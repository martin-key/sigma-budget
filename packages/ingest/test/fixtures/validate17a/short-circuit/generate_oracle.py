"""Independent SHA/byte-field short-circuit outcomes from the frozen donor."""
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
original = LEGACY / 'generate_oracle.py'
ns = {'__file__': str(original), '__name__': 'frozen_sha_order_donor'}
exec(compile(original.read_text().split('\nobserved = {}')[0], str(original), 'exec'), ns)
cases = []
MISSING = object()

def add(name, sha=MISSING, byte_value=MISSING, remove=()):
    doc = json.loads((LEGACY / 'corpus/data/release/catalog.json').read_text())
    row = doc['files'][0]
    if sha is not MISSING: row['sha256'] = sha
    if byte_value is not MISSING: row['bytes'] = byte_value
    for key in remove: del row[key]
    cases.append({'name': 'short-circuit-' + name, 'groups': ['CATALOG'], 'compiled': True,
                  'ops': [{'op': 'write', 'file': 'data/release/catalog.json', 'value': json.dumps(doc, ensure_ascii=False)}]})

add('baseline')
add('bad-sha-only', sha='bad')
add('missing-bytes-only', remove=('bytes',))
add('bad-sha-missing-bytes', sha='bad', remove=('bytes',))
for index, value in enumerate((0.0, None, [], 1.0, False, {})):
    add('sha-type-missing-bytes-' + str(index), sha=value, remove=('bytes',))
sha = json.loads((LEGACY / 'corpus/data/release/catalog.json').read_text())['files'][0]['sha256']
add('lf-sha-missing-bytes', sha=sha+'\n', remove=('bytes',))
for index, value in enumerate((None, 0, 0.0, 1, 1.0, False, True, -1, '1', [], {})):
    add('bytes-' + str(index), byte_value=value)
add('missing-sha', remove=('sha256',))
add('missing-both', remove=('sha256', 'bytes'))
assert len(cases) == 24, len(cases)
observed = {}
with tempfile.TemporaryDirectory(prefix='sigma-sha-order-donor-') as temp:
    for case in cases:
        root = Path(temp) / case['name']
        shutil.copytree(LEGACY / 'corpus', root)
        shutil.copytree(LEGACY / 'overlay', root, dirs_exist_ok=True)
        for op in case['ops']: ns['mutate'](root, op)
        observed[case['name']] = {group: ns['capture'](root, group) for group in case['groups']}
        shutil.rmtree(root)
outputs = {'cases.json': (json.dumps(cases, ensure_ascii=True, separators=(',', ':')) + '\n').encode(), 'oracle.json': (json.dumps(observed, ensure_ascii=True, separators=(',', ':')) + '\n').encode()}
proof = {'python': '3.12', 'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'inputs': {name: hashlib.sha256((LEGACY / name).read_bytes()).hexdigest() for name in ('generate_oracle.py', 'provenance.json', 'catalog-semantics/provenance.json')}, 'outputs': {name: hashlib.sha256(raw).hexdigest() for name, raw in outputs.items()}, 'cases': len(cases)}
outputs['provenance.json'] = (json.dumps(proof, indent=2) + '\n').encode()
for name, raw in outputs.items():
    target = HERE / name
    if '--check' in sys.argv:
        if not target.exists() or target.read_bytes() != raw: raise SystemExit('SHA short-circuit proof differs: ' + name)
    else: target.write_bytes(raw)
