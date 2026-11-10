"""Regenerate FEED observations using only the frozen Python 3.12 donor and corpus."""
import hashlib
import importlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
if sys.version_info[:2] != (3, 12):
    raise SystemExit('Python 3.12 required')
manifest = json.loads((HERE / 'provenance.json').read_text())
paths = {str(p.relative_to(HERE)) for directory in ('donor', 'corpus') for p in (HERE / directory).rglob('*') if p.is_file()}
if paths != set(manifest['files']):
    raise SystemExit('Frozen input file set changed')
for name, digest in manifest['files'].items():
    if hashlib.sha256((HERE / name).read_bytes()).hexdigest() != digest:
        raise SystemExit('Frozen input changed: ' + name)
for key, name in (('casesSha256', 'cases.json'), ('helperCasesSha256', 'helper-cases.json'), ('generatorSha256', 'generate.py')):
    if hashlib.sha256((HERE / name).read_bytes()).hexdigest() != manifest[key]:
        raise SystemExit('Frozen scenario or generator changed: ' + name)
sys.path.insert(0, str(HERE / 'donor/pipeline'))
os.environ['BUDGET_DATA_DIR'] = str(HERE / 'corpus/data/release')
os.environ['BUILD_DATE'] = '2026-11-08'
os.environ.pop('BNS_SITE_URL', None)
from budget_pipeline.validate import checks, search_feed, datasets, base
import budget_pipeline.routes as routes

assert next(g for g in base.all_groups() if g[0] == 'FEED')[1] is search_feed.g_feed
cases = json.loads((HERE / 'cases.json').read_text())

def apply(root, ops):
    for op in ops:
        path = root / 'data/release' / op['file']
        if op['op'] == 'text':
            text = path.read_text(encoding='utf8')
            if op['old'] not in text: raise ValueError(op)
            path.write_text(text.replace(op['old'], op['new'], 1), encoding='utf8')
            continue
        obj = json.loads(path.read_text(encoding='utf8'))
        target = obj
        for key in op['path'][:-1]: target = target[key]
        key = op['path'][-1]
        if op['op'] == 'set': target[key] = op['value']
        elif op['op'] == 'delete': del target[key]
        elif op['op'] == 'append': target[key].append(op['value'])
        elif op['op'] == 'reverse': target[key].reverse()
        else: raise ValueError(op)
        path.write_text(json.dumps(obj, ensure_ascii=False), encoding='utf8')

def capture(c):
    return {'name': c.name, 'n': c.n, 'problems': c.problems, 'warnings': c.warnings, 'facts': c.facts}

def run(root, accepted):
    checks.DATA = str(root / 'data/release')
    routes.CATALOGUE = root / 'apps/web/app/lib/routes.json'
    original = routes.load_routes
    routes.load_routes = lambda: original(routes.CATALOGUE)
    try:
        importlib.reload(datasets)
        datasets._used.clear(); datasets._hit.clear()
        c = datasets.wrap('FEED', search_feed.g_feed, accepted)(checks.Ctx())
        return {'check': capture(c), 'exceptions': [list(x) for x in datasets._used]}
    except Exception as e:
        return {'crash': type(e).__name__ + ': ' + str(e)}
    finally:
        routes.load_routes = original

results = {}
with tempfile.TemporaryDirectory() as td:
    for case in cases:
        root = Path(td) / case['name']
        shutil.copytree(HERE / 'corpus', root)
        apply(root, case['ops'])
        results[case['name']] = {'raw': run(root, False), 'default': run(root, True), 'noAccepted': run(root, False)}
encoded = (json.dumps(results, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
out = HERE / 'oracle.json'
if '--check' in sys.argv:
    if not out.exists() or out.read_bytes() != encoded or hashlib.sha256(encoded).hexdigest() != manifest['oracleSha256']:
        raise SystemExit('Donor results differ')
else:
    out.write_bytes(encoded)
helper_cases = json.loads((HERE / 'helper-cases.json').read_text())
helper_results = []
for case in helper_cases:
    result = {}
    for name, fn in [('money', search_feed.money_in), ('eur', search_feed.eur_in), ('pct', search_feed.pct_in)]:
        try: result[name] = fn(case)
        except Exception as e: result[name] = {'crash': type(e).__name__}
    c = checks.Check('TEXT')
    search_feed.clean_text(c, 'text', case, sentence=True)
    result['clean'] = capture(c)
    try:
        a = checks.Check('AMOUNTS')
        search_feed.amounts(a, 'amount', case, money=[1])
        result['amounts'] = capture(a)
    except Exception as e: result['amounts'] = {'crash': type(e).__name__}
    helper_results.append(result)
helper_encoded = (json.dumps(helper_results, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
helper_out = HERE / 'helpers-oracle.json'
if '--check' in sys.argv:
    if not helper_out.exists() or helper_out.read_bytes() != helper_encoded or hashlib.sha256(helper_encoded).hexdigest() != manifest['helpersOracleSha256']:
        raise SystemExit('Donor helper results differ')
else:
    helper_out.write_bytes(helper_encoded)
