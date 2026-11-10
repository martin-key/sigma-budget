"""Independent TEST-only Python 3.12/xlrd donor run. Production TS never imports this.

All reads use frozen supplied originals and prepared annual tables; the output directory
must be new. No capture grid or published execution is an input to the donor build.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True
os.environ['BUILD_DATE'] = '2026-11-08'
parser = argparse.ArgumentParser()
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
project = Path(__file__).resolve().parents[4]
fixture = project / 'packages/ingest/test/fixtures/wave18'
assert sys.version_info[:2] == (3, 12), sys.version
import xlrd
assert xlrd.__version__ == '2.0.2', xlrd.__version__
sys.path.insert(0, str(project / 'pipeline'))
expected_donors = {
    "extract/kfp_full.py": "232e144e4394feeb61348f8fe2f6e88a58cff52b404481fd32c3c8093172093d",
    "build/execution_law.py": "3d4fd3da440a832dc3ba3aaa3cb6687e7e320a48784e411f0f1ee10493b68bf3",
    "build/annual_periods.py": "3a036c4d9e999897dc4737340da72772a27b8c1e40e3c5bff4f5b678d11a41cb",
    "build/forecast_tables.py": "caacfbe902403d10b93631fd9e191b9cd8613099b8fb4ce0fedc8b05afdc17a9",
    "build/data_io.py": "b827a40fe5c979f2cf0d689766fedc355fddeb8c897460578d6aeb26364b9d68",
    "validate/execution_contract.py": "ffa32a7c6ee3a1ef661294049f77d8797a2e5dbc7fe4e160d7ebc5e7b5e70e5f"
}
for rel, expected in expected_donors.items():
    path = project / 'pipeline/budget_pipeline' / rel
    assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, rel
from budget_pipeline.build import data_io, forecast_tables, annual_periods

data_io.RAW = fixture / 'data/originals'
data_io.SRC = fixture / 'data/inputs'
data_io.DATA = args.out.resolve()
forecast_tables.RAW = project / 'packages/ingest/test/fixtures/fiscal/inputs/data/originals'
annual_periods.ROOT = fixture
annual_periods.SRC = data_io.SRC
from budget_pipeline.extract import kfp_full

manifest = json.loads((fixture / 'manifest.json').read_text())
inputs = {}
for rel, expected in manifest['sha256'].items():
    if rel.startswith('data/inputs/') or rel.startswith('data/originals/'):
        path = fixture / rel
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        assert actual == expected, rel
        inputs[str(path)] = actual
historical = forecast_tables.RAW / 'asbp/asbp_tables.json'
inputs[str(historical)] = hashlib.sha256(historical.read_bytes()).hexdigest()
donors = {}
for rel in ['extract/kfp_full.py', 'build/execution_law.py', 'build/annual_periods.py',
            'build/forecast_tables.py', 'build/data_io.py', 'validate/execution_contract.py']:
    path = project / 'pipeline/budget_pipeline' / rel
    donors[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
args.out.mkdir()  # exclusive creation; no fixture or published-data writes
kfp_full.build()
for path, digest in inputs.items():
    assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == digest, path
receipt = {'schema': 'execution-donor/1', 'python': sys.version.split()[0], 'xlrd': xlrd.__version__,
           'buildDate': '2026-11-08', 'donors': donors, 'inputs': inputs,
           'outputs': {name: hashlib.sha256((args.out / name).read_bytes()).hexdigest()
                       for name in ['execution.json', 'execution-provenance.json']},
           'annualBoundary': 'Prepared annual JSON and archive/member hashes; not new PDF extraction.'}
(args.out / 'donor-receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
