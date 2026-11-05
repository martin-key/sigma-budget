"""D17 rates.json: the 2026 contribution and income-tax parameters behind the S18 calculator ("Данъци и осигуровки").

Every number is re-read from a primary document on each build and cross-checked against the others; a mismatch is a build error.
  * NAP, Приложение № 1 to letter ВК-30-10237 of 12.08.2026 (PDF, 22 pages): the contribution rate of every category of insured
    person, split by fund, for the insured person and for the employer. Read with PyMuPDF `find_tables` (build-time only).
  * ЗБДОО 2026 (ДВ, бр. 68): art. 9 (minimum / maximum monthly insurable income, 01.01-31.07 and 01.08-31.12), art. 14 with
    Приложения 2 and 2А (ТЗПБ rate by economic activity), art. 15(1) (ГВРС: no contributions), Приложения 1 and 1А (minimum
    insurable income by activity and profession group). Parsed from the Държавен вестник HTML with lawparse.
  * ЗБНЗОК 2026 (ДВ, бр. 68): art. 2 (health-insurance contribution, 8%).
  * ASBP bill (docx in prototype/data/raw/parliament/), Приложение № 2 "Основни допускания": the income-tax rate and the assumptions the contribution
    parameters are re-derived from (60:40 split, 8,22:6,58 pension split, ...).
Scenarios other than "employment" are real only where the NAP table has a row for them; the pensioner scenario has no row and stays
pending (no numbers). The tax side of the self-employed and management-contract scenarios is left out (not in the sources).
"""
import re

import lawparse as L
from dlib import RAW, isnum, meta, pct, rnd

NAP_PDF = RAW / "nap" / "nap_prilozhenie_1_VK-30-10237_12.08.2026.pdf"
DOO_HTML = RAW / "dv" / "zbdoo2026_dv68_idMat244982.html"
NZOK_HTML = RAW / "dv" / "zbnzok2026_dv68_idMat244981.html"
BILL_DOCX = RAW / "parliament" / "52-602-01-19.docx"
ASOF = "2026-08-12"                       # the NAP letter is the newest of the documents
YEARS = ["2025", "2026", "2027", "2028"]  # the columns of the bill's Приложение № 2
SETS = {"until": ("2026-01-01", "2026-07-31"), "from": ("2026-08-01", "2026-12-31")}
NAP_ROWS = ["1.1.", "1.2.", "5.1.2.", "5.2.2.", "10.1.2.", "10.2.2."]
ASSUMPTION_ROWS = ["3", "10", "11.1", "11.3", "11.4", "11.5", "12", "13", "14", "16", "18", "19", "20.1", "20.2", "20.3"]
_CYR2LAT = str.maketrans({"А": "A", "В": "B", "Е": "E", "С": "C", "Н": "H", "К": "K", "М": "M", "О": "O", "Р": "P", "Т": "T", "Х": "X"})
MODELLED = {"1": ["employment", "management-contract"], "10": ["self-employed"]}   # NAP category -> scenarios built from it


# ------------------------------------------------------------------------------------------------ small helpers
def _tnum(s):
    """First number of a table cell: '5 за УПФ' -> 5.0, '10,58' -> 10.58, '0.4' -> 0.4, '' -> None."""
    m = re.match(r"\s*(-?\d+(?:[.,]\d+)?)", s or "")
    return float(m.group(1).replace(",", ".")) if m else None


def _pctcell(s):
    v = _tnum(s)
    return 0.0 if v is None else v        # a blank contribution cell = no contribution to that fund


def _clean(s):
    """Whitespace-normalised source text; fixes only the spacing typos '2 111,64 , ...' and '477, 04,'."""
    s = re.sub(r"\s+,", ",", L.ws(s))
    return re.sub(r"(\d), (\d{2})(?=[,;. ]|$)", r"\1,\2", s)


def _fix_name(s):
    """Activity names: the two annexes of the law differ by spelling typos only; use one spelling."""
    return re.sub(r"началник-\s*клиника", "началник клиника", L.ws(s).replace("Произовдство", "Производство"))


def _find_p(blocks, prefix, after=0):
    for i in range(after, len(blocks)):
        if blocks[i][0] == "p" and blocks[i][1].startswith(prefix):
            return i
    raise ValueError("rates: paragraph starting %r not found" % prefix)


def _para_range(blocks, start, stop):
    i = _find_p(blocks, start)
    j = _find_p(blocks, stop, i + 1)
    return [blocks[k][1] for k in range(i, j) if blocks[k][0] == "p"]


def _table_after(blocks, heading):
    """(title paragraph, table rows) of the annex whose heading paragraph starts with `heading`."""
    i = _find_p(blocks, heading)
    for j in range(i + 1, i + 6):
        if blocks[j][0] == "t":
            return blocks[i + 1][1] if blocks[i + 1][0] == "p" else "", blocks[j][1]
    raise ValueError("rates: no table after %r" % heading)


