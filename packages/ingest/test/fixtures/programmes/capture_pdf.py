"""Capture the independent Python PDF reader's parsed evidence from pinned originals.

Run only after restoring the originals and checking the inputs archive hash. The
ordinary oracle regeneration uses the captured evidence and needs no PDFs.
"""
import hashlib
import json
from pathlib import Path
from budget_pipeline.build import program_budget_pdf as pdf

HERE = Path(__file__).parent
ROOT = HERE.parents[4]
inputs = HERE / 'inputs'
src = json.loads((inputs / 'program-budgets.json').read_text())
files = [b['file'] for b in src['budgets'].values()] + list(src['not_parsed'])
pinned = {}
for line in (ROOT / 'data/originals.sha256').read_text().splitlines():
    digest, path = line.split('  ', 1)
    pinned[path] = digest
result = {}
hashes = {}
for fn in sorted(files):
    path = ROOT / 'data/originals/program_budgets' / fn
    key = str(path.relative_to(ROOT))
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if pinned.get(key) != digest:
        raise ValueError(f'Original hash mismatch: {key}')
    hashes[key] = digest
    rows, _ = pdf.read_rows(fn)
    cells, conflicts = pdf.cells_of(rows)
    pdf.resolve_by_structure(cells)
    result[fn] = {'cells': [[list(k), v] for k, v in cells.items()],
                  'conflicts': [list(k) for k in conflicts],
                  'programNames': pdf.program_names(fn), 'rowLabels': pdf.row_labels(fn)}
    print(fn, flush=True)
(inputs / 'pdf-evidence.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
(inputs / 'original-hashes.json').write_text(json.dumps(hashes, ensure_ascii=False, separators=(',', ':')) + '\n')
