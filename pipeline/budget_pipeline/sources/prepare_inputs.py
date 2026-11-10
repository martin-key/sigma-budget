#!/usr/bin/env python3
"""Produce missing offline intermediates before budget build; never fetch or replace inputs.

Run with tmp/venv-data/bin/python -m budget_pipeline.sources.prepare_inputs.
Existing 2027 extractions are regenerated for comparison, never overwritten.
budget build runs this gate inside its commit export, not in the checkout.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
EXTRACTIONS_2027 = (
    ('budget_pipeline.extract.budget_forecast_2027', 'data/inputs/budget_forecast_2027.json'),
    ('budget_pipeline.extract.budget_bill_2027', 'data/inputs/budget_bill_2027.json'),
)
EVIDENCE_2027 = 'tmp/budget-2027-extractions.json'


def verify_budget_2027_sources():
    # The acquisition record is itself pinned: editing both the ZIP and its
    # self-description must not bypass a direct prepare_inputs invocation.
    from budget_pipeline.cli import pins, sha256_file
    pinned = pins(ROOT)
    for name in ('ZDBRB-2027.zip', 'acquisition.json'):
        path = 'data/originals/budget_2027/' + name
        if path not in pinned or sha256_file(ROOT / path) != pinned[path]:
            raise ValueError('2027 source differs from committed pin: ' + path)


def prepare_budget_2027():
    """Check committed extractions against pinned PDF bytes, or generate absent ones.

    No timestamps: this evidence is included in the reproducible manifest. Pins
    and acquisition metadata come from the exported commit/registered originals.
    """
    report = ROOT / EVIDENCE_2027
    report.unlink(missing_ok=True)
    verify_budget_2027_sources()
    evidence = []
    for producer, output in EXTRACTIONS_2027:
        path = ROOT / output
        present = path.is_file()
        print(('verify: ' if present else 'produce: ') + producer, flush=True)
        subprocess.run([sys.executable, '-m', 'budget_pipeline.offline', producer]
                       + (['--check'] if present else []), cwd=ROOT, check=True)
        blob = path.read_bytes()
        evidence.append({'path': output, 'producer': producer,
                         'action': 'verified' if present else 'generated',
                         'bytes': len(blob), 'sha256': hashlib.sha256(blob).hexdigest(),
                         'source': json.loads(blob)['source']})
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(evidence, ensure_ascii=False, sort_keys=True) + '\n', encoding='utf-8')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--budget-2027-only', action='store_true',
                        help='offline extraction/freshness gate used by the isolated release build')
    args = parser.parse_args(argv)
    prepare_budget_2027()
    if args.budget_2027_only:
        return 0
    from budget_pipeline.sources.originals import read_sums

    steps = [
        ('budget_pipeline.extract.dv_laws', ['data/originals/dv/dv_laws_2026.json']),
        ('budget_pipeline.extract.program_budgets',
         ['data/originals/' + p for p in read_sums() if p.startswith('program_budgets/')]),
        ('budget_pipeline.extract.asbp_tables', ['data/originals/asbp/asbp_tables.json']),
        ('budget_pipeline.extract.asbp_pages',
         ['data/cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json']),
        ('budget_pipeline.extract.bill', ['data/cache/law_bill.json']),
        ('budget_pipeline.extract.dbp2027', ['data/cache/research/dbp-2027/dbp2027_figures.json']),
    ]
    for producer, outputs in steps:
        if all((ROOT / p).is_file() for p in outputs):
            print('present: ' + producer, flush=True)
            continue
        print('produce: ' + producer, flush=True)
        subprocess.run([sys.executable, "-m", producer], cwd=ROOT, check=True)
        missing = [p for p in outputs if not (ROOT / p).is_file()]
        if missing:
            sys.exit('producer did not write: ' + ', '.join(missing))
    subprocess.run([sys.executable, "-m", "budget_pipeline.extract.legacy_inputs", "municipal", "--check"],
                   cwd=ROOT, check=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
