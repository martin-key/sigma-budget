#!/usr/bin/env python3
"""Changed-input results produced solely by the frozen, unchanged Python donor."""
import copy
import json
import os
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent
if sys.version_info[:2] != (3, 12): raise SystemExit('Python 3.12 required')
os.environ.pop('BUDGET_DATA_DIR', None)
os.environ['BUILD_DATE'] = '2026-11-08'
sys.path.insert(0, str(ROOT/'pipeline'))
from budget_pipeline.validate import checks, execution_reports as donor, execution_contract
from budget_pipeline.build import data_io, annual_periods

ex = checks.load('execution.json')
first = ex['data']['2024']['files'][0]['file']
may = ex['data']['2024']['files'][4]['file']
rows = {r['id']: r['row']-1 for r in ex['rows'] if 'row' in r}
raw_first = donor._read_report(ROOT/'data/originals/kfp_2024'/first, {k:v+1 for k,v in rows.items()})
# Each operation is also applied to the TypeScript inputs by the differential test.
def data(name, path, value): return dict(kind='data', name=name, path=path, value=value)
def cell(file, row, col, value): return dict(kind='cell', year='2024', file=file, row=row, col=col, value=value, cellType=2 if isinstance(value, float) else 1 if isinstance(value, str) else 4)
def raw(file, rid, col, value): return cell(file, rows[rid], col, value)
def case(name, *ops): return dict(name=name, ops=list(ops))
cases = [
 case('row mapping', data('execution.json',['rows',0,'row'],ex['rows'][0]['row']+1)),
 case('negative sheet index', data('execution.json',['rows',0,'row'],0)),
 case('label',data('execution.json',['rows',0,'label'],'wrong label')),
 case('column metadata',data('execution.json',['cols',1,'kfpCol'],'к.4')),
 case('numeric sheet label',cell(first,rows['rev'],0,0.0)),
 case('sheet date',cell(first,2,0,'КЪМ 30.01.2024 ГОДИНА')),
 case('unicode date',cell(first,2,0,'КЪМ\u0085٣١.٠١.٢٠٢٤\u001cГОДИНА')),
 case('unit label',cell(first,3,3,'млн.евро')),
 case('dimensions',dict(kind='dims',year='2024',file=first,value=[53,4])),
 case('raw string',raw(first,'rev',1,'broken')),
 case('raw integer',raw(first,'rev',1,1)),
 case('raw null',raw(first,'rev',1,None)),
 case('encoded null',dict(kind='input',path=['data','2024','kfp','rev',0],value=None)),
 case('encoded boolean',dict(kind='input',path=['data','2024','kfp','rev',0],value=False)),
 case('encoded invalid money',dict(kind='input',path=['data','2024','kfp','rev',0],value='bad')),
 case('encoded float row',dict(kind='input',path=['rows',0,'row'],value=11.0,literal='11.0')),
 case('encoded integer percent',dict(kind='input',path=['latest','kfp','rev','pctPlan'],value=0)),
 case('encoded boolean percent',dict(kind='input',path=['latest','kfp','rev','pctPlan'],value=True)),
 case('encoded nan',dict(kind='input',path=['data','2024','kfp','rev',0],value='NaN')),
 case('encoded infinity',dict(kind='input',path=['data','2024','kfp','rev',0],value='Infinity')),
 case('raw identity just inside',raw(first,'rev',1,raw_first['cells']['rev']['kfp']+0.000001)),
 case('raw identity beyond tolerance',raw(first,'rev',1,raw_first['cells']['rev']['kfp']+0.00001)),
 case('raw accounting',raw(first,'rev',1,1234.5)),
 case('national column',raw(first,'rev',2,raw_first['cells']['rev']['nat']+1)),
 case('EU column',raw(first,'rev',3,raw_first['cells']['rev']['eu']+1)),
 case('raw tiny float',raw(first,'rev',1,0.00000001)),
 case('raw large float',raw(first,'rev',1,1e20)),
 case('known exception narrowed',raw(may,'fin',1, ex['data']['2024']['kfp']['fin'][4]*1.95583+0.1)),
 case('month',data('execution.json',['data','2024','files',0,'month'],2)),
 case('hash',data('execution.json',['data','2024','files',0,'sha256'],'0'*64)),
 case('filename',data('execution.json',['data','2024','files',0,'file'],'missing.xls')),
 case('missing month',dict(kind='missing',year='2024',file=first)),
 case('extra month',dict(kind='extra',year='2024',file='extra.xls')),
 case('currency',data('execution.json',['data','2024','currency'],'EUR')),
 case('conversion note',data('execution.json',['data','2024','converted'],'wrong')),
 case('converted value',data('execution.json',['data','2024','kfp','rev',0],0.0)),
 case('null cumulative',data('execution.json',['data','2024','kfp','rev',0],None)),
 case('string cumulative',data('execution.json',['data','2024','kfp','rev',0],'bad')),
 case('conversion just inside',data('execution.json',['data','2024','kfp','rev',0],ex['data']['2024']['kfp']['rev'][0]+0.0005)),
 case('conversion beyond tolerance',data('execution.json',['data','2024','kfp','rev',0],ex['data']['2024']['kfp']['rev'][0]+0.0007)),
 case('computed row',data('execution.json',['data','2024','kfp','exp.total',0],0.0)),
 case('delta',data('execution.json',['monthly','2024','kfp','rev',0],0.0)),
 case('pace',data('execution.json',['pace','2024','rev',0],0.0)),
 case('headline',data('execution.json',['data','2026','kfp','rev',6],0.0)),
 case('zero pace denominator',data('execution.json',['data','2024','kfp','rev',11],0.0)),
 case('zero yoy denominator',data('execution.json',['data','2025','kfp','rev',8],0.0)),
 case('latest denominator',data('execution.json',['latest','kfp','rev','plan'],0.0)),
 case('zero plan denominator',data('execution.json',['plan2026','kfp','rev'],0.0)),
 case('missing denominator',dict(kind='delete',name='execution.json',path=['latest','kfp','rev','plan'])),
 case('latest percent',data('execution.json',['latest','kfp','rev','pctPlan'],0.0)),
 case('latest null',data('execution.json',['latest','kfp','rev','pctPlan'],None)),
 case('latest missing',dict(kind='delete',name='execution.json',path=['latest','kfp','rev','pctPlan'])),
 case('month end',data('execution.json',['data','2024','asOf',0],'2024-01-30')),
 case('pending',data('execution.json',['pendingMonths',0,'status'],'done')),
 case('pending end date',data('execution.json',['pendingMonths',0,'asOf'],'2026-10-30')),
 case('empty pending',data('execution.json',['pendingMonths'],[])),
 case('outlook law',data('outlook.json',['byPeriod','2026.law','series','revenue','value'],0.0)),
 case('law amount',data('forecast',['tables','annex1_execution2026','rows',0,'values',0],1.0)),
 case('annex percent',data('forecast',['tables','annex1_execution2026','rows',0,'values',4],1.0)),
 case('missing printed percent',data('forecast',['tables','annex1_execution2026','rows',0,'values',4],None)),
 case('annex september',data('forecast',['tables','annex1_execution2026','rows',0,'values',1],1.0)),
 case('annex subtotal',data('forecast',['tables','annex1_execution2026','rows',1,'values',0],1.0)),
 case('null row',data('execution.json',['rows',0,'row'],None)),
 case('wrong row type',data('execution.json',['rows',0,'row'],'5')),
 case('fractional row',data('execution.json',['rows',0,'row'],5.5)),
 case('row out of range',data('execution.json',['rows',0,'row'],100)),
 case('zero months',data('execution.json',['data','2026','months'],0)),
 case('wrong pct type',data('execution.json',['latest','kfp','rev','pctPlan'],'bad')),
]

