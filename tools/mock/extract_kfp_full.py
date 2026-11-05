#!/usr/bin/env python3
"""D06 + D16 + D26: full extraction of the monthly KFP reports since January 2024 -> site/data/execution.json.

Source files: prototype/data/raw/kfp_<year>/*.xls from 2024 on, sheet "стартова" (cumulative since 1 January). Every year but the
last must hold all 12 reports; the last one holds months 1..n, n being the newest report (no month count is written in the code).
Layout is identical in all files (54 rows); every expected row label is verified before a number is read.
Columns: B = к.2 (КФП) = C = к.3 (национален бюджет) + D = к.4 (европейски средства).

* 2024 and 2025 reports are in млн. лв.; every number is converted to млн. € (divided by 1.95583, rounded to 3 decimals AFTER dividing).
* 2026 reports are in млн. € and only rounded to 3 decimals.
* Identities are checked on the ORIGINAL numbers (rounded to 6 decimals) with the exact rounding bound (n+1)*0.5e-6, and on the
  converted numbers with the rounding bound of the conversion.  Any violation is an error (exit code 1, nothing is written), except the two
  source-internal differences of the 2024 files listed in KNOWN_SOURCE_DIFFS (reported as warnings, bounded).

Run:  .venv-data/bin/python tools/mock/extract_kfp_full.py     (needs xlrd; reads only prototype/ and writes only site/data/; raw files: docs/data-sources.md)
"""
import calendar
import glob
import os
import re
import sys
from decimal import ROUND_HALF_UP, Decimal

import xlrd

import asbp
import exec_contract
from dlib import (DATA, EUR, RAW, SRC, BUILD_DATE, Problems, jload, meta, pct, rnd, say, sha256_file, to_eur,
                  write_data)

SHEET = "стартова"
COLS = [("kfp", 1, "к.2", "Консолидирана фискална програма"),
        ("nat", 2, "к.3", "Национален бюджет"),
        ("eu", 3, "к.4", "Европейски средства")]

# (sheet row, id, label fragment verified in column A, level, parent, group, my short label)
ROWS = [
    (11, "rev", "Приходи, помощи и дарения", 0, None, "revenue", "Приходи"),
    (12, "rev.tax", "Данъчни приходи", 1, "rev", "revenue", "Данъчни приходи"),
    (13, "rev.nontax", "Неданъчни приходи", 1, "rev", "revenue", "Неданъчни приходи"),
    (14, "rev.grants", "Помощи", 1, "rev", "revenue", "Помощи"),
    (16, "exp", "Разходи", 0, None, "expenditure", "Разходи (без вноската в ЕС)"),
    (17, "exp.personnel", "Персонал", 1, "exp", "expenditure", "Персонал"),
    (19, "exp.maint", "Издръжка", 1, "exp", "expenditure", "Издръжка"),
    (20, "exp.interest", "Лихви", 1, "exp", "expenditure", "Лихви"),
    (21, "exp.interest.ext", "Лихви по външни заеми", 2, "exp.interest", "expenditure", "Външни лихви"),
    (22, "exp.interest.dom", "Лихви по вътрешни заеми", 2, "exp.interest", "expenditure", "Вътрешни лихви"),
    (23, "exp.social", "Социални разходи, стипендии", 1, "exp", "expenditure", "Социални разходи и стипендии"),
    (24, "exp.subsidies", "Субсидии", 1, "exp", "expenditure", "Субсидии"),
    (25, "exp.abroad", "Предоставени текущи и капиталови трансфери за чужбина", 1, "exp", "expenditure", "Трансфери за чужбина"),
    (26, "exp.capex", "Капиталови разходи", 1, "exp", "expenditure", "Капиталови разходи"),
    (27, "exp.reserve", "Прираст на държавния резерв", 1, "exp", "expenditure", "Държавен резерв"),
    (28, "transfers", "Трансфери-нето", 0, None, "transfers", "Трансфери (нето)"),
    (29, "transfers.cb", "Трансфери (субсидии/вноски,временни заеми) от/за ЦБ", 1, "transfers", "transfers", "Трансфери от/за ЦБ"),
    (30, "transfers.other", "Други трансфери и временни безлихвени заеми", 1, "transfers", "transfers", "Други трансфери"),
    (31, "transfers.revshare", "Трансфери за отчислени приходи", 1, "transfers", "transfers", "Отчислени приходи"),
    (32, "eucontrib", "Вноска в общия бюджет на ЕС", 0, None, "expenditure", "Вноска в бюджета на ЕС"),
    (33, "balance", "Бюджетно салдо", 0, None, "balance", "Бюджетно салдо"),
    (35, "fin", "Финансиране", 0, None, "financing", "Финансиране"),
    (36, "fin.ext", "Външно финансиране - нето", 1, "fin", "financing", "Външно финансиране"),
    (37, "fin.ext.markets", "Заеми и дълг, поет на межд. капит. пазари", 2, "fin.ext", "financing", "Заеми от международните пазари"),
    (38, "fin.ext.repay", "Погашения по предоставени кредити на др. държави", 2, "fin.ext", "financing", "Погашения по кредити на други държави"),
    (39, "fin.ext.securities", "Операции с ценни книжа и финансови активи", 2, "fin.ext", "financing", "Ценни книжа и финансови активи"),
    (40, "fin.ext.deposits", "Депозити (нето) в чужбина", 2, "fin.ext", "financing", "Депозити в чужбина"),
    (41, "fin.dom", "Вътрешно финансиране - нето", 1, "fin", "financing", "Вътрешно финансиране"),
    (45, "fin.dom.advances", "Авансови плащания от националния бюджет за сметка на ЕС", 2, "fin.dom", "financing", "Авансови плащания за сметка на ЕС"),
    (46, "fin.dom.refunds", "Възстановени суми от ЕС", 2, "fin.dom", "financing", "Възстановени суми от ЕС"),
    (48, "fin.priv", "и възмездни  средства - нето", 1, "fin", "financing", "Приватизация и възмездни средства"),
    (49, "fin.priv.shares", "приватизация на дялове, акции и участия", 2, "fin.priv", "financing", "Приватизация на дялове и акции"),
]
# sheet rows that are blank in ALL reports (dropped, verified at run time): 15, 18, 42, 43, 44, 47
BLANK_ROWS = [15, 18, 42, 43, 44, 47]
# computed row: Разходи с вноската в ЕС
EXP_TOTAL = {"id": "exp.total", "label": "Разходи (с вноската в ЕС)", "short": "Разходи с вноската в ЕС", "level": 0,
             "group": "expenditure", "computed": "exp+eucontrib"}

