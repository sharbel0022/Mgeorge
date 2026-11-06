from pathlib import Path
import datetime, hashlib, json, os, resource, subprocess, sys, time

root = Path(__file__).resolve().parent
cwd = root / 'candidate'
temp = root / 'runtime-temp'
temp.mkdir(mode=0o700, exist_ok=True)
before = sorted(p.name for p in temp.iterdir())
node = '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node'
command = [node, '--import', './scripts/saas-test-isolation.mjs',
           '--experimental-strip-types', '--test', '--test-reporter=tap',
           '--test-concurrency=1', 'sites/tests/banking-security.test.mjs']
environment = os.environ.copy()
environment['NODE_ENV'] = 'test'
environment['TMPDIR'] = str(temp)
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
clock = time.monotonic()
with (root / 'logs/full-bank.tap').open('wb') as log:
    result = subprocess.run(command, cwd=cwd, env=environment, stdout=log, stderr=subprocess.STDOUT)
elapsed = time.monotonic() - clock
usage = resource.getrusage(resource.RUSAGE_CHILDREN)
raw = (root / 'logs/full-bank.tap').read_bytes()
receipt = {
    'sourceCommit': '7a5a397c6543fd762d86005369d6740448876cfe',
    'command': command, 'cwd': str(cwd),
    'environmentOverrides': {'NODE_ENV': 'test', 'TMPDIR': str(temp)},
    'nodeOptionsInherited': bool(environment.get('NODE_OPTIONS')),
    'startedAt': started,
    'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'elapsedSeconds': elapsed, 'exitCode': result.returncode,
    'maxRssKiB': usage.ru_maxrss,
    'rssMethod': 'Linux resource.getrusage(RUSAGE_CHILDREN).ru_maxrss for this single Node invocation and its reaped test process',
    'tempEntriesBefore': before, 'tempEntriesAfter': sorted(p.name for p in temp.iterdir()),
    'rawLog': 'logs/full-bank.tap', 'rawLogSha256': hashlib.sha256(raw).hexdigest(),
    'rawLogBytes': len(raw), 'opticalCalls': 0, 'liveCalls': 0,
}
(root / 'logs/full-bank-result.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt), flush=True)
sys.exit(result.returncode)
