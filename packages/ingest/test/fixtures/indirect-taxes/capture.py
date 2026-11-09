"""Verify reader-only evidence and the unchanged donor from the pinned archive.

This preparation command requires the original archive. Regeneration from the
committed IR uses regenerate.py and does not access it.
"""
import hashlib
import json
import tarfile
import tempfile
from pathlib import Path

import fitz
from docx import Document
from budget_pipeline.build import indirect_taxes as donor

ROOT = Path(__file__).resolve().parents[5]
HERE = Path(__file__).resolve().parent
ARCHIVE = Path('/home/user/work/sigma-budget/data/cache/snapshots/release-build-inputs-2026-11-08-period-selector-complete.tar.gz')
ARCHIVE_SHA = '9430d8acfe5bd178a1675041aaae22295c89f2768474ebd27af347b465ace5e3'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def main():
    assert sha(ARCHIVE.read_bytes()) == ARCHIVE_SHA
    sources = json.loads((ROOT / 'data/inputs/indirect_tax_evidence.json').read_text())['sources']
    temporary_root = ROOT / 'tmp'
    if temporary_root.is_symlink() or temporary_root.resolve() != temporary_root or not temporary_root.is_dir():
        raise ValueError('unsafe temporary root')
    with tempfile.TemporaryDirectory(dir=temporary_root) as temp:
        root = Path(temp)
        with tarfile.open(ARCHIVE, 'r:gz') as archive:
            manifest = json.load(archive.extractfile('data/originals/MANIFEST.json'))
            for record in sources.values():
                name = record['path']
                if not name.startswith('data/originals/') or any(part in ('', '.', '..') for part in name.split('/')):
                    raise ValueError('unsafe original path')
                member = archive.getmember(name)
                assert member.isfile()
                data = archive.extractfile(member).read()
                assert sha(data) == record['sha256'], name
                original_key = name.removeprefix('data/originals/')
                if original_key in manifest:
                    assert sha(data) == manifest[original_key]['sha256'], name
                dest = root / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
        donor.RAW = root / 'data/originals'
        prices = donor.sheet(donor.RAW / 'ec-oil/weekly-prices-2026-11-02.xlsx', 'Sheet1')
        duties = donor.sheet(donor.RAW / 'ec-oil/duties-and-taxes-2026-11-07.xlsx', 'Excise duties')
        vat = donor.sheet(donor.RAW / 'ec-oil/duties-and-taxes-2026-11-07.xlsx', 'VAT')
        parser = donor.Text()
        parser.feed((donor.RAW / 'excise-law/dv-69-2026-budget.html').read_text())
        with fitz.open(donor.RAW / 'nsi-pack/statistical-yearbook-2025.pdf') as pdf:
            nsi = [p.get_text() for p in pdf]
        with fitz.open(donor.RAW / 'excise-law/excise-law-dv54-2025.pdf') as pdf:
            customs = [p.get_text() for p in pdf]
        doc = Document(donor.RAW / 'parliament/52-602-01-19.docx')
        tables = [[[c.text for c in row.cells] for row in table.rows] for table in doc.tables]
        raw = dict(prices=prices, duties=duties, vat=vat, sheets=dict(prices='Sheet1', duties='Excise duties', vat='VAT'), priceFilename='weekly-prices-2026-11-02.xlsx', gazetteParts=parser.parts,
                   nsiPages=nsi, customsPages=customs, docxTables=tables, sources=sources)
        reader = json.dumps(raw, ensure_ascii=False, separators=(',', ':'))+'\n'
        oracle = json.dumps(donor.extract(), ensure_ascii=False, separators=(',', ':'))+'\n'
        if (HERE / 'reader-ir.json').read_text() != reader or (HERE / 'oracle.json').read_text() != oracle:
            raise ValueError('reader evidence or donor output differs')
    print('Reader IR and donor output match six hash-checked originals')

if __name__ == '__main__':
    main()