LABEL_CLEAN_PREFIX = re.compile(r"^\s*(?:I|II|III|IV|V|VI|І|ІІ|ІІІ)\.\s+")        # Latin and Cyrillic roman numerals
FOOTNOTE_SUFFIX = re.compile(r"\s+\d\s*$")

# identities: parent = sum(children), checked for each of the three columns (original numbers).
SUM_IDENTITIES = {
    "rev": ["rev.tax", "rev.nontax", "rev.grants"],
    "exp": ["exp.personnel", "exp.maint", "exp.interest", "exp.social", "exp.subsidies", "exp.abroad", "exp.capex",
            "exp.reserve"],
    "exp.interest": ["exp.interest.ext", "exp.interest.dom"],
    "transfers": ["transfers.cb", "transfers.other", "transfers.revshare"],
    "fin.ext": ["fin.ext.markets", "fin.ext.repay", "fin.ext.securities", "fin.ext.deposits"],
    "fin": ["fin.ext", "fin.dom", "fin.priv"],
}

MIN_BASE_FOR_YOY = 50.0          # млн. €: below this base a year-on-year % is not published
FIN_BALANCE_TOL = 0.005          # млн. (original units): fin vs -balance differ by <= 0.0019 in the 2025/2026 reports
# the series starts with the January 2024 report; file name month = month in the title, months 1..n per year
FIRST_YEAR = 2024
# the builders and validators still read data["2026"], the 2026 plan and kfpMonths2026 (bd_feed, bd_core, vd_catalog):
# a 2027 report stops here until they are generalised
LAST_YEAR = 2026
# the Ministry names the file „…-EU_funds_MMYY_BG_WEB.xls“; the September 2026 report came as „EU funds“, with a space
FILE_RE = re.compile(r"EU[ _]funds_(\d{2})(\d{2})_")
# source-internal differences of single reports (original units, млн. лв.): checked against the stated bound, reported as a
# warning instead of an error.  Nothing is corrected: the numbers are published as the Ministry printed them.
KNOWN_SOURCE_DIFFS = {
    # May 2024: „Финансиране“ (row 35) and „Бюджетно салдо“ (row 33) differ by 0.010047 млн. лв. in к.2 and к.3 (к.4 agrees)
    ("fin=-balance", 2024, 5): 0.0101,
    # November 2024: the control row 34 (balance + financing) is 0.000035 млн. лв. in к.2 and к.3 instead of 0
    ("row34", 2024, 11): 0.00004,
}
# reference headline of the latest reports (KFP, млн. €, 1 decimal): rev, exp.total, balance
# September 2026: the MF release of 02.11.2026, https://www.minfin.bg/bg/news/13559
REFERENCE = {(2026, 7): (26347.4, 28548.8, -2201.4), (2026, 8): (30117.8, 33193.2, -3075.5),
             (2026, 9): (33898.5, 37567.6, -3669.2)}

HEADLINE = ["rev", "exp.total", "balance"]
# rows for which the "pace" block (share of the year's final cumulative) is published
PACE_ROWS = ["rev", "rev.tax", "rev.nontax", "rev.grants", "exp.total", "exp", "exp.personnel", "exp.maint",
             "exp.interest", "exp.social", "exp.subsidies", "exp.capex", "eucontrib"]
LATEST_ROWS = ["rev", "rev.tax", "rev.nontax", "rev.grants", "exp.total", "exp", "exp.personnel", "exp.maint",
               "exp.interest", "exp.social", "exp.subsidies", "exp.abroad", "exp.capex", "exp.reserve", "eucontrib",
               "balance", "fin", "fin.ext.markets"]

MONTH_RE = re.compile(r"КЪМ\s+(\d{2})\.(\d{2})\.(\d{4})\s+ГОДИНА")


def known_bound(kind, rep):
    return KNOWN_SOURCE_DIFFS.get((kind, rep["year"], rep["month"]))


def norm(s):
    return re.sub(r"\s+", " ", str(s).replace("\xa0", " ")).strip().lower()


