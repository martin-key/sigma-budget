"""Independent regex, dictionary overwrite and values-operation donor outcomes."""
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
ns = {'__file__': str(original), '__name__': 'frozen_catalog_semantics_donor'}
exec(compile(original.read_text().split('\nobserved = {}')[0], str(original), 'exec'), ns)

def read(name):
    return json.loads((LEGACY / 'corpus/data/release' / name).read_text())

def encoded(doc):
    return json.dumps(doc, ensure_ascii=False).encode('utf8')

cases = []
def add(name, docs, reconcile=()):
    if reconcile:
        catalog = docs.setdefault('catalog.json', read('catalog.json'))
        for name_to_fix in reconcile:
            raw = encoded(docs[name_to_fix])
            dataset = next(d for d in catalog['datasets'] if d.get('file') == 'data/' + name_to_fix)
            dataset['bytes'] = len(raw)
            dataset['gzipBytes'] = ns['checks'].gz_size(raw)
    cases.append({'name': 'semantics-' + name, 'groups': ['CATALOG'], 'compiled': True,
                  'ops': [{'op': 'write', 'file': 'data/release/' + name, 'value': encoded(doc).decode('utf8')} for name, doc in docs.items()]})

add('baseline', {})
for index, suffix in enumerate(('', '\n', '\n\n', '\r', '\r\n', '\u2028', '\u2029', ' ', '\u0085', '\ufeff')):
    doc = read('catalog.json')
    doc['files'][0]['sha256'] += suffix
    add('sha-suffix-' + str(index), {'catalog.json': doc})
for index, value in enumerate((None, 0, 0.0, 1.0, True, [], {})):
    doc = read('catalog.json')
    doc['files'][0]['sha256'] = value
    add('sha-type-' + str(index), {'catalog.json': doc})
for index, value in enumerate(('0000-01-01', '0000-01-٠١', '0000-01-０１', '0000-01-\U0001d7ce\U0001d7cf', '0000-01-\U00010d40\U00010d41', '0000-01-01\n', '0000-01-01\n\n', '0000-01-01\r', '0000-01-01\r\n', '0000-01-01\u2028', '0000-01-01 ', '0000-01-01\u0085', '0000-01-01\ufeff', None, 0.0)):
    doc = read('catalog.json')
    doc['meta']['asOf'] = value
    next(d for d in doc['datasets'] if d['id'] == 'D25')['asOf'] = value
    add('date-' + str(index), {'catalog.json': doc})
for index, value in enumerate(('D18', 'D١٨', 'D１８', 'D\U0001d7cf\U0001d7d6', 'D\U00010d41\U00010d48', 'D18\n', 'D١٨\n', 'D18\n\n', 'D18\r', 'D18\r\n', 'D18\u2028', 'D18 ', 'D18\u0085', 'D18\ufeff', 'X18', 'D1', 'D188')):
    core, catalog = read('core.json'), read('catalog.json')
    core['meta']['id'] = value
    next(d for d in catalog['datasets'] if d['slug'] == 'core')['contains'] = [value]
    add('id-' + str(index), {'core.json': core, 'catalog.json': catalog}, ('core.json',))
for position in ('first', 'last'):
    for coherent in (False, True):
        execution = read('execution.json')
        rows = execution['data']['2025']['files']
        duplicate = {**rows[0], 'sha256': '0' * 64}
        rows.insert(0, duplicate) if position == 'first' else rows.append(duplicate)
        add('duplicate-' + position + '-' + str(coherent), {'execution.json': execution}, ('execution.json',) if coherent else ())
for index, (a, b) in enumerate(((True, 1), (1, True), (False, 0), (0, False))):
    for position in ('first', 'last'):
        execution, catalog = read('execution.json'), read('catalog.json')
        rows = execution['data']['2025']['files']
        original_name = rows[0]['file']
        next(f for f in catalog['files'] if f['name'] == original_name)['name'] = b
        rows[0]['file'] = b
        duplicate = {**rows[0], 'file': a, 'sha256': '0' * 64}
        rows.insert(0, duplicate) if position == 'first' else rows.append(duplicate)
        add('numeric-key-' + str(index) + '-' + position, {'execution.json': execution, 'catalog.json': catalog}, ('execution.json',))
for index, key in enumerate(([], {})):
    for missing in (False, True):
        execution = read('execution.json')
        row = execution['data']['2025']['files'][0]
        row['file'] = key
        if missing: del row['sha256']
        add('unhashable-' + str(index) + '-' + str(missing), {'execution.json': execution})
for index, value in enumerate(([], {}, None, 0.0, 1.0, 0, False, '')):
    execution = read('execution.json')
    execution['contract'] = {}
    execution['data'] = value
    add('data-values-' + str(index), {'execution.json': execution})
for index, value in enumerate((0.0, 1.0, None, [], {})):
    execution = read('execution.json')
    execution['contract'] = {}
    execution['data'] = {'2025': value}
    add('year-value-' + str(index), {'execution.json': execution})
for index, value in enumerate((0.0, 1.0, None, [], {})):
    execution = read('execution.json')
    execution['contract'] = {}
    execution['data']['2025']['files'] = value
    add('files-value-' + str(index), {'execution.json': execution})
for order in (('2024', '2025'), ('2025', '2024')):
    for last_wrong in (False, True):
        execution = read('execution.json')
        keys = [*order, *(key for key in execution['data'] if key not in order)]
        execution['data'] = {key: execution['data'][key] for key in keys}
        row = copy.deepcopy(execution['data'][order[0]]['files'][0])
        if last_wrong: row['sha256'] = '0' * 64
        else: execution['data'][order[0]]['files'][0]['sha256'] = '0' * 64
        execution['data'][order[1]]['files'].append(row)
        add('year-order-' + order[0] + '-' + str(last_wrong), {'execution.json': execution}, ('execution.json',))
for project in (False, True):
    execution = read('execution.json')
    if not project: execution['contract'] = {}
    execution['data'] = {'2025': 0.0, '2024': None}
    add('year-first-error-' + str(project), {'execution.json': execution})

observed = {}
with tempfile.TemporaryDirectory(prefix='sigma-catalog-semantics-donor-') as temp:
    for case in cases:
        root = Path(temp) / case['name']
        shutil.copytree(LEGACY / 'corpus', root)
        shutil.copytree(LEGACY / 'overlay', root, dirs_exist_ok=True)
        for op in case['ops']: ns['mutate'](root, op)
        observed[case['name']] = {group: ns['capture'](root, group) for group in case['groups']}
        shutil.rmtree(root)
outputs = {'cases.json': (json.dumps(cases, ensure_ascii=True, separators=(',', ':')) + '\n').encode(), 'oracle.json': (json.dumps(observed, ensure_ascii=True, separators=(',', ':')) + '\n').encode()}
proof = {'python': '3.12', 'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'inputs': {name: hashlib.sha256((LEGACY / name).read_bytes()).hexdigest() for name in ('generate_oracle.py', 'provenance.json', 'iterators/provenance.json', 'integer/data.json')}, 'outputs': {name: hashlib.sha256(raw).hexdigest() for name, raw in outputs.items()}, 'cases': len(cases)}
outputs['provenance.json'] = (json.dumps(proof, indent=2) + '\n').encode()
for name, raw in outputs.items():
    target = HERE / name
    if '--check' in sys.argv:
        if not target.exists() or target.read_bytes() != raw: raise SystemExit('Catalog semantics proof differs: ' + name)
    else: target.write_bytes(raw)