# ------------------------------------------------------------------------------------------------ NAP table
def _nap_rows():
    """Every numbered row of the NAP table: {'1.2.': {page, label, cells[15]}} (first occurrence wins)."""
    try:
        import fitz                      # PyMuPDF: build-time only, not needed to serve the site
    except ImportError as exc:
        raise RuntimeError("rates: PyMuPDF (fitz) is needed to read the NAP table; run with .venv-data/bin/python (tools/data/requirements.txt)") from exc
    rows = {}
    with fitz.open(str(NAP_PDF)) as doc:
        for pno, page in enumerate(doc, start=1):
            for tb in page.find_tables().tables:
                for cells in tb.extract():
                    cells = [L.ws(c) for c in cells]
                    m = re.match(r"(\d+(?:\.\d+)*\.)\s*(.*)", cells[0])
                    if m and len(cells) == 15 and m.group(1) not in rows:
                        rows[m.group(1)] = {"page": pno, "label": m.group(2), "cells": cells}
    return rows


def _funds(cells):
    """Columns 4-6 total, 8-10 insured person, 12-14 employer (each: ДОО, УПФ, ЗО), in % of the insurable income."""
    return {who: {"doo": _pctcell(cells[b]), "upf": _pctcell(cells[b + 1]), "health": _pctcell(cells[b + 2])}
            for who, b in (("total", 4), ("employee", 8), ("employer", 12))}


def _sum3(d):
    return rnd(d["doo"] + d["upf"] + d["health"], 2)


# ------------------------------------------------------------------------------------------------ the laws
def _law(doo, nzok):
    """Parameters and quotations from ЗБДОО art. 9, 14, 15(1) and ЗБНЗОК art. 2 (located by their text, never by position)."""
    art9 = _para_range(doo, "Чл. 9. ", "Чл. 10. ")
    head, tail = " ".join(art9).split(" 2. от 1 август до 31 декември", 1)

    def eur(part, label):
        m = re.search(label + r" – (\d[\d ]*(?:,\d+)?) евро", part)
        if not m:
            raise ValueError("rates: art. 9 has no %r amount" % label)
        return L.bgnum(m.group(1))
    own, top = "самоосигуряващите се лица", "максимален месечен размер на осигурителния доход"
    art14 = _para_range(doo, "Чл. 14. ", "Чл. 15. ")
    art15 = doo[_find_p(doo, "Чл. 15. (1)")][1]
    gvrs_ok = "не се внасят вноски за Фонд „Гарантирани вземания на работниците и служителите“" in art15
    art2 = nzok[_find_p(nzok, "Чл. 2. ")][1]
    m = re.search(r"е (\d+(?:,\d+)?) на сто", art2)
    if not (gvrs_ok and m):
        raise ValueError("rates: art. 15(1) of ЗБДОО or art. 2 of ЗБНЗОК does not read as expected")
    return {
        "minSelf": {"until": eur(head, own), "from": eur(tail, own)},
        "max": {"until": eur(head, top), "from": eur(tail, top)},
        "gvrsPct": 0.0, "healthPct": L.bgnum(m.group(1)),
        "quotes": {"zbdoo_art9": "\n".join(art9), "zbdoo_art14": "\n".join(art14), "zbdoo_art15": art15, "zbnzok_art2": art2},
    }


def _notes_after(blocks, heading, stop):
    """The paragraphs under 'Забележки:' of the annex whose heading starts with `heading` (up to the next annex)."""
    i = _find_p(blocks, heading)
    j = _find_p(blocks, "Забележки:", i + 1)
    k = _find_p(blocks, stop, j + 1)
    return [L.ws(blocks[x][1]) for x in range(j + 1, k) if blocks[x][0] == "p"]


