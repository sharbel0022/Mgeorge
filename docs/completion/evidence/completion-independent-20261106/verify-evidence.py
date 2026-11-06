"""Post-run integrity audit. No OCR/parser calls and no edits to frozen files.

This is an independent mechanical check of the scorer's input assumptions, not
a new scoring rule or a replacement first pass. It also reads portable archives.
"""
from pathlib import Path
import json, hashlib, collections, unicodedata, datetime, tarfile, sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
RAW = ROOT.parent / 'independent-ocr-raw/completion-independent-20261106/first-pass'

def read(p): return json.loads(p.read_text())
def sha(b): return hashlib.sha256(b).hexdigest()
def filehash(p): return sha(p.read_bytes())

manifest = read(HERE / 'freeze-manifest.json')
assert filehash(HERE / 'freeze-manifest.json') == '246ea4ac2f60d7567fddd2ee57cd7c48bc3f23a4a2b902a1f3fab30ece12781c'
corpus, binding, scores = (read(HERE / n) for n in ('corpus.json', 'runtime-binding.json', 'scores.json'))
receipt = read(HERE / 'run-receipt.json')
cases = corpus['cases']
ids = [c['id'] for c in cases]
assert ids == [f'N{i:02d}' for i in range(1,17)] + [f'S{i:02d}' for i in range(1,4)]
assert len(set(ids)) == 19
assert collections.Counter(c['population'] for c in cases) == {'normal':16,'stress':3}
mandatory = ['invoice_number','party','organization_number','issued_at','due_at','total_cents','net_cents','vat_cents','direction','currency']
image9 = [f for f in mandatory if f != 'direction']
critical = ['invoice_number','party','organization_number','due_at','total_cents','net_cents','vat_cents','reference','bankgiro','direction','currency']
for c in cases:
    assert set(c['gold']) == set(mandatory + ['reference','bankgiro'])
    assert all(c['gold'][f] is not None and c['gold'][f] != '' for f in mandatory)
    assert c['gold']['reference'] is None and c['gold']['bankgiro'] is None
    assert c['review_required'] == (c['population'] == 'stress')

with tarfile.open(HERE / 'frozen-images.tar.gz','r:gz') as tar:
    archive_images = {m.name:tar.extractfile(m).read() for m in tar.getmembers() if m.isfile()}
assert set(archive_images) == {i+'.png' for i in ids}
for c in cases:
    assert sha(archive_images[c['id']+'.png']) == c['image_sha256']
    assert len(archive_images[c['id']+'.png']) == c['image_bytes']
for f in manifest['files']:
    p = Path(f['path'])
    data = archive_images[p.name] if p.suffix == '.png' else (HERE/p.name).read_bytes()
    assert sha(data) == f['sha256'] and len(data) == f['bytes']
for p,h in binding['harnessHashes'].items(): assert filehash(HERE/p) == h

with tarfile.open(HERE / 'raw-first-pass.tar.gz','r:gz') as tar:
    archived = {m.name:tar.extractfile(m).read() for m in tar.getmembers() if m.isfile()}
def stored(p): return json.loads(archived['first-pass/'+Path(p).name])
assert sha(archived['first-pass/run-receipt.json']) == filehash(HERE/'run-receipt.json')
assert sha(archived['first-pass/attempts.jsonl']) == filehash(HERE/'attempts.jsonl')
optical = receipt['optical']; parsers = receipt['parsers']
assert len(optical) == 19 and collections.Counter(x['id'] for x in optical) == collections.Counter(ids)
expected_pairs = {(i,e) for i in ids for e in ['node','sites']}
assert len(parsers) == 38 and {(p['id'],p['engine']) for p in parsers} == expected_pairs
ledger = [json.loads(l) for l in (HERE/'attempts.jsonl').read_text().splitlines()]
for event in ['optical-start','optical-complete']:
    assert collections.Counter(x['id'] for x in ledger if x['event']==event) == collections.Counter(ids)
for event in ['parser-start','parser-complete']:
    assert collections.Counter((x['id'],x['engine']) for x in ledger if x['event']==event) == collections.Counter(expected_pairs)
assert not any(x['event']=='setup-error' for x in ledger)

