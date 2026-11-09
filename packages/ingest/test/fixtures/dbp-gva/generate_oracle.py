"""Capture independent Python 3.12 donor outputs from adjacent frozen evidence."""
import ast
import contextlib
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
from pathlib import Path

if sys.version_info[:2] != (3, 12):
    raise SystemExit('Python 3.12 required')
if sys.argv[1:] not in ([], ['--check']):
    raise SystemExit('usage: generate_oracle.py [--check]')
CHECK = bool(sys.argv[1:])
HERE = Path(__file__).resolve().parent

def save(name, data):
    path = HERE / name
    if CHECK:
        if path.read_bytes() != data:
            raise SystemExit('fixture differs: ' + name)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

def encoded(obj):
    return (json.dumps(obj, ensure_ascii=False, indent=2) + '\n').encode()

def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / 'donor' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

# Editorial and EXTRA are transcribed from the frozen donor AST, not the published output.
source = (HERE / 'donor/budget_plan.py').read_text(encoding='utf-8')
tree = ast.parse(source)
assigns = {}
for node in ast.walk(tree):
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        key = node.targets[0].id
        if key in ('EXTRA', 'steps', 'measures', 'missing'):
            assigns[key] = ast.literal_eval(node.value)
out_node = next(node for node in ast.walk(tree) if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'out' for t in node.targets) and isinstance(node.value, ast.Dict))
for key, value in zip(out_node.value.keys, out_node.value.values):
    if isinstance(key, ast.Constant) and key.value == 'meta': assigns['meta'] = ast.literal_eval(value)
    if isinstance(key, ast.Constant) and key.value == 'doc':
        assigns['doc'] = {ast.literal_eval(k): ast.literal_eval(v) for k,v in zip(value.keys, value.values) if isinstance(v, ast.Constant)}
formula_node = next(node for node in ast.walk(tree) if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Subscript) and ast.unparse(node.targets[0]) == "figs['deficit.2027.eur']['f']")
assigns['deficitFormula'] = ast.literal_eval(formula_node.value)
save('inputs/editorial.json', encoded(assigns))
gva_tree = ast.parse((HERE / 'donor/gva_sectors.py').read_text(encoding='utf-8'))
gva_editorial = {}
for node in ast.walk(gva_tree):
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in ('BRANCHES', 'PART'):
        gva_editorial[node.targets[0].id] = ast.literal_eval(node.value)
gva_doc = next(node for node in ast.walk(gva_tree) if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'doc' for t in node.targets) and isinstance(node.value, ast.Dict))
meta = next(v for k,v in zip(gva_doc.value.keys,gva_doc.value.values) if isinstance(k, ast.Constant) and k.value == 'meta')
gva_editorial['meta'] = {ast.literal_eval(k): ast.literal_eval(v) for k,v in zip(meta.keys,meta.values) if not isinstance(v, ast.Name)}
save('inputs/gva-editorial.json', encoded(gva_editorial))


# Independently authored JSON-stat cube: ten branches and a subsector, 3 shared
# years plus a non-intersecting year, multiple dimensions and provisional flags.
def cube(dim, keys, years, rows, updated, flags=None, index_list=False):
    ids = ['geo', dim, 'unit', 'time']
    return {'id': ids, 'size': [1, len(keys), 1, len(years)],
            'dimension': {'geo': {'category': {'index': {'BG': 0}}},
                dim: {'category': {'index': keys if index_list else {k:i for i,k in enumerate(keys)}}},
                'unit': {'category': {'index': {'CP_MEUR': 0}}},
                'time': {'category': {'index': {str(y): i for i,y in enumerate(years)}}}},
            'value': {str(i*len(years)+j): v for i,row in enumerate(rows) for j,v in enumerate(row)},
            'status': flags or {}, 'extension': {'annotation': [{'type': 'UPDATE_DATA', 'date': updated}]}}

