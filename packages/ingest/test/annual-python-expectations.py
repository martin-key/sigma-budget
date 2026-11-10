"""Independent TEST expectations from pinned Python donors; never a TS runtime reader.

Use the locked pipeline environment and an absent, caller-owned output directory.
Reads donors/originals/intermediates only; does not fetch or change any fixture.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'pipeline'))

import pymupdf
from budget_pipeline.extract import budget_forecast_2027 as F, budget_bill_2027 as B
from budget_pipeline.build.data_io import jload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    out = args.out.resolve()
    if out == ROOT or ROOT in out.parents:
        assert ROOT / 'tmp' in out.parents, 'output must be owned temporary evidence'
    assert (pymupdf.VersionBind, pymupdf.VersionFitz) == ('1.26.5', '1.26.10'), 'use locked donor environment'
    donor_hashes = {
        'pipeline/budget_pipeline/extract/budget_forecast_2027.py': '38d9c3f2ef59f9b43c45a17d9a7eafb35d0c0d6650da104d73e80ff4c1f94ed0',
        'pipeline/budget_pipeline/extract/budget_bill_2027.py': '4f6c2f7c738531814bad2c044d05c9b5e5a653c3a85ec6e0952b057a5d422798',
    }
    for path, pin in donor_hashes.items():
        assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == pin, 'donor changed: ' + path
    archive_path = 'data/originals/budget_2027/ZDBRB-2027.zip'
    archive = ROOT / archive_path
    acquisition = jload(archive.parent / 'acquisition.json')
    pin = next(x for x in acquisition if x['file'] == archive.name)
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == pin['sha256']
    with zipfile.ZipFile(archive) as z:
        pdf = z.read(F.MEMBER)
    member = next(m for m in pin['members'] if m['name'] == F.MEMBER)
    assert hashlib.sha256(pdf).hexdigest() == member['sha256']
    with pymupdf.open(stream=pdf, filetype='pdf') as doc:
        tables = F.extract(doc)
        verification = F.check_representations(doc, {k: v for k, v in tables.items() if k in F.ORIGINAL_KEYS})
        inventory = F.source_inventory(doc)
        page_text = [{'page': p.number + 1, 'text': p.get_text()} for p in doc if p.number >= 168]
    forecast = {
        'limitations': ['Annex 2 mixed/date/formula cells retain printed text; null numeric values do not imply zero. Annex 2 source rows 21 (minimum pension formula) and 23 (pension policy) have blank unit cells, retained as null units. No tables or annexes are excluded.'],
        'source': {'archive': archive_path, 'archive_sha256': pin['sha256'], 'member': F.MEMBER,
                   'pdf_sha256': member['sha256'], 'pages': 201},
        'tables': tables, 'page_text': page_text, 'checks': F.validate(tables),
        'cross_representation_checks': verification, 'inventory': inventory,
    }
    forecast['checks'] += F.validate_inventory(tables, inventory)
    assert all(c['passed'] for c in forecast['checks'])
    tables['annex2']['parse_status'] = 'checked'
    forecast['diagnostics'] = [c for c in forecast['checks'] if c.get('source_discrepancy')]
    bill = B.build()
    expectations = {'forecast': forecast, 'bill': bill}
    for role, value in expectations.items():
        committed = jload(ROOT / 'data/inputs' / ('budget_' + role + '_2027.json'))
        assert value == committed, role + ': regenerated donor differs from committed intermediate'
    out.mkdir(parents=True, exist_ok=False)
    report = {'donors': donor_hashes, 'pymupdf': pymupdf.VersionBind, 'mupdf': pymupdf.VersionFitz,
              'archiveSha256': pin['sha256'], 'outputs': {}}
    for role, value in expectations.items():
        blob = (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()
        (out / (role + '.json')).write_bytes(blob)
        report['outputs'][role] = {'sha256': hashlib.sha256(blob).hexdigest(), 'bytes': len(blob),
                                   'checks': len(value['checks']), 'matchesCommitted': True}
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
