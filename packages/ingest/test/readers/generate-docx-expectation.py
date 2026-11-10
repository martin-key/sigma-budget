"""TEST-only stdlib donor capture. Never imported or invoked by production TS."""
import argparse
import hashlib
import importlib.util
import json
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

sys.dont_write_bytecode = True

ap = argparse.ArgumentParser()
ap.add_argument('--docx', required=True, type=Path)
ap.add_argument('--sha256', required=True)
ap.add_argument('--donor', required=True, type=Path)
ap.add_argument('--donor-sha256', required=True)
ap.add_argument('--out', required=True, type=Path)
a = ap.parse_args()
sha = lambda b: hashlib.sha256(b).hexdigest()
assert sha(a.docx.read_bytes()) == a.sha256, 'DOCX pin mismatch'
assert sha(a.donor.read_bytes()) == a.donor_sha256, 'Donor pin mismatch'
spec = importlib.util.spec_from_file_location('pinned_legal_donor', a.donor)
donor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(donor)
blocks = donor.docx_blocks(a.docx)
w = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
member = zipfile.ZipFile(a.docx).read('word/document.xml')
root = ET.fromstring(member)
tables = []

def walk(node, parent=None):
    current = parent
    if node.tag == w + 'tbl':
        current = len(tables)
        rows = []
        for tr in node.findall(w + 'tr'):
            cells = []
            for tc in tr.findall(w + 'tc'):
                span = tc.find(w + 'tcPr/' + w + 'gridSpan')
                merge = tc.find(w + 'tcPr/' + w + 'vMerge')
                cells.append({
                    'text': ' '.join(filter(None, (donor._ptext(p) for p in tc.iter(w + 'p')))),
                    'gridSpan': int(span.get(w + 'val')) if span is not None else 1,
                    'verticalMerge': merge.get(w + 'val', 'continue') if merge is not None else None,
                })
            rows.append(cells)
        tables.append({'index': current, 'parentTable': parent, 'rows': rows})
    for child in node:
        walk(child, current)

walk(root)
canonical = lambda obj: json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode()
result = {
    'input': {'path': 'data/originals/parliament/52-602-01-19.docx', 'sha256': a.sha256},
    'donor': {'path': 'pipeline/budget_pipeline/extract/budget_law_parser.py', 'sha256': a.donor_sha256},
    'blocks': {'count': len(blocks), 'sha256': sha(canonical(blocks))},
    'physicalTables': {'count': len(tables), 'rows': sum(len(t['rows']) for t in tables), 'sha256': sha(canonical(tables))},
    'memberSha256': sha(member),
    'limits': ['Test expectation only; not a production raw input or runtime capture.', 'The donor is the pinned stdlib Python legal reader, not a TS-derived oracle.'],
}
with a.out.open('x', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)
    f.write('\n')
