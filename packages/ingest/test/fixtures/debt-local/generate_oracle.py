"""Regenerate the TS07 donor from frozen evidence and a frozen Python 3.12 donor."""
import copy
import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'python'))
os.environ['BUILD_DATE'] = '2026-11-08'
from budget_pipeline.build import debt, municipalities, payments, forecast_tables, data_io
from budget_pipeline.extract import budget_law_parser

if sys.version_info[:2] != (3, 12):
    raise SystemExit('Python 3.12 is required')
if sys.argv[1:] not in ([], ['--check']):
    raise SystemExit('usage: generate_oracle.py [--check]')
CHECK = bool(sys.argv[1:])
DATA = HERE / 'inputs/data'
RAW = DATA / 'originals'
CACHE = DATA / 'cache'

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def emit(name, obj):
    path = HERE / name
    payload = (data_io.jdumps(obj) + '\n').encode()
    if CHECK:
        if path.read_bytes() != payload:
            raise ValueError('fixture differs: ' + name)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
    return hashlib.sha256(payload).hexdigest()

forecast_tables.RAW = RAW
debt.RAW = RAW
payments.PAGE_HTML = RAW / 'sebra/midt_sebra_2026_page.html'
payments.FILES = {'2026-08-27': CACHE / 'sebra_27.08.2026.xlsx',
                  '2026-08-28': CACHE / 'sebra_28.08.2026.xlsx',
                  '2026-08-31': RAW / 'sebra/midt_sebra_31.08.2026.xlsx'}
# Verify the committed reader captures against the archived raw files using the
# frozen Python adapters; the TypeScript builders consume these captures.
reader_expected = {
    'revisions': {release: {'|'.join(key): {str(y): list(pair) for y, pair in values.items()}
                            for key, values in entries.items()}
                  for release, entries in debt.EUROSTAT_REVISIONS.items()},
    'bnbGg': debt._bnb(*debt.BNB_GG), 'bnbCg': debt._bnb(*debt.BNB_CG),
    'listing': payments.parse_listing(), 'latest': payments.LATEST,
    'latestExpected': {key: payments.parse_day(payments.FILES[payments.LATEST])[key] for key in ('count', 'eur')},
    'files': {day: {'bytes': path.stat().st_size, 'rows': payments.xlsx_rows(path)}
              for day, path in payments.FILES.items()},
}
if read(HERE / 'inputs/reader-captures.json') != reader_expected:
    raise ValueError('frozen reader captures differ from Python adapters')
if read(HERE / 'inputs/oblast-jsonstat.json') != read(CACHE / 'eurostat_pop_nuts3_bg.json')['jsonstat']:
    raise ValueError('oblast JSON-stat capture differs from cache')
budget_law_parser.dv_blocks = lambda path: read(HERE / 'inputs/dv-blocks.json')['zdb']
class Context:
    def __init__(self):
        self.tables = read(RAW / 'asbp/asbp_tables.json')['tables']
        self.annex = forecast_tables.load()
        self.pdf_pages = read(CACHE / 'research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json')
        self.law = read(CACHE / 'law_bill.json')
        self.execution = read(HERE / 'inputs/execution.json')
        self.out = {}
        self.notes = []
    def src(self, name):
        return read(DATA / 'inputs' / (name + '.json'))
    def raw(self, rel):
        return read(RAW / rel)
    def cache(self, rel):
        return read(CACHE / rel)
    def put(self, name, obj):
        self.out[name] = obj

ctx = Context()
debt.build_debt(ctx)
municipalities.build_municipalities(ctx)
payments.build_sebra(ctx)
names = ['debt.json', 'municipalities.json', 'geo/obshtini.json', 'sebra.json']
outputs = {}
for name in names:
    outputs['donor/' + name] = emit('donor/' + name, ctx.out[name])
    # The annual, wording, source and active-data projections do not alter these four files.
    outputs['projected/' + name] = emit('projected/' + name, copy.deepcopy(ctx.out[name]))
inputs = {str(p.relative_to(HERE)): digest(p) for root in ('inputs', 'python', 'published', 'stage-evidence')
          for p in sorted((HERE / root).rglob('*')) if p.is_file() and '__pycache__' not in p.parts}
manifest = {'baseline': '05d6f6eeca9991468f3c94c3c9c26e87d5b0fae0',
            'archiveSha256': '9430d8acfe5bd178a1675041aaae22295c89f2768474ebd27af347b465ace5e3',
            'python': '3.12', 'inputSha256': inputs, 'outputSha256': outputs,
            'lawCaptureSource': {'path': 'data/originals/dv/zdb2026_dv69_idMat245041.html',
                                 'sha256': '1f5e85a3e1ae95e55c4d331a5f0ab6e97efd1d64ede5ff529886df7e5e12e160'},
            'policySha256': digest(HERE / 'policy.json'), 'registrySha256': digest(HERE / 'registry.yaml'),
            'limits': ['GISCO and oblast population are cached responses, not original response bytes.',
                       'debt_stock and debt_gdp are frozen copies without recovered original response bytes.',
                       'Law paragraphs and cleaned pages are frozen Python reader captures.']}
emit('provenance.json', manifest)
print('TS07 Python donor: byte-identical' if CHECK else 'TS07 Python donor: regenerated')
