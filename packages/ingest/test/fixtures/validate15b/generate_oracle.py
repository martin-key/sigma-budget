"""Regenerate output mutations from the frozen, unchanged Python 3.12 validator."""
import copy
import hashlib
import json
import os
import socket
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent
if sys.version_info[:2] != (3, 12):
    raise SystemExit('Python 3.12 required')
if sys.argv[1:] not in ([], ['--check']):
    raise SystemExit('usage: generate_oracle.py [--check]')
for path, expected in json.loads((HERE / 'inventory.json').read_text())['sha256'].items():
    if hashlib.sha256((FIXTURES / path).read_bytes()).hexdigest() != expected:
        raise ValueError('Frozen input changed: ' + path)
socket.socket = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('network denied'))
os.environ['BUILD_DATE'] = '2026-11-08'
sys.path.insert(0, str(HERE / 'donor'))
from budget_pipeline.build import annual_periods
from budget_pipeline.validate import budget_2027 as donor
from budget_pipeline.validate.checks import Check
annual_periods.ROOT = FIXTURES / 'fiscal/inputs'
annual_periods.SRC = annual_periods.ROOT / 'data/inputs'
lineage = annual_periods.Lineage()
real_annual, real_budget = donor.annual, donor.budget
annual = real_annual(lineage)
built = real_budget(lineage)
# Output-only cases reuse the exact unchanged donor's projection. This avoids
# repeatedly searching the same physical tables; checks themselves still run.
donor.Lineage = lambda: lineage
donor.annual = lambda _: annual
donor.budget = lambda _: built
files = {f'{name}.json': json.loads((FIXTURES / 'wave13a/published' / f'{name}.json').read_text()) for name in ('outlook', 'revenue', 'expenditure', 'budget2027', 'budget2027-provenance')}
class Context:
    def __init__(self, docs): self.docs = docs
    def get(self, name): return self.docs[name]

def run(docs):
    try:
        check = donor.g_budget_2027(Context(docs))
    except Exception as error:
        check = Check('BUDGET2027')
        check.fail(f'group crashed: {type(error).__name__}: {error}')
    return {'name': check.name, 'n': check.n, 'problems': check.problems, 'warnings': check.warnings, 'facts': check.facts}

def modify(docs, op):
    obj = docs[op['file']]
    for part in op['path'][:-1]: obj = obj[part]
    if op.get('delete'): del obj[op['path'][-1]]
    else: obj[op['path'][-1]] = op['value']

ops = [
 {'name':'baseline'},
 {'name':'amount','file':'outlook.json','path':['byPeriod','2026.law','series','revenue','value'],'value':49615.4},
 {'name':'status','file':'outlook.json','path':['byPeriod','2027.draft','status'],'value':'law'},
 {'name':'unit','file':'outlook.json','path':['byPeriod','2026.law','series','revenue','unit'],'value':'лв.'},
 {'name':'missing-period','file':'revenue.json','path':['byPeriod','2028.forecast'],'delete':True},
 {'name':'extra-field','file':'expenditure.json','path':['byPeriod','2027.draft','unexpected'],'value':1},
 {'name':'variant','file':'budget2027.json','path':['defaultVariant'],'value':'billMc'},
 {'name':'page','file':'budget2027-provenance.json','path':['entries','7253caabe5212a862ada11d1','page'],'value':175},
 {'name':'printed','file':'budget2027-provenance.json','path':['entries','7253caabe5212a862ada11d1','printed'],'value':'49 615,4'},
 {'name':'period','file':'budget2027-provenance.json','path':['entries','7253caabe5212a862ada11d1','period'],'value':'2027.draft'},
 {'name':'document','file':'budget2027-provenance.json','path':['entries','7253caabe5212a862ada11d1','document'],'value':'bill'},
 {'name':'output-address','file':'budget2027-provenance.json','path':['entries','7253caabe5212a862ada11d1','output'],'value':'outlook.json#/byPeriod/2026.law/series/missing'},
 {'name':'cycle','file':'budget2027-provenance.json','path':['entries','dc6a19ed2e010e62794cbe47','operands'],'value':['dc6a19ed2e010e62794cbe47']},
 {'name':'duplicate-operand','file':'budget2027-provenance.json','path':['entries','dc6a19ed2e010e62794cbe47','operands'],'value':['123469d6bc097e08db67f4cd','123469d6bc097e08db67f4cd']},
 {'name':'missing-operand','file':'budget2027-provenance.json','path':['entries','dc6a19ed2e010e62794cbe47','operands'],'value':['missing']},
 {'name':'operation','file':'budget2027-provenance.json','path':['entries','dc6a19ed2e010e62794cbe47','operation'],'value':'subtract'},
 {'name':'project-count','file':'budget2027.json','path':['projects'],'value':[]},
 {'name':'wrong-metadata-type','file':'outlook.json','path':['byPeriod','2026.law','sourceRefs'],'value':{}},
 {'name':'null-by-period','file':'outlook.json','path':['byPeriod'],'value':None},
]
out = []
for op in ops:
    docs = copy.deepcopy(files)
    if 'file' in op: modify(docs, op)
    out.append({'mutation':op, 'result':run(docs)})
