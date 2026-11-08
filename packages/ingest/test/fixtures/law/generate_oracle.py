"""Generate or verify the frozen law oracle from the adjacent input snapshots.

PYTHONPATH=pipeline tmp/venv-data/bin/python packages/ingest/test/fixtures/law/generate_oracle.py --check
Remove --check to regenerate. The DV blocks were captured with Python's
budget_law_parser.dv_blocks from the pinned HTML; law-cache.json is the parsed
bill/law cache. Parliament records include only fields used by the builder.
"""
import ast
import hashlib
import json
import os
import sys
from pathlib import Path

os.environ['BUILD_DATE'] = '2026-11-08'
from budget_pipeline.build import law

ROOT = Path(__file__).resolve().parents[5]
HERE = Path(__file__).parent
INPUTS = HERE / 'inputs'
CHECK = '--check' in sys.argv[1:]
if any(arg != '--check' for arg in sys.argv[1:]):
    raise SystemExit('usage: generate_oracle.py [--check]')

def read(name):
    return json.loads((INPUTS / name).read_text(encoding='utf-8'))

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')

def emit(name, value):
    data = encoded(value)
    if CHECK:
        if (HERE / name).read_bytes() != data:
            raise ValueError(f'Fixture differs: {name}')
    else:
        (HERE / name).write_bytes(data)
    return hashlib.sha256(data).hexdigest()

cache = read('law-cache.json')
ministries = read('ministries.json')
raw = read('parliament.json')
blocks = read('dv-blocks.json')
source_hashes = read('original-hashes.json')
law.SOURCES = read('sources.json')
law.RAW = INPUTS / 'absent-originals'
by_filename = {filename: blocks[key] for key, (_, filename, _, _) in law.LAWS.items()}
law.budget_law_parser.dv_blocks = lambda path: by_filename[Path(path).name]
by_id = {bill_id: raw[key] for key, (bill_id, _, _, _) in law.LAWS.items()}
class Context:
    law = cache
    def raw(self, path): return by_id[int(Path(path).stem.removeprefix('bill_'))]
    def get(self, path): return ministries if path == 'ministries.json' else None
    def put(self, path, value): return value

literal_cases = []
for d in raw.values():
    for p in d['proposal_12_list']:
        if isinstance(p['act_files'], str):
            literal_cases.append({'text': p['act_files'], 'expected': ast.literal_eval(p['act_files'])})
            p['act_files'] = ast.literal_eval(p['act_files'])
# No strings occur in this pinned release; keep explicit representative literals.
for text in ["[{'FILENAME': 'proposal.pdf'}]", '[]', "[{'FILENAME': 'a.pdf'}, {'FILENAME': 'b.pdf'}]"]:
    literal_cases.append({'text': text, 'expected': ast.literal_eval(text)})

outputs = {}
def write(name, value): outputs[name] = emit(name, value)
write('evidence.json', {'law': cache, 'parliament': raw, 'dvBlocks': blocks, 'ministries': ministries, 'archiveBytes': None})
write('literal-data.json', literal_cases)
expected = law.build_law(Context())
write('parliament-oracle.json', {key: law._parl(bill_id) for key, (bill_id, _, _, _) in law.LAWS.items()})
write('gazette-oracle.json', {key: law._dv_facts(filename) for key, (_, filename, _, _) in law.LAWS.items()})
rows = law._budget_rows(Context(), cache)
write('articles-oracle.json', {'art1': law._art1(cache), 'rows': rows, 'totals': law._totals(rows, cache)})
write('oracle.json', expected)
write('next2027.json', expected['next'])
inputs = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(INPUTS.iterdir()) if p.is_file()}
emit('provenance.json', {'baseline': '1843be0', 'buildDate': '2026-11-08', 'sourceArchiveSha256': source_hashes['archiveSha256'], 'billArchiveBytes': None, 'originalInputSha256': source_hashes['inputs'], 'frozenInputSha256': inputs, 'fixtureSha256': outputs, 'oracle': 'Python 3.12 build.law.build_law and ast.literal_eval on frozen parsed evidence'})
print('law fixtures: byte-identical' if CHECK else 'law fixtures: regenerated')