def canonical(f,v):
    if v is None or isinstance(v,str) and not v.strip(): return None
    if f.endswith('_cents'): return v if type(v) is int else 'INVALID_MINOR_UNIT:'+str(v)
    if f=='party': return ' '.join(unicodedata.normalize('NFKC',str(v)).split()).lower()
    if f=='organization_number': return ''.join(x for x in str(v) if x.isascii() and x.isdigit())
    if f in ['invoice_number','currency']: return str(v).strip().lower()
    if f=='direction': return {'supplier':'incoming','customer':'outgoing'}.get(v,v)
    return str(v).strip()

rows = []
same_fields = same_status = 0
for c in cases:
    o = next(x for x in optical if x['id']==c['id'])
    assert sha(archived['first-pass/'+Path(o['path']).name]) == o['sha256']
    observation = stored(o['path'])
    assert observation['inputSha256'] == c['image_sha256'] and observation['attempt'] == 1
    assert observation['error'] == o['error']
    pair = []
    for e in ['node','sites']:
        p = next(x for x in parsers if x['id']==c['id'] and x['engine']==e)
        assert sha(archived['first-pass/'+Path(p['path']).name]) == p['sha256']
        actual = stored(p['path']); pair.append(actual)
        assert actual['processingError'] == observation['error']
        assert actual['observationSha256'] == o['sha256'] and actual['textSha256'] == o['textSha256']
        assert actual['attempt'] == 1 and actual['inputSha256'] == c['image_sha256']
        error = actual['processingError'] or actual['parserError']
        original = actual['extraction']['level'] if actual['extraction'] else None
        assert actual['effectiveLevel'] == ('red' if error else original or 'red')
        values = {k:v.get('value') for k,v in (actual['extraction'] or {}).get('fields',{}).items()}
        counts = {}
        for f in c['gold']:
            expected, got = canonical(f,c['gold'][f]), canonical(f,values.get(f))
            counts[f] = {'tp':int(expected is not None and expected==got),'fp':int(got is not None and got!=expected),'fn':int(expected is not None and expected!=got)}
        fg = original=='green' and bool(error or c['review_required'] or c['population']=='stress' or any(canonical(f,c['gold'][f])!=canonical(f,values.get(f)) for f in critical))
        scored = next(r for r in scores['details'] if r['id']==c['id'] and r['engine']==e)
        assert scored['falseGreen'] == fg and scored['effectiveLevel'] == actual['effectiveLevel']
        rows.append({'id':c['id'],'engine':e,'population':c['population'],'error':bool(error),'counts':counts})
    same_fields += pair[0]['extraction']['fields'] == pair[1]['extraction']['fields']
    same_status += pair[0]['effectiveLevel'] == pair[1]['effectiveLevel']

for engine in ['node','sites']:
    for population in ['normal','stress']:
        selected=[r for r in rows if r['engine']==engine and r['population']==population]
        for scope,names in [('image9',image9),('mandatory10',mandatory)]:
            counts={k:sum(r['counts'][f][k] for r in selected for f in names) for k in ['tp','fp','fn']}
            expected=scores['summaries'][engine][population][scope]
            assert all(counts[k]==expected[k] for k in counts)
            assert expected['documents']==len(selected) and expected['expectedFields']==len(selected)*len(names)
            assert expected['errors']==sum(r['error'] for r in selected)

successful=[r for r in rows if r['engine']=='node' and r['population']=='normal' and not r['error']]
conditional={k:sum(r['counts'][f][k] for r in successful for f in image9) for k in ['tp','fp','fn']}
conditional.update({'documents':len(successful),'expectedFields':len(successful)*9,'precision':conditional['tp']/(conditional['tp']+conditional['fp']),'recall':conditional['tp']/(conditional['tp']+conditional['fn']),'role':'Post-run diagnostic conditioned on optical completion; does not replace primary fixed-denominator result'})
result={'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed','noOpticalOrParserCalls':True,'frozenFilesVerified':len(manifest['files']),'imagesVerified':19,'opticalAttemptsExactlyOnce':19,'parserAttemptsExactlyOnce':38,'goldSchemaComplete':True,'populationCounts':{'normal':16,'stress':3},'processingErrorPropagationVerified':True,'independentlyRecomputedCountsMatch':True,'pairedIdenticalFieldObjects':same_fields,'pairedIdenticalEffectiveStatus':same_status,'successfulNormalCasesDiagnostic':conditional}
destination=HERE/'verification-receipt.json'
if '--check-only' not in sys.argv:
    with destination.open('x') as f: json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(result,indent=2))
