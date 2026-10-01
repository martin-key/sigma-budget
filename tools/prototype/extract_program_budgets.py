#!/usr/bin/env python3
"""Извлича разходите по области на политики и бюджетни програми от програмните бюджети за 2026 г.

Какво прави:
  1. Разархивира програмните бюджети на първостепенните разпоредители (ПРБ) от архива към
     законопроекта за държавния бюджет 2026 (parliament.bg/bills/52/52-602-01-19.zip, папка
     „7.Програмни формати на бюджети на ПРБ с бюджет по ДБ“: 4 zip-а + 7z за съдебната власт)
     в prototype/data/raw/program_budgets/.
  2. Във всеки PDF намира таблиците „Код | Области на политики и бюджетни програми“
     (PyMuPDF find_tables) с 9 колони числа: консолидирани / ведомствени / администрирани разходи,
     всяка разделена на „общо“, „по бюджета на ПРБ“ и „по други бюджети и сметки за средства от ЕС“.
     Годината на таблицата (Отчет 2023, Отчет 2024, Закон 2025, Проект 2026, Прогноза 2027, 2028)
     се взима от заглавието ѝ или от текста точно над нея; таблица без заглавие продължава предишната.
  3. Сверява „Проект 2026 — по бюджета на ПРБ“ с чл. 3–47 на ЗДБ 2026 (src/zdb2026.json):
     общата сума и сумите по политики/програми, които законът дава.
  4. Пише prototype/src/program_budgets_2026.json.

Входове: prototype/data/raw/parliament/52-602-01-19.zip (сваля го fetch_sources.py), prototype/src/zdb2026.json
Изход:   prototype/src/program_budgets_2026.json (+ разархивираните PDF-и в data/raw/program_budgets/)
Изисква: pymupdf, py7zr (pip install pymupdf py7zr) — в отделен venv.
"""
import io, json, os, re, sys, zipfile

import pymupdf

PROTO = str(__import__("pathlib").Path(__file__).resolve().parents[2]) + "/prototype"
ZIP = f"{PROTO}/data/raw/parliament/52-602-01-19.zip"
OUTDIR = f"{PROTO}/data/raw/program_budgets"
OUT = f"{PROTO}/src/program_budgets_2026.json"
ZDB = f"{PROTO}/src/zdb2026.json"

NUM = re.compile(r"^-?\d{1,3}(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?$|^-?\d+(?:[.,]\d+)?$|^-$")
CODE = re.compile(r"^(\d{4})\.\s*(\d{2})\.\s*(\d{2})\*?$")
YEAR = re.compile(r"(Отчет|Закон|Проект|Прогноза)\s*(?:за\s*)?(20\d\d)")
COLS = ["cons_total", "cons_prb", "cons_other", "dept_total", "dept_prb", "dept_other", "adm_total", "adm_prb", "adm_other"]


def name_of(info):
    return info.filename if info.flag_bits & 0x800 else info.filename.encode("cp437").decode("cp866", "replace")


def unpack():
    os.makedirs(OUTDIR, exist_ok=True)
    z = zipfile.ZipFile(ZIP)
    for i in z.infolist():
        n = name_of(i)
        if "7.Програмни" in n and n.endswith(".zip"):
            iz = zipfile.ZipFile(io.BytesIO(z.read(i)))
            for j in iz.infolist():
                path = os.path.join(OUTDIR, name_of(j))
                if not os.path.exists(path):
                    open(path, "wb").write(iz.read(j))
        elif "7.Програмни" in n and n.endswith(".7z") and not os.path.exists(os.path.join(OUTDIR, "0600_СВ.pdf")):
            import py7zr
            arc = os.path.join(OUTDIR, os.path.basename(n))
            open(arc, "wb").write(z.read(i))
            with py7zr.SevenZipFile(arc) as s:
                names = [x for x in s.getnames() if "програмен формат" in x]
                s.extract(path=OUTDIR, targets=names)
            src = os.path.join(OUTDIR, names[0])
            os.replace(src, os.path.join(OUTDIR, "0600_СВ.pdf"))
            os.rmdir(os.path.dirname(src))


def num(s):
    s = s.replace("\u00a0", " ").replace("\u202f", " ").strip()
    if s in ("-", ""):
        return 0.0
    return float(s.replace(" ", "").replace(",", "."))


def clean(c):
    return re.sub(r"\s+", " ", (c or "").replace("\n", " ")).strip()


