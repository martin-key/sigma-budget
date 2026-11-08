"""Regenerate Python oracle for job 02 from the named archive and this checkout.

Extract the archive's data/originals/asbp/asbp_tables.json into tmp/ts-common-inputs first.
Run with PYTHONPATH=pipeline and Python 3.12 with pipeline requirements installed.
"""
import hashlib
import json
from pathlib import Path
import yaml
from budget_pipeline import cli
from budget_pipeline.build import data_io, forecast_tables, definitions
from budget_pipeline.validate.execution_contract import numbers

ROOT = Path(__file__).resolve().parents[5]
HERE = Path(__file__).parent
INPUTS = HERE / 'inputs'  # registries and execution.json as of the baseline, frozen
source = ROOT / 'tmp/ts-common-inputs/data/originals/asbp/asbp_tables.json'
original = json.loads(source.read_text(encoding='utf8'))
fixture = {'tables': {k: original['tables'][k] for k in ['annex3_mln', 'annex3_pct_gdp']}, 'docx_check': original['docx_check']}
def write(name, value):
    (HERE / name).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf8')
write('asbp-tables.json', fixture)
forecast_tables.RAW = source.parent.parent
annex = forecast_tables.load()
write('annex.json', {'annex': annex, 'problems': forecast_tables.check_sums(annex)})
write('registries.json', [yaml.safe_load((INPUTS / f'{name}.yaml').read_text(encoding='utf8')) for name in ('sources', 'datasets')])
# Exercise registry_inputs using the real Python implementation on a small, fixed input tree.
maproot = HERE / 'source-map'
sources = yaml.safe_load((maproot / 'data-sources.yaml').read_text())
datasets = yaml.safe_load((maproot / 'data-datasets.yaml').read_text())
old = cli.yaml_load
cli.yaml_load = lambda p: sources if p.name == 'sources.yaml' else datasets
found, missing, source_map = cli.registry_inputs(ROOT, maproot)
cli.yaml_load = old
for entry in found.values(): entry['datasets'] = sorted(entry['datasets'])
write('source-map.json', {'found': found, 'missing': missing, 'sources': source_map})
execution = numbers(json.loads((INPUTS / 'execution.json').read_text(encoding='utf8')))
write('execution-numbers.json', execution)
write('format.json', {'number': [definitions.fmt_num(v, 2, True) for v in [1234.56, -0.001, -42.5, None]], 'ties': [definitions.fmt_num(v, 0) for v in [2.5, 3.5, -2.5]], 'percent': definitions.fmt_pct(12.3), 'money': [definitions.fmt_money(v) for v in [1234.5, 100, 12.3, None]], 'thousands': definitions.fmt_khil(4567), 'euro': definitions.fmt_eur(4567), 'dates': [definitions.fmt_date('2026-11-08'), definitions.fmt_date('2026-11-08', True), definitions.fmt_date(None)], 'month': definitions.month_name(8)})
definitions.set_kfp_pending(execution)
write('source-definitions.json', {'sources': definitions.SOURCES, 'pending': definitions.PENDING_DEFS, 'block': definitions.pending_block('P04', note='test')})
js = {'id': ['geo', 'time'], 'size': [2, 2], 'dimension': {'geo': {'category': {'index': {'BG': 0, 'EU': 1}}}, 'time': {'category': {'index': ['2024', '2025']}}}, 'value': [1, None, 3, 4], 'status': {'2': 'p'}}
write('jsonstat.json', {'cells': data_io.jsonstat_cells(js), 'series': data_io.jsonstat_series(js, 'time', {'geo': 'EU'})})
write('metadata.json', [data_io.meta('id', 'Заглавие'), data_io.meta('x', 'title', status='mock', source=['asbp'], source_note='note', as_of='2026-01-02', unit='€', custom=3)])
write('provenance.json', {'baseline': '851e90f', 'buildDate': '2026-11-08', 'sourceArchiveSha256': '5f8e6a98b05919dc776fb68f40615a544b585e1a1690e29cf2f6f3b0e0648701', 'originalTableSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'fixtureSha256': hashlib.sha256((HERE/'asbp-tables.json').read_bytes()).hexdigest(), 'inputSha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(INPUTS.iterdir())}, 'oracle': 'Python 3.12: forecast_tables, data_io, cli.registry_inputs, execution_contract.numbers and yaml.safe_load'})

# Review edge cases: each expected result is produced by the corresponding Python helper.
import copy
import math
import tempfile
from budget_pipeline.build import context
from budget_pipeline.validate import execution_contract

