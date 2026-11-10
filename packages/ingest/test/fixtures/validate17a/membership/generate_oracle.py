"""Independent catalogue membership/equality controls from unchanged Python."""
import copy
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
original = LEGACY / 'generate_oracle.py'
ns = {'__file__': str(original), '__name__': 'frozen_membership_donor'}
exec(compile(original.read_text().split('\nobserved = {}')[0], str(original), 'exec'), ns)
def read(name): return json.loads((LEGACY / 'corpus/data/release' / name).read_text())
def encoded(doc): return json.dumps(doc, ensure_ascii=False).encode('utf8')
cases = []
def add(name, docs=None, extra=()):
    docs = {} if docs is None else docs
    if docs:
        catalog = docs.setdefault('catalog.json', read('catalog.json'))
        for filename, doc in list(docs.items()):
            if filename == 'catalog.json': continue
            dataset = next((d for d in catalog['datasets'] if d.get('file') == 'data/' + filename), None)
            if dataset is not None:
                raw = encoded(doc)
                dataset['bytes'], dataset['gzipBytes'] = len(raw), ns['checks'].gz_size(raw)
                dataset['schema'] = ns['catalog']._schema(doc)
        next(d for d in catalog['datasets'] if d['slug'] == 'catalog')['schema'] = ns['catalog']._schema(catalog)
    cases.append({'name': 'membership-' + name, 'groups': ['CATALOG'], 'compiled': True,
                  'ops': [{'op': 'write', 'file': 'data/release/' + filename, 'value': encoded(doc).decode('utf8')} for filename, doc in docs.items()] + list(extra)})

add('baseline')
for index, (group_id, reference) in enumerate(((True, 1), (1, True), (False, 0), (0, False), (1.0, True), (True, 1.0), (None, None), ('1', 1), (1, 2))):
    doc = read('catalog.json'); doc['groups'].append({'id': group_id, 'label': 'membership'})
    doc['datasets'][0]['group'] = reference
    add('group-' + str(index), {'catalog.json': doc})
for name in ('group-only', 'reference-only', 'duplicate-pair'):
    doc = read('catalog.json')
    if name != 'reference-only': doc['groups'].append({'id': True, 'label': 'membership'})
    if name == 'duplicate-pair': doc['groups'].append({'id': 1, 'label': 'duplicate'})
    if name != 'group-only': doc['datasets'][0]['group'] = 1
    add(name, {'catalog.json': doc})
for index, (slug, reference) in enumerate(((1, True), (True, 1), (0, False), (False, 0), (1.0, True), (None, None), ('1', True))):
    doc = read('catalog.json'); row = next(d for d in doc['datasets'] if d['status'] == 'pending')
    row['slug'] = slug; doc['files'][0]['usedBy'] = [reference]
    add('used-by-' + str(index), {'catalog.json': doc})
for index, (identifier, reference) in enumerate(((True, 1), (1, True), (False, 0), (0, False), (True, 1.0), (1.0, True), (None, None))):
    doc, ministries = read('catalog.json'), read('ministries.json')
    ministries['items'][0]['id'] = identifier
    dataset = next(d for d in doc['datasets'] if d.get('fileTemplate'))
    part = dataset['parts'][0]; old_file = part['file']; new_file = 'data/ministries/' + str(reference) + '.json'
    raw = (LEGACY / 'corpus/data/release' / old_file.removeprefix('data/')).read_bytes()
    part['code'], part['file'] = reference, new_file
    part['bytes'], part['gzipBytes'] = len(raw), ns['checks'].gz_size(raw)
    add('ministry-' + str(index), {'ministries.json': ministries, 'catalog.json': doc}, [
        {'op': 'deleteFile', 'file': 'data/release/' + old_file.removeprefix('data/')},
        {'op': 'write', 'file': 'data/release/' + new_file.removeprefix('data/'), 'value': raw.decode('utf8')}])
for index, value in enumerate((None, 0.0, [], {}, '', 'MISSING')):
    doc, ministries = read('catalog.json'), read('ministries.json')
    next(d for d in doc['datasets'] if d.get('fileTemplate'))['parts'] = []
    if value == 'MISSING': del ministries['items']
    else: ministries['items'] = value
    add('empty-parts-' + str(index), {'ministries.json': ministries, 'catalog.json': doc})
for index, value in enumerate(([], {})):
    ministries = read('ministries.json'); ministries['items'][0]['id'] = value
    add('unhashable-ministry-' + str(index), {'ministries.json': ministries})
for index, value in enumerate(([], {})):
    ministries = read('ministries.json'); ministries['items'][0]['id'] = value
    del ministries['items'][1]['id']
    add('ministry-first-error-' + str(index), {'ministries.json': ministries})
for index, (identifier, reference) in enumerate(((True, 1), (1, True), (False, 0), (0, False), (True, 1.0), ('1', True))):
    doc, core = read('catalog.json'), read('core.json')
    row = next(d for d in doc['datasets'] if d['status'] == 'pending')
    row['screens'] = [reference]; core['pending'][row['id']]['screens'] = [reference]
    routes = json.loads((LEGACY / 'corpus/apps/web/app/lib/routes.json').read_text())
    record = copy.deepcopy(routes['routes'][0][:7]); record[0], record[2] = identifier, '/membership'
    routes['routes'].append(record)
    add('route-' + str(index), {'core.json': core, 'catalog.json': doc}, [
        {'op': 'write', 'file': 'apps/web/app/lib/routes.json', 'value': json.dumps(routes, ensure_ascii=False)}])
doc, core = read('catalog.json'), read('core.json')
dataset = next(d for d in doc['datasets'] if d.get('fileTemplate'))
dataset['parts'] = dataset['parts'][:1]
dataset['bytes'] = sum(p['bytes'] for p in dataset['parts'])
dataset['gzipBytes'] = sum(p['gzipBytes'] for p in dataset['parts'])
core['counts']['programBudgets'] = True
add('part-count-equality', {'core.json': core, 'catalog.json': doc})
doc, core = read('catalog.json'), read('core.json')
next(d for d in doc['datasets'] if d.get('fileTemplate'))['parts'][0]['code'] = []
del core['counts']['programBudgets']
add('part-first-error', {'core.json': core, 'catalog.json': doc})

observed = {}
with tempfile.TemporaryDirectory(prefix='sigma-membership-donor-') as temp:
    for case in cases:
        root = Path(temp) / case['name']
        shutil.copytree(LEGACY / 'corpus', root)
        shutil.copytree(LEGACY / 'overlay', root, dirs_exist_ok=True)
        for op in case['ops']: ns['mutate'](root, op)
        observed[case['name']] = {group: ns['capture'](root, group) for group in case['groups']}
        shutil.rmtree(root)
outputs = {'cases.json': (json.dumps(cases, ensure_ascii=True, separators=(',', ':')) + '\n').encode(), 'oracle.json': (json.dumps(observed, ensure_ascii=True, separators=(',', ':')) + '\n').encode()}
proof = {'python': '3.12', 'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'inputs': {name: hashlib.sha256((LEGACY / name).read_bytes()).hexdigest() for name in ('generate_oracle.py', 'provenance.json', 'short-circuit/provenance.json')}, 'outputs': {name: hashlib.sha256(raw).hexdigest() for name, raw in outputs.items()}, 'cases': len(cases)}
outputs['provenance.json'] = (json.dumps(proof, indent=2) + '\n').encode()
for name, raw in outputs.items():
    target = HERE / name
    if '--check' in sys.argv:
        if not target.exists() or target.read_bytes() != raw: raise SystemExit('Membership proof differs: ' + name)
    else: target.write_bytes(raw)
