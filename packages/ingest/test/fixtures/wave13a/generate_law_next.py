"""Run the unchanged 9d law next_budget donor in isolation (Python 3.12)."""
import ast
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DONOR_SHA = 'ecdbc2fffd48630c9b2de59e0495966c30557ebc32ff5f0190ae6ef149eaee6a'
source = (HERE / 'law-donor.py').read_bytes()
if hashlib.sha256(source).hexdigest() != DONOR_SHA:
    raise ValueError('Frozen law donor changed')
tree = ast.parse(source)
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'next_budget')
module = ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[]))
namespace = {}
exec(compile(module, 'law-donor.py', 'exec'), namespace)
next_budget = namespace['next_budget']
cases = [None, {}, {'publication': '2026-11-06'}, {'publication': '2027-01-09'}]
data = (json.dumps([{'input': case, 'next': next_budget(case)} for case in cases],
                   ensure_ascii=False, separators=(',', ':')) + '\n').encode()
target = HERE / 'law-next-oracle.json'
if sys.argv[1:] == ['--check']:
    if target.read_bytes() != data:
        raise ValueError('Law next oracle differs')
elif not sys.argv[1:]:
    target.write_bytes(data)
else:
    raise SystemExit('usage: generate_law_next.py [--check]')
