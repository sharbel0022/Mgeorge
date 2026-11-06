from pathlib import Path
import datetime, hashlib, json, os, resource, subprocess, sys, time

root=Path(__file__).resolve().parent
label='-'+sys.argv[1] if len(sys.argv)>1 else ''
temp=root/'probe-temp'
temp.mkdir(mode=0o700,exist_ok=True)
before=sorted(p.name for p in temp.iterdir())
node='/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node'
command=[node,'--import',str(root/'candidate/scripts/saas-test-isolation.mjs'),'--experimental-strip-types','--test','--test-reporter=tap','--test-concurrency=1','loader-risk.test.mjs']
environment=os.environ.copy();environment['NODE_ENV']='test';environment['TMPDIR']=str(temp)
started=datetime.datetime.now(datetime.timezone.utc).isoformat();clock=time.monotonic()
with (root/('logs/loader-risk'+label+'.tap')).open('xb') as log:
 result=subprocess.run(command,cwd=root,env=environment,stdout=log,stderr=subprocess.STDOUT)
usage=resource.getrusage(resource.RUSAGE_CHILDREN);raw=(root/('logs/loader-risk'+label+'.tap')).read_bytes()
receipt={'sourceCommit':'7a5a397c6543fd762d86005369d6740448876cfe','command':command,'cwd':str(root),'environmentOverrides':{'NODE_ENV':'test','TMPDIR':str(temp)},'startedAt':started,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsedSeconds':time.monotonic()-clock,'exitCode':result.returncode,'maxRssKiB':usage.ru_maxrss,'tempEntriesBefore':before,'tempEntriesAfter':sorted(p.name for p in temp.iterdir()),'rawLog':'logs/loader-risk'+label+'.tap','rawLogSha256':hashlib.sha256(raw).hexdigest(),'rawLogBytes':len(raw),'failureChildIntentional':True,'opticalCalls':0,'liveCalls':0}
(root/('logs/loader-risk'+label+'-result.json')).write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt),flush=True)
sys.exit(result.returncode)
