"""Regenerate Python outputs using only adjacent frozen evidence, never live data.

PYTHONPATH=pipeline python packages/ingest/test/fixtures/components-rates/generate_oracle.py --check
The capture step uses pinned originals and the Python readers; it is not run in CI.
"""
import hashlib
import json
import os
import sys
from pathlib import Path

os.environ['BUILD_DATE'] = '2026-11-08'
from budget_pipeline.build import components, rates
from budget_pipeline.build.data_io import rnd
from budget_pipeline.extract import budget_law_parser

HERE = Path(__file__).parent
INPUTS = HERE / 'inputs'
CHECK = sys.argv[1:] == ['--check']
if sys.argv[1:] not in ([], ['--check']):
    raise SystemExit('usage: generate_oracle.py [--check]')

def read(name):
    return json.loads((INPUTS / name).read_text(encoding='utf-8'))

def emit(name, value):
    data = (json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode()
    path = HERE / name
    if CHECK:
        if path.read_bytes() != data:
            raise ValueError('Fixture differs: ' + name)
    else:
        path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()

class Context:
    def __init__(self):
        self.tables = read('tables.json')
        self.pdf_pages = read('pages.json')
        self.execution = read('execution.json')
        self.out = {name + '.json': read(name + '.json') for name in ('law', 'municipalities', 'outlook')}
        self.notes = []
    def get(self, name):
        return self.out[name]
    def src(self, name):
        assert name == 'kfp_components_2026'
        return read('kfp-components.json')
    def put(self, name, value):
        self.out[name] = value

# Only the raw readers are replaced: all transformation and cross-check logic remains Python's.
doo, nzok = read('doo-blocks.json'), read('nzok-blocks.json')
nap, bill = read('nap-rows.json'), read('bill-blocks.json')
budget_law_parser.dv_blocks = lambda path: doo if 'zbdoo' in str(path) or 'doo-blocks' in str(path) else nzok
budget_law_parser.docx_blocks = lambda path: bill
rates._nap_rows = lambda: nap
# build_rates checks existence before invoking readers; these are frozen evidence files.
rates.NAP_PDF = INPUTS / 'nap-rows.json'
rates.DOO_HTML = INPUTS / 'doo-blocks.json'
rates.NZOK_HTML = INPUTS / 'nzok-blocks.json'
rates.BILL_DOCX = INPUTS / 'bill-blocks.json'
ctx = Context()
rates.build_rates(ctx)
components.build_components(ctx)
outputs = {name: emit(name, ctx.out[name]) for name in ('components.json', 'rates.json')}
outputs['social.json'] = emit('social.json', {'doo': components._doo(doo), 'nzok': components._nzok(nzok)})
state, transfers = components._state(ctx)
outputs['component-tables.json'] = emit('component-tables.json', {'municipal': components._municipal(ctx, transfers['municipalities']), 'national': components._national_vs_eu(ctx), 'other': components._other(ctx)})
outputs['state.json'] = emit('state.json', {'state': state, 'transfers': transfers})
outputs['rounding.json'] = emit('rounding.json', [{'value': value, 'places': places, 'rounded': rnd(value, places)} for value, places in [(2.675, 2), (1.005, 2), (1.25, 1), (-1.25, 1), (0.045, 2), (-0.04, 1)]])
outputs['rates-law.json'] = emit('rates-law.json', rates._law(doo, nzok))
outputs['assumptions.json'] = emit('assumptions.json', rates._bill_assumptions())
funds = {rid: rates._funds(nap[rid]['cells']) for rid in rates.NAP_ROWS}
outputs['funds.json'] = emit('funds.json', funds)
fixes = [0]
groups, rows, notes = rates._min_income_tables(doo, fixes)
activities, note = rates._tzpb_tables(doo, fixes)
outputs['annexes.json'] = emit('annexes.json', {'groups': groups, 'minimumIncome': rows,
    'minimumNotes': notes, 'activities': activities, 'activityNote': note, 'nameFixes': fixes[0]})
inputs = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(INPUTS.iterdir()) if p.is_file()}
emit('provenance.json', {
    'baseline': 'bd973a0a3dfbc8d8bd03ac85e6aa1f0784669bf2',
    'buildDate': '2026-11-08',
    'sourceArchiveSha256': '9430d8acfe5bd178a1675041aaae22295c89f2768474ebd27af347b465ace5e3',
    'frozenInputSha256': inputs,
    'fixtureSha256': outputs,
    'oracle': 'Python 3.12 components and rates builders with frozen raw-reader evidence and context',
    'limitations': ['The original source of the July component summary is unknown; its values are frozen context, not newly sourced evidence.'],
})
print('components/rates fixtures: byte-identical' if CHECK else 'components/rates fixtures: regenerated')
