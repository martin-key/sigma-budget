"""Regenerate observations from the frozen 810b0f donor and byte-pinned corpus.

No live repository paths or unfrozen originals are read. Mutations are applied
only to temporary copies. Source evidence is read from the pinned corpus.
"""
import ast
import hashlib
import importlib.util
import json
import shutil
import sys
import tempfile
import types
import zipfile
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
if sys.version_info[:2] != (3, 12):
    raise SystemExit('Python 3.12 is required')
provenance_path = HERE / 'provenance.json'
provenance = json.loads(provenance_path.read_text())
if '--check' in sys.argv and hashlib.sha256((HERE / 'cases.json').read_bytes()).hexdigest() != provenance['scenariosSha256']:
    raise SystemExit('scenario definitions changed')
if '--check' in sys.argv and hashlib.sha256((HERE / 'sum-cases.json').read_bytes()).hexdigest() != provenance['sumCasesSha256']:
    raise SystemExit('sum scenarios changed')
for path, digest in provenance['inputs'].items():
    if hashlib.sha256((HERE / path).read_bytes()).hexdigest() != digest:
        raise SystemExit('frozen input changed: ' + path)
actual = {str(p.relative_to(HERE)) for folder in ('corpus', 'donor', 'evidence') for p in (HERE / folder).rglob('*') if p.is_file()}
if actual != set(provenance['inputs']):
    raise SystemExit('frozen input set changed')

def package(name):
    module = types.ModuleType(name)
    module.__path__ = []
    sys.modules[name] = module

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, HERE / 'donor' / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

package('budget_pipeline')
package('budget_pipeline.validate')
checks = load('budget_pipeline.validate.checks', 'checks.py')
load('budget_pipeline.validate.execution_contract', 'execution_contract.py')
routes = load('budget_pipeline.routes', 'routes.py')
original_routes = routes.load_routes
routes.load_routes = lambda: original_routes(HERE / 'corpus/apps/web/app/lib/routes.json')
# The imported KFP function is not called by the fiscal groups.
execution_reports = types.ModuleType('budget_pipeline.validate.execution_reports')
execution_reports.g_kfp = None
sys.modules[execution_reports.__name__] = execution_reports
catalog = types.ModuleType('budget_pipeline.validate.catalog')
tree = ast.parse((HERE / 'donor/catalog.py').read_text())
catalog.INTERNAL = ast.literal_eval(next(n.value for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'INTERNAL' for t in n.targets)))
sys.modules[catalog.__name__] = catalog
fiscal = load('budget_pipeline.validate.fiscal', 'fiscal.py')
law = load('budget_pipeline.validate.law', 'law.py')
budgets = load('budget_pipeline.validate.budgets', 'budgets.py')
functions = {'ANNEX3': fiscal.g_annex3, 'REVENUE': fiscal.g_revenue, 'EXPENDITURE': fiscal.g_expenditure,
             'MEASURES': fiscal.g_measures, 'LAW': law.g_law, 'BUDGETS': budgets.g_budgets, 'PROGRAMS': budgets.g_programs}

def mutate(root, operation):
    if operation['op'] == 'deleteOriginal':
        (root / 'data/originals' / operation['file']).unlink()
        return
    path = root / 'data/release' / operation['file']
    if operation['op'] == 'deleteFile':
        path.unlink()
        return
    if operation['op'] == 'writeRaw':
        path.write_text(operation['text'], encoding='utf8')
        return
    if operation['op'] == 'copyFile':
        shutil.copyfile(path, path.with_name(operation['name']))
        return
    data = json.loads(path.read_text(encoding='utf8'))
    node = data
    for key in operation['path'][:-1]:
        node = node[key]
    key = operation['path'][-1]
    if operation['op'] == 'evidenceDocxPage':
        with zipfile.ZipFile(HERE / 'corpus/data/originals/parliament/52-602-01-19.docx') as archive:
            xml = archive.read('word/document.xml').decode('utf8')
        marker = 'Повишаване на максималния осигурителен доход'
        assert xml.count(marker) == 1
        before = xml[:xml.index(marker)]
        node[key] = 1 + before.count('lastRenderedPageBreak') + before.count('w:type="page"')
        assert node[key] == 215
    elif operation['op'] == 'evidencePage':
        evidence = json.loads((HERE / 'evidence/programme-pdf.json').read_text())
        cells = evidence['0200_Администрация на президента.pdf']['cells']
        node[key] = next(value['pages'] for name, value in cells if name == ['Проект 2026', 'total'])
    elif operation['op'] == 'evidenceAdopted':
        evidence = json.loads((HERE / 'evidence/parliament.json').read_text())
        node[key] = next(x['L_Act_St_date'] for x in evidence['zdb']['activity'] if x['L_Act_St2_name'] == 'зала второ гласуване' and x['L_Act_St_name'] == 'приет')
    elif operation['op'] == 'rawSet': node[key] = '__WAVE15_NUMBER_TOKEN__'
    elif operation['op'] == 'set': node[key] = operation['value']
    elif operation['op'] == 'delete': del node[key]
    elif operation['op'] == 'appendCopy': node[key].append(node[key][operation['index']])
    else: raise ValueError(operation)
    encoded = json.dumps(data, ensure_ascii=False)
    if operation['op'] == 'rawSet': encoded = encoded.replace('\"__WAVE15_NUMBER_TOKEN__\"', operation['token'])
    path.write_text(encoded, encoding='utf8')

