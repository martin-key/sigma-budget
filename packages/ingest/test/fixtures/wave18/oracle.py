#!/usr/bin/env python3
"""Regenerate the frozen Python 3.12 KFP oracle and independent xlrd cell captures."""
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
if sys.version_info[:2] != (3, 12):
    raise SystemExit('Python 3.12 required')
manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
for name, digest in manifest['sha256'].items():
    path = ROOT / name
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise SystemExit('fixture hash mismatch: ' + name)
# Neither caller environment nor live workspace paths may redirect frozen reads.
os.environ.pop('BUDGET_DATA_DIR', None)
os.environ['BUILD_DATE'] = manifest['buildDate']
sys.path.insert(0, str(ROOT / 'pipeline'))
import xlrd
from budget_pipeline.validate import checks, execution_reports as donor

if xlrd.__version__ != manifest['xlrd']:
    raise SystemExit('xlrd version mismatch')

def check_result(absent=False):
    original_exists = os.path.exists
    try:
        donor.RAW_PRESENT = not absent
        if absent:
            os.path.exists = lambda path: False if '/data/originals/kfp_' in str(path) else original_exists(path)
        chk = donor.g_kfp(checks.Ctx())
        return dict(name=chk.name, n=chk.n, problems=chk.problems, warnings=chk.warnings, facts=chk.facts)
    finally:
        os.path.exists = original_exists
        donor.RAW_PRESENT = True

ex = checks.load('execution.json')
row_no = {r['id']: r['row'] for r in ex['rows'] if 'row' in r}
captures = []
for year, block in sorted(ex['data'].items()):
    for f in block['files']:
        path = ROOT / 'data' / 'originals' / ('kfp_' + year) / f['file']
        entry = dict(year=year, filename=f['file'], rawSha256=donor._sha(path),
                     sheet=donor.SHEET, publishedRows=row_no, readFailure=None)
        try:
            sh = xlrd.open_workbook(path).sheet_by_name(donor.SHEET)
            entry.update(dims=[sh.nrows, sh.ncols],
                cells=[[dict(type=sh.cell_type(r, c), value=sh.cell_value(r, c)) for c in range(sh.ncols)] for r in range(sh.nrows)],
                report=donor._read_report(path, row_no))
        except Exception as error:
            entry['readFailure'] = dict(type=type(error).__name__, message=str(error))
        captures.append(entry)
outputs = {
    'captures.json': dict(version=1, xlrd=xlrd.__version__, rawOriginalsPresent=True, reports=captures),
    'expected.json': dict(present=check_result(), absent=check_result(True)),
}
check = sys.argv[1:] == ['--check']
if sys.argv[1:] not in ([], ['--check']):
    raise SystemExit('usage: oracle.py [--check]')
if check and hashlib.sha256((ROOT / 'captures.json').read_bytes()).hexdigest() != manifest['capturesSha256']:
    raise SystemExit('capture manifest hash mismatch')
for name, obj in outputs.items():
    encoded = json.dumps(obj, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    path = ROOT / name
    if check:
        if path.read_text(encoding='utf-8') != encoded:
            raise SystemExit(name + ' differs from independent Python output')
    else:
        path.write_text(encoded, encoding='utf-8')
print('KFP frozen oracle and captures verified' if check else 'KFP frozen oracle and captures generated')
