"""GET public GitHub metadata without an Authorization header; keep a bounded receipt."""
import argparse
import base64
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
PREFIX = 'https://api.github.com/repos/sharbel0022/Mgeorge'


def now():
    return datetime.now(timezone.utc).isoformat()


def select(value, names):
    return {name: value.get(name) for name in names}


def sanitize(payload, kind):
    if kind == 'repo':
        return select(payload, ['id', 'full_name', 'private', 'default_branch', 'archived', 'disabled', 'created_at', 'updated_at', 'pushed_at', 'html_url'])
    if kind == 'workflow':
        return select(payload, ['id', 'name', 'path', 'state', 'created_at', 'updated_at', 'html_url', 'url'])
    if kind == 'branch':
        commit = payload['commit']
        return {**select(payload, ['name', 'protected']), 'commit': {'sha': commit['sha'], 'url': commit['url'], 'committedAt': commit['commit']['committer']['date']}}
    if kind in ['runs', 'run']:
        fields = ['id', 'workflow_id', 'name', 'path', 'run_number', 'run_attempt', 'event', 'status', 'conclusion', 'head_branch', 'head_sha', 'created_at', 'updated_at', 'run_started_at', 'html_url', 'url', 'jobs_url', 'logs_url']
        if kind == 'run':
            return select(payload, fields)
        return {'total_count': payload['total_count'], 'returned_count': len(payload['workflow_runs']), 'workflow_runs': [select(run, fields) for run in payload['workflow_runs']]}
    if kind == 'content':
        assert payload['encoding'] == 'base64'
        content = base64.b64decode(''.join(payload['content'].split()), validate=True)
        assert len(content) == payload['size']
        blob = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
        assert blob == payload['sha']
        return {**select(payload, ['name', 'path', 'sha', 'size', 'type', 'html_url']), 'sha256': hashlib.sha256(content).hexdigest(), 'gitBlobShaVerified': True, 'text': content.decode('utf-8')}
    if kind == 'jobs':
        jobs = []
        for job in payload['jobs']:
            item = select(job, ['id', 'run_id', 'run_attempt', 'name', 'status', 'conclusion', 'started_at', 'completed_at', 'head_sha', 'head_branch', 'html_url'])
            item['steps'] = [select(step, ['number', 'name', 'status', 'conclusion', 'started_at', 'completed_at']) for step in job.get('steps', [])]
            jobs.append(item)
        return {'total_count': payload['total_count'], 'returned_count': len(jobs), 'jobs': jobs}
    raise ValueError('Unsupported read kind')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('name')
    parser.add_argument('kind', choices=['repo', 'workflow', 'branch', 'runs', 'run', 'content', 'jobs'])
    parser.add_argument('url')
    args = parser.parse_args()
    assert args.url == PREFIX or args.url.startswith(PREFIX + '/')
    assert all(c.isalnum() or c in '-_' for c in args.name)
    record = {'method': 'GET', 'url': args.url, 'requestedAt': now(), 'authentication': 'none', 'authorizationHeaderSent': False, 'kind': args.kind}
    request = Request(args.url, headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'Mgeorge-readonly-schedule-followup', 'X-GitHub-Api-Version': '2022-11-28', 'Cache-Control': 'no-cache'}, method='GET')
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read(5 * 1024 * 1024 + 1)
            assert len(raw) <= 5 * 1024 * 1024
            record.update({'observedAt': now(), 'httpStatus': response.status, 'headers': {key: response.headers.get(key) for key in ['Date', 'ETag', 'Age', 'X-GitHub-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Link']}, 'responseBytes': len(raw), 'responseSha256': hashlib.sha256(raw).hexdigest(), 'data': sanitize(json.loads(raw), args.kind)})
    except Exception as error:
        record.update({'observedAt': now(), 'httpStatus': error.code if isinstance(error, HTTPError) else None, 'errorType': type(error).__name__, 'error': str(error)[:1000]})
    destination = ROOT / (args.name + '.json')
    destination.write_text(json.dumps(record, indent=2, ensure_ascii=False) + '\n')
    data = record.get('data', {})
    summary = {'name': args.name, 'httpStatus': record.get('httpStatus'), 'observedAt': record['observedAt'], 'error': record.get('error')}
    if args.kind == 'runs':
        summary.update({'total_count': data.get('total_count'), 'returned_count': data.get('returned_count'), 'latest': data.get('workflow_runs', [None])[0] if data.get('workflow_runs') else None})
    elif args.kind == 'content':
        summary.update({key: data.get(key) for key in ['path', 'sha', 'size', 'sha256', 'gitBlobShaVerified']})
    else:
        summary['data'] = data
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    main()