def _min_income_tables(doo, fixes):
    """Приложения 1 and 1А merged: one row per activity with the 9 profession-group minimums before and after 01.08.2026.

    The annexes print КИД section letters that do not follow КИД-2008 in the last rows (e.g. "T, V"); they are compared between the two
    annexes but not republished."""
    _, t1 = _table_after(doo, "Приложение № 1 към чл. 9")
    _, t2 = _table_after(doo, "Приложение № 1А към чл. 9")
    if t1[0] != t2[0] or t1[1] != t2[1] or len(t1[0]) != 13:
        raise ValueError("rates: Приложения 1 and 1А have different headers")
    groups = [L.ws(c) for c in t1[0][4:]]
    rows = []
    for a, b in zip(t1[2:], t2[2:]):
        na, nb = _fix_name(a[3]), _fix_name(b[3])
        fixes[0] += (na != L.ws(a[3])) + (nb != L.ws(b[3]))
        sec = L.ws(a[1]).translate(_CYR2LAT)
        if not ((sec == "" or re.fullmatch(r"[A-V](, [A-V])*", sec)) and L.ws(a[1]).translate(_CYR2LAT) == L.ws(b[1]).translate(_CYR2LAT)
                and a[0] == b[0] and L.ws(a[2]) == L.ws(b[2]) and na == nb):
            raise ValueError("rates: Приложения 1 and 1А are not aligned at row %s" % a[0])
        vals = []
        for r in (a, b):
            v = [_tnum(c) for c in r[4:]]
            if any(c and v[i] is None for i, c in enumerate(r[4:])):
                raise ValueError("rates: non-numeric minimum insurable income in row %s" % a[0])
            vals.append(v)
        rows.append({"no": int(a[0]), "code": L.ws(a[2]), "name": na, "until": vals[0], "from": vals[1]})   # section letters are only compared
    if len(t1) != len(t2) or [r["no"] for r in rows] != list(range(1, len(rows) + 1)):
        raise ValueError("rates: Приложения 1 and 1А row numbering is not 1..n")
    n1 = _notes_after(doo, "Приложение № 1 към чл. 9", "Приложение № 1А към чл. 9")
    n2 = _notes_after(doo, "Приложение № 1А към чл. 9", "Приложение № 2 към чл. 14")
    same = lambda x: [L.ws(t).lower().replace("№ ", "№") for t in x]      # noqa: E731 - capitalisation / spacing only
    if same(n1) != same(n2):
        raise ValueError("rates: the notes under Приложения 1 and 1А differ")
    return groups, rows, n2


def _tzpb_tables(doo, fixes):
    """Приложения 2 and 2А merged by activity code (the two annexes list the same 87 codes in a different order)."""
    _, t1 = _table_after(doo, "Приложение № 2 към чл. 14")
    _, t2 = _table_after(doo, "Приложение № 2А към чл. 14")
    a = {L.ws(r[0]): r for r in t1[2:]}
    b = {L.ws(r[0]): r for r in t2[2:]}
    if len(a) != len(t1) - 2 or len(b) != len(t2) - 2 or set(a) != set(b):
        raise ValueError("rates: Приложения 2 and 2А do not list the same activity codes")
    acts = []
    for code in sorted(a):
        na, nb = _fix_name(a[code][1]), _fix_name(b[code][1])
        if na != nb:
            raise ValueError("rates: activity %s is named differently in Приложения 2 and 2А" % code)
        fixes[0] += (na != L.ws(a[code][1])) + (nb != L.ws(b[code][1]))
        acts.append({"code": code, "name": na, "until": _tnum(a[code][2]), "from": _tnum(b[code][2])})
    if any(x["until"] is None or x["from"] is None for x in acts):
        raise ValueError("rates: a ТЗПБ rate is missing")
    note_i = _find_p(doo, "Забележка:", _find_p(doo, "Приложение № 2 към чл. 14"))
    return acts, L.ws(doo[note_i + 1][1])


# ------------------------------------------------------------------------------------------------ ASBP Приложение № 2
def _bill_assumptions():
    """The bill's Приложение № 2 'Основни допускания' -> {no: {no, label, unit, years{2025..2028}, sub[]}} (text as printed)."""
    blocks = L.docx_blocks(str(BILL_DOCX))
    tabs = [v for k, v in blocks if k == "t" and v and len(v[0]) == 7 and L.ws(v[0][1]).upper() == "ОСНОВНИ ДОПУСКАНИЯ"]
    if len(tabs) != 1 or [L.ws(c) for c in tabs[0][0][3:]] != ["%s г." % y for y in YEARS]:
        raise ValueError("rates: the bill's Приложение № 2 was not found or has other year columns")
    items, cur = {}, None
    for r in tabs[0][2:]:
        if len(r) != 7:                       # the one row whose number is merged into its label (8.9): not used here
            cur = None
            continue
        no, label, unit, vals = L.ws(r[0]).rstrip("."), _clean(r[1]), _clean(r[2]), [_clean(c) for c in r[3:]]
        years = dict(zip(YEARS, vals))
        if no:
            cur = items[no] = {"no": no, "label": label, "unit": unit, "years": years, "sub": []}
        elif cur is None or label.rstrip(":") in ("в т.ч.", "в т.ч"):
            continue
        elif label.startswith("-"):
            cur["sub"].append({"label": label.lstrip("- ").strip(), "unit": unit, "years": years})
        elif not label and any(vals):         # a continuation line of the previous item
            for y in YEARS:
                if years[y]:
                    cur["years"][y] = (cur["years"][y] + " " + years[y]).strip()
    missing = [n for n in ASSUMPTION_ROWS if n not in items]
    if missing:
        raise ValueError("rates: Приложение № 2 has no row(s) %s" % ", ".join(missing))
    return items


