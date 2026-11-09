#!/usr/bin/env python3
"""Извлича таблиците от АСБП 2026–2028 (мотивите към законопроекта за бюджета), нужни на прототипа.

Какво прави:
  1. Чете PDF-а на МФ UMTBF-2026-2028-motivi.pdf (data/originals/asbp/) с PyMuPDF.
     Таблиците са с текстов слой: всяко число е отделен „span“ с координати, затова колоната
     се определя по позицията (най-близкият център на заглавие на колона), а не по реда на текста.
  2. Сверява Приложение № 3 с внесения в парламента файл 52-602-01-19.docx: там приложението
     е вградено като EMF картинки (word/media/image19–22.emf), чиито текстови записи
     (EMR_EXTTEXTOUTW) съдържат същите числа. Сверката е число по число.
  3. Пише data/originals/asbp/asbp_tables.json — суровите таблици с номерата на страниците
     (в PDF-а на МФ и в docx-а, по съдържанието му).

Входове: data/originals/asbp/UMTBF-2026-2028-motivi.pdf, data/originals/parliament/52-602-01-19.docx
Изход:   data/originals/asbp/asbp_tables.json
Изисква: pymupdf (pip install pymupdf) — в отделен venv, не в репото на бота.
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import hashlib, json, re, struct, sys, zipfile

import pymupdf

RAW = str(__import__("pathlib").Path(__file__).resolve().parents[3]) + "/data/originals"
PDF = f"{RAW}/asbp/UMTBF-2026-2028-motivi.pdf"
DOCX = f"{RAW}/parliament/52-602-01-19.docx"
OUT = f"{RAW}/asbp/asbp_tables.json"
NUM = re.compile(r"^[−-]?\d{1,3}(?: \d{3})*,\d+%?$")


def num(s):
    s = s.replace("−", "-").replace("%", "").replace(" ", "").replace(",", ".")
    return float(s)


_SPANS = {}


def spans(page):
    """Текстовите парчета на страницата с плътни граници (без водещите и крайните интервали)."""
    if page.number in _SPANS:
        return _SPANS[page.number]
    out = []
    for b in page.get_text("rawdict")["blocks"]:
        for l in b.get("lines", []):
            for s in l["spans"]:
                chars = [c for c in s["chars"] if c["c"].strip()]
                if not chars:
                    continue
                t = "".join(c["c"] for c in s["chars"]).strip()
                x0 = min(c["bbox"][0] for c in chars); x1 = max(c["bbox"][2] for c in chars)
                y0, y1 = s["bbox"][1], s["bbox"][3]
                out.append({"t": t, "x0": x0, "x1": x1, "y": (y0 + y1) / 2})
    _SPANS[page.number] = out
    return out


def table(pages, cols, y_min=0, y_max=1e9, label_max_x=None, row_tol=2.2):
    """cols: [(име, x_център)]. Връща редове {label, x0, values[]} по реда отгоре надолу."""
    rows = []
    for pno, (ymin, ymax) in pages:
        page = DOC[pno - 1]
        sp = [s for s in spans(page) if max(ymin, y_min) <= s["y"] <= min(ymax, y_max)]
        sp.sort(key=lambda s: (s["y"], s["x0"]))
        groups = []
        for s in sp:
            if groups and abs(groups[-1][0]["y"] - s["y"]) <= row_tol:
                groups[-1].append(s)
            else:
                groups.append([s])
        lmax = label_max_x if label_max_x is not None else min(c for _, c in cols) - 40
        for g in groups:
            label = " ".join(s["t"] for s in g if s["x1"] <= lmax and not NUM.match(s["t"]))
            vals = [None] * len(cols)
            for s in g:
                if NUM.match(s["t"]) and s["x1"] > lmax:
                    cx = (s["x0"] + s["x1"]) / 2
                    k = min(range(len(cols)), key=lambda i: abs(cols[i][1] - cx))
                    vals[k] = num(s["t"])
            if label or any(v is not None for v in vals):
                x0 = min((s["x0"] for s in g if s["x1"] <= lmax), default=None)
                rows.append({"page": pno, "y": round(g[0]["y"], 1), "label": label, "x0": round(x0, 1) if x0 else None, "values": vals})
    # Надпис на няколко реда: редът с числата е без надпис, а парчетата на надписа са редове без числа
    # непосредствено над него (до 2 реда) и под него (1 ред). Слепваме ги в един ред.
    has = lambda r: any(v is not None for v in r["values"])
    used = set()
    for i, r in enumerate(rows):
        if r["label"] or not has(r):
            continue
        parts, j, y = [], i - 1, r["y"]
        while j >= 0 and len(parts) < 2 and rows[j]["page"] == r["page"] and not has(rows[j]) and rows[j]["label"] \
                and y - rows[j]["y"] <= 13 and j not in used:
            parts.insert(0, rows[j]["label"]); used.add(j); y = rows[j]["y"]; j -= 1
        if i + 1 < len(rows) and rows[i + 1]["page"] == r["page"] and not has(rows[i + 1]) and rows[i + 1]["label"] \
                and rows[i + 1]["y"] - r["y"] <= 8:
            parts.append(rows[i + 1]["label"]); used.add(i + 1)
        r["label"] = " ".join(parts)
        r["x0"] = rows[min(used & set(range(max(0, i - 2), i + 2)), default=i)]["x0"] if parts else None
    return [r for k, r in enumerate(rows) if k not in used]


def header_centers(pno, labels, y_from, y_to):
    """Намира центровете на заглавията на колоните (напр. „2024“…„2028“) в даден ред."""
    sp = [s for s in spans(DOC[pno - 1]) if y_from <= s["y"] <= y_to]
    out = []
    for lab in labels:
        c = [s for s in sp if s["t"] == lab]
        if not c:
            sys.exit(f"с. {pno}: няма заглавие на колона {lab!r}")
        out.append((lab, (c[0]["x0"] + c[0]["x1"]) / 2))
    return out


def find_y(pno, text):
    for s in spans(DOC[pno - 1]):
        if text in s["t"]:
            return s["y"]
    sys.exit(f"с. {pno}: няма {text!r}")


# ---------- EMF (docx) ----------
def emf_texts(data):
    """Текстовите записи EMR_EXTTEXTOUTW (тип 84) от EMF: [(x, y, текст)]."""
    out, off = [], 0
    while off + 8 <= len(data):
        typ, size = struct.unpack_from("<II", data, off)
        if size < 8:
            break
        if typ == 84:
            rx, ry, nch, offs = struct.unpack_from("<iiII", data, off + 36)
            s = data[off + offs: off + offs + 2 * nch].decode("utf-16le", errors="replace")
            out.append((rx, ry, s))
        if typ == 14:  # EMR_EOF
            break
        off += size
    return out


def emf_numbers(data):
    """Числата от EMF, групирани по ред (y): {y: [числа по x]}."""
    rows = {}
    for x, y, s in emf_texts(data):
        s = s.strip()
        if NUM.match(s):
            rows.setdefault(y, []).append((x, num(s)))
    return {y: [v for _, v in sorted(r)] for y, r in rows.items()}


def main():
    global DOC
    DOC = pymupdf.open(PDF)
    res = {"source": {
        "file": "UMTBF-2026-2028-motivi.pdf",
        "title": "Актуализирана средносрочна бюджетна прогноза за периода 2026–2028 г. — мотиви към законопроекта за държавния бюджет за 2026 г. (МФ, юни 2026)",
        "publisher_page": "https://www.minfin.bg/bg/legislation1/609 (minfin.bg отказва автоматичния достъп — HTTP 403)",
        "obtained": "Предоставен от работната група на 01.10.2026 с връзка към страницата на МФ.",
        "sha256": hashlib.sha256(open(PDF, "rb").read()).hexdigest(),
        "pages_note": "Страниците са по номерацията на PDF файла (съвпада с отпечатаната). В 52-602-01-19.docx (parliament.bg) същите таблици са с 204–206 страници по-нататък — виж docx_page.",
    }, "tables": {}}
    T = res["tables"]

    # Прил. 3: КФП 2024–2028, млн. € (с. 191–192) и % от БВП (с. 193–194)
    yrs = ["2024", "2025", "2026", "2027", "2028"]
    colnames = ["2024 Отчет", "2025 Предв. отчет", "2026 Проект", "2027 Прогноза", "2028 Прогноза"]
    for key, pages, unit, docx_page in (("annex3_mln", (191, 192), "млн. €", "397–398"), ("annex3_pct_gdp", (193, 194), "% от БВП", "399–400")):
        rows = []
        for p in pages:
            hy = find_y(p, "Показатели")
            cols = header_centers(p, yrs, hy - 12, hy + 12)
            rows += table([(p, (hy + 20, 9999))], list(zip(colnames, [c for _, c in cols])), label_max_x=450)
        T[key] = {"title": "Приложение № 3: Консолидирана фискална програма за периода 2023–2028 г.", "pdf_pages": f"{pages[0]}–{pages[1]}",
                  "docx_page": docx_page + " (картинки в docx-а; в съдържанието: с. 397)", "unit": unit, "columns": colnames,
                  "rows": [r for r in rows if r["label"]]}

    # Табл. VI-1: Държавен дълг (с. 142)
    p = 142
    hy = find_y(p, "Отчет")
    cols = header_centers(p, yrs, hy - 20, hy + 2)
    y0 = find_y(p, "Държавен дълг, млн. евро")
    y1 = find_y(p, "БВП, млн. евро")
    T["VI_1"] = {"title": "Табл. VI-1: Държавен дълг – вътрешен и външен и съотношение спрямо БВП", "pdf_pages": "142", "docx_page": "348",
                 "columns": ["2024 Отчет", "2025 Отчет", "2026 Проект", "2027 Прогноза", "2028 Прогноза"],
                 "rows": table([(p, (y0 - 3, y1 + 3))], list(zip(colnames, [c for _, c in cols])), label_max_x=215),
                 "note": "Забележка под таблицата: „Поради закръгления някои от сумарните позиции е възможно да не се изчерпват от съставните им числа. Източник: МФ“"}

    # Табл. II-3 и II-4: КФП — национален бюджет и сметки за средства от ЕС (с. 31–32)
    for key, p, title, start, end, docx_page in (
            ("II_3", 31, "Табл. II-3: КФП – Национален бюджет (2026-2028 г.)", "Табл. II-3", "ФИНАНСИРАНЕ (+/-)", "235"),
            ("II_4", 32, "Табл. II-4: КФП – Сметки за средства от ЕС (2026-2028 г.)", "Табл. II-4", "ФИНАНСИРАНЕ (+/-)", "236")):
        ys = find_y(p, start)
        sp = [s for s in spans(DOC[p - 1]) if s["y"] > ys - 2 and s["t"] in yrs]
        hy = min(s["y"] for s in sp)
        cols = header_centers(p, yrs, hy - 2, hy + 2)
        ye = max(s["y"] for s in spans(DOC[p - 1]) if s["t"].startswith(end) and s["y"] > ys)
        T[key] = {"title": title, "pdf_pages": str(p), "docx_page": docx_page, "unit": "млн. €", "columns": colnames,
                  "rows": table([(p, (hy + 8, ye + 12))], list(zip(colnames, [c for _, c in cols])), label_max_x=305)}

    # Табл. IV-1: общини (с. 128) — колони: Проект 2026, от тях местни, делегирани, Прогноза 2027, 2028 (хил. €)
    p = 128
    y0 = find_y(p, "Общо:")
    yh = find_y(p, "местни")
    sp = spans(DOC[p - 1])
    def cx(t, near):
        c = sorted([s for s in sp if s["t"] == t], key=lambda s: abs(s["y"] - near))[0]
        return (c["x0"] + c["x1"]) / 2
    cols4 = [("2026 Проект", cx("2026", yh)), ("2026 от тях местни", cx("местни", yh)), ("2026 от тях делегирани", cx("делегирани", yh)),
             ("2027 Прогноза", cx("2027", yh)), ("2028 Прогноза", cx("2028", yh))]
    yend = find_y(p, "Целева субсидия за капиталови разходи")
    T["IV_1"] = {"title": "Табл. IV-1: Основни бюджетни взаимоотношения на общините с централния бюджет за периода 2026-2028 г.", "pdf_pages": "128",
                 "docx_page": "334", "unit": "хил. €", "columns": [c for c, _ in cols4],
                 "rows": table([(p, (y0 - 3, yend + 3))], cols4, label_max_x=cols4[0][1] - 35)}
    # текстът над таблицата: разходите на общините за 2026–2028 г.
    txt = re.sub(r"\s+", " ", DOC[p - 1].get_text())
    m = re.search(r"Предвидени са разходи за общините за 2026 г\. в размер на ([\d ,]+) млн\. евро.*?– 12,4%\.", txt)
    T["IV_text"] = {"pdf_pages": "128", "docx_page": "334", "quote": m.group(0) if m else None,
                    "quote_local": (re.search(r"Разходите за местни дейности през 2026 г\. са в размер на [\d ,]+ млн\. евро и представляват [\d,]+% от общите разходи на общините\.", txt) or [None])[0],
                    "quote_delegated": (re.search(r"Предвидените за 2026 г\. разходи за делегираните от държавата дейности са в размер на [\d ,]+ млн\. евро", txt) or [None])[0]}

    # Прил. 6 (с. 197) и Прил. 9 (с. 200): хил. €, колони 2026, 2027, 2028
    for key, p, title, start, docx_page in (
            ("annex6", 197, "Приложение № 6: Размери на бюджетните взаимоотношения (трансферите) на държавния бюджет с бюджетите на БНТ, БНР, БТА, БАН, държавните висши училища и държавните висши военни училища за периода 2026-2028 г.", "ПРИЛОЖЕНИЕ № 6", "403"),
            ("annex9", 200, "Приложение № 9: Размери на основните бюджетни взаимоотношения между централния бюджет и бюджетите на общините за периода 2026-2028 г.", "ПРИЛОЖЕНИЕ № 9", "406")):
        ys = find_y(p, start)
        sp = [s for s in spans(DOC[p - 1]) if s["y"] > ys]
        hy = min(s["y"] for s in sp if s["t"] == "2026 г.")
        c3 = [(f"{y} г.", (lambda c: (c["x0"] + c["x1"]) / 2)([s for s in sp if s["t"] == f"{y} г." and abs(s["y"] - hy) < 3][0])) for y in (2026, 2027, 2028)]
        T[key] = {"title": title, "pdf_pages": str(p), "docx_page": docx_page, "unit": "хил. €", "columns": [c for c, _ in c3],
                  "rows": table([(p, (hy + 6, 9999))], c3, label_max_x=c3[0][1] - 40)}

    # ---------- сверка на Прил. 3 с docx-а (EMF) ----------
    z = zipfile.ZipFile(DOCX)
    pdf_rows = [(t, r["label"], tuple(v for v in r["values"] if v is not None))
                for t in ("annex3_mln", "annex3_pct_gdp") for r in T[t]["rows"] if any(v is not None for v in r["values"])]
    docx_rows = []
    for n in ("word/media/image19.emf", "word/media/image20.emf", "word/media/image21.emf", "word/media/image22.emf"):
        rows = emf_numbers(z.read(n))
        docx_rows += [(n, tuple(rows[y])) for y in sorted(rows)]
    pool = [r for _, r in docx_rows]
    diffs = []
    for t, lab, vals in pdf_rows:
        if vals in pool:
            pool.remove(vals)
            continue
        # най-близкият ред в docx-а със същия брой числа и същите първи две години
        cand = [r for r in pool if len(r) == len(vals) and r[:2] == vals[:2]]
        diffs.append({"table": t, "label": lab, "pdf": list(vals), "docx": list(cand[0]) if cand else None})
        if cand:
            pool.remove(cand[0])
    T["annex3_mln"]["rows_differing_in_docx"] = [d["label"] for d in diffs if d["table"] == "annex3_mln"]
    res["docx_check"] = {
        "what": "Числата на Прил. 3 в PDF-а на МФ срещу текстовите записи на EMF картинките в 52-602-01-19.docx (word/media/image19–22.emf), ред по ред",
        "pdf_numeric_rows": len(pdf_rows), "docx_numeric_rows": len(docx_rows),
        "identical_rows": len(pdf_rows) - len(diffs), "differing_rows": diffs,
        "docx_rows_without_pair": [list(r) for r in pool],
        "note": "Разликите са само в подредове на разходите (персонал, издръжка, субсидии) и на неданъчните приходи (собственост, продажба на активи) за 2026–2028 г.; сборните редове и данъчните приходи съвпадат."}
    json.dump(res, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in res["docx_check"].items() if k != "what"}, ensure_ascii=False, indent=1))
    for k, t in T.items():
        if "rows" in t:
            print(k, len(t["rows"]), "реда")


if __name__ == "__main__":
    main()
