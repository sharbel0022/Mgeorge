import datetime
import hashlib
import json
import os
import pathlib
import re
import resource
import subprocess
import sys
import time

label, cwd, *command = sys.argv[1:]
directory = pathlib.Path(__file__).resolve().parent
log = directory / (label + '.tap')
receipt = directory / (label + '.json')
if log.exists() or receipt.exists():
    raise SystemExit('Refusing to overwrite a preserved run')
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
env = dict(os.environ, NODE_ENV='test', CLOUDFLARE_CF_FETCH_ENABLED='false', WRANGLER_SEND_METRICS='false')
begin = time.monotonic()
with log.open('wb') as output:
    process = subprocess.run(command, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT)
raw = log.read_bytes()
text = raw.decode('utf-8', errors='replace')
counts = {key: int(value) for key, value in re.findall(r'^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$', text, re.MULTILINE)}
result = {
    'label': label,
    'startedAt': started,
    'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'cwd': cwd,
    'command': command,
    'environment': {key: env[key] for key in ('NODE_ENV', 'CLOUDFLARE_CF_FETCH_ENABLED', 'WRANGLER_SEND_METRICS')},
    'returncode': process.returncode,
    'signal': -process.returncode if process.returncode < 0 else None,
    'durationSeconds': round(time.monotonic() - begin, 3),
    'maxRssKiB': resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
    'counts': counts,
    'log': str(log),
    'logSha256': hashlib.sha256(raw).hexdigest(),
}
receipt.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