def _eur_nums(text):
    return [L.bgnum(x) for x in re.findall(r"(\d+(?:,\d+)?) евро", text)]


def _bgtxt(v):
    """2111.64 -> '2111,64', 2300.0 -> '2300' (the way the bill prints it once spaces are removed)."""
    s = ("%.2f" % v).replace(".", ",")
    return s[:-3] if s.endswith(",00") else s


def _has(text, v):
    return _bgtxt(v) in re.sub(r"(?<=\d) (?=\d)", "", text)


def _ratio(text):
    m = re.fullmatch(r"(\d+):(\d+)", text.strip())
    if not m:
        raise ValueError("rates: %r is not a ratio" % text)
    a, b = int(m.group(1)), int(m.group(2))
    return a / (a + b), b / (a + b)           # (employer share, insured person's share)


def _derive_split(bill, year="2026"):
    """Employee / employer ДОО and health shares re-derived from the bill's rows 11.3, 11.5, 12 and 20.1-20.3."""
    yrs = lambda n: bill[n]["years"][year]                                   # noqa: E731
    er_s, ee_s = _ratio(yrs("20.1"))
    hr_s, he_s = _ratio(yrs("20.3"))
    pairs = re.findall(r"(\d+,\d+):(\d+,\d+)", yrs("20.2"))                    # [pre-1960, post-1959], employer:insured
    if len(pairs) != 2:
        raise ValueError("rates: bill row 20.2 does not hold two pension splits")
    shared = _tnum(yrs("11.3")) + _tnum(yrs("11.5"))                           # ОЗМ + безработица, split 60:40
    health = _tnum(yrs("12"))
    out = {}
    for key, (er, ee) in zip(("before1960", "after1959"), pairs):
        er, ee = L.bgnum(er), L.bgnum(ee)
        out[key] = {"employee": {"doo": rnd(ee + ee_s * shared, 2), "health": rnd(he_s * health, 2)},
                    "employer": {"doo": rnd(er + er_s * shared, 2), "health": rnd(hr_s * health, 2)}}
    return out


def _short(s, n=150):
    s = s.rstrip(":").strip()
    return s if len(s) <= n else s[:n].rsplit(" ", 1)[0].rstrip(",;") + "…"


def _chg(id_, label, unit, a, b, basis, source):
    out = {"id": id_, "label": label, "unit": unit, "until": a, "from": b, "delta": rnd(b - a, 2)}
    if a:
        out["deltaPct"] = pct(b - a, a, 2)
    out.update({"basis": basis, "source": source})
    return out


# ------------------------------------------------------------------------------------------------ cross-checks
def _checks(nap, f, law, bill, acts, derived):
    """Everything that must agree between the NAP letter, the two laws and the bill's assumptions; returns a list of problems."""
    bad = []

    def ok(cond, msg):
        if not cond:
            bad.append(msg)
    yrs = lambda n: bill[n]["years"]["2026"]                                    # noqa: E731
    # each NAP row adds up: total = insured person + employer, fund by fund
    for rid in NAP_ROWS:
        t, e, r = f[rid]["total"], f[rid]["employee"], f[rid]["employer"]
        for k in ("doo", "upf", "health"):
            ok(abs(t[k] - e[k] - r[k]) < 0.0051, "NAP row %s: %s total %s != %s + %s" % (rid, k, t[k], e[k], r[k]))
    # the totals equal the sum of the bill's fund rates (Приложение № 2: 11.1 + 11.3 + 11.5, 13, 12)
    pens_post = L.bgnum(re.search(r"(\d+,\d+) за родените след 31 декември 1959", yrs("11.1")).group(1))
    pens_pre = L.bgnum(re.search(r"(\d+,\d+) за родените преди 1 януари 1960", yrs("11.1")).group(1))
    ozm, unemp, upf, health = _tnum(yrs("11.3")), _tnum(yrs("11.5")), _tnum(yrs("13")), _tnum(yrs("12"))
    expect = {"1.2.": (pens_post + ozm + unemp, upf, health), "1.1.": (pens_pre + ozm + unemp, 0.0, health),
              "10.1.2.": (pens_post, upf, health), "10.2.2.": (pens_post + ozm, upf, health)}
    for rid, (d, u, h) in expect.items():
        t = f[rid]["total"]
        ok((rnd(d, 2), rnd(u, 2), rnd(h, 2)) == (t["doo"], t["upf"], t["health"]),
           "NAP row %s totals %s differ from the bill's Приложение № 2 (%s, %s, %s)" % (rid, t, d, u, h))
    ok(health == law["healthPct"], "health contribution: bill %s vs ЗБНЗОК %s" % (health, law["healthPct"]))
    ok(_tnum(yrs("16")) == law["gvrsPct"], "ГВРС: bill %s vs ЗБДОО %s" % (yrs("16"), law["gvrsPct"]))
    # the employee / employer split is reproduced from the bill's 60:40 and 8,22:6,58 rows
    for rid, key in (("1.2.", "after1959"), ("1.1.", "before1960")):
        for who in ("employee", "employer"):
            for fund in ("doo", "health"):
                ok(abs(f[rid][who][fund] - derived[key][who][fund]) < 0.0051,
                   "NAP row %s %s %s %s vs %s derived from the bill" % (rid, who, fund, f[rid][who][fund], derived[key][who][fund]))
    # insurable-income limits: NAP row texts, ЗБДОО art. 9 and the bill rows 18 and 19 say the same
    lim_max = [law["max"]["until"], law["max"]["from"]]
    lim_min = [law["minSelf"]["until"], law["minSelf"]["from"]]
    ok(_eur_nums(nap["1.2."]["cells"][2]) == lim_max, "NAP row 1.2: limits %s vs law %s" % (_eur_nums(nap["1.2."]["cells"][2]), lim_max))
    for rid in ("10.1.2.", "10.2.2."):
        ok(_eur_nums(nap[rid]["cells"][2]) == lim_min + lim_max, "NAP row %s: limits %s vs law" % (rid, _eur_nums(nap[rid]["cells"][2])))
    ok(all(_has(yrs("18"), v) for v in lim_max), "bill row 18 %r vs law %s" % (yrs("18"), lim_max))
    ok(all(_has(yrs("19"), v) for v in lim_min), "bill row 19 %r vs law %s" % (yrs("19"), lim_min))
    # ТЗПБ: the range of the activity tables is the range the bill quotes
    lo, hi = min(min(a["until"], a["from"]) for a in acts), max(max(a["until"], a["from"]) for a in acts)
    ok("от %s до %s" % (str(lo).replace(".", ","), str(hi).replace(".", ",")) in yrs("11.4"), "ТЗПБ range %s-%s vs bill %r" % (lo, hi, yrs("11.4")))
    ok(f["1.1."]["employee"]["upf"] == 0 and f["1.1."]["employer"]["upf"] == 0, "NAP row 1.1 should have no УПФ share")
    return bad


