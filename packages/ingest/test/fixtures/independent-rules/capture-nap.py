"""Explicit Python 3.12 NAP capture for boundary tests; never a TS decoder.

The supplied PDF must match the existing original pin. This copies an available
original; it does not acquire a new source or overwrite older fixture families.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

import fitz

assert sys.version_info[:2] == (3, 12)
parser = argparse.ArgumentParser()
parser.add_argument('pdf', type=Path)
args = parser.parse_args()
HERE = Path(__file__).resolve().parent
manifest = json.loads((HERE/'manifest.json').read_text())
raw = args.pdf.read_bytes()
assert hashlib.sha256(raw).hexdigest() == manifest['sourceCapture']['originalSha256']
rows = {}
with fitz.open(str(args.pdf)) as document:
    for page_number, page in enumerate(document, start=1):
        for table in page.find_tables().tables:
            for cells in table.extract():
                cells = [' '.join((cell or '').split()) for cell in cells]
                match = re.match(r'(\d+(?:\.\d+)*\.)\s*(.*)', cells[0])
                if match and len(cells) == 15 and match[1] not in rows:
                    rows[match[1]] = dict(page=page_number, label=match[2], cells=cells)
output = json.dumps(rows, ensure_ascii=False, indent=2)+'\n'
assert hashlib.sha256(output.encode()).hexdigest() == manifest['frozen']['source-captures/nap-rows.json']
print(json.dumps(dict(originalSha256=hashlib.sha256(raw).hexdigest(), rows=len(rows), frozenCaptureMatches=True)))