branches = ['A','B-E','F','G-I','J','K','L','M_N','O-Q','R-U']
rows = [[10+i+j for j in range(4)] for i in range(10)]
total = [sum(row[j] for row in rows) for j in range(4)]
nama = cube('nace_r2', ['TOTAL']+branches+['C'], [2018,2019,2020,2021], [total]+rows+[[5,6,7,8]], '2026-10-08T11:00:00', {'9':'p', '12':'p'}, True)
gdp = cube('na_item', ['D21X31','B1GQ'], [2019,2020,2021,2022], [[20,21,22,23], [total[1]+20,total[2]+21,total[3]+22,300]], '2026-10-09T12:00:00')
outlook = {'years': [2019,2020,2021,2022], 'gdp': {'mlnPrecise': [total[1]+20,total[2]+21,total[3]+22,300]}}
for name, value in [('nama.json', nama), ('gdp.json', gdp), ('outlook.json', outlook)]:
    save('inputs/' + name, encoded(value))

with tempfile.TemporaryDirectory() as temp:
    temp = Path(temp)
    dbp = load('budget_plan')
    dbp.SRC = HERE / 'inputs/figures.json'; dbp.PDF = HERE / 'inputs/plan.pdf'; dbp.OUT = temp / 'dbp.json'; dbp.W = temp
    # donor prints a relative path; input paths exist, and output is inside temp.
    with contextlib.redirect_stdout(io.StringIO()): dbp.main()
    save('oracle/dbp2027.json', dbp.OUT.read_bytes())
    gva = load('gva_sectors')
    gva.OUT = temp / 'gva.json'; gva.OUTLOOK = HERE / 'inputs/outlook.json'
    with contextlib.redirect_stdout(io.StringIO()):
        if gva.main([str(HERE/'inputs/nama.json'), str(HERE/'inputs/gdp.json')]) != 0: raise SystemExit('GVA donor failed')
    save('oracle/synthetic-gva.json', gva.OUT.read_bytes())

    # Donor is rerun on changed evidence, establishing an independent mutation oracle.
    changed_plan = json.loads((HERE / 'inputs/figures.json').read_bytes())
    changed_plan['figures'].append({'id': 't4.synthetic', 'value': 123.4, 'unit': 'млрд. EUR', 'page': 17, 'basis': 'ESA_GG', 'year': 2027, 'table': 'Табл. 4'})
    next(f for f in changed_plan['derived'] if f['id'] == 'gdp.2027')['value'] = 456
    (temp / 'figures.json').write_bytes(encoded(changed_plan))
    dbp.SRC = temp / 'figures.json'; dbp.OUT = temp / 'changed-dbp.json'
    with contextlib.redirect_stdout(io.StringIO()): dbp.main()
    save('oracle/changed-dbp.json', dbp.OUT.read_bytes())
    changed_nama = json.loads((HERE / 'inputs/nama.json').read_bytes())
    changed_gdp = json.loads((HERE / 'inputs/gdp.json').read_bytes())
    changed_outlook = json.loads((HERE / 'inputs/outlook.json').read_bytes())
    changed_nama['value']['5'] = 12.25
    changed_nama['value']['1'] += 1.25
    changed_gdp['value']['4'] += 1.25
    changed_outlook['gdp']['mlnPrecise'][0] += 1.25
    for name, value in [('nama', changed_nama), ('gdp', changed_gdp), ('outlook', changed_outlook)]:
        (temp / (name + '.json')).write_bytes(encoded(value))
    gva.OUT = temp / 'changed-gva.json'; gva.OUTLOOK = temp / 'outlook.json'
    with contextlib.redirect_stdout(io.StringIO()):
        if gva.main([str(temp/'nama.json'), str(temp/'gdp.json')]) != 0: raise SystemExit('changed GVA donor failed')
    save('oracle/changed-gva.json', gva.OUT.read_bytes())

files = ['inputs/figures.json','inputs/plan.pdf','inputs/editorial.json','inputs/gva-editorial.json','inputs/nama.json','inputs/gdp.json','inputs/outlook.json','donor/budget_plan.py','donor/gva_sectors.py','oracle/dbp2027.json','oracle/synthetic-gva.json','oracle/changed-dbp.json','oracle/changed-gva.json','published/dbp2027.json','published/gva-sectors.json','datasets.yaml','policy.json']
provenance = {'baseline': '05d6f6eeca9991468f3c94c3c9c26e87d5b0fae0', 'archiveSha256': '9430d8acfe5bd178a1675041aaae22295c89f2768474ebd27af347b465ace5e3', 'files': {p: hashlib.sha256((HERE/p).read_bytes()).hexdigest() for p in files}}
save('provenance.json', encoded(provenance))
print('DBP and synthetic GVA Python oracles verified' if CHECK else 'DBP and synthetic GVA Python oracles captured')