def clean_label(raw):
    s = re.sub(r"\s+", " ", str(raw).replace("\xa0", " ")).strip()
    s = LABEL_CLEAN_PREFIX.sub("", s)
    s = FOOTNOTE_SUFFIX.sub("", s)
    return s


def list_reports():
    files = []
    for d in sorted(glob.glob(str(RAW / "kfp_[0-9][0-9][0-9][0-9]"))):
        if int(os.path.basename(d)[4:]) >= FIRST_YEAR:
            files += sorted(glob.glob(os.path.join(d, "*.xls")))
    return files


def parse_report(path):
    """Parse one report. Returns {'year','month','asOf','unit','values':{id:{col:float|None}}, 'labels':{id:str}, 'blank':[rows]}.

    Values are the ORIGINAL numbers rounded to 6 decimals (the xls holds float noise like 3e-13); blank cells are None.
    Raises ValueError when the layout deviates from the one all files share.
    """
    sh = xlrd.open_workbook(path).sheet_by_name(SHEET)
    if sh.nrows != 54 or sh.ncols != 4:
        raise ValueError("%s: unexpected sheet size %dx%d" % (os.path.basename(path), sh.nrows, sh.ncols))
    m = MONTH_RE.search(str(sh.cell_value(2, 0)))
    if not m:
        raise ValueError("%s: no 'КЪМ dd.mm.yyyy ГОДИНА' in row 3" % os.path.basename(path))
    day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    unit_text = norm(sh.cell_value(3, 3))
    unit = "BGN" if "млн.лв" in unit_text else ("EUR" if "млн.евро" in unit_text else None)
    if unit is None:
        raise ValueError("%s: unknown unit %r" % (os.path.basename(path), unit_text))
    out = {"year": year, "month": month, "asOf": "%04d-%02d-%02d" % (year, month, day), "unit": unit, "values": {},
           "labels": {}, "blank": [], "path": path}
    expected_unit = "BGN" if year <= 2025 else "EUR"
    if unit != expected_unit:
        raise ValueError("%s: unit %s, expected %s" % (os.path.basename(path), unit, expected_unit))
    for row, rid, frag, _lvl, _parent, _grp, _short in ROWS:
        a = sh.cell_value(row - 1, 0)
        if norm(frag) not in norm(a):
            raise ValueError("%s row %d: label %r does not contain %r" % (os.path.basename(path), row, a, frag))
        out["labels"][rid] = clean_label(a)
        out["values"][rid] = {}
        for col, ci, _kc, _kl in COLS:
            v = sh.cell_value(row - 1, ci)
            if isinstance(v, float):
                v = round(v, 6)
                if v == 0:
                    v = 0.0
                out["values"][rid][col] = v
            elif v == "":
                out["values"][rid][col] = None
            else:
                raise ValueError("%s row %d col %d: not a number: %r" % (os.path.basename(path), row, ci, v))
    # row 47 + 48 label: "Приватизация, придобиване на дялове и акции, и възмездни средства - нето"
    a47, a48 = norm(sh.cell_value(46, 0)), norm(sh.cell_value(47, 0))
    if not a47.startswith("приватизация") or "възмездни" not in a48:
        raise ValueError("%s rows 47-48: unexpected labels" % os.path.basename(path))
    out["labels"]["fin.priv"] = "Приватизация, придобиване на дялове и акции, и възмездни средства - нето"
    for row in BLANK_ROWS:
        for ci in (1, 2, 3):
            if sh.cell_value(row - 1, ci) != "":
                out["blank"].append((row, ci))
    # row 34 is the control row (balance + financing): numbers or blank, tiny
    ctl = []
    for ci in (1, 2, 3):
        v = sh.cell_value(33, ci)
        ctl.append(round(v, 6) if isinstance(v, float) else 0.0)
    out["control34"] = ctl
    return out


def nz(x):
    return 0.0 if x is None else x


