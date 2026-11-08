#!/usr/bin/env python3
"""Извлича числата за лентата „Бюджет 2026 в шест числа“ на началната страница, които още не са в src/.

Лентата показва шест числа за 2026 г. Приходите, разходите и дефицитът (АСБП, Табл. II-2) и дългът
(Табл. VI-1) вече са в прототипа; тук се извличат новите и се сверяват със старите:
  1. БВП 2026 — АСБП 2026–2028, Табл. I-2 „Основни макроикономически показатели“, ред „БВП (млн. евро)“,
     колона 2026 (прогноза). Чете се от PDF-а на МФ (с. 23, PyMuPDF) и от внесения в парламента
     52-602-01-19.docx (таблиците се четат със zipfile + ElementTree; страницата е по съдържанието му).
     Двете версии трябва да съвпадат. Сверява се и с незакръгления БВП от Табл. VI-1 (с. 142) и
     Прил. 3 (с. 194) в asbp_tables.json.
  2. Капиталови разходи, план 2026 — Прил. 3, с. 192, ред „Капиталови разходи“, колона „2026 Проект“
     (asbp_tables.json от asbp_tables.py). Проверява, че редът не е сред различаващите се
     в docx-а (docx_check), т.е. числото е същото и в законопроекта.
  3. Капиталови разходи, изпълнение — месечните отчети на МФ за КФП, 2026 г. (data/raw/kfp_2026/*.xls),
     лист „стартова“, редът с етикет „Капиталови разходи“ (търси се по етикет, не по номер):
     колона B „Консолидирана фискална програма“ (= к.3 национален бюджет + к.4 европейски средства),
     млн. €, натрупано от 1 януари.
  4. Сверява дефицита (Табл. II-2) и дълга (Табл. VI-1) в docx-а с константите в apps/web/public/index.html.
Пише data/inputs/home_kpis_2026.json — стойностите, източниците (файл, таблица, страница, клетка)
и проверките. gen_inline.py го вгражда в apps/web/public/index.html като const KPI.

Входове: data/originals/asbp/{UMTBF-2026-2028-motivi.pdf,asbp_tables.json},
         data/originals/parliament/52-602-01-19.docx, data/originals/kfp_2026/*.xls,
         the archived HTML snapshot (само за сверката с KFP_T22)
Изход:   data/inputs/home_kpis_2026.json
Изисква: pymupdf и xlrd (pip install pymupdf xlrd) — в отделен venv, не в репото на бота.
Употреба: python3 home_kpis.py   (изходът е 1, ако някоя проверка не мине)
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import datetime, glob, hashlib, json, os, re, sys, zipfile
import xml.etree.ElementTree as ET

import pymupdf
import xlrd

P = str(__import__("pathlib").Path(__file__).resolve().parents[3])
RAW = f"{P}/data/originals"
PDF = f"{RAW}/asbp/UMTBF-2026-2028-motivi.pdf"
TABLES = f"{RAW}/asbp/asbp_tables.json"
DOCX = f"{RAW}/parliament/52-602-01-19.docx"
KFP = sorted(glob.glob(f"{RAW}/kfp_2026/*.xls"))
HTML = f"{P}/apps/web/public/index.html"
OUT = f"{P}/data/inputs/home_kpis_2026.json"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
YEARS = ["2024", "2025", "2026", "2027", "2028"]
NUM = re.compile(r"^[−-]?\d{1,3}(?: \d{3})*(?:,\d+)?%?$")
ASBP = "АСБП 2026–2028 (мотиви към законопроекта за държавния бюджет за 2026 г., № 52-602-01-19)"

checks, failed = [], []


def check(ok, msg):
    (checks if ok else failed).append(msg)


def num(s):
    return float(s.replace("−", "-").replace("%", "").replace(" ", "").replace(",", "."))


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def norm(s):
    return " ".join(str(s).split())


def gdp_pdf():
    """Табл. I-2 в PDF-а на МФ: страница 23, редът „БВП (млн. евро)“ и петте числа след него."""
    page = pymupdf.open(PDF)[22]
    lines = [norm(l) for l in page.get_text().split("\n") if l.strip()]
    check(any("Табл. I-2" in l for l in lines) and "Основни макроикономически показатели" in lines,
          "PDF, с. 23: заглавието на Табл. I-2 „Основни макроикономически показатели“ е на страницата")
    i = lines.index("БВП (млн. евро)")
    vals = [num(x) for x in lines[i + 1:i + 6] if NUM.match(x)]
    yi = lines.index("2024")
    check(lines[yi:yi + 5] == YEARS, "PDF, с. 23: колоните на Табл. I-2 са 2024–2028")
    check(len(vals) == 5, "PDF, с. 23: редът „БВП (млн. евро)“ има 5 числа")
    return vals


def docx_tables():
    root = ET.fromstring(zipfile.ZipFile(DOCX).read("word/document.xml"))
    text = lambda el: norm("".join(t.text or "" for t in el.iter(W + "t")))
    tables = [[[text(tc) for tc in tr.findall(W + "tc")] for tr in tbl.iter(W + "tr")] for tbl in root.iter(W + "tbl")]
    body = " ".join(text(p) for p in root.iter(W + "p"))
    return tables, body


def docx_row(tables, label, years_row=True):
    """Първият ред с този етикет и 5 числа; таблицата трябва да има ред с годините 2024–2028."""
    for t in tables:
        if years_row and not any([c for c in r if c][-5:] == YEARS for r in t):
            continue
        for r in t:
            cells = [c for c in r if c]
            if cells and cells[0] == label and len(cells) == 6 and all(NUM.match(c) for c in cells[1:]):
                return [num(c) for c in cells[1:]]
    return None


def capex_exec():
    out = []
    for f in KFP:
        sh = xlrd.open_workbook(f).sheet_by_name("стартова")
        m = re.search(r"(\d\d)\.(\d\d)\.(\d{4})", norm(sh.cell_value(2, 0)))
        rows = [r for r in range(sh.nrows) if norm(sh.cell_value(r, 0)) == "Капиталови разходи"]
        check(len(rows) == 1, f"{os.path.basename(f)}: точно един ред „Капиталови разходи“")
        r = rows[0]
        kfp, nat, eu = (float(sh.cell_value(r, c)) for c in (1, 2, 3))
        check(abs(kfp - nat - eu) < 1e-6, f"{os.path.basename(f)}: к.2 = к.3 + к.4 на реда „Капиталови разходи“")
        out.append({"as_of": f"{m.group(3)}-{m.group(2)}-{m.group(1)}", "kfp": round(kfp, 6), "national": round(nat, 6), "eu": round(eu, 6),
                    "file": os.path.basename(f), "sha256": sha(f), "sheet": "стартова", "cell": f"B{r + 1}", "label": "Капиталови разходи"})
    out.sort(key=lambda x: x["as_of"])
    check(all(a["kfp"] < b["kfp"] for a, b in zip(out, out[1:])), "капиталовите разходи растат всеки месец (натрупано от 1 януари)")
    return out


def main():
    tabs = json.load(open(TABLES, encoding="utf-8"))
    T = tabs["tables"]
    row = lambda t, label: next(r for r in T[t]["rows"] if r["label"] == label)

    # 1. БВП 2026: Табл. I-2 в PDF-а и в docx-а
    g_pdf = gdp_pdf()
    tables, body = docx_tables()
    g_docx = docx_row(tables, "БВП (млн. евро)")
    toc = re.search(r"Табл\.\s*I-?2:?\s*Основни макроикономически показатели\s*(\d+)", body)
    check(g_docx is not None and g_docx == g_pdf, "Табл. I-2, ред „БВП (млн. евро)“: PDF и docx съвпадат за 2024–2028")
    gdp_exact = row("VI_1", "БВП, млн. евро")["values"][2]
    check(gdp_exact == row("annex3_pct_gdp", "Б В П")["values"][2], "незакръгленият БВП 2026 е еднакъв в Табл. VI-1 и в Прил. 3")
    check(abs(g_pdf[2] - gdp_exact) < 0.5, f"Табл. I-2 ({g_pdf[2]:.0f}) = закръгленият БВП от Табл. VI-1 и Прил. 3 ({gdp_exact})")

    # 2. Капиталови разходи, план: Прил. 3
    cap = row("annex3_mln", "Капиталови разходи")
    cap_pct = row("annex3_pct_gdp", "Капиталови разходи")
    differ = {r["label"] for r in tabs["docx_check"]["differing_rows"]}
    check("Капиталови разходи" not in differ and tabs["docx_check"]["docx_numeric_rows"] == tabs["docx_check"]["pdf_numeric_rows"],
          "Прил. 3, „Капиталови разходи“: числата в docx-а (EMF картинките) са същите като в PDF-а")
    check(abs(cap["values"][2] / gdp_exact * 100 - cap_pct["values"][2]) < 0.05, "Прил. 3: 9 360,6 млн. € / БВП = 7,5% (с. 194)")

    # 3. Капиталови разходи, изпълнение: месечните отчети на МФ
    ex = capex_exec()
    last = ex[-1]
    pct = last["kfp"] / cap["values"][2] * 100

    # 4. Сверка на дефицита и дълга (docx) с константите в index.html
    html = open(HTML, encoding="utf-8").read()
    t22 = json.loads(re.sub(r"(\w+):", r'"\1":', re.search(r"const KFP_T22 = (\{.*?\});", html).group(1)))
    rev = docx_row(tables, "ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ", years_row=False)
    exp = docx_row(tables, "ОБЩО РАЗХОДИ И ВНОСКА В БЮДЖЕТА НА ЕС", years_row=False)
    bal = docx_row(tables, "БЮДЖЕТНО САЛДО (+/-)", years_row=False)
    check(rev and exp and bal and [rev[2], exp[2], bal[2]] == [t22["rev"][1], t22["exp"][1], t22["bal"][1]],
          "Табл. II-2 в docx-а: приходи, разходи и салдо за 2026 г. = KFP_T22 в index.html")
    check(round(-bal[2] / gdp_exact * 100, 1) == t22["balPct"][1], f"дефицит 2026: {-bal[2]} / {gdp_exact} = {t22['balPct'][1]}% от БВП")
    debt = docx_row(tables, "Държавен дълг, млн. евро")
    debt_pct = row("VI_1", "Държавен дълг/БВП (%)*")["values"][2]
    check(debt is not None and debt[2] == row("VI_1", "Държавен дълг, млн. евро")["values"][2] and round(debt[2] / gdp_exact * 100, 1) == debt_pct,
          f"Табл. VI-1: държавен дълг 2026 = {debt and debt[2]} млн. € = {debt_pct}% от БВП (docx и PDF)")

    out = {
        "title": "Лентата „Бюджет 2026 в шест числа“ на началната страница: БВП и капиталови разходи (план и изпълнение)",
        "retrieved": datetime.date.today().isoformat(),
        "unit": "млн. €",
        "note": "Приходите, разходите и дефицитът (Табл. II-2) и дългът (Табл. VI-1) са в apps/web/public/index.html (KFP_T22, DEBT_STOCK); тук само се сверяват.",
        "gdp_2026": {
            "what": "Брутен вътрешен продукт, номинален (млн. евро), прогноза на МФ за 2026 г.",
            "mln_eur": g_pdf[2],
            "source": f"{ASBP}, Табл. I-2 „Основни макроикономически показатели“, ред „БВП (млн. евро)“, колона 2026 (прогноза)",
            "pdf": {"file": os.path.basename(PDF), "sha256": sha(PDF), "page": 23, "values_2024_2028": g_pdf},
            "docx": {"file": os.path.basename(DOCX), "sha256": sha(DOCX), "page": int(toc.group(1)) if toc else None,
                     "page_note": "по съдържанието на docx-а", "values_2024_2028": g_docx},
            "unrounded_mln_eur": gdp_exact,
            "unrounded_source": "Табл. VI-1, с. 142, ред „БВП, млн. евро“ и Прил. 3, с. 194, ред „БВП“ (PDF на МФ)",
        },
        "capex_2026": {
            "plan": {"mln_eur": cap["values"][2], "pct_gdp": cap_pct["values"][2],
                     "source": f"{ASBP}, Приложение № 3 „Консолидирана фискална програма за периода 2023–2028 г.“, ред „Капиталови разходи“, колона „2026 Проект“",
                     "pdf_page": cap["page"], "pdf_page_pct_gdp": cap_pct["page"], "docx_page": "397–398 (картинки; числата са същите)"},
            "exec": ex,
            "latest": {"as_of": last["as_of"], "mln_eur": last["kfp"], "pct_of_plan": round(pct, 2),
                       "how": "изпълнение към датата / план по Прил. 3 × 100 — изчислено от нас"},
            "basis": "Касово изпълнение по КФП, натрупано от 1 януари; колона B „Консолидирана фискална програма“ (к.2 = к.3 + к.4).",
        },
        "checks": checks,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"БВП 2026: {g_pdf[2]:.0f} млн. € (с. 23 PDF / с. {toc.group(1) if toc else '?'} docx) | "
          f"капиталови разходи: план {cap['values'][2]} млн. €, към {last['as_of']} {last['kfp']:.1f} млн. € = {pct:.1f}%")
    print(f"проверки: {len(checks)} минават" + (f"; НЕ МИНАВАТ: {failed}" if failed else ""))
    print("записан:", OUT)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
