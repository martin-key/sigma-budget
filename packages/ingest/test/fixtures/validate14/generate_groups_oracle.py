"""Generate wave14 observations from immutable baseline Python files and frozen inputs.

Producer existence and tracked-code paths are materialized from tracked-paths.json;
placeholder bytes do not claim to reconstruct source files. Historical originals are
absent. Mutation scenarios apply to isolated temporary copies only.
"""
import ast
import hashlib
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import types
from pathlib import Path
import yaml

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
if sys.version_info[:2] != (3, 12):
    raise SystemExit('Python 3.12 is required')
provenance = json.loads((HERE / 'groups-provenance.json').read_text(encoding='utf8'))
actual_corpus = {str(p.relative_to(HERE)) for p in (HERE / 'corpus').rglob('*') if p.is_file()}
expected_corpus = {p for p in provenance['inputs'] if p.startswith('corpus/')}
if actual_corpus != expected_corpus:
    raise SystemExit('Frozen corpus file set changed')
for rel, wanted in provenance['inputs'].items():
    if hashlib.sha256((HERE / rel).read_bytes()).hexdigest() != wanted:
        raise SystemExit('Frozen input changed: ' + rel)

def package(name):
    mod = types.ModuleType(name)
    mod.__path__ = []
    sys.modules[name] = mod
    return mod

def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, HERE / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod

package('budget_pipeline'); package('budget_pipeline.validate'); package('budget_pipeline.build')
contract = load('budget_pipeline.validate.execution_contract', 'execution_contract.py')
checks = load('budget_pipeline.validate.checks', 'donor/checks.py')
routes = load('budget_pipeline.routes', 'donor/routes.py')
catalog = types.ModuleType('budget_pipeline.validate.catalog')
catalog.g_core = catalog.g_catalog = lambda ctx: None
sys.modules[catalog.__name__] = catalog
periods = types.ModuleType('budget_pipeline.build.annual_periods')
tree = ast.parse((HERE / 'donor/annual_periods.py').read_text())
periods.PERIODS = ast.literal_eval(next(n.value for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'PERIODS' for t in n.targets)))
sys.modules[periods.__name__] = periods
foundations = load('budget_pipeline.validate.foundations', 'donor/foundations.py')
registry = load('budget_pipeline.validate.registry', 'donor/registry.py')
base = types.ModuleType('budget_pipeline.validate.base'); base.all_groups = lambda: []
sys.modules[base.__name__] = base
execution = types.ModuleType('budget_pipeline.validate.execution'); execution.GROUPS = ()
sys.modules[execution.__name__] = execution
# datasets initializes feed counts during import; set to the immutable corpus.
checks.DATA = str(HERE / 'corpus/data/release')
datasets = load('budget_pipeline.validate.datasets', 'donor/datasets.py')

FUNCS = {'INPUTS': foundations.g_inputs, 'ENVELOPE': foundations.g_envelope,
         'NUMBERS': foundations.g_numbers, 'SIZES': foundations.g_sizes,
         'PRIVACY': foundations.g_privacy, 'GLOSSARY': foundations.g_glossary}
tracked = json.loads((HERE / 'tracked-paths.json').read_text())
cases = json.loads((HERE / 'cases.json').read_text())

def build(root):
    shutil.copytree(HERE / 'corpus', root, dirs_exist_ok=True)
    for rel in tracked:
        if not rel.startswith(('pipeline/', 'apps/', 'tests/', '.github/', 'docs/')):
            continue
        path = root / rel
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'')

def apply(root, ops):
    added = []
    for op in ops:
        p = root / op['file']
        p.parent.mkdir(parents=True, exist_ok=True)
        if op['op'] == 'set':
            obj = yaml.safe_load(p.read_text()) if p.suffix == '.yaml' else json.loads(p.read_text())
            dest = obj
            for key in op['path'][:-1]: dest = dest[key]
            dest[op['path'][-1]] = op['value']
            p.write_text(json.dumps(obj, ensure_ascii=False), encoding='utf8')
        elif op['op'] == 'deleteKey':
            obj = yaml.safe_load(p.read_text()) if p.suffix == '.yaml' else json.loads(p.read_text())
            dest = obj
            for key in op['path'][:-1]: dest = dest[key]
            del dest[op['path'][-1]]
            p.write_text(json.dumps(obj, ensure_ascii=False), encoding='utf8')
        elif op['op'] == 'write':
            p.write_text(op['text'], encoding='utf8'); added.append(op['file'])
        elif op['op'] == 'append':
            with p.open('a', encoding='utf8') as fh: fh.write(op['text'])
        elif op['op'] == 'deleteFile': p.unlink()
        elif op['op'] == 'duplicateFirstLine':
            lines = p.read_text().splitlines(); p.write_text('\n'.join(lines + [lines[0]]) + '\n')
        elif op['op'] == 'repeat': p.write_text(op['char'] * op['count'], encoding='utf8')
        elif op['op'] == 'hashNoise': p.write_text(''.join(hashlib.sha256(str(i).encode()).hexdigest() for i in range(op['count'])), encoding='utf8')
        else: raise ValueError(op)
    return added

