"""Apply the unmodified production wrapper to the separately generated raw donor results."""
import hashlib
import importlib.util
import json
import sys
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURE = HERE.parent
if sys.version_info[:2] != (3, 12): raise SystemExit('Python 3.12 required')
if hashlib.sha256((HERE / 'datasets.py').read_bytes()).hexdigest() != '02234d24a03c387690d03b714eb7d413d334726951bcfa0034bc0a6325778790': raise SystemExit('production wrapper changed')
sys.dont_write_bytecode = True
sys.path.insert(0, str(FIXTURE / 'donor'))
from budget_pipeline.validate import checks
checks.DATA = str(FIXTURE / 'corpus/data/release')
base = types.ModuleType('budget_pipeline.validate.base'); base.all_groups = lambda: []
execution = types.ModuleType('budget_pipeline.validate.execution'); execution.GROUPS = ()
sys.modules[base.__name__] = base
sys.modules[execution.__name__] = execution
spec = importlib.util.spec_from_file_location('budget_pipeline.validate.datasets', HERE / 'datasets.py')
module = importlib.util.module_from_spec(spec); sys.modules[spec.name] = module; spec.loader.exec_module(module)
raw = {**json.loads((FIXTURE / 'oracle.json').read_text()), **json.loads((FIXTURE / 'oracle-extra.json').read_text())}
out = {}
for case, groups in raw.items():
    out[case] = {}
    for name, result in groups.items():
        if 'crash' in result:
            out[case][name] = result
            continue
        def build(_ctx):
            c = checks.Check(name); c.n=result['n']; c.problems=list(result['problems']); c.warnings=list(result['warnings']); c.facts=list(result['facts']); return c
        module._used.clear(); module._hit.clear()
        c = module.wrap(name, build, True)(None)
        out[case][name] = {'name':c.name, 'n':c.n, 'problems':c.problems, 'warnings':c.warnings, 'facts':c.facts, 'exceptions':[list(x) for x in module._used]}
encoded = (json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
path = HERE / 'oracle.json'
if '--check' in sys.argv:
    if not path.exists() or path.read_bytes() != encoded: raise SystemExit('wrapper oracle differs')
else: path.write_bytes(encoded)

# Audit the actual registration declarations and exercise datasets.main's default
# and --no-accepted paths with its real wrap function over the frozen donor result.
import ast
import contextlib
import io
pins = {'base.py':'8a4067e045e2b72eec24603f37b0d72ed37ee04b87f1713ebc6a4d3733791fe3',
        'foundations.py':'c7b713c7c45798c528c0ba5e082b2127347a63ab6bed5bd50dd32ae7c59c452b'}
for filename, digest in pins.items():
    if hashlib.sha256((HERE / filename).read_bytes()).hexdigest() != digest: raise SystemExit('registration donor changed: ' + filename)
def assignment(path, name):
    tree = ast.parse((HERE / path).read_text())
    return next(n.value for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in n.targets))
modules = assignment('base.py', 'MODULES')
if 'foundations' not in [n.id for n in modules.elts]: raise SystemExit('foundation registration changed')
groups = assignment('foundations.py', 'GROUPS')
registered = {n.elts[0].value:n.elts[1].id for n in groups.elts if isinstance(n, ast.Tuple)}
if registered.get('CORE') != 'g_core' or registered.get('CATALOG') != 'g_catalog': raise SystemExit('group registration changed')
selected = raw['baseline']
def original_groups():
    def fn(name):
        def run(_ctx):
            result=selected[name]; c=checks.Check(name); c.n=result['n']; c.problems=list(result['problems']); c.warnings=list(result['warnings']); c.facts=list(result['facts']); return c
        return run
    return [(name,fn(name),'') for name in ('CORE','CATALOG')]
def drive(argv):
    seen = {}
    base.all_groups = original_groups
    def fake_main(passed):
        seen['argv'] = passed
        seen['groups'] = {}
        for name, fn, _ in base.all_groups():
            c=fn(None); seen['groups'][name]={'name':c.name,'n':c.n,'problems':c.problems,'warnings':c.warnings,'facts':c.facts}
        return int(any(x['problems'] for x in seen['groups'].values()))
    base.main = fake_main; module._used.clear(); module._hit.clear()
    with contextlib.redirect_stdout(io.StringIO()): seen['exit'] = module.main(argv)
    return seen
main_out={'default':drive(['--only','CORE,CATALOG']), 'noAccepted':drive(['--only','CORE,CATALOG','--no-accepted'])}
encoded_main=(json.dumps(main_out,ensure_ascii=False,separators=(',',':'))+'\n').encode()
main_path=HERE/'main-oracle.json'
if '--check' in sys.argv:
    if not main_path.exists() or main_path.read_bytes()!=encoded_main: raise SystemExit('main wrapper oracle differs')
else: main_path.write_bytes(encoded_main)
