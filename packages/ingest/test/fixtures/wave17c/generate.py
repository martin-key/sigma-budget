#!/usr/bin/env python3
"""Regenerate SEARCH evidence from the frozen Git-only donor and input closure."""
import copy
import hashlib
import json
import os
import re
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE / 'corpus'
os.environ['BUDGET_DATA_DIR'] = str(ROOT / 'data/release')
os.environ['BUILD_DATE'] = '2026-11-08'
sys.path.insert(0, str(ROOT / 'pipeline'))
from budget_pipeline.validate import checks, search_feed, datasets

inventory = json.loads((HERE / 'inventory.json').read_text(encoding='utf-8'))
actual = {str(p.relative_to(ROOT)) for p in ROOT.rglob('*') if p.is_file()}
if actual != set(inventory['files']):
    raise SystemExit('frozen input inventory differs: ' + repr(sorted(actual ^ set(inventory['files']))))
for name, expected in inventory['files'].items():
    raw = (ROOT / name).read_bytes()
    if len(raw) != expected['bytes'] or hashlib.sha256(raw).hexdigest() != expected['sha256']:
        raise SystemExit('frozen input hash mismatch: ' + name)

names = ['search-index','ministries','municipalities','measures','glossary','catalog','programs','budget2027']
original = {n + '.json': checks.load(n + '.json') for n in names}
items = original['search-index.json']['items']
find = lambda fn: next(i for i,r in enumerate(items) if fn(r))
current = find(lambda r: r[0] == 1 and r[4] == 'Проект 2027')
measure = find(lambda r: r[0] == 3 and r[6].startswith('#/merki?') and r[3])
blank = find(lambda r: r[0] == 3 and r[6].startswith('#/merki?') and not r[3])
municipal = find(lambda r: r[0] == 2)
program = find(lambda r: r[0] == 1 and r[6].count('/') > 2)
dataset = find(lambda r: r[0] == 5)
bill = original['budget2027.json']['budgets']['bill']
article = next(k for k in bill if int(k) >= 2)
bill_row = next(i for i, r in enumerate(bill[article]['rows']) if r['no'] == 'II.')
measure_anchor = re.search(r's12-(II_[78])-(\d+)-(\d+)$',items[measure][6])
measure_value = ['forecast',measure_anchor.group(1),int(measure_anchor.group(2)),'cells',measure_anchor.group(3),'value']

