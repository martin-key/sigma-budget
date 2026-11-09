"""Small independent Python oracle for pointers, multiplicity and decimal boundaries."""
import copy
import hashlib
import json
import sys
import tempfile
import shutil
from pathlib import Path
HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent
if sys.version_info[:2] != (3, 12): raise SystemExit('Python 3.12 required')
if sys.argv[1:] not in ([], ['--check']): raise SystemExit('usage: generate_helpers.py [--check]')
for name, digest in json.loads((HERE / 'inventory.json').read_text())['sha256'].items():
    if hashlib.sha256((FIXTURES / name).read_bytes()).hexdigest() != digest: raise ValueError('Frozen input changed: ' + name)
sys.path.insert(0, str(HERE / 'donor'))
from budget_pipeline.validate import annual_oracles as donor
from budget_pipeline.validate import budget_2027 as group
from budget_pipeline.validate.checks import Check
address = 'sample.json#/a~1b/~0key'
leaf = {'output':address, 'period':'2026.law', 'unit':'млн. €', 'document':'forecast', 'page':1, 'printed':'1,2'}
base = {'sample.json': {'a/b': {'~key': {'value':1.2, 'unit':'млн. €', 'provenance':'leaf'}}}, 'budget2027-provenance.json': {'entries': {'leaf':leaf}}}
oracle = {'output':address, 'value':'1.2', 'unit':'млн. €', 'period':'2026.law', 'document':'forecast', 'sources':[{'page':1,'printed':'1,2'}]}
class Context:
    def __init__(self, docs): self.docs = docs
    def get(self, name): return self.docs[name]
def result(check): return {'name':check.name,'n':check.n,'problems':check.problems,'warnings':check.warnings,'facts':check.facts}
def run(name, docs, expected):
    donor.load_oracles = lambda: [expected]
    check = Check('BUDGET2027')
    try: donor.check_output_oracles(check, Context(docs))
    except Exception as error:
        check = Check('BUDGET2027'); check.fail(f'group crashed: {type(error).__name__}: {error}')
    return {'name':name, 'docs':docs, 'oracles':[expected], 'result':result(check)}
cases = [run('escaped', copy.deepcopy(base), copy.deepcopy(oracle))]
for name in ('missing-address','wrong-page','bad-printed','blank-printed','null-printed','null-value','malformed-index','malformed-address','unicode-index','underscored-index','new-unicode-index','cycle','missing-operand','duplicate-match','duplicate-mismatch'):
    docs, expected = copy.deepcopy(base), copy.deepcopy(oracle)
    entries = docs['budget2027-provenance.json']['entries']
    if name == 'missing-address': del docs['sample.json']['a/b']['~key']
    if name == 'wrong-page': entries['leaf']['page'] = 2
    if name == 'bad-printed': entries['leaf']['printed'] = 'not a number'
    if name == 'blank-printed': entries['leaf']['printed'] = ''
    if name == 'null-printed': entries['leaf']['printed'] = None
    if name == 'null-value': docs['sample.json']['a/b']['~key']['value'] = None
    if name == 'malformed-address': expected['output'] = 'sample.json'
    if name in ('unicode-index', 'underscored-index', 'new-unicode-index'):
        key, index = {'unicode-index': ('١',1), 'underscored-index': ('1_0',10), 'new-unicode-index': ('\U00010d40',1)}[name]
        address = 'sample.json#/array/' + key
        docs['sample.json']['array'] = [None] * 11
        docs['sample.json']['array'][index] = copy.deepcopy(docs['sample.json']['a/b']['~key'])
        entries['leaf']['output'] = address
        expected['output'] = address
    if name == 'malformed-index':
        docs['sample.json']['array'] = []
        expected['output'] = 'sample.json#/array/not-an-index'
    if name in ('cycle','missing-operand','duplicate-match','duplicate-mismatch'):
        entries['derived'] = {'output':address,'period':'2026.law','unit':'млн. €','document':'forecast','operation':'sum','operands': ['leaf','leaf']}
        docs['sample.json']['a/b']['~key']['provenance'] = 'derived'
        if name == 'cycle': entries['derived']['operands'] = ['derived']
        if name == 'missing-operand': entries['derived']['operands'] = ['missing']
        if name == 'duplicate-match': expected['sources'].append(copy.deepcopy(expected['sources'][0]))
    cases.append(run(name, docs, expected))
