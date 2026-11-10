"""Source string conversions and slice/method order from unchanged Python."""
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
original = LEGACY / 'generate_oracle.py'
ns = {'__file__': str(original), '__name__': 'frozen_source_string_donor'}
exec(compile(original.read_text().split('\nobserved = {}')[0], str(original), 'exec'), ns)
def read(name): return json.loads((LEGACY / 'corpus/data/release' / name).read_text())
def encode(doc): return json.dumps(doc, ensure_ascii=False).encode('utf8')
cases = []
def add(name, changes, groups=('CORE',)):
    docs = {}
    for filename, path, value in changes:
        doc = docs.setdefault(filename, read(filename))
        target = doc
        for key in path[:-1]: target = target[key]
        target[path[-1]] = value
    catalog = docs.setdefault('catalog.json', read('catalog.json'))
    for filename, doc in docs.items():
        if filename == 'catalog.json': continue
        row = next(d for d in catalog['datasets'] if d.get('file') == 'data/' + filename)
        data = encode(doc); row['bytes'], row['gzipBytes'] = len(data), ns['checks'].gz_size(data)
        row['schema'] = ns['catalog']._schema(doc)
    next(d for d in catalog['datasets'] if d['slug'] == 'catalog')['schema'] = ns['catalog']._schema(catalog)
    cases.append({'name': 'source-string-' + name, 'groups': list(groups), 'compiled': True,
                  'ops': [{'op': 'write', 'file': 'data/release/' + filename,
                           'value': encode(doc).decode('utf8')} for filename, doc in docs.items()]})

types = (0.0, True, None, [], {}, 'control')
for index, value in enumerate(types):
    add('function-id-' + str(index), [('expenditure.json', ['functions', 'items', 0, 'id'], value)])
    add('revenue-id-' + str(index), [('revenue.json', ['groups', 0, 'id'], value)])
for index, value in enumerate(types[:-1]):
    add('function-near-' + str(index), [
        ('expenditure.json', ['functions', 'items', 0, 'id'], value),
        ('core.json', ['functions', 0, 'id'], value),
        *[('core.json', ['functions', 0, key], 999) for key in ('pctGdp', 'share', 'yoyPct')]])
for index, value in enumerate(types[:-1]):
    add('next-date-' + str(index), [('execution.json', ['pendingMonths', 0, 'asOf'], value)])
    add('latest-date-' + str(index), [('execution.json', ['latest', 'asOf'], value)])
    add('latest-skipped-' + str(index), [
        ('execution.json', ['latest', 'asOf'], value),
        ('core.json', ['pending', 'P04', 'title'], 'different')])
add('method-first', [('execution.json', ['pendingMonths', 0, 'asOf'], []),
                     ('core.json', ['pending', 'P04', 'title'], 0.0)])
add('next-unicode-prefix', [
    ('execution.json', ['pendingMonths', 0, 'asOf'], '😀2026-10-31'),
    ('core.json', ['build', 'kfpNext'], '😀2026-10-31'),
    ('core.json', ['pending', 'P04', 'title'], 'Отчетът към 31.10.😀2026 г.'),
    ('core.json', ['pending', 'P04', 'reason'], 'за октомври 😀202 г. още не е добавен; последният е за септември 2026 г.')])
for name, value in (('list-prefix', [0.0, True, None, {}]), ('unicode-prefix', '😀2026-09-30')):
    prefix = str(value[:4])
    add('latest-' + name, [
        ('execution.json', ['latest', 'asOf'], value),
        ('core.json', ['build', 'kfpLatest'], value),
        ('core.json', ['kpis', 'asOf'], value),
        ('core.json', ['meta', 'asOf'], value),
        ('core.json', ['pending', 'P04', 'reason'], 'за октомври 2026 г. още не е добавен; последният е за септември %s г.' % prefix)])
pending = next(i for i, d in enumerate(read('catalog.json')['datasets']) if d['status'] == 'pending')
for index, value in enumerate(types):
    add('pending-id-' + str(index), [('catalog.json', ['datasets', pending, 'id'], value)], ('CATALOG',))
for index, value in enumerate(types[:-1]):
    add('file-slice-' + str(index), [('catalog.json', ['datasets', 0, 'file'], value)], ('CATALOG',))
assert len(cases) == 47

observed = {}
with tempfile.TemporaryDirectory(prefix='sigma-source-string-donor-') as temp:
    for case in cases:
        root = Path(temp) / case['name']
        shutil.copytree(LEGACY / 'corpus', root)
        shutil.copytree(LEGACY / 'overlay', root, dirs_exist_ok=True)
        for op in case['ops']: ns['mutate'](root, op)
        observed[case['name']] = {group: ns['capture'](root, group) for group in case['groups']}
        shutil.rmtree(root)
outputs = {name: (json.dumps(value, ensure_ascii=True, separators=(',', ':')) + '\n').encode()
           for name, value in {'cases.json': cases, 'oracle.json': observed}.items()}
proof = {'python': '3.12', 'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
         'inputs': {name: hashlib.sha256((LEGACY / name).read_bytes()).hexdigest() for name in
                    ('generate_oracle.py', 'provenance.json', 'extra-provenance.json', 'year-keys/provenance.json')},
         'outputs': {name: hashlib.sha256(data).hexdigest() for name, data in outputs.items()}, 'cases': len(cases)}
outputs['provenance.json'] = (json.dumps(proof, indent=2) + '\n').encode()
for name, data in outputs.items():
    target = HERE / name
    if '--check' in sys.argv:
        if not target.exists() or target.read_bytes() != data: raise SystemExit('Source string proof differs: ' + name)
    else: target.write_bytes(data)