def outcome(fn):
    try:
        value = fn()
        if isinstance(value, float) and not math.isfinite(value):
            value = 'nan' if math.isnan(value) else ('-inf' if value < 0 else 'inf')
        return {'ok': True, 'value': value}
    except (TypeError, ValueError, IndexError, KeyError, FileNotFoundError) as exc:
        return {'ok': False, 'error': type(exc).__name__}

annex_cases = []
for key in ['r.total', 'x.total', 'x.balance', 'x.fin', 'x.exp', 'x.interest', 'x.nonint']:
    annex_cases.append({'name': 'null-'+key, 'id': key, 'values': [None]*5})
annex_cases += [{'name': 'empty-series', 'id': 'r.total', 'values': []},
                {'name': 'short-series', 'id': 'x.balance', 'values': [1,2]},
                {'name': 'null-child', 'id': 'r.corp.nonfin', 'values': [None]*5}]
for case in annex_cases:
    modified = copy.deepcopy(annex)
    modified['mln'][case['id']] = case['values']
    case['expected'] = outcome(lambda: forecast_tables.check_sums(modified))
write('annex-cases.json', annex_cases)

scalars = ['1e3', '1.0e3', '1.0e+3', '1e+3', '1.0e-3', '1.', '.5', '-.5', '012', '09', '+09', '1_000', '0x10', '0b10', '1:20', '1:20.0', 'yes', 'no', 'on', 'off', 'YES', 'No', 'y', 'n', 'true', 'False', '~', 'Null', 'NULL', 'null', '"1e3"']
write('yaml-scalars.json', [{'text': x, 'expected': yaml.safe_load('x: ' + x)['x']} for x in scalars])
money_cases = ['0x10', '0b10', ' 1 ', '1_000', 'Infinity', '-inf', 'NaN', '', ' ', '1e3', '1.0e3', '1.0e+3', '1_0.2_3', '1__0', '1_', '_1', '1_.0', '.5', '1.', '+3', '1e_3', '１２.５', '\u00851\u0085', None, True, 123]
write('money-cases.json', [{'input': x, 'expected': outcome(lambda: execution_contract._num(x))} for x in money_cases])

ctx_inputs = {'src': {'name':'source', 'value':1}, 'raw': {'name':'raw', 'value':2}, 'cache': {'name':'cache', 'value':3}, 'law': {'name':'law', 'value':4}, 'pages': {'name':'pages', 'value':5}}
write('context-inputs.json', ctx_inputs)
with tempfile.TemporaryDirectory() as temp:
    base = Path(temp)
    for d in ['inputs', 'originals/asbp', 'cache/research/mf-umtbf-2026-2028/extracts', 'release']:
        (base/d).mkdir(parents=True, exist_ok=True)
    def put(rel, obj): (base/rel).write_text(json.dumps(obj, ensure_ascii=False), encoding='utf8')
    put('originals/asbp/asbp_tables.json', fixture)
    put('inputs/example.json', ctx_inputs['src'])
    put('originals/raw.json', ctx_inputs['raw'])
    put('cache/cache.json', ctx_inputs['cache'])
    put('cache/law_bill.json', ctx_inputs['law'])
    put('cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json', ctx_inputs['pages'])
    put('release/execution.json', json.loads((INPUTS/'execution.json').read_text()))
    context.SRC, context.RAW, context.CACHE, context.DATA = (base/'inputs', base/'originals', base/'cache', base/'release')
    context.PDF_PAGES = base/'cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json'
    forecast_tables.RAW = base/'originals'
    ctx = context.Ctx()
    write('context-loaders.json', {'src':ctx.src('example'), 'raw':ctx.raw('raw.json'), 'cache':ctx.cache('cache.json'), 'law':ctx.law, 'pdfPages':ctx.pdf_pages, 'docxCheck':ctx.docx_check, 'gdp':ctx.gdp, 'gdpTies': (lambda c: c.gdp)(type('C', (), {'annex': {'gdp': [-2.5, -1.5, 0.5, 1.5, 2.5]}, 'gdp': context.Ctx.gdp})())})

sparse_text = '{"id":["time"],"size":[3],"dimension":{"time":{"category":{"index":["2024","2025","2026"]}}},"value":{"2":3,"0":1,"1":null},"status":{"2":"p"}}'
sparse = json.loads(sparse_text)
write('sparse-jsonstat.json', {'text':sparse_text, 'cells':data_io.jsonstat_cells(sparse), 'series':data_io.jsonstat_series(sparse)})
