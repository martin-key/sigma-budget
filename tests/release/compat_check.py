#!/usr/bin/env python3
"""The compatibility of code and data (docs/approach-specification.md, sections 10.1 and 11, stage E).

    python3 -m tests.release.compat_check                                 the code against itself and against the releases in data/release/releases
    python3 -m tests.release.compat_check --env-url https://staging.…     also against the current release of an environment, before a deploy

The code says which data contracts it reads in three places, and they must agree:
  apps/web/workers/api/store.js SUPPORTED        what the Worker accepts in a manifest (it refuses to publish anything else)
  pipeline/budget_pipeline/cli.py compatibility    what a release built by this code declares
  apps/web/client/data.js parse            what the pages read: run here on the published execution.json, every amount must become a number
Then every release this code may meet must use a contract it reads: the releases published with the site, their execution.json, and with
--env-url the release that is current in an environment (a code deploy must not leave the screens unable to read the data on them).
Exit 0 when all agree, 1 when not, 2 when the environment cannot be read.
"""


from pathlib import Path as _Path
import argparse
import json
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
fails = []


def ok(cond, msg):
    print(('  ok    ' if cond else '  FAIL  ') + msg)
    if not cond:
        fails.append(msg)


def supported_worker():
    m = re.search(r"export const SUPPORTED = (\{[^;]*\});", (ROOT / 'apps' / 'web' / 'workers' / 'api' / 'store.js').read_text(encoding='utf-8'))
    return json.loads(re.sub(r"(\w+):", r'"\1":', m.group(1)).replace("'", '"')) if m else {}


def supported_budget():
    m = re.search(r'"compatibility": \{"execution": (\[[^\]]*\])', (ROOT / 'pipeline' / 'budget_pipeline' / 'cli.py').read_text(encoding='utf-8'))
    return {'execution': json.loads(m.group(1))} if m else {}


def node_parse(path):
    """apps/web/client/data.js parse('execution', text) in Node: how many amounts are not numbers after it (the pages compute with numbers)"""
    script = ("import { readFileSync } from 'node:fs';\n"
              "const { parse } = await import(new URL('apps/web/client/data.js', 'file://' + process.argv[1] + '/').href);\n"
              "const d = parse('execution', readFileSync(process.argv[2], 'utf8'));\n"
              "let bad = 0, all = 0;\n"
              "for (const b of Object.values(d.data || {})) for (const c of ['kfp', 'nat', 'eu']) for (const a of Object.values(b[c] || {})) for (const v of a) { all++; if (v !== null && typeof v !== 'number') bad++; }\n"
              "console.log(JSON.stringify({ bad, all, schema: d.contract && d.contract.schema }));\n")
    r = subprocess.run(['node', '--input-type=module', '-e', script, str(ROOT), str(path)], capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 else {'error': (r.stderr or r.stdout)[-300:]}


def check_manifest(m, where, sup):
    for name, version in (m.get('data_schema') or {}).items():
        if name in sup:
            ok(version in sup[name], f'{where}: {name} is {version}, which this code reads ({", ".join(sup[name])})')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--env-url', help='the address of an environment: its current release must be readable by this code')
    a = ap.parse_args()

    print('the code')
    w, b = supported_worker(), supported_budget()
    ok(bool(w.get('execution')), f'apps/web/workers/api/store.js SUPPORTED names the execution contracts ({w})')
    ok(w == b, f'pipeline/budget_pipeline/cli.py declares the same contracts as the Worker accepts ({b})')
    ex = ROOT / 'data' / 'release' / 'execution.json'
    r = node_parse(ex)
    ok('error' not in r and r.get('all', 0) > 0 and r.get('bad') == 0,
       f'apps/web/client/data.js reads execution.json (contract {r.get("schema")}): {r.get("all")} amounts, {r.get("bad")} not numbers {r.get("error", "")}')
    schema = json.loads(ex.read_text(encoding='utf-8')).get('contract', {}).get('schema')
    ok(f'execution/{schema}' in w.get('execution', []), f'data/release/execution.json is execution/{schema}, which the Worker accepts')

    print('the releases published with the site')
    rels = sorted((ROOT / 'data' / 'release' / 'releases').glob('*/manifest.json'))
    ok(bool(rels), f'{len(rels)} release(s) in data/release/releases')
    cur = json.loads((ROOT / 'data' / 'release' / 'releases' / 'current.json').read_text(encoding='utf-8'))
    for mp in rels:
        m = json.loads(mp.read_text(encoding='utf-8'))
        check_manifest(m, 'release ' + mp.parent.name[:12], w)
        if mp.parent.name == cur.get('release_id'):
            ok(m.get('data_schema', {}).get('execution') == f'execution/{schema}',
               f'the current release declares the contract of data/release/execution.json (execution/{schema})')

    if a.env_url:
        base = a.env_url.rstrip('/')
        print('the current release of ' + base)
        try:
            with urllib.request.urlopen(urllib.request.Request(base + '/api/releases/current', headers={'User-Agent': 'compat-check'}), timeout=30) as res:
                c = json.load(res)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                print('  —     no release is current there: nothing to read yet')
                return 1 if fails else 0
            print(f'cannot read {base}/api/releases/current: HTTP {e.code}', file=sys.stderr)
            return 2
        except (urllib.error.URLError, OSError) as e:
            print(f'cannot read {base}/api/releases/current: {e}', file=sys.stderr)
            return 2
        with urllib.request.urlopen(urllib.request.Request(base + c['manifest'], headers={'User-Agent': 'compat-check'}), timeout=60) as res:
            check_manifest(json.load(res), 'release ' + c['release_id'][:12], w)

    print(f'RESULT: {"FAIL" if fails else "PASS"} · {len(fails)} failed')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