# Acceptance regressions; the original 68 cases and donor bytes remain unchanged.
for path in (["data"], ["monthly"], ["monthly", "2024"], ["monthly", "2024", "kfp"],
             ["data", "2024", "kfp"], ["plan2026", "nat"], ["latest", "kfp"],
             ["latest", "nat"], ["latest", "eu"], ["pace"], ["pace", "2024"]):
    for value in ([], [0], None, "invalid"):
        cases.append(case("mapping " + "/".join(path) + " " + repr(value),
                          data("execution.json", path, value)))
        cases.append(case("encoded mapping " + "/".join(path) + " " + repr(value),
                          dict(kind="encoded", path=path, value=value)))
for path, needle, replacement, value in (
    (["data", "2024", "months"], '\"months\":12', '\"months\":12.0', 12.0),
    (["data", "2024", "months"], '\"months\":12', '\"months\":1.2e1', 12.0),
    (["latest", "month"], '\"month\":9,\"asOf\":\"2026-09-30\"', '\"month\":9.0,\"asOf\":\"2026-09-30\"', 9.0),
    (["latest", "month"], '\"month\":9,\"asOf\":\"2026-09-30\"', '\"month\":9e0,\"asOf\":\"2026-09-30\"', 9.0),
):
    cases.append(case("integer token " + "/".join(path) + " " + replacement,
                      dict(kind="input", path=path, needle=needle, replacement=replacement, value=value)))
from budget_pipeline.build.execution_law import LAW_ROWS
for row in LAW_ROWS.values():
    for field in ("units", "label", "page", "printed"):
        cases.append(case("missing lineage row " + str(row) + " " + field,
                          dict(kind="delete", name="forecast", path=["tables", "annex1_execution2026", "rows", row, field])))
