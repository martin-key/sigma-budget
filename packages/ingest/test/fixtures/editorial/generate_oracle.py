"""Regenerate or check editorial fixtures from the adjacent frozen inputs.

PYTHONPATH=pipeline tmp/venv-data/bin/python packages/ingest/test/fixtures/editorial/generate_oracle.py --check
The guide's original raw text is unavailable. The published snapshots are the
actual inputs to build.frozen_editorial, not reconstructed original text.
"""
import copy
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ['BUILD_DATE'] = '2026-11-08'
from budget_pipeline.build import editorial, frozen_editorial, guide

HERE = Path(__file__).parent
INPUTS = HERE / 'inputs'
CHECK = '--check' in sys.argv[1:]
if any(x != '--check' for x in sys.argv[1:]):
    raise SystemExit('usage: generate_oracle.py [--check]')

def digest(data): return hashlib.sha256(data).hexdigest()
def emit(name, data):
    path = HERE / name
    if CHECK:
        if path.read_bytes() != data: raise ValueError(f'Fixture differs: {name}')
    else: path.write_bytes(data)
    return digest(data)
def encoded(obj): return (json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '\n').encode()

inputs = {p.name: digest(p.read_bytes()) for p in sorted(INPUTS.iterdir())}
registered = {'guide.json': '9a808bca21b3817350f1032d469e9dc242f397012be93a4b09d976557be05b09', 'glossary.json': '0d88665ab18f66da040adfe6ee525d5a7aacfcc72223df5ccfc7b4276c888a77'}
for name, expected in registered.items():
    if inputs[name] != expected: raise ValueError(f'Registered editorial hash differs: {name}')

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    (root / 'data/inputs/editorial').mkdir(parents=True)
    (root / 'data/release').mkdir(parents=True)
    for name in ('guide.json', 'glossary.json'):
        (root / 'data/inputs/editorial' / name).write_bytes((INPUTS / name).read_bytes())
    frozen_editorial.ROOT = root
    frozen_editorial.main()
    outputs = {name: emit('oracle/' + name, (root / 'data/release' / name).read_bytes()) for name in ('guide.json', 'glossary.json')}

editorial.GLOSSARY_SRC = str(INPUTS / 'glossary-source.json')
routes = editorial.parse_routes(INPUTS / 'routes.json')
legacy = editorial.build_glossary(routes)
editorial.verify_glossary(legacy)
if editorial.problems: raise ValueError(editorial.problems)
outputs['legacy-glossary.json'] = emit('legacy-glossary.json', encoded(legacy))

# A synthetic source exercises the raw parser; it is not the missing original.
editorial.GUIDE_SRC = str(INPUTS / 'synthetic-guide.txt')
parsed_guide = editorial.build_guide(routes)
editorial.verify_guide(parsed_guide)
if editorial.problems: raise ValueError(editorial.problems)
outputs['synthetic-guide-oracle.json'] = emit('synthetic-guide-oracle.json', encoded(parsed_guide))

# Read the CRLF fixture through the original Python text-mode parser and verifier.
editorial.GUIDE_SRC = str(INPUTS / 'synthetic-guide-crlf.txt')
crlf_guide = editorial.build_guide(routes)
editorial.verify_guide(crlf_guide)
if editorial.problems: raise ValueError(editorial.problems)
outputs['synthetic-guide-crlf-oracle.json'] = emit('synthetic-guide-crlf-oracle.json', encoded(crlf_guide))


# The same route catalogue is injected for guide.check; apply does not read inputs.
guide.load_routes = lambda: routes
published = json.loads((INPUTS / 'guide.json').read_text())
outputs['guide-check.json'] = emit('guide-check.json', encoded(guide.check(published)))
outputs['guide-apply.json'] = emit('guide-apply.json', encoded(guide.apply(copy.deepcopy(published))))
provenance = {'baseline': 'e2954c957bd0659843609f870bcbc92d48d00c7c', 'buildDate': '2026-11-08', 'frozenInputSha256': inputs, 'fixtureSha256': outputs, 'oracle': 'Python 3.12 build.frozen_editorial, build.editorial.build_glossary and build.guide apply/check', 'registeredProvenance': {'guide.json': {'commit': '838c64c', 'path': 'data/release/guide.json', 'blob': '8fa4fcbe4475ead3130e1177efc22bcd04206813'}, 'glossary.json': {'commit': '838c64c', 'path': 'data/release/glossary.json', 'blob': 'd41851da551dd9eb70dad52e7e82371c274954e7'}}, 'guideRaw': 'Unavailable; the registered published snapshot is the frozen input. Original text cannot be regenerated.'}
emit('provenance.json', encoded(provenance))
print('editorial fixtures: byte-identical' if CHECK else 'editorial fixtures: regenerated')
