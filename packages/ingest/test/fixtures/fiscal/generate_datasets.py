"""Regenerate donor and annual-layer fiscal outputs from isolated frozen inputs."""
import copy
import hashlib
import json
import os
import sys
from pathlib import Path

os.environ['BUILD_DATE'] = '2026-11-08'
from budget_pipeline.build import annual_periods, context, debt_pdf, fiscal, forecast_tables, measures

HERE = Path(__file__).resolve().parent
ROOT = HERE / 'inputs'
DATA = ROOT / 'data'
CHECK = '--check' in sys.argv[1:]
if any(arg != '--check' for arg in sys.argv[1:]):
    raise SystemExit('usage: generate_datasets.py [--check]')

forecast_tables.RAW = DATA / 'originals'
context.RAW = DATA / 'originals'
context.SRC = DATA / 'inputs'
context.PDF_PAGES = DATA / 'cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json'
annual_periods.ROOT = ROOT
annual_periods.SRC = DATA / 'inputs'

def emit(name, obj):
    data = (json.dumps(obj, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode()
    path = HERE / name
    if CHECK:
        if path.read_bytes() != data:
            raise ValueError('Fixture differs: ' + name)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()

ctx = context.Ctx()
fiscal.build_outlook(ctx)
fiscal.build_revenue(ctx)
fiscal.build_expenditure(ctx)
measures.build_measures(ctx)
donor = copy.deepcopy(ctx.out)
annual_periods.build_annual_periods(ctx)
final = ctx.out
outputs = {}
for name in sorted(donor):
    outputs['donor/' + name] = emit('donor/' + name, donor[name])
    outputs['oracle/' + name] = emit('oracle/' + name, final[name])
# Independently exercise the cleaned-page debt readers.
outputs['debt-text-oracle.json'] = emit('debt-text-oracle.json', {
    'structure': debt_pdf.parse_structure(ctx),
    'interest': debt_pdf.parse_interest(ctx),
    'guaranteed': debt_pdf.parse_guaranteed(ctx),
    'newDebt': debt_pdf.parse_new_debt(ctx),
    'lawLimits': debt_pdf.parse_law_limits([text for kind, text in json.loads((ROOT / 'dv-blocks.json').read_text())['zdb'] if kind == 'p']),
})
files = sorted(p for p in ROOT.rglob('*') if p.is_file())
inputs = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
published = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((HERE / 'published').iterdir())}
emit('datasets-provenance.json', {
    'baseline': 'bd973a0a3dfbc8d8bd03ac85e6aa1f0784669bf2',
    'buildDate': '2026-11-08',
    'archiveSha256': '9430d8acfe5bd178a1675041aaae22295c89f2768474ebd27af347b465ace5e3',
    'frozenInputSha256': inputs, 'oracleSha256': outputs, 'publishedSnapshotSha256': published,
    'policySha256': hashlib.sha256((HERE / 'policy.json').read_bytes()).hexdigest(),
    'sourceLimits': 'Cleaned page and table evidence supplied by Python extraction; historical raw DOCX and authored excerpts are not independently re-extracted here.',
})
print('fiscal donor and annual oracle: byte-identical' if CHECK else 'fiscal donor and annual oracle: regenerated')