# A mutually consistent edited extraction and rebuilt publication must still
# fail against the independent manually transcribed physical PDF values.
changed = annual_periods.Lineage()
row = changed.inputs['F']['tables']['annex1_execution2026']['rows'][0]
row['values'][0] = 49615.4
row['printed'][0] = '49 615,4'
changed_annual = real_annual(changed)
changed_bill = real_budget(changed)
docs = copy.deepcopy(files)
for name, records in changed_annual.items(): docs[name + '.json']['byPeriod'] = records
docs['budget2027.json'] = changed_bill
docs['budget2027-provenance.json']['documents'] = changed.documents
docs['budget2027-provenance.json']['entries'] = changed.entries
lineage, annual, built = changed, changed_annual, changed_bill
out.append({'mutation': {'name':'consistent-source', 'source': True}, 'result': run(docs)})
# Rebuild a bill with a duplicate project identity; cells and lineage remain
# internally consistent, while the source-level uniqueness check must fail.
changed = annual_periods.Lineage()
old_id = changed.inputs['B']['projects']['rows'][1]['id']
new_id = changed.inputs['B']['projects']['rows'][0]['id']
changed.inputs['B']['projects']['rows'][1]['id'] = new_id
for table in changed.inputs['B']['tables']:
    for row in table['rawCells']:
        for column, text in enumerate(row):
            if text == old_id: row[column] = new_id
changed_annual = real_annual(changed)
changed_bill = real_budget(changed)
docs = copy.deepcopy(files)
for name, records in changed_annual.items(): docs[name + '.json']['byPeriod'] = records
docs['budget2027.json'] = changed_bill
docs['budget2027-provenance.json']['documents'] = changed.documents
docs['budget2027-provenance.json']['entries'] = changed.entries
lineage, annual, built = changed, changed_annual, changed_bill
out.append({'mutation': {'name':'duplicate-project-source', 'source': 'project'}, 'result': run(docs)})
# A missing final project must be detected even after recomputing annual sums.
changed = annual_periods.Lineage()
changed.inputs['B']['projects']['rows'].pop()
changed_annual = real_annual(changed)
changed_bill = real_budget(changed)
docs = copy.deepcopy(files)
for name, records in changed_annual.items(): docs[name + '.json']['byPeriod'] = records
docs['budget2027.json'] = changed_bill
docs['budget2027-provenance.json']['documents'] = changed.documents
docs['budget2027-provenance.json']['entries'] = changed.entries
lineage, annual, built = changed, changed_annual, changed_bill
out.append({'mutation': {'name':'project-count-source', 'source': 'project-count'}, 'result': run(docs)})
data = (json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
path = HERE / 'oracle.json'
if '--check' in sys.argv:
    if path.read_bytes() != data: raise ValueError('Oracle differs')
else: path.write_bytes(data)
