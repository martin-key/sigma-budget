"""Regenerate contract evidence from the frozen Python 3.12 donor and frozen input."""
import hashlib
import importlib.util
import json
import sys
from decimal import Decimal
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
DONOR_HASH = 'ffa32a7c6ee3a1ef661294049f77d8797a2e5dbc7fe4e160d7ebc5e7b5e70e5f'
if sys.version_info[:2] != (3, 12):
    raise SystemExit('Python 3.12 is required')
if hashlib.sha256((HERE / 'execution_contract.py').read_bytes()).hexdigest() != DONOR_HASH:
    raise SystemExit('Frozen donor hash changed')
spec = importlib.util.spec_from_file_location('frozen_execution_contract', HERE / 'execution_contract.py')
donor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(donor)
provenance = json.loads((HERE / 'provenance.json').read_text(encoding='utf8'))
for name in ('execution_contract.py', 'execution.json', 'contract.json', 'synthetic-execution.json'):
    if hashlib.sha256((HERE / name).read_bytes()).hexdigest() != provenance['files'][name]:
        raise SystemExit('Frozen fixture changed: ' + name)
if json.loads((HERE / 'contract.json').read_text(encoding='utf8')) != donor.CONTRACT:
    raise SystemExit('Contract fixture differs from donor')
doc = json.loads((HERE / 'execution.json').read_text(encoding='utf8'))
decimals = ['.5', '-.5', '1e-1000', '0', '-0.00001', '1.2345', '-1.2345', '9.9995', '1e-7', '999999.9995', '2.5', '-2.5']
synthetic = json.loads((HERE / 'synthetic-execution.json').read_text(encoding='utf8'))
def outcome(value, places):
    try: return {'ok': True, 'value': donor.money(value, places)}
    except (ValueError, TypeError, ArithmeticError): return {'ok': False}
result = {'syntheticCanonical': donor.canonical(synthetic), 'syntheticNumbers': donor.numbers(donor.canonical(synthetic)),
          'moneyValues': [{'input': v, 'places': 3, 'expected': outcome(v, 3)} for v in [None, True, False, -1.2345, 1.2345, ' 12.3455 ', '1e3', 'bad', 'NaN', 'Infinity']],
          'numbers': donor.numbers(doc), 'canonical': donor.canonical(donor.numbers(doc)),
          'money': [{'input': v, 'places': p, 'value': donor.money(Decimal(v), p)} for p in (0, 1, 3) for v in decimals]}
encoded = (json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
path = HERE / 'oracle.json'
if '--check' in sys.argv:
    if not path.exists() or path.read_bytes() != encoded or hashlib.sha256(encoded).hexdigest() != provenance['files']['oracle.json']:
        raise SystemExit('Oracle differs from frozen donor')
else:
    path.write_bytes(encoded)