def setop(file, path, value): return {'op':'set','file':file,'path':path,'value':value}
def delop(file, path): return {'op':'delete','file':file,'path':path}
def row(i, col, value): return setop('search-index.json',['items',i,col],value)
cases = [
 ('baseline', []),
 ('wrong bill amount', [row(current,3,'1 млн. €')]),
 ('wrong bill publication', [row(current,4,'Прогноза 2027')]),
 ('wrong current measure amount', [row(measure,3,'1 млн. €')]),
 ('typography repr and unicode word boundary', [row(0,1,'Бюджет  None')]),
 ('newline title', [row(0,1,'Бюджет\nнов ред')]),
 ('blank cell changed to zero', [row(blank,3,'0 млн. €')]),
 ('wrong current measure publication', [row(measure,4,'Проект 2028')]),
 ('wrong current measure anchor', [row(measure,6,items[measure][6]+'-bad')]),
 ('duplicate current measure', [setop('search-index.json',['items',measure],items[measure-1])]),
 ('missing municipality id', [row(municipal,6,'#/obshtina/no-such-id')]),
 ('missing programme code', [row(program,6,items[program][6].split('?')[0]+'/bad?per=2027.draft')]),
 ('bad route', [row(0,6,'#/not-a-screen')]),
 ('dataset status', [row(dataset,5,'pending')]),
 ('mock outside datasets', [row(0,5,'mock')]),
 ('duplicate row', [setop('search-index.json',['items',1],items[0])]),
 ('missing row', [delop('search-index.json',['items',municipal])]),
 ('extra row field', [setop('search-index.json',['items',0],items[0]+['x'])]),
 ('dropped row field', [setop('search-index.json',['items',0],items[0][:-1])]),
 ('row as dictionary', [setop('search-index.json',['items',0],{'g':0})]),
 ('null title', [row(0,1,None)]),
 ('float title', [row(0,1,1.0)]),
 ('bool index', [row(0,0,True)]),
 ('float index', [row(0,0,0.0)]),
 ('string index', [row(0,0,'0')]),
 ('catalog status', [setop('catalog.json',['datasets',0,'status'],'pending')]),
 ('bill source amount', [setop('budget2027.json',['budgets','bill',article,'rows',bill_row,'cell','value'],999999.0)]),
 ('bill source amount null', [setop('budget2027.json',['budgets','bill',article,'rows',bill_row,'cell','value'],None)]),
 ('bill source amount string', [setop('budget2027.json',['budgets','bill',article,'rows',bill_row,'cell','value'],'1')]),
 ('current measure source amount null', [setop('budget2027.json',measure_value,None)]),
 ('current measure source amount absent', [delop('budget2027.json',measure_value)]),
 ('bill article removed', [delop('budget2027.json',['budgets','bill',article])]),
 ('billMc ignored by donor', [setop('budget2027.json',['budgets','billMc'],{})]),
 ('duplicate municipality source id', [setop('municipalities.json',['items',0,'id'],original['municipalities.json']['items'][1]['id'])]),
 ('duplicate measure source id', [setop('measures.json',['items',0,'id'],original['measures.json']['items'][1]['id'])]),
 ('missing measure source id', [setop('measures.json',['items',0,'id'],'absent-measure')]),
 ('missing term source id', [setop('glossary.json',['terms',0,'slug'],'absent-term')]),
 ('missing programme source code', [setop('programs.json',['items',0,original['programs.json']['fields'].index('code')],'no-code')]),
 ('duplicate programme source code', [setop('programs.json',['items',0,original['programs.json']['fields'].index('code')],original['programs.json']['items'][1][original['programs.json']['fields'].index('code')])]),
 ('numeric municipality source id', [setop('municipalities.json',['items',0,'id'],123)]),
 ('boolean measure source id', [setop('measures.json',['items',0,'id'],True)]),
 ('current measure missing', [delop('search-index.json',['items',measure])]),
 ('extra current measure', [setop('search-index.json',['items',0],items[measure])]),
 ('out of range index', [row(0,0,6)]),
 ('negative index', [row(0,0,-1)]),
 ('null index', [row(0,0,None)]),
 ('decimal digits in value', [row(0,3,'١٢%')]),
 ('GDP suffix without number', [row(0,3,'дял от БВП')]),
 ('boolean version equality', [setop('search-index.json',['version'],True)]),
 ('boolean duplicate index equality', [setop('search-index.json',['items',1],[False]+items[0][1:])]),
 ('exponent float index', [row(0,0,1.0)]),
 ('null groups', [setop('search-index.json',['groups'],None)]),
 ('null items', [setop('search-index.json',['items'],None)]),
 ('items dictionary', [setop('search-index.json',['items'],{'x': 1})]),
 ('fields null', [setop('search-index.json',['fields'],None)]),
 ('source municipalities dictionary', [setop('municipalities.json',['items'],{})]),
 ('source municipality id null', [setop('municipalities.json',['items',0,'id'],None)]),
 ('source programme fields missing', [delop('programs.json',['fields'])]),
 ('source bill mapping null', [setop('budget2027.json',['budgets','bill'],None)]),
 ('source bill invalid article', [setop('budget2027.json',['budgets','bill'],{'2.0': bill[article]})]),
 ('forecast table null', [setop('budget2027.json',['forecast','II_7'],None)]),
 ('measure cells null', [setop('budget2027.json',['forecast','II_7',0,'cells'],None)]),
 ('source catalogue null', [setop('catalog.json',['datasets'],None)]),
 ('missing fields key', [delop('search-index.json',['fields'])]),
 ('groups wrong type', [setop('search-index.json',['groups'],{})]),
]

def run_case(ops):
    docs = copy.deepcopy(original)
    for op in ops:
        obj = docs[op['file']]
        for key in op['path'][:-1]: obj = obj[key]
        key = op['path'][-1]
        if op['op'] == 'delete':
            if isinstance(obj,list): obj.pop(key)
            else: del obj[key]
        else: obj[key] = op['value']
    ctx = checks.Ctx()
    ctx.get = lambda name: docs[name]
    try:
        check = search_feed.g_search(ctx)
        accepted = datasets.wrap('SEARCH', search_feed.g_search, True)(ctx)
        raw = datasets.wrap('SEARCH', search_feed.g_search, False)(ctx)
        if vars(check) != vars(accepted) or vars(check) != vars(raw):
            raise AssertionError('SEARCH wrapper changed the result')
        return vars(check)
    except Exception as exc:
        return {'crash': type(exc).__name__ + ': ' + str(exc)}

result = {'cases':[{'name':name,'ops':ops,'expected':run_case(ops)} for name,ops in cases]}
out = json.dumps(result,ensure_ascii=False,indent=2)+'\n'
target = HERE/'differential.json'
if '--check' in sys.argv:
    if target.read_text(encoding='utf-8') != out: raise SystemExit('SEARCH oracle differs')
else: target.write_text(out,encoding='utf-8')
print('Verified %d frozen inputs and %d SEARCH cases' % (len(actual),len(cases)))