def consistent(v, tol=0.25):
    """Тъждествата в таблицата: общо = по ПРБ + по други (×3) и консолидирани = ведомствени + администрирани."""
    ct, cp, co, dt, dp, do, at, ap, ao = v
    return all(abs(x) <= tol for x in (ct - cp - co, dt - dp - do, at - ap - ao, ct - dt - at))


def header_map(rows):
    """Индексите на 9-те колони по реда на заглавията „Общо…“, „По бюджета на ПРБ“, „По други…“ (×3)."""
    for h, r in enumerate(rows[:12]):
        idx = [j for j, c in enumerate(r) if re.match(r"^(Общо|По бюджет|По други)", c)]
        if len(idx) == 9 and sum(1 for j in idx if r[j].startswith("Общо")) == 3:
            return idx, h
    return None


def col_ranges(t, hm):
    """x-обхватите на 9-те колони от клетките на заглавния ред (PyMuPDF дава bbox на всяка клетка)."""
    idx, h = hm
    cells = t.rows[h].cells
    rng = [cells[j] for j in idx]
    if any(c is None for c in rng):
        return None
    return [(c[0], c[2]) for c in rng]


def positional_values(page, t, i, ranges):
    """Резервен път: числата в реда по координати — всяко число отива в колоната, в чийто
    x-обхват е центърът му; празна клетка = 0. Числата с разделител за хилядите са няколко думи."""
    rb = t.rows[i].bbox
    words = [w for w in page.get_text("words", clip=pymupdf.Rect(rb)) if re.match(r"^-?[\d.,]+$", w[4])]
    words.sort(key=lambda w: (round(w[1]), w[0]))
    nums, cur = [], None
    for w in words:
        if cur and abs(w[1] - cur[1]) < 3 and 0 <= w[0] - cur[2] < 4.5 and re.match(r"^\d{3}([.,]\d+)?$", w[4]) \
                and not re.search(r"[.,]\d+$", cur[3]):
            cur = (cur[0], cur[1], w[2], cur[3] + " " + w[4])
        else:
            if cur:
                nums.append(cur)
            cur = (w[0], w[1], w[2], w[4])
    if cur:
        nums.append(cur)
    vals = [0.0] * 9
    seen = [False] * 9
    for x0, y0, x1, txt in nums:
        if not NUM.match(txt):
            continue
        cx = (x0 + x1) / 2
        k = next((k for k, (a, b) in enumerate(ranges) if a - 1 <= cx <= b + 1), None)
        if k is None or seen[k]:
            return None
        vals[k] = num(txt); seen[k] = True
    return vals if any(seen) else None


def row_values(r, hmap, pos=None):
    """Стойностите на 9-те колони: по заглавията, по точно 9 числа в реда или по координати."""
    cand = []
    if hmap and max(hmap[0]) < len(r):
        cells = [r[j] for j in hmap[0]]
        if all(NUM.match(c) or c == "" for c in cells) and any(cells):
            cand.append([num(c) for c in cells])
    nums = [num(c) for c in r if NUM.match(c)]
    if len(nums) == 9:
        cand.append(nums)
    if pos:
        v = pos()
        if v:
            cand.append(v)
    for v in cand:
        if consistent(v):
            return v, True
    return (cand[0] if cand else nums), False


