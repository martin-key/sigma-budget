"""Capture only raw-reader results; run offline after verifying provenance."""
import hashlib
import json
import os
import sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'python'))
os.environ['BUILD_DATE'] = '2026-11-08'
from budget_pipeline.build import debt, payments
manifest = json.loads((HERE / 'provenance.json').read_text())
for name, expected in manifest['inputSha256'].items():
    path = HERE / name
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise ValueError('hash mismatch: ' + name)
data = HERE / 'inputs/data'
raw, cache = data / 'originals', data / 'cache'
debt.RAW = raw
payments.PAGE_HTML = raw / 'sebra/midt_sebra_2026_page.html'
files = {'2026-08-27': cache / 'sebra_27.08.2026.xlsx', '2026-08-28': cache / 'sebra_28.08.2026.xlsx',
         '2026-08-31': raw / 'sebra/midt_sebra_31.08.2026.xlsx'}
revisions = {release: {'|'.join(key): {str(y): list(pair) for y, pair in values.items()} for key, values in entries.items()} for release, entries in debt.EUROSTAT_REVISIONS.items()}
result = {'revisions': revisions, 'bnbGg': debt._bnb(*debt.BNB_GG), 'bnbCg': debt._bnb(*debt.BNB_CG),
          'listing': payments.parse_listing(), 'latest': payments.LATEST,
          'latestExpected': {key: payments.parse_day(files[payments.LATEST])[key] for key in ('count', 'eur')},
          'files': {day: {'bytes': path.stat().st_size, 'rows': payments.xlsx_rows(path)} for day, path in files.items()}}
path = HERE / 'inputs/reader-captures.json'
path.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')
oblast = json.loads((cache / 'eurostat_pop_nuts3_bg.json').read_text())['jsonstat']
(HERE / 'inputs/oblast-jsonstat.json').write_text(json.dumps(oblast, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')
print('captured verified Python readers')
