from pathlib import Path
import datetime, hashlib, json, os, re, resource, subprocess, sys, time
root=Path(__file__).resolve().parent
label=sys.argv[1]
pattern=sys.argv[2] if len(sys.argv)>2 else None
worktree=root/'worktree'
node='/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node'
command=[node,'--import','./scripts/saas-test-isolation.mjs','--experimental-strip-types','--test','--test-reporter=tap','--test-concurrency=1']
if pattern:command.append('--test-name-pattern='+pattern)
command.append('sites/tests/banking-security.test.mjs')
source=worktree/'sites/tests/banking-security.test.mjs'
source_sha=hashlib.sha256(source.read_bytes()).hexdigest()
existing={str(p) for p in Path('/tmp').glob('mg-bank-security-*') if p.is_dir()}
started=datetime.datetime.now(datetime.timezone.utc).isoformat();start=time.monotonic()
log=root/'logs'/(label+'.tap')
with log.open('wb') as out:
 result=subprocess.run(command,cwd=worktree,env={**os.environ,'NODE_ENV':'test'},stdout=out,stderr=subprocess.STDOUT)
text=log.read_text(errors='replace')
counts={key:int(match.group(1)) if (match:=re.search(r'^# '+key+r' (\d+)$',text,re.M)) else None for key in ['tests','pass','fail','cancelled','skipped','todo']}
leftovers=sorted({str(p) for p in Path('/tmp').glob('mg-bank-security-*') if p.is_dir()}-existing)
evidence={'label':label,'command':command,'cwd':str(worktree),'env':{'NODE_ENV':'test'},'startedAt':started,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':result.returncode,'elapsedSeconds':round(time.monotonic()-start,6),'maxRssKb':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,'counts':counts,'node':'v24.22.1','log':str(log),'logSha256':hashlib.sha256(log.read_bytes()).hexdigest(),'testSourceSha256':source_sha,'testSourceUnchangedDuringRun':source_sha==hashlib.sha256(source.read_bytes()).hexdigest(),'newTemporaryModuleDirectoriesRemaining':leftovers,'transportDisconnection':False}
(root/(label+'.json')).write_text(json.dumps(evidence,indent=2)+'\n')
print(json.dumps(evidence,indent=2))
sys.exit(result.returncode if result.returncode>=0 else 1)
