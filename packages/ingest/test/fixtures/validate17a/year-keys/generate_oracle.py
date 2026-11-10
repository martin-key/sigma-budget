"""Independent vintage-key and short-circuit outcomes from the frozen donor."""
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
original = LEGACY / 'generate_oracle.py'
ns = {'__file__': str(original), '__name__': 'frozen_year_key_donor'}
exec(compile(original.read_text().split('\nobserved = {}')[0], str(original), 'exec'), ns)
wrapper = LEGACY / 'wrapper/generate.py'
wn = {'__file__': str(wrapper), '__name__': 'frozen_year_key_wrapper'}
exec(compile(wrapper.read_text().split('\nraw = ')[0], str(wrapper), 'exec'), wn)

def read(name): return json.loads((LEGACY / 'corpus/data/release' / name).read_text())
cases = []
def add(name, tokens=None, copy_year=False, key_indices=(), drop_old=(), mismatch=False,
        wrong_value=False, complete=False):
    tokens = {} if tokens is None else tokens
    outlook, core, catalog = read('outlook.json'), read('core.json'), read('catalog.json')
    old_years = list(outlook['years'])
    for index, token in tokens.items():
        outlook['years'][index] = '__YEAR_RAW_%d__' % index
        if copy_year: core['years']['list'][index] = '__YEAR_RAW_%d__' % index
    for index in key_indices:
        key = str(json.loads(tokens[index]))
        core['years']['vintage'][key] = 'wrong' if wrong_value else core['years']['vintage'][str(old_years[index])]
    for index in drop_old:
        core['years']['vintage'][str(old_years[index]) + '.0'] = core['years']['vintage'].pop(str(old_years[index]))
    if mismatch: core['years']['list'][0] = 1900
    def encode(doc):
        text = json.dumps(doc, ensure_ascii=False)
        for index, token in tokens.items(): text = text.replace('"__YEAR_RAW_%d__"' % index, token)
        return text.encode('utf8')
    docs = {'outlook.json': outlook, 'core.json': core}
    raw = {name: encode(doc) for name, doc in docs.items()}
    for filename, data in raw.items():
        row = next(d for d in catalog['datasets'] if d.get('file') == 'data/' + filename)
        row['bytes'], row['gzipBytes'] = len(data), ns['checks'].gz_size(data)
        row['schema'] = ns['catalog']._schema(json.loads(data))
    raw['catalog.json'] = encode(catalog)
    cases.append({'name': 'year-key-' + name, 'groups': ['CORE', 'CATALOG'], 'compiled': True,
                  'complete': complete, 'ops': [{'op': 'write', 'file': 'data/release/' + filename,
                  'value': data.decode('utf8')} for filename, data in raw.items()]})

years = read('outlook.json')['years']
add('baseline', complete=True)
for index, year in enumerate(years):
    add('float-' + str(index), {index: str(year) + '.0'}, complete=index == 0)
    add('exponent-' + str(index), {index: str(year) + 'e0'})
add('trailing-zeroes', {0: str(years[0]) + '.000'})
add('scientific-source', {0: '2.024e3'})
add('fractional-control', {0: '2024.5'})
add('mapped-first', {0: '2024.0'}, key_indices=(0,), drop_old=(0,), complete=True)
add('mapped-last', {4: '2028.0'}, key_indices=(4,), drop_old=(4,))
add('owner-float', {0: '2024.0'}, copy_year=True, key_indices=(0,))
add('wrong-key-only', {0: '2024'}, drop_old=(0,))
add('short-circuit', {0: '2024.0'}, mismatch=True)
add('later-missing-key', {0: '2024.0', 4: '2028.0'}, key_indices=(0,))
for index, token in enumerate(('true', 'false', 'null', '"2024"', '[2024.0]',
                               '{"2": 0.0, "1": false}', '[]', '{}')):
    add('matching-type-' + str(index), {0: token}, copy_year=True, key_indices=(0,))
add('negative-zero', {0: '-0.0'}, copy_year=True, key_indices=(0,))
add('scientific-key', {0: '1e20'}, copy_year=True, key_indices=(0,))
add('wrong-vintage', {0: '2024.0'}, key_indices=(0,), wrong_value=True)
assert len(cases) == 31

observed, wrapped = {}, {}
with tempfile.TemporaryDirectory(prefix='sigma-year-key-donor-') as temp:
    for case in cases:
        root = Path(temp) / case['name']
        shutil.copytree(LEGACY / 'corpus', root)
        shutil.copytree(LEGACY / 'overlay', root, dirs_exist_ok=True)
        for op in case['ops']: ns['mutate'](root, op)
        groups = {group: ns['capture'](root, group) for group in case['groups']}
        observed[case['name']] = groups
        if case['complete']:
            wrapped[case['name']] = {}
            for accepted in (True, False):
                module, checks = wn['module'], wn['checks']
                module._used.clear(); module._hit.clear()
                results, raw_results = [], []
                for name, result in groups.items():
                    def build(_ctx):
                        c = checks.Check(name)
                        if 'crash' in result: c.fail('group crashed: ' + result['crash'])
                        else:
                            c.n = result['n']; c.problems = list(result['problems'])
                            c.warnings = list(result['warnings']); c.facts = list(result['facts'])
                        return c
                    c = module.wrap(name, build, accepted)(None)
                    results.append({'name': c.name, 'n': c.n, 'problems': c.problems,
                                    'warnings': c.warnings, 'facts': c.facts})
                    raw_results.append(result if 'crash' not in result else
                        {'name': name, 'n': 1, 'problems': ['group crashed: ' + result['crash']],
                         'warnings': [], 'facts': []})
                totals = {'checks': sum(c['n'] for c in results),
                          'problems': sum(len(c['problems']) for c in results),
                          'warnings': sum(len(c['warnings']) for c in results)}
                wrapped[case['name']]['default' if accepted else 'noAccepted'] = {
                    'raw': raw_results, 'groups': results,
                    'exceptions': [{'group': g, 'problem': p, 'reason': reason} for g, p, reason in module._used],
                    'totals': totals, 'status': 'FAIL' if totals['problems'] else 'PASS',
                    'exit': int(totals['problems'] > 0)}
        shutil.rmtree(root)
outputs = {name: (json.dumps(value, ensure_ascii=True, separators=(',', ':')) + '\n').encode()
           for name, value in {'cases.json': cases, 'oracle.json': observed, 'wrapper-oracle.json': wrapped}.items()}
inputs = ('generate_oracle.py', 'provenance.json', 'extra-provenance.json',
          'membership/provenance.json', 'wrapper/generate.py', 'wrapper/datasets.py')
proof = {'python': '3.12', 'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
         'inputs': {name: hashlib.sha256((LEGACY / name).read_bytes()).hexdigest() for name in inputs},
         'outputs': {name: hashlib.sha256(data).hexdigest() for name, data in outputs.items()}, 'cases': len(cases)}
outputs['provenance.json'] = (json.dumps(proof, indent=2) + '\n').encode()
for name, data in outputs.items():
    target = HERE / name
    if '--check' in sys.argv:
        if not target.exists() or target.read_bytes() != data: raise SystemExit('Year-key proof differs: ' + name)
    else: target.write_bytes(data)