def result(group, root):
    checks.ROOT = str(root)
    checks.DATA = str(root / 'data/release')
    checks.RAW = str(root / 'data/originals')
    try:
        c = functions[group](checks.Ctx())
        return {'name': c.name, 'n': c.n, 'problems': c.problems, 'warnings': c.warnings, 'facts': c.facts}
    except Exception as error:
        return {'crash': (type(error).__name__ + ': ' + str(error)).replace(str(root), '<sandbox>')}

cases = json.loads((HERE / 'cases.json').read_text(encoding='utf8'))
observed = {}
expected_mutations = set()
with tempfile.TemporaryDirectory(prefix='sigma-validate15-') as temp:
    for case in cases:
        root = Path(temp) / case['name']
        shutil.copytree(HERE / 'corpus', root)
        changed_files = set()
        for op in case['ops']:
            mutate(root, op)
            if op['op'] in ('set', 'delete', 'appendCopy', 'evidencePage', 'evidenceAdopted', 'evidenceDocxPage', 'writeRaw', 'rawSet'):
                changed_files.add(op['file'])
        for filename in changed_files:
            frozen = HERE / 'mutations' / case['name'] / filename
            expected_mutations.add(str(frozen.relative_to(HERE)))
            content = (root / 'data/release' / filename).read_bytes()
            if '--check' in sys.argv:
                if not frozen.exists() or frozen.read_bytes() != content:
                    raise SystemExit('mutation preimage changed: ' + case['name'])
            else:
                frozen.parent.mkdir(parents=True, exist_ok=True)
                frozen.write_bytes(content)
        observed[case['name']] = {group: result(group, root) for group in case['groups']}
        shutil.rmtree(root)
actual_mutations = {str(p.relative_to(HERE)) for p in (HERE / 'mutations').rglob('*') if p.is_file()}
if actual_mutations != expected_mutations:
    raise SystemExit('mutation file set changed')
encoded = (json.dumps(observed, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
output = HERE / 'oracle.json'
sum_cases = json.loads((HERE / 'sum-cases.json').read_text())
sum_bytes = (json.dumps([sum(json.loads(raw)) for raw in sum_cases], separators=(',', ':')) + '\n').encode()
sum_output = HERE / 'sum-oracle.json'
if '--check' in sys.argv:
    if not sum_output.exists() or sum_output.read_bytes() != sum_bytes or hashlib.sha256(sum_bytes).hexdigest() != provenance['sumOracleSha256']:
        raise SystemExit('sum oracle differs from donor')
    if not output.exists() or output.read_bytes() != encoded or hashlib.sha256(encoded).hexdigest() != provenance['oracleSha256']:
        raise SystemExit('oracle differs from frozen donor')
else:
    output.write_bytes(encoded)
    sum_output.write_bytes(sum_bytes)
    provenance['sumCasesSha256'] = hashlib.sha256((HERE / 'sum-cases.json').read_bytes()).hexdigest()
    provenance['sumOracleSha256'] = hashlib.sha256(sum_bytes).hexdigest()
    provenance['scenariosSha256'] = hashlib.sha256((HERE / 'cases.json').read_bytes()).hexdigest()
    provenance['oracleSha256'] = hashlib.sha256(encoded).hexdigest()
    provenance_path.write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n')