def capture(c):
    return {'name':c.name,'n':c.n,'problems':c.problems,'warnings':c.warnings,'facts':c.facts}

def run(root, case, added):
    checks.ROOT = str(root); checks.DATA = str(root/'data/release'); checks.SITE = str(root/'apps/web/public')
    registry.ROOT = root; registry.DATA = root/'data/release'; registry.SUMS = root/'data/originals.sha256'
    original_routes = routes.load_routes
    routes.load_routes = lambda: original_routes(root/'apps/web/app/lib/routes.json')
    ctx = checks.Ctx()
    result = {}
    for name in case['groups']:
        if name == 'REGISTRY':
            rr = registry.Report()
            sr = yaml.safe_load((root/'data/sources.yaml').read_text())
            dr = yaml.safe_load((root/'data/datasets.yaml').read_text())
            ids, inter = registry.check_sources(sr, rr)
            ds = registry.check_datasets(dr, ids, inter, rr)
            old = registry.subprocess.run
            registry.subprocess.run = lambda *a, **kw: types.SimpleNamespace(stdout=('\0'.join(tracked + added)+'\0').encode())
            try: registry.check_paths(rr)
            finally: registry.subprocess.run = old
            result[name] = {'errors':rr.errors, 'gaps':registry.gaps(ds, inter),
                'describedInputs':[i['path'] for i in inter if i.get('category') == 'described-input'],
                'sourceExceptions':{d['id']:d['notRebuilt'] for d in ds if d['status'] != 'pending' and d.get('notRebuilt') and not d.get('rebuild')}}
        else:
            try:
                raw = FUNCS[name](ctx)
                datasets._used.clear(); datasets._hit.clear()
                accepted = datasets.wrap(name, FUNCS[name], True)(ctx)
                result[name] = {'raw': capture(raw), 'accepted': capture(accepted),
                                'exceptions':[list(x) for x in datasets._used]}
            except Exception as e:
                result[name] = {'crash': type(e).__name__ + ': ' + str(e)}
    routes.load_routes = original_routes
    return result

out = {}
with tempfile.TemporaryDirectory() as temp:
    for case in cases:
        root = Path(temp)/case['name']; root.mkdir()
        build(root); added = apply(root, case['ops'])
        out[case['name']] = run(root, case, added)
        shutil.rmtree(root)
sample = {'items':[{'id':'x', 'value':1}, {'id':'y', 'value':None}, True, 3.5], 'empty':{}}
checker = checks.Check('HELPERS')
checker.ok(True, 'ok'); checker.near(1, 2, 0.5, 'distance'); checker.warn('warning'); checker.fact('fact')
fmt_cases = [[v, nd, checks.fmt(v, nd)] for v, nd in [(12345.6,1),(-12345.6,1),(-0.0,1),(2.675,2),(1.25,1),(1.35,1),(999.5,0),(None,1),(True,1)]]
helpers = {'walk':list(checks.walk(sample)), 'pattern':checks.pattern('$.items[12].value[3]'),
           'numbersIn':checks.numbers_in(sample), 'total':checks.total([1, True, 2.5, None]),
           'byId':checks.by_id([{'id':'x','v':1},{'id':'x','v':2},{'v':3},None]),
           'fmt':fmt_cases, 'check':capture(checker),
           'gzip':[checks.gz_size(b'abc' * 1000), 0]}
# The second sample is stable UTF-8, independent of object repr or runtime addresses.
helpers['gzip'][1] = checks.gz_size(('тест ' * 300).encode())
helper_bytes = (json.dumps(helpers, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
helper_path = HERE / 'helpers-oracle.json'
if '--check' in sys.argv:
    if not helper_path.exists() or helper_path.read_bytes() != helper_bytes or hashlib.sha256(helper_bytes).hexdigest() != provenance['helpersOracleSha256']:
        raise SystemExit('Helper oracle differs from frozen donor')
else:
    helper_path.write_bytes(helper_bytes)
encoded = (json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
path = HERE / 'groups-oracle.json'
if '--check' in sys.argv:
    if not path.exists() or path.read_bytes() != encoded or hashlib.sha256(encoded).hexdigest() != provenance['oracleSha256']:
        raise SystemExit('Group oracle differs from frozen donor')
else:
    path.write_bytes(encoded)
