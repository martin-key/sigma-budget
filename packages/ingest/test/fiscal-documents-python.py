#!/usr/bin/env python3
"""Fresh locked Python actual-source expectations. Input repo/export is read-only.

Run using Python 3.12 data venv, PYTHONDONTWRITEBYTECODE=1, --repo owned git
export --sources owned copied-original root --out a new owned directory.
No fetch, subprocess, registry updates or writes under the donor/source roots.
"""
import argparse
import contextlib
import hashlib
import importlib.metadata
import io
import json
from pathlib import Path
import sys

p = argparse.ArgumentParser()
p.add_argument('--repo', type=Path, required=True)
p.add_argument('--sources', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
assert sys.version_info[:2] == (3, 12)
assert sys.dont_write_bytecode
for name, version in {'PyMuPDF':'1.26.5','pdfplumber':'0.11.10','python-docx':'1.2.0','lxml':'6.1.3'}.items():
    assert importlib.metadata.version(name) == version
root = a.sources.resolve()
out = a.out.resolve()
assert not out.exists() and not out.is_relative_to(root) and not out.is_relative_to(a.repo.resolve())
out.mkdir(parents=True)
sys.path.insert(0, str(a.repo.resolve()/'pipeline'))
from budget_pipeline.extract import asbp_tables as at, asbp_pages as ap
from budget_pipeline.build import rates, data_io
from budget_pipeline.extract import indirect_tax_evidence as independent
from budget_pipeline.build import indirect_taxes as producer
import pymupdf
raw = root/'data/originals'
at.PDF = str(raw/'asbp/UMTBF-2026-2028-motivi.pdf')
at.DOCX = str(raw/'parliament/52-602-01-19.docx')
at.OUT = str(out/'asbp.json')
with contextlib.redirect_stdout(io.StringIO()) as log:
    at.main()
(out/'asbp.log').write_text(log.getvalue())
pages=[]
with pymupdf.open(at.PDF) as pdf:
    for n, page in enumerate(pdf,1):
        lines=ap.page_lines(page)
        k=next((k for k,line in enumerate(lines) if line.strip()==str(n)),None)
        if k is not None:del lines[k]
        pages.append(dict(page=n,body=''.join(lines)))
rates.NAP_PDF=raw/'nap/nap_prilozhenie_1_VK-30-10237_12.08.2026.pdf'
producer.RAW=raw
producer.BUILD_DATE='2026-11-10'
data_io.BUILD_DATE='2026-11-10'
values={'pages':pages, 'nap':rates._nap_rows(), 'indirect-independent':independent.extract(root), 'indirect-builder':producer.extract()}
for name,value in values.items():
    (out/(name+'.json')).write_text(json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+'\n')
files=['extract/asbp_tables.py','extract/asbp_pages.py','extract/indirect_tax_evidence.py','build/rates.py','build/indirect_taxes.py','build/data_io.py']
manifest=dict(python=sys.version.split()[0],packages={name:importlib.metadata.version(name) for name in ['PyMuPDF','pdfplumber','python-docx','lxml']},donors={s:hashlib.sha256((a.repo/'pipeline/budget_pipeline'/s).read_bytes()).hexdigest() for s in files},sources={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in raw.rglob('*') if p.is_file()},outputs={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.glob('*.json')})
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2)+'\n')
print(json.dumps(dict(python=manifest['python'],pages=len(pages),napRows=len(values['nap']),outputs=list(manifest['outputs']))))