def check_report(rep, prob, stats):
    """Identity checks on the ORIGINAL numbers (6-decimal rounding bound)."""
    fn = "%d-%02d" % (rep["year"], rep["month"])
    vals = rep["values"]
    if rep["blank"]:
        prob.error("%s: rows expected blank hold numbers: %s" % (fn, rep["blank"]))
    for parent, kids in SUM_IDENTITIES.items():
        bound = (len(kids) + 1) * 0.5e-6 + 1e-9
        for col, _ci, _kc, _kl in COLS:
            pv = vals[parent][col]
            if pv is None:
                prob.error("%s: %s/%s is blank" % (fn, parent, col))
                continue
            s = sum(nz(vals[k][col]) for k in kids)
            dev = abs(pv - s)
            stats.setdefault(parent, 0.0)
            stats[parent] = max(stats[parent], dev)
            if dev > bound:
                prob.error("%s: %s=%.6f != sum(%s)=%.6f in col %s (dev %.6f)" % (fn, parent, pv, ",".join(kids), s, col, dev))
    for col, _ci, _kc, _kl in COLS:
        # balance = rev - exp + transfers - eucontrib
        bal = vals["rev"][col] - vals["exp"][col] + vals["transfers"][col] - vals["eucontrib"][col]
        dev = abs(bal - vals["balance"][col])
        stats["balance"] = max(stats.get("balance", 0.0), dev)
        if dev > 5 * 0.5e-6 + 1e-9:
            prob.error("%s: balance %.6f != rev-exp+transfers-eucontrib %.6f (col %s)" % (fn, vals["balance"][col], bal, col))
        # fin = -balance: the source computes both rows separately; they differ by up to ~0.002 млн. (source rounding)
        dev = abs(vals["fin"][col] + vals["balance"][col])
        known = known_bound("fin=-balance", rep)
        if dev > FIN_BALANCE_TOL and known is not None and dev <= known:
            prob.warn("%s: fin %.6f != -balance %.6f (col %s, dev %.6f): known difference in the source file"
                      % (fn, vals["fin"][col], -vals["balance"][col], col, dev))
        else:
            stats["fin=-balance"] = max(stats.get("fin=-balance", 0.0), dev)
            if dev > FIN_BALANCE_TOL:
                prob.error("%s: fin %.6f != -balance %.6f (col %s)" % (fn, vals["fin"][col], -vals["balance"][col], col))
    # к.2 = к.3 + к.4 for every row that has numbers
    for rid, cv in vals.items():
        k, n, e = cv["kfp"], cv["nat"], cv["eu"]
        if k is None or n is None or e is None:
            prob.error("%s: %s has a blank cell %s" % (fn, rid, cv))
            continue
        dev = abs(k - (n + e))
        stats["к.2=к.3+к.4"] = max(stats.get("к.2=к.3+к.4", 0.0), dev)
        if dev > 2 * 0.5e-6 + 1e-9:
            prob.error("%s: %s к.2 %.6f != к.3+к.4 %.6f" % (fn, rid, k, n + e))
    known = known_bound("row34", rep)
    if known is not None and max(abs(v) for v in rep["control34"]) > 1e-5:
        if max(abs(v) for v in rep["control34"]) <= known:
            prob.warn("%s: control row 34 = %s: known difference in the source file" % (fn, rep["control34"]))
        else:
            prob.error("%s: control row 34 = %s exceeds the known bound %s" % (fn, rep["control34"], known))
        return
    for v in rep["control34"]:
        stats["row34"] = max(stats.get("row34", 0.0), abs(v))
        if abs(v) > 1e-5:
            prob.error("%s: control row 34 = %s" % (fn, rep["control34"]))


D_EUR = Decimal("1.95583")
D_PLACES = Decimal("0.001")
D_TENTH = Decimal("0.1")


def dec(x):
    """the decimal a float of this extractor stands for (its repr: the numbers are read to 6 places and rounded to 3)"""
    return Decimal(repr(x))


def convert(v, unit):
    """Original number -> млн. € rounded to 3 decimals, in decimal arithmetic (BGN is divided by 1.95583 first). The float returned holds
    exactly that decimal (exec_contract.money() writes it); on the 3168 numbers of the 33 reports it equals the earlier float division."""
    d = dec(v) / D_EUR if unit == "BGN" else dec(v)
    r = float(d.quantize(D_PLACES, rounding=ROUND_HALF_UP))
    return 0.0 if r == 0 else r


def tenth(x):
    """a 3-place value -> 1 place, half away from zero (as Excel and the MF releases round), in decimal arithmetic"""
    r = float(dec(x).quantize(D_TENTH, rounding=ROUND_HALF_UP))
    return 0.0 if r == 0 else r


PLAN_ANNEX = {"rev": "r.total", "rev.tax": "r.tax", "rev.nontax": "r.nontax", "rev.grants": "r.grants", "exp": "x.exp",
              "exp.personnel": "x.personnel", "exp.maint": "x.maint", "exp.interest": "x.interest", "exp.interest.ext": "x.interest.ext",
              "exp.interest.dom": "x.interest.dom", "exp.social": ("x.social", "x.scholarships"), "exp.subsidies": "x.subsidies",
              "exp.abroad": "x.abroad", "exp.capex": "x.capex", "exp.reserve": "x.reserve", "exp.contingency": "x.contingency",
              "eucontrib": "x.eucontrib", "exp.total": "x.total", "balance": "x.balance", "fin": "x.fin"}
PLAN_COMPONENTS = {"nat": "national", "eu": "eu"}
PLAN_COMPONENT_KEYS = {"rev": "rev", "exp.total": "exp_incl_eu_contribution", "balance": "balance",
                       "transfers": {"nat": "transfer_to_eu_accounts_net", "eu": "transfer_from_state_budget_net"}}


