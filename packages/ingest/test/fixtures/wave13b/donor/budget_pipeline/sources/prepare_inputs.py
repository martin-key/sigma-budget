#!/usr/bin/env python3
"""Produce missing offline intermediates before budget build; never fetch or replace inputs.

Run with tmp/venv-data/bin/python -m budget_pipeline.sources.prepare_inputs.
Existing files are retained; sources.originals status and budget build verify pins.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def main():
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