def parse_pdf(path):
    doc = pymupdf.open(path)
    tables, last = [], None  # last: (година, страница) на последната таблица с програми
    for page in doc:
        txt = page.get_text()
        if not re.search(r"\d{4}\.\s*\d{2}\.\s*\d{2}", txt) or not re.search(r"хил\.?\s*евро", txt):
            continue
        try:
            found = page.find_tables().tables
        except Exception:
            continue
        prev_bottom = 0
        for t in found:
            rows = [[clean(c) for c in r] for r in t.extract()]
            if not any(CODE.match(c) for r in rows for c in r[:4]):
                prev_bottom = t.bbox[3]
                continue
            head = " ".join(" ".join(r) for r in rows[:10])
            above = page.get_text(clip=pymupdf.Rect(0, max(prev_bottom, t.bbox[1] - 140), page.rect.width, t.bbox[1]))
            m = YEAR.search(head)
            if not m:
                ms = list(YEAR.finditer(above))
                m = ms[-1] if ms else None
            if m:
                label = f"{m.group(1)} {m.group(2)}"
            elif last and last[1] in (page.number - 1, page.number):
                label = last[0]  # продължение от предишната страница
            else:
                label = None
            hm = header_map(rows)
            ranges = col_ranges(t, hm) if hm else None
            if not hm and last and last[1] in (page.number - 1, page.number):
                hm, ranges = last[2], last[3]  # продължение: същите колони
            items, cur = [], None
            for i, r in enumerate(rows):
                code = next((CODE.match(c) for c in r[:4] if CODE.match(c)), None)
                text = " ".join(c for c in r if c and not NUM.match(c) and not CODE.match(c))
                if code or re.match(r"^общо разходи", text, re.I):
                    pos = (lambda i=i: positional_values(page, t, i, ranges)) if ranges else None
                    vals, ok = row_values(r, hm, pos)
                    cur = {"code": f"{code.group(1)}.{code.group(2)}.{code.group(3)}" if code else "total", "name": text, "values": vals, "ok": ok}
                    items.append(cur)
                elif cur is not None and text and not any(NUM.match(c) for c in r) and not YEAR.search(text) and "хил" not in text:
                    cur["name"] = (cur["name"] + " " + text).strip()
            tables.append({"page": page.number + 1, "label": label, "items": items})
            if label:
                last = (label, page.number, hm, ranges)
            prev_bottom = t.bbox[3]
    return tables