for field in ("units", "printed"):
    cases.append(case("empty lineage " + field,
                      data("forecast", ["tables", "annex1_execution2026", "rows", 0, field], [])))


for year, count in (("2025", 12), ("2026", 9)):
    needle = '"' + year + '":{"months":' + str(count)
    replacement = needle + '.0'
    cases.append(case("integer token data/" + year + "/months " + replacement,
                      dict(kind="input", path=["data", year, "months"], needle=needle,
                           replacement=replacement, value=float(count))))
for field in ("units", "printed"):
    for value in (None, {}, ""):
        cases.append(case("invalid lineage " + field + " " + repr(value),
                          data("forecast", ["tables", "annex1_execution2026", "rows", 0, field], value)))
    cases.append(case("explicit null lineage " + field,
                      data("forecast", ["tables", "annex1_execution2026", "rows", 0, field, 0], None)))
for value in (None, False, "1", [], {}):
    cases.append(case("invalid law value " + repr(value),
                      data("forecast", ["tables", "annex1_execution2026", "rows", 0, "values", 0], value)))


def change(obj, path, value=None, delete=False):
    for key in path[:-1]: obj=obj[key]
    if delete: del obj[path[-1]]
    else: obj[path[-1]]=value

def run(case):
    ctx=checks.Ctx(); forecast=copy.deepcopy(data_io.jload(data_io.SRC/'budget_forecast_2027.json'))
    orig_jload=data_io.jload; orig_annual=annual_periods.jload; orig_open=donor.xlrd.open_workbook
    orig_exists=os.path.exists; orig_listdir=os.listdir
    cells={}; dims={}; missing=set(); extra={}
    raw_ex=json.loads((ROOT/'data/release/execution.json').read_text(encoding='utf8'))
    input_ops=[op for op in case['ops'] if op['kind'] in ('input', 'encoded')]
    for op in input_ops: change(raw_ex,op['path'],op['value'])
    original_get=ctx.get
    if input_ops:
        def input_get(name):
            if name != 'execution.json': return original_get(name)
            if name not in ctx._json: ctx._json[name]=execution_contract.numbers(raw_ex)
            return ctx._json[name]
        ctx.get=input_get
    for op in case['ops']:
        kind=op['kind']
        if kind in ('data','delete'):
            obj=forecast if op['name']=='forecast' else ctx.get(op['name'])
            change(obj,op['path'],op.get('value'),kind=='delete')
        elif kind=='cell': cells[(op['year'],op['file'],op['row'],op['col'])]=op['value']
        elif kind=='dims': dims[(op['year'],op['file'])]=op['value']
        elif kind=='missing': missing.add((op['year'],op['file']))
        elif kind=='extra': extra.setdefault(op['year'],[]).append(op['file'])
    def jload(path): return copy.deepcopy(forecast) if Path(path).name=='budget_forecast_2027.json' else orig_jload(path)
    def key(path):
        path=Path(path); return (path.parent.name.removeprefix('kfp_'),path.name)
    class Sheet:
        def __init__(self, sh, k): self.sh=sh; self.k=k; self.nrows,self.ncols=dims.get(k,(sh.nrows,sh.ncols))
        def cell_value(self,r,c): return cells.get((*self.k,r,c),self.sh.cell_value(r,c))
    class Book:
        def __init__(self,b,k): self.b=b; self.k=k
        def sheet_by_name(self,name): return Sheet(self.b.sheet_by_name(name),self.k)
    try:
        data_io.jload=annual_periods.jload=jload
        donor.xlrd.open_workbook=lambda path: Book(orig_open(path),key(path))
        os.path.exists=lambda path: False if key(path) in missing else orig_exists(path)
        os.listdir=lambda path: orig_listdir(path)+extra.get(Path(path).name.removeprefix('kfp_'),[])
        try:
            c=donor.g_kfp(ctx)
            return dict(name=c.name,n=c.n,problems=c.problems,warnings=c.warnings,facts=c.facts)
        except Exception as err:
            return dict(crash=type(err).__name__+': '+str(err))
    finally:
        data_io.jload=orig_jload;annual_periods.jload=orig_annual;donor.xlrd.open_workbook=orig_open
        os.path.exists=orig_exists;os.listdir=orig_listdir
output={'cases':[{**case,'expected':run(case)} for case in cases]}
text=json.dumps(output,ensure_ascii=False,indent=2,allow_nan=False)+'\n'; path=ROOT/'differential.json'
if sys.argv[1:] == ['--check']:
    if path.read_text(encoding='utf8') != text: raise SystemExit('differential oracle mismatch')
elif not sys.argv[1:]: path.write_text(text,encoding='utf8')
else: raise SystemExit('usage: differential.py [--check]')
print('independent changed-input results verified' if sys.argv[1:] else 'independent changed-input results generated')