def _scenarios(ctx_nap, f, law, bill, tz, sets_max, sets_min):
    """The four calculator scenarios of S18 (see DATA_SPEC §3.13)."""
    tax = _tnum(bill["3"]["years"]["2026"])
    e12, e11 = f["1.2."], f["1.1."]
    wo_tzpb = _sum3(e12["employer"])
    page = lambda rid: ctx_nap[rid]["page"]                                      # noqa: E731
    split = lambda row: {"employee": dict(row["employee"]), "employer": dict(row["employer"])}   # noqa: E731
    same_totals = _sum3(e11["employee"]) == _sum3(e12["employee"]) and _sum3(e11["employer"]) == _sum3(e12["employer"])

    def employee_like(id_, label, rid, applies, basis):
        return {
            "id": id_, "label": label, "status": "real", "source": ["nap", "zbdoo", "zbnzok", "asbp"],
            "basis": basis, "appliesTo": applies,
            "employeePct": _sum3(e12["employee"]), "employerPct": rnd(wo_tzpb + tz["used"], 2), "employerPctWithoutTzpb": wo_tzpb,
            "split": split(e12), "tzpbPct": dict(tz), "gvrsPct": law["gvrsPct"], "maxInsurableIncomeEur": sets_max}
    emp = employee_like(
        "employment", "Трудов договор", "1.2.",
        "Лица на трудов договор, родени след 31.12.1959 г., които се осигуряват и в универсален пенсионен фонд (ред 1.2 от таблицата на НАП). "
        + ("За родените преди 1960 г. вноските са разпределени различно по фондове, но общата сума е същата. " if same_totals else "")
        + "Различни са ставките за първа и втора категория труд, за учителите, за държавните служители (от 01.08.2026 г. те внасят "
        "част от осигуровките), за военнослужещите и за другите категории от таблицата.",
        "НАП, Приложение № 1, ред 1.2 (с. %d); ЗБДОО чл. 9, 14, 15; ЗБНЗОК чл. 2; АСБП, Приложение № 2, ред 3" % page("1.2."))
    emp["incomeTaxPct"] = tax
    emp["variants"] = [{
        "id": "born-before-1960", "label": "Родени преди 1 януари 1960 г.", "nap": "1.1", "employeePct": _sum3(e11["employee"]),
        "employerPctWithoutTzpb": _sum3(e11["employer"]), "split": split(e11),
        "note": "Няма вноска за универсален пенсионен фонд; вноската за ДОО е по-голяма с размера на тази за УПФ."}]
    emp = {k: emp[k] for k in ("id", "label", "status", "source", "basis", "appliesTo", "employeePct", "employerPct",
                               "employerPctWithoutTzpb", "incomeTaxPct", "split", "tzpbPct", "gvrsPct", "maxInsurableIncomeEur", "variants")}
    mgmt = employee_like(
        "management-contract", "Договор за управление", "1.2.",
        "Управители и прокуристи на търговски дружества, членове на съвети на директорите, на управителни и надзорни съвети, контрольори, "
        "синдици и ликвидатори, лица по договори за управление на неперсонифицирани дружества и лица, на които е възложено управлението или "
        "контролът на държавни и общински предприятия (ред 1 от таблицата на НАП). Ставките са същите като при трудов договор; показани са "
        "тези за родените след 31.12.1959 г., осигурени и в УПФ.",
        "НАП, Приложение № 1, ред 1 и 1.2 (с. %d); ЗБДОО чл. 9, 14, 15; ЗБНЗОК чл. 2" % page("1.2."))
    mgmt["sameRatesAs"] = "employment"
    mgmt["pending"] = [{
        "field": "incomeTaxPct", "reason": "Как се облага доходът по договор за управление не е записано в източниците на проекта, затова данък не се изчислява.",
        "expected": "ЗДДФЛ (действаща редакция) или указания на НАП", "source": ["nap"]}]
    s1, s2 = f["10.1.2."], f["10.2.2."]
    zero = {"doo": 0.0, "upf": 0.0, "health": 0.0}
    selfe = {
        "id": "self-employed", "label": "Самоосигуряващ се", "status": "real", "source": ["nap", "zbdoo", "zbnzok"],
        "basis": "НАП, Приложение № 1, ред 10.1.2 и 10.2.2 (с. %d–%d); ЗБДОО чл. 9" % (page("10.1.2."), page("10.2.2.")),
        "appliesTo": "Еднолични търговци, собственици и съдружници в търговски дружества, лица със свободна професия или занаятчийска дейност по "
                     "регистрация, регистрирани земеделски стопани и тютюнопроизводители (ред 10 от таблицата на НАП), родени след 31.12.1959 г., "
                     "осигурени и в УПФ. Вноските са "
                     "върху избран месечен доход между минималния и максималния осигурителен доход.",
        "employeePct": _sum3(s1["employee"]), "employerPct": 0.0, "split": {"employee": dict(s1["employee"]), "employer": zero},
        "minInsurableIncomeEur": sets_min, "maxInsurableIncomeEur": sets_max,
        "variants": [{"id": "with-sickness-maternity", "label": "Осигурен и за общо заболяване и майчинство", "nap": "10.2",
                      "employeePct": _sum3(s2["employee"]), "split": {"employee": dict(s2["employee"]), "employer": zero}}],
        "pending": [{
            "field": "incomeTaxPct",
            "reason": "Основната ставка е 10%, а за стопанската дейност на едноличните търговци Приложение № 2 към АСБП посочва 15%. "
                      "Данъчната основа (признати разходи, годишна декларация) не е в източниците на проекта, затова данък не се изчислява.",
            "expected": "ЗДДФЛ (действаща редакция) и указания на НАП за облагането на самоосигуряващите се лица", "source": ["asbp"]}]}
    pens = {
        "id": "pensioner", "label": "Пенсионер", "status": "pending", "source": ["nap"],
        "reason": "В таблицата на НАП няма ред за пенсионери. Ставките при работа след пенсиониране не са в източниците на проекта и не се предполагат.",
        "expected": "Официален текст на КСО, ЗЗО и ЗДДФЛ или разяснение на НАП за осигуряването на работещите пенсионери"}
    return [emp, mgmt, selfe, pens]


