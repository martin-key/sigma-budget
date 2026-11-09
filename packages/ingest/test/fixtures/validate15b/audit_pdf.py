"""Page-level text presence audit, not a fresh column or table extraction."""
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path
import fitz

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent
if sys.argv[1:] not in ([], ['--check']):
    raise SystemExit('usage: audit_pdf.py [--check]')
for path, expected in json.loads((HERE / 'inventory.json').read_text())['sha256'].items():
    if hashlib.sha256((FIXTURES / path).read_bytes()).hexdigest() != expected:
        raise ValueError('Frozen input changed: ' + path)
cells = json.loads((HERE / 'donor/budget_pipeline/validate/fixtures/budget_2027_cells.json').read_text())['cells']
inputs = {kind: json.loads((FIXTURES / f'fiscal/inputs/data/inputs/budget_{kind}_2027.json').read_text()) for kind in ('forecast', 'bill')}
archive = FIXTURES / 'fiscal/inputs/data/originals/budget_2027/ZDBRB-2027.zip'
def normalize(text):
    return re.sub(r'\s+', '', text).replace('−', '-')
with zipfile.ZipFile(archive) as z:
    docs = {kind: fitz.open(stream=z.read(source['source']['member']), filetype='pdf') for kind, source in inputs.items()}
    records = []
    for cell in cells:
        for source in cell['sources']:
            text = normalize(docs[cell['document']][source['page'] - 1].get_text())
            label = normalize(source['label']) in text
            printed = normalize(source['printed']) in text
            if not label or not printed: raise ValueError(f"Page text missing: {cell['output']}")
            records.append({'output': cell['output'], 'document': cell['document'], 'page': source['page'], 'labelPresent': label, 'printedPresent': printed})
    for doc in docs.values(): doc.close()
data = (json.dumps(records, ensure_ascii=False, indent=2) + '\n').encode()
path = HERE / 'pdf-audit.json'
if '--check' in sys.argv:
    if path.read_bytes() != data: raise ValueError('PDF audit differs')
else: path.write_bytes(data)