def provenance(by_year, rows_out, plan2026, a3, as_of):
    """execution-provenance.json: a compact index from every number of execution.json to its place in the original (spec, section 6.2).
    A record `data/2026-09/kfp/rev` is the original of 2026-09, sheet „стартова“, column of kfp, row of rev."""
    originals = {}
    for year, lst in sorted(by_year.items()):
        for rep, f in lst:
            originals["%04d-%02d" % (year, rep["month"])] = {"source": "kfp", "file": os.path.basename(f), "sha256": sha256_file(f),
                                                             "asOf": rep["asOf"], "unit": rep["unit"]}
    tables = jload(RAW / "asbp" / "asbp_tables.json")
    annex_rows = dict(zip([s[0] for s in asbp.REVENUE + asbp.EXPENDITURE], asbp._content_rows(tables["tables"]["annex3_mln"])))
    pdf = {"source": "asbp", "file": tables["source"]["file"], "sha256": tables["source"]["sha256"],
           "table": tables["tables"]["annex3_mln"]["title"], "column": tables["tables"]["annex3_mln"]["columns"][2]}

    def annex(key):
        r = annex_rows[key]
        return {"page": r["page"], "row": r["label"].strip(), "y": r["y"]}

    plan = {"kfp": {}}
    for rid in plan2026["kfp"]:
        keys = PLAN_ANNEX[rid]
        plan["kfp"][rid] = ({"cells": [annex(k) for k in keys], "rule": "the sum of the rows, rounded to 1 place"} if isinstance(keys, tuple)
                            else annex(keys))
    for col, part in PLAN_COMPONENTS.items():
        plan[col] = {}
        for rid in plan2026[col]:
            k = PLAN_COMPONENT_KEYS[rid]
            plan[col][rid] = {"path": "national_vs_eu_2026.plan.%s.%s" % (part, k[col] if isinstance(k, dict) else k)}
    return {
        "meta": meta("execution-provenance", "Произход на числата в execution.json", "real", ["kfp", "asbp"],
                     "клетката в оригиналния отчет на МФ за всяко число на месечното изпълнение и страницата на Приложение 3 за плана",
                     as_of),
        "schema": "provenance/1",
        "dataset": "execution",
        "record": "<block>/<ГГГГ-ММ>/<колона>/<ред>, например data/2026-09/kfp/rev: оригиналът на 2026-09, лист „%s“, клетка B11" % SHEET,
        "sheet": SHEET,
        "columns": {col: "ABCDEFGH"[ci] for col, ci, _kc, _kl in COLS},
        "rows": {r["id"]: r["row"] for r in rows_out if "row" in r},
        "computed": {"exp.total": {"from": ["exp", "eucontrib"],
                                   "rule": "exp + eucontrib of the same report, added on the original numbers, then converted"}},
        "rules": {
            "data": "the cell of the original of the month; 2024 and 2025: млн. лв. ÷ 1.95583, rounded to 3 places (contract.conversion)",
            "monthly": "data(m) − data(m − 1) of the same year, column and row; January = data(1)",
            "latest": "cum and prevYearCum: data of the latest month of this and the previous year, rounded to 1 place; plan: plan2026",
            "pace": "data(m) ÷ data(12) of the same year × 100",
            "reconcile": "data(12) of 2024 and 2025 against the columns 2024 Отчет and 2025 Предв. отчет of Приложение 3",
        },
        "originals": originals,
        "plan2026": {"kfp": dict(pdf, rows=plan["kfp"]),
                     "nat": {"source": "prototype/src/kfp_components_2026.json", "rows": plan["nat"],
                             "note": "made by tools/prototype/build_src.py from the motives (Табл. II-3/II-4); see sources/registry.yaml"},
                     "eu": {"source": "prototype/src/kfp_components_2026.json", "rows": plan["eu"],
                            "note": "made by tools/prototype/build_src.py from the motives (Табл. II-3/II-4); see sources/registry.yaml"}},
    }


