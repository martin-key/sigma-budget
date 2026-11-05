#!/usr/bin/env python3
"""Пише текста на страниците от АСБП 2026–2028 (мотивите към законопроекта за бюджета) за строителите на Mock приложението.

Защо: bd_fiscal.py (Табл. I-2 и III-1), bd_debt_pdf.py (Табл. VI-2 и текстът на стр. 138–145) и bd_components.py (стр. 171 и 175)
четат tmp/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json. Файлът идваше от междинно извличане без описан производител
(docs/approach-specification.md, раздел 4). Този скрипт го прави отново от PDF-а на МФ.

Какво прави:
  1. Чете prototype/data/raw/asbp/UMTBF-2026-2028-motivi.pdf с PyMuPDF; текстът на всяка страница е редовете на get_text("dict")
     (същото като get_text()), всеки ред завършва с „\\n“.
  2. Маха номерата на бележките под линия: части с флаг „горен индекс“, които са само цифри („Заетост (СНС15)“ → „(СНС)“).
  3. Маха номера на страницата: първия ред, който е само поредният номер на страницата в PDF-а (на 195 страници е първият
     ред, на 2 е по-надолу, 4 нямат номер). Иначе той се залепя за таблица, която продължава на следващата страница.
С PyMuPDF 1.26.5 (tools/data/requirements.txt) outlook.json и expenditure.json от build_data.py излизат байт по байт като в site/data.

Вход:  prototype/data/raw/asbp/UMTBF-2026-2028-motivi.pdf
Изход: tmp/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json   [{"page": номер в PDF-а, "body": текст}, …]
Изисква: pymupdf — .venv-data/bin/python tools/prototype/extract_asbp_pages.py
"""
import json
import os
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "prototype" / "data" / "raw" / "asbp" / "UMTBF-2026-2028-motivi.pdf"
OUT = ROOT / "tmp" / "research" / "mf-umtbf-2026-2028" / "extracts" / "pdf_pages_clean.json"
SUPERSCRIPT = 1                                    # бит 0 на span["flags"] в PyMuPDF


def page_lines(page):
    lines = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:                 # картинка
            continue
        for line in block["lines"]:
            text = "".join(s["text"] for s in line["spans"] if not (s["flags"] & SUPERSCRIPT and s["text"].strip().isdigit()))
            if text.strip():                       # редове само с интервали (празни клетки на таблиците) не влизат
                lines.append(text + "\n")
    return lines


def main():
    if not PDF.is_file():
        sys.exit("няма %s (docs/data-sources.md, раздел 4.2; tools/data/raw_sources.py import)" % PDF.relative_to(ROOT))
    pages = []
    with pymupdf.open(str(PDF)) as doc:
        for i, page in enumerate(doc):
            n = i + 1
            lines = page_lines(page)
            k = next((k for k, ln in enumerate(lines) if ln.strip() == str(n)), None)
            if k is not None:
                del lines[k]
            pages.append({"page": n, "body": "".join(lines)})
    os.makedirs(OUT.parent, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(pages, fh, ensure_ascii=False)
    print("%d страници -> %s (PyMuPDF %s)" % (len(pages), OUT.relative_to(ROOT), pymupdf.VersionBind))


if __name__ == "__main__":
    main()
