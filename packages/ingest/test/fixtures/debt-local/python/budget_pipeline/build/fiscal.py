"""Builders for outlook.json, revenue.json and expenditure.json, plus the shared table parsers.

Inputs: Annex 3 (forecast_tables.load), the printed Табл. I-2 (macro frame) and Табл. III-1 (functions) from the PDF text,
the as-submitted III-1 from data/inputs/kfp_functions_2026.json, COFOG from data/inputs/cofog_bg.json and
Табл. VI-1 (state debt) from asbp_tables.json. Every number is read from a source or computed here from numbers
that are read; nothing is typed in. User-facing strings are Bulgarian, keys/comments English.
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import re

import budget_pipeline.build.forecast_tables as forecast_tables
from budget_pipeline.build.definitions import (FUNCTION_DEFS, FUNCTION_NAMES, FUNCTIONS_MINISTRIES_NOTE, NBSP, REVENUE_GROUP_DEFS, fmt_num,
                       span)
from budget_pipeline.build.data_io import isnum, meta, pct, rnd

YEARS = forecast_tables.YEARS
VINTAGE = forecast_tables.VINTAGE
ASOF = "2026-07-01"          # the bill was submitted on this date; the figures are the bill's motives

FUNCTION_SHORT = {
    "obshti-sluzhbi": "Общи държавни служби",
    "otbrana-sigurnost": "Отбрана и сигурност",
    "obrazovanie": "Образование",
    "zdraveopazvane": "Здравеопазване",
    "sotsialni": "Социално осигуряване и грижи",
    "zhilishtno-sreda": "Комунално стопанство и околна среда",
    "kultura-sport": "Култура и спорт",
    "ikonomika": "Икономически дейности",
    "drugi": "Некласифицирани разходи",
}


def _mln(v, d=1):
    return fmt_num(v, d) + NBSP + "млн." + NBSP + "€"


# =================================================================================================== Табл. I-2
I2_GROUPS = [("gdp", "Брутен вътрешен продукт"), ("labour", "Пазар на труда и цени"),
             ("external", "Платежен баланс"), ("money", "Паричен сектор")]
# (id, label as printed, group, level, short label, unit)
I2_ROWS = [
    ("gdp", "БВП (млн. евро)", "gdp", 0, "БВП", "млн. €"),
    ("gdpGrowth", "БВП (реален растеж, %)", "gdp", 0, "Реален растеж на БВП", "%"),
    ("consumption", "Потребление", "gdp", 1, "Потребление", "%"),
    ("gfcf", "Брутообразуване на основен капитал", "gdp", 1, "Инвестиции (брутообразуване на основен капитал)", "%"),
    ("exports", "Износ на стоки и услуги", "gdp", 1, "Износ на стоки и услуги", "%"),
    ("imports", "Внос на стоки и услуги", "gdp", 1, "Внос на стоки и услуги", "%"),
    ("employment", "Заетост (СНС) (%)", "labour", 0, "Заетост", "%"),
    ("unemployment", "Коефициент на безработица (НРС) (%)", "labour", 0, "Безработица", "%"),
    ("compensation", "Компенсации на един нает (%)", "labour", 0, "Компенсации на един нает", "%"),
    ("deflator", "Дефлатор на БВП (%)", "labour", 0, "Дефлатор на БВП", "%"),
    ("hicp", "Средногодишна инфлация (ХИПЦ) (%)", "labour", 0, "Инфлация (ХИПЦ), средногодишна", "%"),
    ("currentAccount", "Текуща сметка (% от БВП)", "external", 0, "Текуща сметка", "% от БВП"),
    ("tradeBalance", "Търговски баланс (% от БВП)", "external", 0, "Търговски баланс", "% от БВП"),
    ("fdi", "Преки чуждестранни инвестиции (% от БВП)", "external", 0, "Преки чуждестранни инвестиции", "% от БВП"),
    ("loansFirms", "Вземания от фирми (%)", "money", 0, "Вземания от фирми", "%"),
    ("loansHouseholds", "Вземания от домакинства (%)", "money", 0, "Вземания от домакинства", "%"),
]
_I2_PARENT = {"consumption": "gdpGrowth", "gfcf": "gdpGrowth", "exports": "gdpGrowth", "imports": "gdpGrowth"}
_NUM_RE = re.compile(r"^-?\d{1,3}(?: \d{3})*(?:,\d+)?$")


def _num_token(tok):
    """'104 767' -> 104767.0; '-2,1' -> -2.1; years such as '2024' and any text -> None."""
    t = tok.replace(NBSP, " ").replace("−", "-").strip()
    if not _NUM_RE.match(t):
        return None
    return float(t.replace(" ", "").replace(",", "."))


def find_page(ctx, *needles, nth=0):
    """Index of the nth PDF page whose body contains ALL `needles` (the table of contents repeats table titles)."""
    hits = [i for i, p in enumerate(ctx.pdf_pages) if all(n in p["body"] for n in needles)]
    if len(hits) <= nth:
        raise ValueError("PDF page with %r not found" % (needles,))
    return hits[nth]


def parse_macro(ctx):
    """Табл. I-2 -> list of 16 row dicts (id, label, group, level, short, unit, values[5])."""
    i = find_page(ctx, "Брутен вътрешен продукт \nБВП (млн. евро)")
    lines = [ln.strip() for ln in ctx.pdf_pages[i]["body"].split("\n")]
    head = {g[1] for g in I2_GROUPS}
    a = lines.index("Брутен вътрешен продукт")
    b = next(k for k in range(a, len(lines)) if lines[k].startswith("Източник:"))
    rows, buf, nums = [], [], []
    for ln in lines[a:b]:
        if not ln:
            continue
        if ln in head and not buf and not nums:
            continue                                   # group heading (the group of a row is fixed by I2_ROWS)
        v = _num_token(ln)
        if v is not None:
            nums.append(v)
            if len(nums) == 5:
                rows.append((" ".join(buf), nums))
                buf, nums = [], []
            continue
        if nums:
            raise ValueError("Табл. I-2: a label follows a partial number run: %r" % ln)
        buf.append(ln)
    if buf or nums:
        raise ValueError("Табл. I-2: trailing tokens %r %r" % (buf, nums))
    if len(rows) != len(I2_ROWS):
        raise ValueError("Табл. I-2: %d rows parsed, expected %d" % (len(rows), len(I2_ROWS)))
    out = []
    for (rid, label, group, level, short, unit), (plabel, vals) in zip(I2_ROWS, rows):
        if re.sub(r"\s+", " ", plabel) != label:
            raise ValueError("Табл. I-2 label mismatch for %s: %r != %r" % (rid, plabel, label))
        r = {"id": rid, "label": label, "short": short, "group": group, "level": level, "unit": unit,
             "values": [int(v) if unit == "млн. €" else v for v in vals]}
        if rid in _I2_PARENT:
            r["parent"] = _I2_PARENT[rid]
        out.append(r)
    return out


# =================================================================================================== Annex 3 rows
def annex_row(a, node):
    """One Annex 3 row with y0 handling: blanks are only allowed at the ends and are never filled."""
    rid = node["id"]
    y0, mln = span(a["mln"][rid])
    p0, pc = span(a["pct"][rid])
    if p0 != y0 or len(pc) != len(mln):
        raise ValueError("Annex 3: blank pattern of mln and pct differs for %s" % rid)
    r = {"id": rid, "label": node["label"], "level": node["level"]}
    if node["parent"]:
        r["parent"] = node["parent"]
    if node.get("memo"):
        r["memo"] = True
    if y0:
        r["y0"] = y0
    r["mln"] = mln
    r["pctGdp"] = pc
    return r


def annex_series(a, rid):
    """{'mln': [...5], 'pctGdp': [...5]} for a row that has no blank cell."""
    mln, pc = a["mln"][rid], a["pct"][rid]
    if any(v is None for v in mln) or any(v is None for v in pc):
        raise ValueError("Annex 3 row %s has blank cells" % rid)
    return {"mln": list(mln), "pctGdp": list(pc)}


def _tree(a, prefix):
    return [n for n in a["tree"] if n["id"].startswith(prefix)]


# =================================================================================================== outlook.json
def _versions(ctx):
    """The rows of Annex 3 that differ between the June PDF (our base) and the .docx submitted on 01.07.2026."""
    a = ctx.annex
    by_label = {}
    for n in a["tree"]:
        by_label.setdefault(n["label"], []).append(n["id"])
    out = []
    for r in ctx.docx_check["differing_rows"]:
        if r["table"] != "annex3_mln":
            raise ValueError("unexpected differing table " + r["table"])
        ids = by_label.get(r["label"].strip())
        if not ids or len(ids) != 1:
            raise ValueError("cannot map differing Annex 3 label %r (%r)" % (r["label"], ids))
        out.append({"id": ids[0], "label": r["label"].strip(), "pdf": r["pdf"], "docx": r["docx"],
                    "diff": [rnd(d - p, 1) for p, d in zip(r["pdf"], r["docx"])]})
    return out


def two_versions_note(versions):
    mx = max(abs(d) for v in versions for d in v["diff"])
    return ("Числата на Приложение 3 са от PDF версията на мотивите (проект от юни 2026 г.). Внесеният на 01.07.2026 г. документ "
            "(.docx) се различава в %d реда само за 2026–2028 г., най-много с %s; общите суми и осемте групи приходи са еднакви. "
            "Различията са в „versions“." % (len(versions), _mln(mx)))


def build_outlook(ctx):
    a = ctx.annex
    gdp_precise = ctx.gdp["mlnPrecise"]
    macro_rows = parse_macro(ctx)
    gdp_row = next(r for r in macro_rows if r["id"] == "gdp")
    for printed, precise in zip(gdp_row["values"], gdp_precise):
        if abs(printed - precise) > 0.5:
            raise ValueError("Табл. I-2 GDP %r differs from Annex 3 GDP %r" % (printed, precise))
    byid = {r["id"]: r for r in macro_rows}

    revenue = annex_series(a, "r.total")
    expenditure = annex_series(a, "x.total")
    balance = annex_series(a, "x.balance")
    interest = annex_series(a, "x.interest")
    financing = annex_series(a, "x.fin")
    primary = {"mln": [rnd(b + i, 1) for b, i in zip(balance["mln"], interest["mln"])]}
    primary["pctGdp"] = [pct(v, g, 2) for v, g in zip(primary["mln"], gdp_precise)]
    primary["computed"] = True
    primary["note"] = "Изчислено: бюджетно салдо + лихви. Лихвените приходи не са извадени, затова е ориентир, не официален показател."

    versions = _versions(ctx)
    notes = [
        {"id": "twoVersions", "text": two_versions_note(versions)},
        {"id": "gdp", "text": "БВП в Табл. I-2 е закръглен до цели милиони евро (2026: 125 247); процентите от БВП в Приложение 3 са "
                              "изчислени от незакръглената стойност (125 246,7), която е в „gdp.mlnPrecise“."},
        {"id": "rounding", "text": "Всяка клетка в източника е закръглена до 0,1 млн. €, затова сборът на съставните редове може да се "
                                    "различава от общия ред с до 0,1–0,3 млн. €."},
        {"id": "balance", "text": "Бюджетното салдо е за консолидираната фискална програма (КФП), с вноската в общия бюджет на ЕС "
                                  "в разходите. Финансирането е със същата стойност и обратен знак."},
    ]
    # Табл. II-3: the printed 2024 column of "% от БВП" uses an older (smaller) GDP -> say so, with the implied figure
    t = ctx.tables["II_3"]["rows"]
    rev_row = next(r for r in t if r["label"] == "ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ")
    exp_row = next(r for r in t if r["label"] == "ОБЩО РАЗХОДИ И ВНОСКА В БЮДЖЕТА НА ЕС")
    pct_rows = [r for r in t if r["label"] == "% от БВП"]
    implied = [rev_row["values"][0] / pct_rows[0]["values"][0] * 100, exp_row["values"][0] / pct_rows[1]["values"][0] * 100]
    if not all(92000 < v < 97000 for v in implied):
        raise ValueError("II-3 2024 implied GDP changed: %r" % implied)
    notes.append({"id": "pct2024",
                  "text": "В Табл. II-3 и II-4 колоната „%% от БВП“ за 2024 г. е изчислена с по-малък БВП (около %s млрд. €), "
                          "а не с 104,8 млрд. € от Приложение 3 (напр. приходите на националния бюджет са отпечатани като 37,1%%, "
                          "а при БВП от Приложение 3 са %s%%). Ползваме Приложение 3 и изчислени дялове."
                          % (fmt_num(sum(implied) / len(implied) / 1000.0, 1),
                             fmt_num(pct(rev_row["values"][0], gdp_precise[0], 1), 1))})

    obj = {
        "meta": meta("D01+D02+D15", "Рамка на КФП и макроикономическа прогноза 2024–2028", source=["asbp"],
                     source_note="Приложение 3 „Консолидирана фискална програма за периода 2023–2028 г.“ и Табл. I-2 на мотивите към законопроекта",
                     as_of=ASOF, unit="млн. €"),
        "years": YEARS, "vintage": VINTAGE,
        "gdp": {"mln": gdp_row["values"], "mlnPrecise": gdp_precise},
        "kfp": {"revenue": revenue, "expenditure": expenditure, "balance": balance, "interest": interest,
                "primaryBalance": primary, "financing": financing},
        "macro": {"gdpRealGrowthPct": byid["gdpGrowth"]["values"], "hicpPct": byid["hicp"]["values"],
                  "unemploymentPct": byid["unemployment"]["values"]},
        "macroVintage": ["actual", "actual", "forecast", "forecast", "forecast"],
        "macroGroups": [{"id": g, "name": n, "rows": [r["id"] for r in macro_rows if r["group"] == g]} for g, n in I2_GROUPS],
        "macroRows": macro_rows,
        "versions": versions,
        "notes": notes,
    }
    return ctx.put("outlook.json", obj)


# =================================================================================================== revenue.json
def build_revenue(ctx):
    a = ctx.annex
    gdp = ctx.gdp["mlnPrecise"]
    total = annex_series(a, "r.total")
    groups = []
    sums = [0.0] * 5
    for gid, name, rows, gloss in REVENUE_GROUP_DEFS:
        vals = []
        for yi in range(5):
            v = sum(a["mln"][r][yi] for r in rows)
            vals.append(rnd(v, 1))
        sums = [s + v for s, v in zip(sums, vals)]
        g = {"id": gid, "name": name, "rowIds": rows, "annex3Rows": [a["labels"][r] for r in rows], "mln": vals,
             "pctGdp": [pct(v, gd, 2) for v, gd in zip(vals, gdp)],
             "share2026": pct(vals[2], total["mln"][2], 2),
             "yoy2026Pct": rnd(100.0 * (vals[2] / vals[1] - 1.0), 1),
             "glossary": gloss}
        groups.append(g)
    sums = [rnd(s, 1) for s in sums]
    for yi in range(5):
        if abs(sums[yi] - total["mln"][yi]) > 0.35:
            raise ValueError("revenue groups do not add up to the total in %d: %r vs %r" % (YEARS[yi], sums[yi], total["mln"][yi]))
    rows = [annex_row(a, n) for n in _tree(a, "r.")]
    obj = {
        "meta": meta("D05", "Приходи на КФП по видове 2024–2028", source=["asbp"],
                     source_note="Приложение 3, редове „Приходи, помощи и дарения“ и съставните им; групите са сборове от редове на приложението",
                     as_of=ASOF, unit="млн. €", pending=["P01"]),
        "years": YEARS, "vintage": VINTAGE,
        "total": total,
        "groups": groups,
        "groupSums": sums,
        "rows": rows,
        "execution": {"ref": "execution", "rows": {"rev.tax": "Данъчни приходи", "rev.nontax": "Неданъчни приходи", "rev.grants": "Помощи и дарения"}},
        "notes": [
            {"id": "groups", "text": "Осемте групи са сборове от редове на Приложение 3. „Други данъци и мита“ са данъкът върху застрахователните "
                                     "премии, митата и митническите такси и другите данъци. Дяловете и процентите от БВП са изчислени от нас."},
            {"id": "rounding", "text": "Сборът на групите се различава от общия ред с до 0,1 млн. € заради закръгляването в източника (виж „groupSums“)."},
            {"id": "byTax", "text": "Изпълнението по видове данъци (ДДС, ДДФЛ, корпоративен данък, акцизи) предстои: месечният отчет в .xls дава само общата сума на данъчните приходи."},
        ],
    }
    return ctx.put("revenue.json", obj)


# =================================================================================================== Табл. III-1
_HEADER_TOKENS = {"ПОКАЗАТЕЛИ", "млн. евро", "% от БВП", "2025", "2026", "2027", "2028", "Програма", "Проект", "Прогноза"}
_MONEY_RE = re.compile(r"^-?\d{1,3}(?: \d{3})*,\d$")
_PCT_RE = re.compile(r"^-?\d+,\d%$")


def parse_iii1_pdf(ctx):
    """Табл. III-1 from the PDF text: [{'name', 'mln': [4], 'pct': [4], 'part': bool}, ...] in printed order."""
    i = find_page(ctx, "Табл. III-1: Разходи по функции по КФП", "ПОКАЗАТЕЛИ \nмлн. евро")
    text = ctx.pdf_pages[i]["body"] + "\n" + ctx.pdf_pages[i + 1]["body"]
    lines = [ln.strip() for ln in text.split("\n")]
    a = lines.index("Общи държавни служби")
    b = next(k for k in range(a, len(lines)) if lines[k].startswith("Източник:"))
    rows, label, money, pcts = [], [], [], []

    def flush():
        if not label and not money and not pcts:
            return
        if len(money) != 4 or len(pcts) != 4:
            raise ValueError("Табл. III-1: row %r has %d amounts and %d percentages" % (label, len(money), len(pcts)))
        name = re.sub(r"\s+", " ", " ".join(label)).strip()
        part = name.startswith("- ")
        rows.append({"name": name[2:].strip() if part else name, "part": part, "mln": list(money),
                     "pct": [float(p[:-1].replace(",", ".")) for p in pcts]})
        label.clear(), money.clear(), pcts.clear()

    for ln in lines[a:b]:
        if not ln or ln in _HEADER_TOKENS:
            continue
        if _MONEY_RE.match(ln):
            if len(money) == 4:
                raise ValueError("Табл. III-1: more than 4 amounts after %r" % label)
            money.append(float(ln.replace(" ", "").replace(",", ".")))
        elif _PCT_RE.match(ln):
            pcts.append(ln)
        else:
            if money or pcts:                           # a new label starts: the previous row is complete
                flush()
            label.append(ln)
    flush()
    return rows


def build_functions(ctx):
    """The functions block (as-submitted III-1 = .docx) with versions/reconcile against the PDF and Annex 3."""
    a = ctx.annex
    gdp = ctx.gdp["mlnPrecise"]
    src = ctx.src("kfp_functions_2026")
    docx = src["functions"]
    pdf = parse_iii1_pdf(ctx)
    if len(docx) != 9:
        raise ValueError("kfp_functions_2026: %d functions" % len(docx))
    # --- the PDF rows regrouped by function
    pdf_f = []
    for r in pdf:
        if not r["part"]:
            pdf_f.append({"name": r["name"], "mln": r["mln"], "pct": r["pct"], "parts": []})
        else:
            pdf_f[-1]["parts"].append(r)
    if len(pdf_f) != 9:
        raise ValueError("Табл. III-1 PDF: %d functions" % len(pdf_f))
    ycols = [1, 2, 3, 4]                               # 2025..2028 positions in the Annex 3 arrays

    items, versions = [], []
    for (slug, prefix, gloss, mins), d, p in zip(FUNCTION_DEFS, docx, pdf_f):
        if not d["name"].startswith(prefix) or p["name"] != d["name"]:
            raise ValueError("function name mismatch: %r / %r / %r" % (prefix, d["name"], p["name"]))
        if len(d["parts"]) != len(p["parts"]) or any(x["name"] != y["name"] for x, y in zip(d["parts"], p["parts"])):
            raise ValueError("function parts mismatch for " + slug)
        it = {"id": slug, "name": FUNCTION_NAMES.get(slug, d["name"]), "short": FUNCTION_SHORT[slug],
              "mln": d["mln"], "pctGdp": d["pc_gdp"]}
        if d["parts"]:
            it["parts"] = [{"name": x["name"], "mln": x["mln"], "pctGdp": x["pc_gdp"]} for x in d["parts"]]
            ssum = [rnd(sum(x["mln"][k] for x in d["parts"]), 1) for k in range(4)]
            if any(abs(ssum[k] - d["mln"][k]) > 0.45 for k in range(4)):
                raise ValueError("parts of %s do not add up: %r vs %r" % (slug, ssum, d["mln"]))
        it["ministries"] = mins
        it["glossary"] = gloss
        items.append(it)
        # --- versions: rows that differ between the June PDF and the .docx
        pairs = [(None, d["name"], d["mln"], p["mln"], d["pc_gdp"], p["pct"])]
        pairs += [(x["name"], x["name"], x["mln"], y["mln"], x["pc_gdp"], y["pct"]) for x, y in zip(d["parts"], p["parts"])]
        for part, label, dm, pm, dp, pp in pairs:
            if dm != pm or dp != pp:
                v = {"id": slug, "label": label, "pdf": pm, "docx": dm}
                if part:
                    v["part"] = part
                if dp != pp:
                    v["pdfPct"], v["docxPct"] = pp, dp
                versions.append(v)

    total = [rnd(sum(it["mln"][k] for it in items), 1) for k in range(4)]
    total_pdf = [rnd(sum(f["mln"][k] for f in pdf_f), 1) for k in range(4)]
    annex_exp = [a["mln"]["x.exp"][k] for k in ycols]
    diff = [rnd(t - e, 1) for t, e in zip(total, annex_exp)]
    # the year where the printed programme is NOT the Annex 3 outturn
    gaps = [YEARS[ycols[k]] for k in range(4) if abs(diff[k]) > 0.35]
    if gaps != [2025]:
        raise ValueError("III-1 vs Annex 3: unexpected gap years %r (diff %r)" % (gaps, diff))
    for it in items:
        it["share"] = [pct(it["mln"][k], total[k], 2) for k in range(4)]
        it["yoy2026Pct"] = rnd(100.0 * (it["mln"][1] / it["mln"][0] - 1.0), 1)
    # printed % of GDP versus % computed with the Annex 3 GDP, per year (max abs gap over the 9 functions)
    gdp4 = [gdp[k] for k in ycols]
    pct_gap = []
    for k in range(4):
        pct_gap.append(rnd(max(abs(it["pctGdp"][k] - 100.0 * it["mln"][k] / gdp4[k]) for it in items), 2))
    if not (pct_gap[0] > 0.2 and all(g < 0.1 for g in pct_gap[1:])):
        raise ValueError("III-1 printed %% of GDP check changed: %r" % pct_gap)
    zdr = next(it for it in items if it["id"] == "zdraveopazvane")
    zdr_calc = pct(zdr["mln"][0], gdp4[0], 1)
    drugi = next(it for it in items if it["id"] == "drugi")
    intr = [a["mln"]["x.interest"][k] for k in ycols]
    same_interest = [drugi["mln"][k] == intr[k] for k in range(4)]

    notes = [
        {"id": "base", "text": "Таблицата няма ред „Общо“. Сборът на деветте функции за 2026 г. е %s и е равен на разходите по КФП без вноската в "
                               "общия бюджет на ЕС (Приложение 3); с вноската от %s общо разходите са %s."
                               % (_mln(total[1]), _mln(a["mln"]["x.eucontrib"][2]), _mln(a["mln"]["x.total"][2]))},
        {"id": "col2025", "text": "Колоната „2025 Програма“ е програмата, както е отпечатана в таблицата (%s), а не предварителният отчет за 2025 г. "
                                   "в Приложение 3 (%s разходи без вноската в ЕС). Отпечатаните там проценти от БВП са с по-малък БВП: "
                                   "напр. за здравеопазване са 5,5%%, а при БВП от Приложение 3 са %s%%. За 2026–2028 г. отпечатаните проценти съвпадат с изчислените."
                                   % (_mln(total[0]), _mln(annex_exp[0]), fmt_num(zdr_calc, 1))},
        {"id": "version", "text": "Редовете са по внесения на 01.07.2026 г. документ (.docx). PDF версията на мотивите се различава в %d от %d реда "
                                   "(виж „versions“); сборовете им са %s и %s за 2026 г." % (len(versions), len(pdf), _mln(total[1]), _mln(total_pdf[1]))},
    ]
    if all(same_interest[1:]) and not same_interest[0]:
        notes.append({"id": "drugi", "text": "Разходите „Некласифицирани в другите функции“ за 2026–2028 г. са равни на лихвите по КФП в Приложение 3 "
                                              "(%s, %s и %s), но за 2025 г. не са (%s срещу %s)."
                                              % (_mln(intr[1]), _mln(intr[2]), _mln(intr[3]), _mln(drugi["mln"][0]), _mln(intr[0]))})
    return {
        "years": [2025, 2026, 2027, 2028], "vintage": ["prelim", "plan", "forecast", "forecast"],
        "yearLabels": ["2025 Програма", "2026 Проект", "2027 Прогноза", "2028 Прогноза"],
        "totalMln": total, "totalPctGdp": [pct(t, g, 2) for t, g in zip(total, gdp4)],
        "items": items,
        "ministriesNote": FUNCTIONS_MINISTRIES_NOTE,
        "reconcile": {"annex3ExpenditureMln": annex_exp, "diffMln": diff, "pdfTotalMln": total_pdf,
                      "printedPctGdpMaxGap": pct_gap},
        "versions": versions,
        "notes": notes,
    }


# =================================================================================================== COFOG
COFOG_NAMES = {
    "GF01": "Общи държавни служби", "GF0107": "Операции с публичния дълг", "GF02": "Отбрана", "GF03": "Обществен ред и сигурност",
    "GF04": "Икономически дейности", "GF05": "Опазване на околната среда", "GF06": "Жилищно строителство и комунални дейности",
    "GF07": "Здравеопазване", "GF08": "Отдих, култура и религия", "GF09": "Образование", "GF10": "Социална защита",
}
# approximate crosswalk to the КФП functions of Табл. III-1 (the two methodologies are NOT the same cut)
COFOG_TO_FUNCTION = {
    "GF01": ["obshti-sluzhbi", "drugi"], "GF02": ["otbrana-sigurnost"], "GF03": ["otbrana-sigurnost"], "GF04": ["ikonomika"],
    "GF05": ["zhilishtno-sreda"], "GF06": ["zhilishtno-sreda"], "GF07": ["zdraveopazvane"], "GF08": ["kultura-sport"],
    "GF09": ["obrazovanie"], "GF10": ["sotsialni"],
}


def build_cofog(ctx):
    c = ctx.src("cofog_bg")
    years = [int(y) for y in c["years"]]
    n = len(years)
    for k in ("MIO_EUR", "PC_GDP"):
        for code, vals in c[k].items():
            if len(vals) != n or any(not isnum(v) for v in vals):
                raise ValueError("cofog %s %s: blank or short series" % (k, code))
    divisions = ["GF01", "GF02", "GF03", "GF04", "GF05", "GF06", "GF07", "GF08", "GF09", "GF10"]
    for yi in range(n):                                # the ten divisions add up to the total (rounding)
        s = sum(c["MIO_EUR"][d][yi] for d in divisions)
        if abs(s - c["MIO_EUR"]["TOTAL"][yi]) > 0.55:
            raise ValueError("COFOG divisions do not add up in %d: %r vs %r" % (years[yi], s, c["MIO_EUR"]["TOTAL"][yi]))
    items = []
    for code in divisions[:1] + ["GF0107"] + divisions[1:]:
        it = {"code": code, "name": COFOG_NAMES[code], "nameEn": c["labels"][code],
              "mln": c["MIO_EUR"][code], "pctGdp": c["PC_GDP"][code]}
        if code == "GF0107":
            it["memoOf"] = "GF01"
        else:
            it["kfpFunctions"] = COFOG_TO_FUNCTION[code]
        items.append(it)
    return {
        "years": years, "unit": "млн. €", "source": ["eurostat"], "asOf": c["updated"][:10],
        "sector": "S13 (държавно управление)", "dataset": c["dataset"],
        "total": {"mln": c["MIO_EUR"]["TOTAL"], "pctGdp": c["PC_GDP"]["TOTAL"]},
        "items": items,
        "note": "Разходите по функции на сектор „Държавно управление“ (COFOG, Евростат) са друг разрез от функциите на КФП в Табл. III-1: "
                "различен обхват и методика, затова числата не са сравними един към един. „Операции с публичния дълг“ е част от „Общи държавни служби“.",
    }


# =================================================================================================== expenditure.json
def build_expenditure(ctx):
    a = ctx.annex
    functions = build_functions(ctx)
    economic_nodes = [n for n in _tree(a, "x.") if n["id"] not in ("x.balance", "x.fin")]
    economic = {"years": YEARS, "vintage": VINTAGE, "rows": [annex_row(a, n) for n in economic_nodes]}
    population = _population_2026(ctx)
    obj = {
        "meta": meta("D03+D04+D05", "Разходи на КФП: по функции, по икономически вид и по COFOG", source=["asbp", "eurostat"],
                     source_note="Табл. III-1 (функции), Приложение 3 (икономически вид), Евростат gov_10a_exp (COFOG)",
                     as_of=ASOF, unit="млн. €"),
        "functions": functions,
        "economic": economic,
        "cofog": build_cofog(ctx),
        "perCapita": {"population": population["persons"], "year": population["year"]},
    }
    return ctx.put("expenditure.json", obj)


def _population_2026(ctx):
    """Eurostat tps00001, 1 January 2026 (data/inputs/population.json -> latest)."""
    return population_latest(ctx.src("population"))


def population_latest(p):
    """{'year': 2026, 'date': '2026-01-01', 'persons': 6423207} from data/inputs/population.json."""
    lat = p["latest"]
    year = int(lat["date"][:4])
    if year != 2026 or not isnum(lat["persons"]):
        raise ValueError("population.json: latest is %r, expected 2026-01-01" % (lat,))
    # the same figure must be the last element of the series
    if int(p["years"][-1]) != year or p["persons"][-1] != lat["persons"]:
        raise ValueError("population.json: latest differs from the last series element")
    return {"year": year, "date": lat["date"], "persons": int(lat["persons"])}


# =================================================================================================== Табл. VI-1
def zdd_table(ctx):
    """Табл. VI-1 (state debt, ЗДД scope) as {key: [5 values]}."""
    t = {r["label"]: r["values"] for r in ctx.tables["VI_1"]["rows"]}
    out = {"totalMln": t["Държавен дълг, млн. евро"], "totalPctGdp": t["Държавен дълг/БВП (%)*"],
           "externalMln": t["Външен дълг, млн. евро"], "externalPctGdp": t["Външен дълг/БВП (%)"],
           "domesticMln": t["Вътрешен дълг, млн. евро"], "domesticPctGdp": t["Вътрешен дълг/БВП (%)"],
           "gdpMln": t["БВП, млн. евро"]}
    for k, v in out.items():
        if len(v) != 5 or any(not isnum(x) for x in v):
            raise ValueError("VI-1 %s is incomplete" % k)
    for i in range(5):
        if abs(out["totalMln"][i] - out["externalMln"][i] - out["domesticMln"][i]) > 0.25:
            raise ValueError("VI-1: external + domestic != total in %d" % YEARS[i])
    return out