def build():
    prob = Problems("extract_kfp_full")
    files = list_reports()
    if not files:
        prob.error("no reports in prototype/data/raw/kfp_*/ (raw files, not in the repository: docs/data-sources.md)")
        prob.finish()
    reports = [parse_report(f) for f in files]
    reports.sort(key=lambda r: (r["year"], r["month"]))
    stats = {}
    for rep in reports:
        check_report(rep, prob, stats)
    # the month in the file name (…_MMYY_…) must match the as-of date inside the sheet
    by_year = {}
    for rep in reports:
        f = rep["path"]
        m = FILE_RE.search(os.path.basename(f))
        if not m or (int(m.group(1)), 2000 + int(m.group(2))) != (rep["month"], rep["year"]):
            prob.error("%s: file name does not match the as-of date %s" % (os.path.basename(f), rep["asOf"]))
        by_year.setdefault(rep["year"], []).append((rep, f))
    years = sorted(by_year)
    if years != list(range(FIRST_YEAR, FIRST_YEAR + len(years))):
        prob.error("years %s are not consecutive from %d" % (years, FIRST_YEAR))
    if years and years[-1] > LAST_YEAR:
        prob.error("reports for %d: the builders read only up to %d (see LAST_YEAR); generalise them before adding the next year"
                   % (years[-1], LAST_YEAR))
    for y, lst in by_year.items():
        months = [r["month"] for r, _ in lst]
        if months != list(range(1, len(months) + 1)):
            prob.error("year %d: months %s are not 1..n" % (y, months))
        if y != years[-1] and len(months) != 12:
            prob.error("year %d: %d reports, expected 12 (only the last year may be incomplete)" % (y, len(months)))
        for r, _f in lst:
            if r["asOf"] != "%04d-%02d-%02d" % (y, r["month"], calendar.monthrange(y, r["month"])[1]):
                prob.error("%s: the title date %s is not the last day of the month" % (os.path.basename(_f), r["asOf"]))
    say("identities: max deviation on original numbers (млн.) " + ", ".join("%s=%.6f" % (k, v) for k, v in sorted(stats.items())))

    ids = [r[1] for r in ROWS]
    rows_out = []
    for row, rid, _frag, lvl, parent, grp, short in ROWS:
        label = reports[-1]["labels"][rid]
        d = {"id": rid, "label": label, "short": short, "row": row, "level": lvl}
        if parent:
            d["parent"] = parent
        d["group"] = grp
        rows_out.append(d)
    # insert the computed row after eucontrib
    pos = [r["id"] for r in rows_out].index("eucontrib") + 1
    rows_out.insert(pos, dict(EXP_TOTAL))

    data = {}
    all_series = {}          # year -> col -> id -> list (млн. €)
    for year, lst in sorted(by_year.items()):
        n = len(lst)
        unit = lst[0][0]["unit"]
        block = {"months": n, "currency": unit}
        if unit == "BGN":
            block["converted"] = "÷%s" % ("%g" % EUR)
        block["asOf"] = [r["asOf"] for r, _ in lst]
        block["files"] = [{"month": r["month"], "file": os.path.basename(f), "sha256": sha256_file(f)} for r, f in lst]
        series = {}
        for col, _ci, _kc, _kl in COLS:
            cs = {}
            for rid in ids:
                cs[rid] = [convert(r["values"][rid][col], unit) for r, _ in lst]
            # computed row: rev-side none; exp.total = exp + eucontrib on the ORIGINAL numbers, then converted
            cs["exp.total"] = [convert(round(r["values"]["exp"][col] + r["values"]["eucontrib"][col], 6), unit)
                               for r, _ in lst]
            # keep the declared row order
            ordered = {}
            for rr in rows_out:
                ordered[rr["id"]] = cs[rr["id"]]
            series[col] = ordered
            block[col] = ordered
        data[str(year)] = block
        all_series[year] = series

    # converted identities (rounding bound of the conversion)
    conv_dev = {}
    for year, series in all_series.items():
        for col in ("kfp", "nat", "eu"):
            s = series[col]
            for parent, kids in SUM_IDENTITIES.items():
                bound = (len(kids) + 1) * (0.0005 + 0.5e-6 * EUR) + 1e-9
                for mi in range(len(s["rev"])):
                    dev = abs(s[parent][mi] - sum(s[k][mi] for k in kids))
                    conv_dev[parent] = max(conv_dev.get(parent, 0.0), dev)
                    if dev > bound:
                        prob.error("converted %d-%02d %s %s: dev %.4f > %.4f" % (year, mi + 1, col, parent, dev, bound))
        for rid in ids:
            for mi in range(len(series["kfp"]["rev"])):
                dev = abs(series["kfp"][rid][mi] - series["nat"][rid][mi] - series["eu"][rid][mi])
                conv_dev["к.2=к.3+к.4"] = max(conv_dev.get("к.2=к.3+к.4", 0.0), dev)
                if dev > 0.0015 + 1e-9:
                    prob.error("converted %d-%02d %s: к.2 != к.3+к.4 (dev %.4f)" % (year, mi + 1, rid, dev))
    say("converted identities: max deviation (млн. €) " + ", ".join("%s=%.4f" % (k, v) for k, v in sorted(conv_dev.items())))
    # cumulative series: revenue and expenditure of the KFP grow every month (a fall would mean a wrong or swapped file)
    for year, series in all_series.items():
        for rid in ("rev", "exp", "exp.total"):
            cum = series["kfp"][rid]
            for mi in range(1, len(cum)):
                if not cum[mi] > cum[mi - 1]:
                    prob.error("%d-%02d: cumulative %s does not grow (%.3f after %.3f)" % (year, mi + 1, rid, cum[mi], cum[mi - 1]))
    if max(conv_dev.values()) > 0.005 + 1e-9:
        prob.warn("converted identities exceed 0.005 (max %.4f): DATA_SPEC §3.5 states ±0.005" % max(conv_dev.values()))

    # ---- monthly (non-cumulative) for the three headline rows, all columns
    monthly = {}
    for year, series in sorted(all_series.items()):
        my = {}
        for col in ("kfp", "nat", "eu"):
            mc = {}
            for rid in HEADLINE:
                cum = series[col][rid]
                mc[rid] = [float(dec(cum[i]) - (dec(cum[i - 1]) if i else 0)) + 0.0 for i in range(len(cum))]   # exact on 3 places
            my[col] = mc
        monthly[str(year)] = my

    # ---- plan 2026 from Annex 3 (+ national/EU split from the components file)
    a3 = asbp.load()
    pl = {k: v[2] for k, v in a3["mln"].items()}          # 2026 project column
    plan_kfp = {
        "rev": pl["r.total"], "rev.tax": pl["r.tax"], "rev.nontax": pl["r.nontax"], "rev.grants": pl["r.grants"],
        "exp": pl["x.exp"], "exp.personnel": pl["x.personnel"], "exp.maint": pl["x.maint"],
        "exp.interest": pl["x.interest"], "exp.interest.ext": pl["x.interest.ext"], "exp.interest.dom": pl["x.interest.dom"],
        "exp.social": rnd(pl["x.social"] + pl["x.scholarships"], 1), "exp.subsidies": pl["x.subsidies"],
        "exp.abroad": pl["x.abroad"], "exp.capex": pl["x.capex"], "exp.reserve": pl["x.reserve"],
        "exp.contingency": pl["x.contingency"], "eucontrib": pl["x.eucontrib"], "exp.total": pl["x.total"],
        "balance": pl["x.balance"], "fin": pl["x.fin"],
    }
    # the plan items must add up to the plan totals
    s_exp = sum(plan_kfp[k] for k in ("exp.personnel", "exp.maint", "exp.interest", "exp.social", "exp.subsidies",
                                      "exp.abroad", "exp.capex", "exp.reserve", "exp.contingency"))
    if abs(s_exp - plan_kfp["exp"]) > 0.3:
        prob.error("plan2026: items sum %.1f != exp %.1f" % (s_exp, plan_kfp["exp"]))
    if abs(plan_kfp["rev.tax"] + plan_kfp["rev.nontax"] + plan_kfp["rev.grants"] - plan_kfp["rev"]) > 0.3:
        prob.error("plan2026: revenue items do not add up")
    comp = jload(SRC / "kfp_components_2026.json")["national_vs_eu_2026"]
    pn, pe = comp["plan"]["national"], comp["plan"]["eu"]
    plan_nat = {"rev": pn["rev"], "exp.total": pn["exp_incl_eu_contribution"], "balance": pn["balance"],
                "transfers": pn["transfer_to_eu_accounts_net"]}
    plan_eu = {"rev": pe["rev"], "exp.total": pe["exp_incl_eu_contribution"], "balance": pe["balance"],
               "transfers": pe["transfer_from_state_budget_net"]}
    if abs(plan_nat["exp.total"] + plan_eu["exp.total"] - plan_kfp["exp.total"]) > 0.15:
        prob.error("plan2026: national + EU expenditure != KFP expenditure")
    # Annex 3 exists in two versions (PDF = June base; .docx submitted on 01.07.2026): disclose how far they differ
    diff_rows = jload(RAW / "asbp" / "asbp_tables.json")["docx_check"]["differing_rows"]
    max_diff = max(abs(d - p) for r in diff_rows for p, d in zip(r["pdf"], r["docx"]))
    plan2026 = {
        "kfp": plan_kfp, "nat": plan_nat, "eu": plan_eu,
        "note": "Съпоставката на перата на отчета с Приложение 3 предстои да бъде проверена от експерт по публични финанси. "
                "Планът е „Проект“ към законопроекта (мотиви на МФ, Приложение 3 и Табл. II-3/II-4); окончателните числа по приетия закон може да се различават. "
                "Приложение 3 е публикувано в две версии: числата са от PDF версията на мотивите (проект от юни 2026 г.); внесеният на 01.07.2026 г. "
                "документ (.docx) се различава в %d подреда само за 2026–2028 г., най-много с %s млн. €, при еднакви общи суми. "
                "„Резерв за непредвидени разходи“ няма отделен ред в месечния отчет." % (len(diff_rows), ("%.1f" % max_diff).replace(".", ",")),
        "mapping": {"exp.social": "Социални и здравноосигурителни плащания + Стипендии", "exp.maint": "Издръжка - общо",
                    "exp.subsidies": "Субсидии и други текущи трансфери - общо", "rev.tax": "Данъчно-осигурителни приходи",
                    "rev.grants": "Помощи и дарения", "exp.reserve": "Прираст на държавния резерв и изкупуване на земеделска продукция"},
        "source": ["asbp"], "asOf": "2026-07-01", "unit": "млн. €",
    }

    # ---- latest (headline of the last report) and pace
    last_year = max(all_series)
    n_last = len(all_series[last_year]["kfp"]["rev"])
    prev_year = last_year - 1
    latest = {"month": n_last, "asOf": data[str(last_year)]["asOf"][-1]}
    plan_by_col = {"kfp": plan_kfp, "nat": plan_nat, "eu": plan_eu}
    for col in ("kfp", "nat", "eu"):
        lc = {}
        rows_for = LATEST_ROWS if col == "kfp" else ["rev", "exp.total", "balance"]
        for rid in rows_for:
            cum = all_series[last_year][col][rid][n_last - 1]
            d = {"cum": tenth(cum)}
            plan_v = plan_by_col[col].get(rid)
            if plan_v is not None and rid != "balance":
                d["plan"] = plan_v
                d["pctPlan"] = pct(cum, plan_v, 2)
            elif plan_v is not None:
                d["plan"] = plan_v
            prev = all_series[prev_year][col][rid][n_last - 1]
            d["prevYearCum"] = tenth(prev)
            if prev >= MIN_BASE_FOR_YOY and cum >= 0:          # no growth rate on a tiny base (e.g. 1.1 -> 31.4 млн. €)
                d["yoyPct"] = rnd(100.0 * (cum / prev - 1.0), 1)
            lc[rid] = d
        latest[col] = lc

    pace = {}
    for year, series in sorted(all_series.items()):
        if len(series["kfp"]["rev"]) != 12:
            continue
        py = {}
        for rid in PACE_ROWS:
            cum = series["kfp"][rid]
            if cum[-1] > 0:
                py[rid] = [rnd(100.0 * c / cum[-1], 2) for c in cum]
        pace[str(year)] = py
    pace_note = "Дял (%) от изпълнението за цялата година, достигнат към края на месеца; служи за „изостава / изпреварва“."

    # ---- reconcile: the December reports vs Annex 3 ("2024 Отчет", "2025 Предв. отчет")
    rec_map = [("rev", "r.total"), ("rev.tax", "r.tax"), ("rev.nontax", "r.nontax"), ("rev.grants", "r.grants"),
               ("exp", "x.exp"), ("exp.personnel", "x.personnel"), ("exp.maint", "x.maint"), ("exp.interest", "x.interest"),
               ("exp.social", None), ("exp.subsidies", "x.subsidies"), ("exp.abroad", "x.abroad"), ("exp.capex", "x.capex"),
               ("exp.reserve", "x.reserve"), ("eucontrib", "x.eucontrib"), ("exp.total", "x.total"), ("balance", "x.balance")]
    def reconcile_year(year, col_index):
        december = all_series[year]["kfp"]
        ay = {k: v[col_index] for k, v in a3["mln"].items()}
        rec = {}
        for rid, ak in rec_map:
            kv = december[rid][-1]
            av = rnd(ay["x.social"] + ay["x.scholarships"], 1) if ak is None else ay[ak]
            rec[rid] = {"kfp": kv, "annex3": av, "diff": tenth(float(dec(kv) - dec(av)))}
        return rec
    if len(a3["mln"]["r.total"]) != 5:            # Annex 3 columns: 2024 Отчет, 2025 Предв. отчет, 2026 Проект, 2027, 2028
        prob.error("Annex 3 has %d columns, expected 5 (2024-2028)" % len(a3["mln"]["r.total"]))
    rec24, rec25 = reconcile_year(2024, 0), reconcile_year(2025, 1)
    for rid in ("rev", "exp.total", "balance"):
        say("December 2024 vs Annex 3 (2024 Отчет) %s: %.1f vs %.1f (diff %+.1f)" % (rid, rec24[rid]["kfp"], rec24[rid]["annex3"], rec24[rid]["diff"]))
    reconcile = {"dec2024VsAnnex3": rec24, "dec2025VsAnnex3": rec25, "unit": "млн. €",
                 "note": "Декемврийските отчети на КФП (в лева, превърнати по 1,95583) са сравнени с колоните „2024 Отчет“ и „2025 Предв. отчет“ на Приложение 3. "
                         "Малки разлики са очаквани („Резерв за непредвидени разходи“ няма отделен ред в отчета). За 2024 г. разликите са по-големи "
                         "(приходи %s, разходи %s, салдо %s млн. €); причината предстои да бъде проверена от експерт по публични финанси."
                         % tuple(("%+.1f" % rec24[k]["diff"]).replace("-", "−").replace(".", ",") for k in ("rev", "exp.total", "balance"))}

    nxt_year, nxt_month = (last_year, n_last + 1) if n_last < 12 else (last_year + 1, 1)
    pending_months = [{"month": nxt_month, "asOf": "%04d-%02d-%02d" % (nxt_year, nxt_month, calendar.monthrange(nxt_year, nxt_month)[1]),
                       "status": "pending", "id": "P04"}]

    # the newest report must be the newest headline a person has read from the MF release (REFERENCE): without this, a report missing
    # from the disk takes the data a month back without a word, and a new report would go out without its independent check
    if (last_year, n_last) != max(REFERENCE):
        prob.error("the newest report on disk is %d-%02d, the newest headline in REFERENCE is %d-%02d: a missing report is not "
                   "published as an older month, and a new report needs its MF headline in REFERENCE and in vd_kfp.HEADLINES"
                   % ((last_year, n_last) + max(REFERENCE)))
    # reference check for the headline of the latest reports (the July numbers must not move when a month is added)
    for (ry, rm), want in sorted(REFERENCE.items()):
        j = all_series.get(ry, {}).get("kfp", {})
        if len(j.get("rev", [])) < rm:
            continue                                   # reported above
        ref = (j["rev"][rm - 1], j["exp.total"][rm - 1], j["balance"][rm - 1])
        say("%d-%02d cumulative: rev %.3f  exp.total %.3f  balance %.3f" % ((ry, rm) + ref))
        if tuple(rnd(v, 1) for v in ref) != want:
            prob.error("%d-%02d headline reference differs from %s: %s" % (ry, rm, want, ref))
    if prob.errors:
        say("nothing written: site/data/execution.json keeps the last extraction that passed")
        prob.finish()

    doc = {
        "meta": meta("D06+D16+D26", "Месечно изпълнение на консолидираната фискална програма (КФП)", "real", ["kfp"],
                     "лист „стартова“ на месечните отчети на МФ, редове 11–49, колони к.2–к.4 (натрупано от началото на годината)",
                     data[str(last_year)]["asOf"][-1], "млн. €", pending=["P01", "P02", "P04", "P05"]),
        "cols": [{"id": c, "label": lbl, "kfpCol": kc} for c, _ci, kc, lbl in COLS],
        "rows": rows_out,
        "data": data,
        "monthly": monthly,
        "plan2026": plan2026,
        "latest": latest,
        "pace": pace,
        "paceNote": pace_note,
        "pendingMonths": pending_months,
        "reconcile": reconcile,
    }
    path, size, changed = write_data("execution.json", exec_contract.canonical(doc))
    say("wrote %s (%d bytes, %s)" % (path.relative_to(DATA.parent.parent), size, "changed" if changed else "unchanged"))
    prov = provenance(by_year, rows_out, plan2026, a3, data[str(last_year)]["asOf"][-1])
    path, size, changed = write_data(exec_contract.CONTRACT["provenance"], prov)
    say("wrote %s (%d bytes, %s)" % (path.relative_to(DATA.parent.parent), size, "changed" if changed else "unchanged"))
    prob.finish()
    return doc


if __name__ == "__main__":
    build()
