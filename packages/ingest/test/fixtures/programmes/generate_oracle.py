"""Regenerate or check the Python oracle from adjacent frozen inputs.

PYTHONPATH=pipeline tmp/venv-data/bin/python packages/ingest/test/fixtures/programmes/generate_oracle.py --check
PDF evidence was captured separately by capture_pdf.py from the pinned originals.
"""
import copy
import hashlib
import json
import os
import sys
from pathlib import Path

os.environ['BUILD_DATE'] = '2026-11-08'
from budget_pipeline.build import budgets, program_budgets as programmes

HERE = Path(__file__).parent
INPUTS = HERE / 'inputs'
CHECK = '--check' in sys.argv[1:]
if any(x != '--check' for x in sys.argv[1:]):
    raise SystemExit('usage: generate_oracle.py [--check]')

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def encode(value):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode()

def emit(name, value):
    data = encode(value)
    path = HERE / name
    if CHECK:
        if path.read_bytes() != data:
            raise ValueError(f'Fixture differs: {name}')
    else:
        path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()

source = read(INPUTS / 'program-budgets.json')
law = read(INPUTS / 'law-cache.json')
pdfs = read(INPUTS / 'pdf-evidence.json')
pdf = programmes.pdf
pdf.read_rows = lambda filename: (filename, [])
pdf.cells_of = lambda filename: ({tuple(k): v for k, v in pdfs[filename]['cells']}, [tuple(k) for k in pdfs[filename]['conflicts']])
pdf.resolve_by_structure = lambda cells: None
pdf.program_names = lambda filename: pdfs[filename]['programNames']
pdf.row_labels = lambda filename: pdfs[filename]['rowLabels']
class Context:
    def __init__(self):
        self.law = law
        self.notes = []
        self.outputs = {}
    def src(self, name):
        assert name == 'program_budgets_2026'
        return source
    def put(self, name, value):
        self.outputs[name] = value
ctx = Context()
budgets.build_budgets(ctx)
outputs = {'oracle.json': emit('oracle.json', ctx.outputs)}
# A null source cell is ignored when resolving ambiguous PDF cells.
source = copy.deepcopy(source)
source['budgets']['1800']['programs']['1800.02.03']['by_year']['Отчет 2023'] = None
ctx = Context()
budgets.build_budgets(ctx)
outputs['null-cell-oracle.json'] = emit('null-cell-oracle.json', ctx.outputs)
name_inputs = [
    'Дълго име на политика Бюджетна програма: Допълнителен текст',
    'Дълго име на политика ОБЛАСТИ НА: Допълнителен текст',
    'Дълго име на политика Бюджетна програма-допълнение',
    'Дълго име на политика Бюджетна програмаЖ допълнение',
    'Дълго име на политика Бюджетна програма_допълнение',
    'Дълго име на политика Бюджетна програма2 допълнение',
    'Дълго име на политика Бюджетна програма',
    'Дълго име на политика ОБЛАСТИ НАЖ допълнение',
    'Дълго име на политика 1800.02.03: Допълнителен текст',
    'Дълго име на политика 1800.02.03Ж Допълнителен текст',
    'Дълго име на политика 0, 0: Допълнителен текст',
]
outputs['name-oracle.json'] = emit('name-oracle.json', [
    {'input': name, 'expected': programmes.clean_name(name)} for name in name_inputs
])
inputs = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(INPUTS.iterdir()) if p.is_file()}
emit('provenance.json', {'baseline': 'e2954c9', 'buildDate': '2026-11-08',
    'sourceArchiveSha256': '5f8e6a98b05919dc776fb68f40615a544b585e1a1690e29cf2f6f3b0e0648701',
    'frozenInputSha256': inputs, 'fixtureSha256': outputs,
    'oracle': 'Python 3.12 build.budgets and program_budgets from frozen PDF reader evidence'})
print('programme fixtures: byte-identical' if CHECK else 'programme fixtures: regenerated')