def main():
    unpack()
    zdb = {m["art"]: m for m in json.load(open(ZDB, encoding="utf-8"))}
    # ПРБ код → член от ЗДБ (по наименование в ЗДБ); съпоставката е ръчна и проверима
    ART = {"0300": 6, "0400": 7, "0500": 4, "0600": 2, "0200": 5, "0100": 3, "1000": 9, "1100": 10, "1200": 11, "1300": 12, "1400": 13, "1500": 14,
           "1600": 15, "1700": 16, "1800": 17, "1900": 18, "2000": 19, "7400": 20, "2400": 21, "7100": 22, "2100": 23, "2200": 24, "2300": 25,
           "2500": 26, "3000": 27, "3300": 29, "3400": 30, "3700": 31, "3800": 32, "3900": 33, "4100": 34, "4200": 35, "4300": 36, "4400": 37,
           "4500": 38, "4600": 39, "4800": 40, "5300": 41, "4700": 42, "8300": 43, "8200": 44, "8400": 45, "8500": 46, "8600": 47, "4000": 8,
           "3200": 28}
    out = {"title": "Програмни бюджети на първостепенните разпоредители за 2026–2028 г.: разходи по области на политики и бюджетни програми",
           "source": {"archive": "https://www.parliament.bg/bills/52/52-602-01-19.zip",
                      "folder": "52-602-01-19/7.Програмни формати на бюджети на ПРБ с бюджет по ДБ/ (10.1–10.4 … .zip, 10.5 0600 BCC проект СВ.7z)",
                      "bill": "Законопроект за държавния бюджет на Република България за 2026 г., № 52-602-01-19, внесен на 01.07.2026",
                      "note": "Програмните бюджети са към законопроекта; приетият закон (ДВ, бр. 69 от 31.07.2026) може да се различава."},
           "unit": "хил. €", "columns": COLS,
           "columns_bg": ["Консолидирани разходи — общо", "— по бюджета на ПРБ", "— по други бюджети и сметки за средства от ЕС",
                          "Ведомствени разходи — общо", "— по бюджета на ПРБ", "— по други бюджети и сметки за средства от ЕС",
                          "Администрирани разходи — общо", "— по бюджета на ПРБ", "— по други бюджети и сметки за средства от ЕС"],
           "years": ["Отчет 2023", "Отчет 2024", "Закон 2025", "Проект 2026", "Прогноза 2027", "Прогноза 2028"],
           "budgets": {}, "not_parsed": {}}
    for f in sorted(os.listdir(OUTDIR)):
        if not f.endswith(".pdf"):
            continue
        prb = f[:4]
        try:
            tables = parse_pdf(os.path.join(OUTDIR, f))
        except Exception as e:
            out["not_parsed"][f] = f"грешка: {e}"
            continue
        progs, problems, pages = {}, [], {}
        for t in tables:
            if t["label"] in out["years"] and t["items"]:
                pages.setdefault(t["label"], [])
                if t["page"] not in pages[t["label"]]:
                    pages[t["label"]].append(t["page"])
            if not t["label"] or t["label"] not in out["years"]:
                if t["items"]:
                    problems.append(f"с. {t['page']}: таблица без разпозната година ({t['label']})")
                continue
            for it in t["items"]:
                if not it["ok"]:
                    problems.append(f"с. {t['page']} {t['label']} {it['code']}: числата не дават сборовете на таблицата ({it['values']})")
                    continue
                p = progs.setdefault(it["code"], {"name": it["name"], "by_year": {}})
                if len(it["name"]) > len(p["name"]):
                    p["name"] = it["name"]
                p["by_year"][t["label"]] = dict(zip(COLS, it["values"]))
        if not progs:
            out["not_parsed"][f] = "; ".join(problems[:5]) or "няма таблици с код на програма в текстовия слой (сканиран документ или друг формат)"
            continue
        # сверка с ЗДБ 2026
        art = ART.get(prb)
        check = {}
        if art in zdb:
            law = zdb[art]
            tot = next((p for c, p in progs.items() if c in ("total", f"{prb}.00.00")), None)
            if tot and "Проект 2026" in tot["by_year"]:
                check["total_prb_2026"] = tot["by_year"]["Проект 2026"]["cons_prb"]
                check["zdb_exp"] = law["exp"]
                check["total_matches_law"] = abs(check["total_prb_2026"] - law["exp"]) < 0.15
            pol = [p for c, p in progs.items() if c.endswith(".00") and c not in ("total", f"{prb}.00.00")]
            law_items = [i["k"] for i in law["items"] if "." not in i["n"]]
            got = sorted(round(p["by_year"].get("Проект 2026", {}).get("cons_prb", -1), 1) for p in pol)
            check["policies_in_law"] = len(law_items)
            check["policy_amounts_found_in_law"] = sum(1 for k in law_items if round(k, 1) in got)
        # вътрешна сверка за 2026 г. (по бюджета на ПРБ): политиките дават общото, програмите — своята политика
        y = "Проект 2026"
        v = lambda c: progs[c]["by_year"].get(y, {}).get("cons_prb")
        tot_code = next((c for c in progs if c in ("total", f"{prb}.00.00")), None)
        pol_codes = [c for c in progs if c.endswith(".00") and c != tot_code and c != f"{prb}.00.00"]
        if tot_code and v(tot_code) is not None and pol_codes and all(v(c) is not None for c in pol_codes):
            check["policies_sum_to_total_2026"] = abs(sum(v(c) for c in pol_codes) - v(tot_code)) < 0.5
            bad = []
            for pc in pol_codes:
                kids = [c for c in progs if c[:7] == pc[:7] and not c.endswith(".00")]
                if kids and all(v(c) is not None for c in kids) and abs(sum(v(c) for c in kids) - v(pc)) >= 0.5:
                    bad.append(pc)
            check["programs_sum_to_policy_2026"] = not bad
            if bad:
                check["policies_with_program_mismatch"] = bad
        check["use_in_prototype"] = bool(check.get("total_matches_law") and check.get("policies_sum_to_total_2026") and check.get("programs_sum_to_policy_2026"))
        complete = [y for y in out["years"] if progs and all(y in p["by_year"] for p in progs.values())]
        out["budgets"][prb] = {"file": f, "zdb_art": art, "zdb_name": zdb[art]["name"] if art in zdb else None, "pages": pages,
                               "years_complete": complete, "programs": progs, "check": check, "problems": problems}
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    ok = [k for k, b in out["budgets"].items() if b["check"].get("total_matches_law")]
    use = [k for k, b in out["budgets"].items() if b["check"].get("use_in_prototype")]
    out["validated"] = use
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"ПРБ с таблици: {len(out['budgets'])}; общата сума за 2026 г. съвпада със ЗДБ: {len(ok)}; минават и вътрешните сверки: {len(use)}: {use}")
    for k, b in out["budgets"].items():
        yrs = sorted({y for p in b["programs"].values() for y in p["by_year"]})
        print(f"  {k} {b["file"][:22]:22} ({b["zdb_name"]}) програми/политики: {len(b['programs']):3}  години: {','.join(y.split()[1] for y in yrs):35} "
              f"сверка: {b['check']}  проблеми: {len(b['problems'])}")
    for k, v in out["not_parsed"].items():
        print("  НЕ:", k, "—", v[:160])


if __name__ == "__main__":
    main()
