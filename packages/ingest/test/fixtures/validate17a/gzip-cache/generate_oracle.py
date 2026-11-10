"""Unchanged Python gzip-size evidence for content cache boundaries."""
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
original = LEGACY / 'generate_oracle.py'
ns = {'__file__': str(original), '__name__': 'frozen_gzip_cache_donor'}
exec(compile(original.read_text().split('\nobserved = {}')[0], str(original), 'exec'), ns)
cases = []
def add(name, pattern, repeats=1, group='small'):
    raw = pattern * repeats
    cases.append({'name': name, 'group': group, 'hex': pattern.hex(), 'repeats': repeats,
                  'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
                  'gzip': ns['checks'].gz_size(raw)})
add('empty', b'')
add('ascii', b'abc', 1000)
add('bulgarian', 'тест '.encode(), 300)
add('zeroes', b'\x00', 512)
add('invalid-uniform', b'\x80', 512)
add('invalid-varied', bytes(range(128, 192)), 8)
for i in range(300):
    add('distinct-' + str(i), hashlib.sha256(str(i).encode()).digest(), 4, 'distinct')
add('cache-limit-a', b'A', 16 * 1024 * 1024, 'limit')
add('cache-limit-b', b'B', 16 * 1024 * 1024, 'limit')
add('over-limit', b'C', 16 * 1024 * 1024 + 1, 'large')
output = (json.dumps(cases, separators=(',', ':')) + '\n').encode()
proof = {'python': '3.12', 'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
         'inputs': {name: hashlib.sha256((LEGACY / name).read_bytes()).hexdigest() for name in
                    ('generate_oracle.py', 'provenance.json', 'donor/budget_pipeline/validate/checks.py')},
         'outputs': {'oracle.json': hashlib.sha256(output).hexdigest()}, 'cases': len(cases)}
for name, raw in {'oracle.json': output, 'provenance.json': (json.dumps(proof, indent=2) + '\n').encode()}.items():
    target = HERE / name
    if '--check' in sys.argv:
        if not target.exists() or target.read_bytes() != raw: raise SystemExit('Gzip cache proof differs: ' + name)
    else: target.write_bytes(raw)