# ------------------------------------------------------------------------------------------------ extra blocks
def _min_income_block(groups, rows, law, nap_notes):
    """Приложения 1 + 1А as one table (rows aligned with `groups`; null = the cell is empty in the law's text)."""
    pairs = [(r["until"][i], r["from"][i]) for r in rows for i in range(len(groups))]
    if any((a is None) != (b is None) for a, b in pairs):
        raise ValueError("rates: a minimum-income cell is empty in only one of Приложения 1 and 1А")
    filled = [(a, b) for a, b in pairs if a is not None]
    block = {
        "unit": "евро на месец", "groups": groups, "rows": rows,
        "selfEmployedEur": [{"id": k, "from": SETS[k][0], "to": SETS[k][1], "eur": law["minSelf"][k]} for k in ("until", "from")],
        "notes": nap_notes, "cells": len(pairs), "emptyCells": len(pairs) - len(filled),
        "basis": "ЗБДОО, Приложение № 1 (до 31.07.2026 г.) и Приложение № 1А (от 01.08.2026 г.) към чл. 9", "source": ["zbdoo"]}
    stats = {"cells": len(pairs), "filled": len(filled), "changed": sum(1 for a, b in filled if a != b),
             "untilMin": min(a for a, _ in filled), "untilMax": max(a for a, _ in filled),
             "fromMin": min(b for _, b in filled), "fromMax": max(b for _, b in filled)}
    return block, stats