laws = []
for name, revenue, expenditure, balance, interest, primary in [('edge',10.15,10,0,0,0),('outside',10.151,10,0,0,0),('negative-edge',9.85,10,0,0,0),('primary-exact',10,10,0,0.1,0.1000000001)]:
    series = {key:{'value':value} for key,value in zip(('revenue','expenditure','balance','interest','primaryBalance'),(revenue,expenditure,balance,interest,primary))}
    docs = {'outlook.json':{'byPeriod':{'2026.law':{'series':series}}}}
    check = Check('BUDGET2027'); donor.check_law_identities(check, Context(docs))
    laws.append({'name':name,'docs':docs,'result':result(check)})
# Independent source identity checks run on changed frozen extraction inputs.
forecast = json.loads((FIXTURES / 'fiscal/inputs/data/inputs/budget_forecast_2027.json').read_text())
bill = json.loads((FIXTURES / 'fiscal/inputs/data/inputs/budget_bill_2027.json').read_text())
identity_ops = [
 ('forecast-balance','forecast',['tables','annex3_mln','rows',61,'values',2], 5),
 ('forecast-function','forecast',['tables','III_1','rows',0,'values',1], 5),
 ('state-transfer','bill',['bill','1','headline','transfers'], 5),
 ('institution-transfer','bill',['bill','2','headline','transfers'], 5),
 ('policy-total','bill',['bill','2','policyTotal'], 5),
 ('municipal-total','bill',['municipal','art52','total',0], 50),
 ('municipal-part','bill',['municipal','art52','rows',0,'values',1], 5),
 ('municipal-duplicate','bill',['municipal','art52','rows',1,'name'], bill['municipal']['art52']['rows'][0]['name']),
]
identities=[]
for name, kind, path, change in identity_ops:
    data = copy.deepcopy(forecast if kind == 'forecast' else bill)
    parent=data
    for key in path[:-1]: parent=parent[key]
    old=parent[path[-1]]
    value=old+change if isinstance(change,(int,float)) else change
    parent[path[-1]]=value
    check=Check('BUDGET2027')
    if kind=='forecast': group.check_forecast_identities(check,data['tables'])
    elif name.startswith('municipal'): group.check_municipal_identities(check,data)
    else: group.check_bill_identities(check,data)
    identities.append({'name':name,'kind':kind,'path':path,'value':value,'result':result(check)})
from budget_pipeline.build import annual_periods
annual_periods.ROOT = FIXTURES / 'fiscal/inputs'
annual_periods.SRC = annual_periods.ROOT / 'data/inputs'
initial = annual_periods.Lineage()
source_cases = []
for name, path, value in [
 ('blank-required-cell',['tables','annex1_execution2026','rows',0,'values',0], None),
 ('wrong-year',['tables','annex1_execution2026','columns',0,'year'], 2025),
 ('wrong-vintage',['tables','annex1_execution2026','columns',0,'vintage'], 'проект'),
]:
    changed = copy.deepcopy(initial)
    parent=changed.inputs['F']
    for key in path[:-1]: parent=parent[key]
    parent[path[-1]]=value
    try: annual_periods.annual(changed)
    except Exception as error: source_cases.append({'name':name,'path':path,'value':value,'problem':f'group crashed: {type(error).__name__}: {error}'})
archives = []
with tempfile.TemporaryDirectory(prefix='sigma15b-archive-') as tmp:
    root = Path(tmp)
    source_root = FIXTURES / 'fiscal/inputs/data'
    shutil.copytree(source_root / 'inputs', root / 'data/inputs')
    shutil.copytree(source_root / 'originals/budget_2027', root / 'data/originals/budget_2027')
    annual_periods.ROOT = root
    annual_periods.SRC = root / 'data/inputs'
    path = root / 'data/originals/budget_2027/ZDBRB-2027.zip'
    original = path.read_bytes()
    for name in ('archive','archive-before-metadata','member'):
        if name in ('archive','archive-before-metadata'):
            path.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
            if name == 'archive-before-metadata':
                f = root / 'data/inputs/budget_forecast_2027.json'
                data = json.loads(f.read_text()); data['tables']['annex1_execution2026']['rows'][0]['page'] = None; f.write_text(json.dumps(data))
        else:
            path.write_bytes(original)
            f = root / 'data/inputs/budget_forecast_2027.json'
            data = json.loads(f.read_text()); data['source']['pdf_sha256'] = '0' * 64; f.write_text(json.dumps(data))
        try: annual_periods.Lineage()
        except Exception as error: archives.append({'name':name,'problem':f'group crashed: {type(error).__name__}: {error}'})
data = (json.dumps({'oracles':cases,'laws':laws,'archives':archives,'identities':identities,'sourceCases':source_cases},ensure_ascii=False,indent=2)+'\n').encode()
path=HERE/'helpers.json'
if '--check' in sys.argv:
    if path.read_bytes()!=data: raise ValueError('Helper oracle differs')
else: path.write_bytes(data)