def _changes(nap, f, law, acts, min_stats):
    csa, csb = f["5.1.2."], f["5.2.2."]
    out = [
        _chg("max-insurable", "Максимален месечен размер на осигурителния доход", "евро", law["max"]["until"], law["max"]["from"],
             "ЗБДОО чл. 9, т. 1 и т. 2", ["zbdoo"]),
        _chg("min-self-employed", "Минимален месечен размер на осигурителния доход на самоосигуряващите се лица", "евро",
             law["minSelf"]["until"], law["minSelf"]["from"], "ЗБДОО чл. 9, т. 1 и т. 2", ["zbdoo"]),
        {"id": "min-income-by-activity", "label": "Минимален осигурителен доход по икономически дейности и групи професии", "unit": "евро",
         "cells": min_stats["cells"], "filled": min_stats["filled"], "changed": min_stats["changed"],
         "untilMin": min_stats["untilMin"], "untilMax": min_stats["untilMax"], "fromMin": min_stats["fromMin"],
         "fromMax": min_stats["fromMax"], "basis": "ЗБДОО, Приложения № 1 и № 1А към чл. 9", "source": ["zbdoo"]}]
    changed = [a["code"] for a in acts if a["until"] != a["from"]]
    out.append({"id": "tzpb-by-activity", "label": "Вноска за фонд „Трудова злополука и професионална болест“ по икономически дейности",
                "unit": "%", "activities": len(acts), "changed": len(changed), "changedCodes": changed,
                "basis": "ЗБДОО, Приложения № 2 и № 2А към чл. 14", "source": ["zbdoo"]})
    page = nap["5.1.2."]["page"]
    out.append(_chg("civil-servant-employee-share", "Част от осигуровките, внасяна от самия държавен служител (категория 5 в таблицата на НАП)",
                    "% от осигурителния доход", _sum3(csa["employee"]), _sum3(csb["employee"]),
                    "НАП, Приложение № 1, ред 5.1.2 и 5.2.2 (с. %d)" % page, ["nap"]))
    out.append(_chg("civil-servant-employer-share", "Част от осигуровките, внасяна от работодателя за държавен служител (категория 5)",
                    "% от осигурителния доход", _sum3(csa["employer"]), _sum3(csb["employer"]),
                    "НАП, Приложение № 1, ред 5.1.2 и 5.2.2 (с. %d)" % page, ["nap"]))
    return out


def _tzpb_block(acts, tz, note):
    return {"unit": "% от осигурителния доход", "min": tz["min"], "max": tz["max"], "used": tz["used"],
            "usedWhy": "Ставката зависи от икономическата дейност на работодателя; калкулаторът използва най-ниската.",
            "activities": acts, "changed": sum(1 for a in acts if a["until"] != a["from"]), "note": note,
            "basis": "ЗБДОО, Приложение № 2 (до 31.07.2026 г.) и Приложение № 2А (от 01.08.2026 г.) към чл. 14", "source": ["zbdoo"]}


# ------------------------------------------------------------------------------------------------ build
def build_rates(ctx):
    for p in (NAP_PDF, DOO_HTML, NZOK_HTML, BILL_DOCX):
        if not p.exists():
            raise FileNotFoundError("rates: input %s is missing" % p)
    nap = _nap_rows()
    need = NAP_ROWS + ["%d." % k for k in range(1, 20)]
    if [r for r in need if r not in nap]:
        raise ValueError("rates: the NAP table has no row(s) %s" % ", ".join(r for r in need if r not in nap))
    doo, nzok = L.dv_blocks(str(DOO_HTML)), L.dv_blocks(str(NZOK_HTML))
    law = _law(doo, nzok)
    fixes = [0]
    groups, minrows, minnotes = _min_income_tables(doo, fixes)
    acts, tz_note = _tzpb_tables(doo, fixes)
    bill = _bill_assumptions()
    f = {rid: _funds(nap[rid]["cells"]) for rid in NAP_ROWS}
    derived = _derive_split(bill)
    bad = _checks(nap, f, law, bill, acts, derived)
    if (len(minrows), len(acts), len(groups)) != (86, 87, 9):
        bad.append("rates: annex sizes %s are not 86 rows x 9 groups and 87 activities" % ((len(minrows), len(acts), len(groups)),))
    if len(bill["3"]["sub"]) != 1 or not bill["3"]["sub"][0]["label"].startswith("Данъчна ставка за данъка върху доходите от стопанска дейност"):
        bad.append("rates: bill row 3 has no single 'стопанска дейност' sub-row")
    for rid in ("5.1.2.", "5.2.2."):
        if f[rid]["total"] != f["1.2."]["total"]:
            bad.append("NAP row %s totals differ from row 1.2" % rid)
    if bad:
        raise ValueError("rates: cross-check failed:\n  " + "\n  ".join(bad))

    mk = lambda d: [{"id": k, "from": SETS[k][0], "to": SETS[k][1], "eur": d[k]} for k in ("until", "from")]     # noqa: E731
    sets_max, sets_min = mk(law["max"]), mk(law["minSelf"])
    lo = min(min(a["until"], a["from"]) for a in acts)
    hi = max(max(a["until"], a["from"]) for a in acts)
    tz = {"min": lo, "max": hi, "used": lo}
    scen = _scenarios(nap, f, law, bill, tz, sets_max, sets_min)
    mini, mstats = _min_income_block(groups, minrows, law, minnotes)
    cats = [{"no": k, "label": _short(nap["%d." % k]["label"]), "page": nap["%d." % k]["page"],
             "modelledBy": MODELLED.get(str(k), [])} for k in range(1, 20)]
    sole = {y: _tnum(bill["3"]["sub"][0]["years"][y]) for y in YEARS}
    income_tax = {"ratePct": _tnum(bill["3"]["years"]["2026"]), "years": {y: _tnum(bill["3"]["years"][y]) for y in YEARS},
                  "soleTraderBusinessPct": sole, "basis": "АСБП, Приложение № 2 „Основни допускания“, ред 3", "source": ["asbp"],
                  "note": "Основната ставка е 10%. Приложението посочва отделно 15% за доходите от стопанска дейност на едноличните търговци; "
                          "тази ставка не се използва в калкулатора."}
    notes = [
        "Таблицата на НАП има 19 категории осигурени лица и %d номерирани реда. Моделирани са категория 1 (трудов договор и договор за "
        "управление) и категория 10 (самоосигуряващи се); останалите са изброени в „napCategories“ и не се изчисляват." % len(nap),
        "Вноската за фонд „Трудова злополука и професионална болест“ зависи от икономическата дейност на работодателя (от %s до %s%%); "
        "по подразбиране се използва най-ниската." % (str(lo).replace(".", ","), str(hi).replace(".", ",")),
        "Ставките са сверени автоматично: сборът по фондове от таблицата на НАП съвпада с Приложение № 2 към АСБП (общо и между осигурител "
        "и осигурено лице), а границите на осигурителния доход съвпадат със ЗБДОО и с Приложение № 2.",
        "Данъкът върху дохода се изчислява само за трудов договор. За договор за управление и за самоосигуряващите се данъчната основа не е "
        "в източниците на проекта, затова данъкът е отбелязан като предстоящ.",
        "За 2027 и 2028 г. Приложение № 2 запазва максимален осигурителен доход 2 300 евро; минималният доход на самоосигуряващите се е „на "
        "равнището на МРЗ, съгласно нов механизъм“ и размерът му още не е определен.",
        "В двойките приложения към ЗБДОО (1 и 1А, 2 и 2А) имената на някои дейности са изписани различно; %d правописни разлики са "
        "уеднаквени, без да се променя смисълът." % fixes[0],
        "%d от %d клетки в Приложения № 1 и № 1А са празни в текста на закона; в данните те са null (няма стойност)."
        % (mini["emptyCells"], mini["cells"])]
    meta_ = meta("D17", "Данъци и осигуровки: ставки за 2026 г.", "real", ["nap", "zbdoo", "zbnzok", "asbp"],
                 "Ставките и разпределението им са от таблицата на НАП (изх. ВК-30-10237 от 12.08.2026 г.), сверени със ЗБДОО и ЗБНЗОК за 2026 г. "
                 "и с Приложение № 2 към АСБП. Сценарият „Пенсионер“ и данъкът при самоосигуряване и договор за управление предстоят.",
                 ASOF, unit="%", pending=[])
    checks = {"napRowsAddUp": True, "napTotalsVsBill": True, "napSplitVsBill": True, "limitsVsLawAndBill": True, "tzpbRangeVsBill": True,
              "annexesAligned": True, "annexRows": len(minrows), "activities": len(acts), "nameFixes": fixes[0]}
    out = {"meta": meta_, "scenarios": scen, "rules": {"validTo": SETS["until"][1], "from": SETS["from"][0], "year": 2026},
           "incomeTax": income_tax, "tzpb": _tzpb_block(acts, tz, tz_note), "minInsurableIncome": mini,
           "changes": _changes(nap, f, law, acts, mstats), "napCategories": cats,
           "assumptions": [bill[n] for n in ASSUMPTION_ROWS], "quotes": law["quotes"], "notes": notes, "checks": checks}
    ctx.put("rates.json", out)
    ctx.notes.append("rates.json: 4 scenarios (3 real, pensioner pending), %d NAP rows read, %d activities, %d name fixes"
                     % (len(nap), len(acts), fixes[0]))
