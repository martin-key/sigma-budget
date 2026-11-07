"""KFP group of validate_data.py: execution.json against the raw monthly reports of the Ministry of Finance since January 2024
(12 per year, the last year 1..n; the count comes from execution.json and the raw folders, not from the code).

The reports are re-read here with a separate, minimal xlrd reader (cell positions come from the published `rows[].row`, the
accounting identities are written out again below), so a wrong row map or a wrong conversion in the extractor cannot hide.
Pure standard library plus xlrd (already in the venv). Nothing here writes a file.
"""
import calendar
import hashlib
import os
import re

import xlrd

import vd_lib as L
from vd_lib import Check, PROTO, fmt, isnum

# the raw reports are NOT in the repository (docs/data-sources.md): without prototype/data/raw the independent re-read is skipped with a warning
RAW_PRESENT = os.path.isdir(os.path.join(PROTO, "data", "raw"))

EUR = 1.95583
SHEET = "стартова"
COLS = (("kfp", 1, "к.2"), ("nat", 2, "к.3"), ("eu", 3, "к.4"))
SUMS = {                                  # parent = sum(children); the fixed accounting structure of the report
    "rev": ["rev.tax", "rev.nontax", "rev.grants"],
    "exp": ["exp.personnel", "exp.maint", "exp.interest", "exp.social", "exp.subsidies", "exp.abroad", "exp.capex",
            "exp.reserve"],
    "exp.interest": ["exp.interest.ext", "exp.interest.dom"],
    "transfers": ["transfers.cb", "transfers.other", "transfers.revshare"],
    "fin.ext": ["fin.ext.markets", "fin.ext.repay", "fin.ext.securities", "fin.ext.deposits"],
    "fin": ["fin.ext", "fin.dom", "fin.priv"],
}
MONTH_RE = re.compile(r"КЪМ\s+(\d{2})\.(\d{2})\.(\d{4})\s+ГОДИНА")
FILE_RE = re.compile(r"EU[ _]funds_(\d{2})(\d{2})_")    # „EU funds“ with a space from the September 2026 report
CONV_TOL = 0.0006                         # published value vs round(raw / 1.95583, 3): equal up to float noise
FIRST_YEAR = 2024                         # every year but the last has 12 reports; the last one 1..12


def _want_cur(y):
    return "BGN" if int(y) <= 2025 else "EUR"     # the euro from 1 January 2026



# source-internal differences of single raw reports, (check, year, month) -> bound in млн. лв.; everything else keeps the strict bound
KNOWN_RAW = {("fin=-balance", 2024, 5): 0.0101}
# headline references (KFP, млн. €, 1 decimal) written out independently of the extractor: rev, exp.total, balance
# September 2026: the MF release of 02.11.2026, https://www.minfin.bg/bg/news/13559
HEADLINES = {("2026", 7): (26347.4, 28548.8, -2201.4), ("2026", 8): (30117.8, 33193.2, -3075.5),
             ("2026", 9): (33898.5, 37567.6, -3669.2)}
# plan2026.kfp keys -> (file, row id): the same Annex 3 numbers as the other datasets
PLAN_REV = {"rev.tax": "r.tax", "rev.nontax": "r.nontax", "rev.grants": "r.grants"}
PLAN_EXP = {"exp": "x.exp", "exp.personnel": "x.personnel", "exp.maint": "x.maint", "exp.interest": "x.interest",
            "exp.interest.ext": "x.interest.ext", "exp.interest.dom": "x.interest.dom", "exp.subsidies": "x.subsidies",
            "exp.abroad": "x.abroad", "exp.capex": "x.capex", "exp.reserve": "x.reserve",
            "exp.contingency": "x.contingency", "eucontrib": "x.eucontrib", "exp.total": "x.total"}


def _norm(s):
    return re.sub(r"\s+", " ", str(s).replace("\xa0", " ")).strip().lower()


def _sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for blk in iter(lambda: fh.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def _eur(raw, currency):
    return round(raw / EUR, 3) if currency == "BGN" else round(raw, 3)


def _rowval(rows, rid, i):
    """Annex 3 row value for year index i (blank -> None)."""
    j = i - rows[rid].get("y0", 0)
    return rows[rid]["mln"][j] if 0 <= j < len(rows[rid]["mln"]) else None


def _read_report(path, row_no):
    """{'year','month','asOf','unit','cells':{id:{col:raw}},'a':{id:text},'dims':(r,c)} read with xlrd directly."""
    sh = xlrd.open_workbook(path).sheet_by_name(SHEET)
    m = MONTH_RE.search(str(sh.cell_value(2, 0)))
    unit_text = _norm(sh.cell_value(3, 3))
    out = {"dims": (sh.nrows, sh.ncols), "unit": "BGN" if "млн.лв" in unit_text else ("EUR" if "млн.евро" in unit_text else None),
           "cells": {}, "a": {}, "asOf": None, "year": None, "month": None}
    if m:
        out["year"], out["month"] = int(m.group(3)), int(m.group(2))
        out["asOf"] = "%s-%s-%s" % (m.group(3), m.group(2), m.group(1))
    for rid, r in row_no.items():
        out["a"][rid] = sh.cell_value(r - 1, 0)
        out["cells"][rid] = {col: sh.cell_value(r - 1, ci) for col, ci, _k in COLS}
    return out


def g_kfp(ctx):
    c = Check("KFP")
    ex = ctx.get("execution.json")
    out_ = ctx.get("outlook.json")
    rev_ = ctx.get("revenue.json")
    exp_ = ctx.get("expenditure.json")
    rows = ex["rows"]
    ids = [r["id"] for r in rows]
    c.ok(len(ids) == len(set(ids)), "rows: duplicate ids")
    c.ok(len(rows) == 33 and "exp.total" in ids, "rows: expected 32 sheet rows + the computed exp.total, got %d" % len(rows))
    row_no = {r["id"]: r["row"] for r in rows if "row" in r}
    c.ok(len(row_no) == 32 and "exp.total" not in row_no, "rows: 32 rows must carry a sheet row number, exp.total none")
    c.ok(set(SUMS) | {k for v in SUMS.values() for k in v} <= set(ids), "rows: an accounting-identity id is missing")
    c.ok([x["id"] for x in ex["cols"]] == ["kfp", "nat", "eu"] and [x["kfpCol"] for x in ex["cols"]] == ["к.2", "к.3", "к.4"],
         "cols must be kfp/nat/eu = к.2/к.3/к.4")
    data = ex["data"]
    years = sorted(data)
    c.ok(years == [str(y) for y in range(FIRST_YEAR, FIRST_YEAR + len(years))], "data years %s, not consecutive from %d" % (years, FIRST_YEAR))
    max_dev = {}
    known_seen = set()
    compared = 0
    files_n = 0
    for y in sorted(data):
        blk = data[y]
        n = blk["months"]
        if y != years[-1]:
            c.ok(n == 12, "%s: months %s, expected 12 (only the last year may be incomplete)" % (y, n))
        else:
            c.ok(1 <= n <= 12, "%s: months %s, expected 1..12" % (y, n))
        c.ok(blk["currency"] == _want_cur(y), "%s: currency %s, expected %s" % (y, blk["currency"], _want_cur(y)))
        c.ok(len(blk["asOf"]) == n and len(blk["files"]) == n, "%s: asOf/files length differs from months" % y)
        if _want_cur(y) == "BGN":
            c.ok(blk.get("converted") == "÷1.95583", "%s: converted note %r" % (y, blk.get("converted")))
        for col, _ci, _k in COLS:
            c.ok(set(blk[col]) == set(ids), "%s/%s: row ids differ from rows[]" % (y, col))
            for rid, arr in blk[col].items():
                c.ok(len(arr) == n and all(isnum(v) for v in arr), "%s/%s/%s: %d values, expected %d numbers" % (y, col, rid, len(arr), n))
        # ---- independent re-read of the raw reports
        for i, f in enumerate(blk["files"]):
            month = i + 1
            c.ok(f["month"] == month, "%s: files[%d].month %s" % (y, i, f["month"]))
            path = os.path.join(PROTO, "data", "raw", "kfp_%s" % y, f["file"])
            if not os.path.exists(path):
                if RAW_PRESENT:
                    c.fail("%s-%02d: raw report %s missing" % (y, month, f["file"]))
                continue
            files_n += 1
            c.ok(_sha(path) == f["sha256"], "%s-%02d: sha256 of %s differs from the published one" % (y, month, f["file"]))
            m = FILE_RE.search(f["file"])
            c.ok(bool(m) and (int(m.group(1)), 2000 + int(m.group(2))) == (month, int(y)), "%s: file name %s vs month %d" % (y, f["file"], month))
            rep = _read_report(path, row_no)
            c.ok(rep["dims"] == (54, 4), "%s-%02d: sheet size %s, expected 54x4" % (y, month, rep["dims"]))
            c.ok((rep["year"], rep["month"]) == (int(y), month), "%s-%02d: the sheet says %s-%s" % (y, month, rep["year"], rep["month"]))
            c.ok(rep["asOf"] == blk["asOf"][i], "%s-%02d: asOf %s vs sheet %s" % (y, month, blk["asOf"][i], rep["asOf"]))
            last = calendar.monthrange(int(y), month)[1]
            c.ok(rep["asOf"] == "%s-%02d-%02d" % (y, month, last), "%s-%02d: asOf %s is not the last day of the month" % (y, month, rep["asOf"]))
            c.ok(rep["unit"] == blk["currency"], "%s-%02d: unit %s vs published %s" % (y, month, rep["unit"], blk["currency"]))
            raw = {}
            bad = False
            for rid in row_no:
                if rid != "fin.priv":
                    lab = [r["label"] for r in rows if r["id"] == rid][0]
                    if not _norm(lab) in _norm(rep["a"][rid]):
                        c.fail("%s-%02d row %s: label %r not in the sheet cell %r" % (y, month, rid, lab, rep["a"][rid]))
                for col, _ci, _k in COLS:
                    v = rep["cells"][rid][col]
                    if not isinstance(v, float):
                        c.fail("%s-%02d %s/%s: not a number: %r" % (y, month, rid, col, v))
                        bad = True
                    raw.setdefault(col, {})[rid] = v
            if bad:
                continue
            for col, _ci, kc in COLS:
                rw = raw[col]
                rw["exp.total"] = rw["exp"] + rw["eucontrib"]
                for rid, vv in rw.items():                    # published = round(raw / 1.95583, 3)
                    exp_v = _eur(vv, blk["currency"])
                    pub = blk[col][rid][i]
                    compared += 1
                    if abs(pub - exp_v) > CONV_TOL:
                        c.fail("%s-%02d %s/%s: published %s vs raw %s -> %s" % (y, month, col, rid, pub, vv, exp_v))
                for parent, kids in SUMS.items():             # identities on the raw numbers
                    dev = abs(rw[parent] - sum(rw[k] for k in kids))
                    max_dev[parent] = max(max_dev.get(parent, 0.0), dev)
                    c.ok(dev <= (len(kids) + 1) * 0.5e-6 + 1e-6, "%s-%02d %s: %s differs from the sum of its parts by %.6f" % (y, month, col, parent, dev))
                dev = abs(rw["rev"] - rw["exp"] + rw["transfers"] - rw["eucontrib"] - rw["balance"])
                max_dev["balance"] = max(max_dev.get("balance", 0.0), dev)
                c.ok(dev <= 5 * 0.5e-6 + 1e-6, "%s-%02d %s: balance != rev - exp + transfers - eucontrib (%.6f)" % (y, month, col, dev))
                dev = abs(rw["fin"] + rw["balance"])
                known = KNOWN_RAW.get(("fin=-balance", int(y), month))
                if known is not None and dev > 0.005:
                    c.ok(dev <= known, "%s-%02d %s: financing != -balance (%.6f) beyond the known source difference" % (y, month, col, dev))
                    known_seen.add("%s-%02d %s %.6f" % (y, month, col, dev))
                else:
                    max_dev["fin=-balance"] = max(max_dev.get("fin=-balance", 0.0), dev)
                    c.ok(dev <= 0.005, "%s-%02d %s: financing != -balance (%.6f)" % (y, month, col, dev))
            for rid in row_no:                                # к.2 = к.3 + к.4
                dev = abs(raw["kfp"][rid] - raw["nat"][rid] - raw["eu"][rid])
                max_dev["к.2=к.3+к.4"] = max(max_dev.get("к.2=к.3+к.4", 0.0), dev)
                c.ok(dev <= 2 * 0.5e-6 + 1e-6, "%s-%02d %s: к.2 != к.3 + к.4 (%.6f)" % (y, month, rid, dev))
    # ---- identities on the published (converted, млн. €) series
    for y in sorted(data):
        n = data[y]["months"]
        for col, _ci, _k in COLS:
            s = data[y][col]
            for i in range(n):
                for parent, kids in SUMS.items():
                    c.ok(abs(s[parent][i] - sum(s[k][i] for k in kids)) <= (len(kids) + 1) * 0.0005 + 0.00001 * len(kids) + 1e-9,
                         "%s %s month %d: converted %s differs from its parts" % (y, col, i + 1, parent))
                c.ok(abs(s["rev"][i] - s["exp"][i] + s["transfers"][i] - s["eucontrib"][i] - s["balance"][i]) <= 0.0026,
                     "%s %s month %d: converted balance identity" % (y, col, i + 1))
                c.ok(abs(s["fin"][i] + s["balance"][i]) <= 0.0061, "%s %s month %d: converted financing != -balance" % (y, col, i + 1))
                c.ok(abs(s["exp.total"][i] - s["exp"][i] - s["eucontrib"][i]) <= 0.0011, "%s %s month %d: exp.total != exp + eucontrib" % (y, col, i + 1))
        for rid in ids:
            for i in range(n):
                c.ok(abs(data[y]["kfp"][rid][i] - data[y]["nat"][rid][i] - data[y]["eu"][rid][i]) <= 0.0016,
                     "%s month %d %s: converted к.2 != к.3 + к.4" % (y, i + 1, rid))
    # ---- cumulative series grow every month (KFP revenue and expenditure)
    for y in sorted(data):
        for rid in ("rev", "exp", "exp.total"):
            arr = data[y]["kfp"][rid]
            c.ok(all(arr[i] > arr[i - 1] for i in range(1, len(arr))), "%s kfp/%s: the cumulative series does not grow every month" % (y, rid))
    # ---- headline references (the July 2026 numbers must not move when a month is added)
    last_y = max(data)
    prev_y = str(int(last_y) - 1)
    n_last = data[last_y]["months"]
    kf = data[last_y]["kfp"]
    head = (kf["rev"][n_last - 1], kf["exp.total"][n_last - 1], kf["balance"][n_last - 1])
    for (hy, hm), want in sorted(HEADLINES.items()):
        k2 = data[hy]["kfp"]
        got = tuple(round(k2[r][hm - 1], 1) for r in ("rev", "exp.total", "balance"))
        c.ok(got == want, "%s-%02d headline %s, expected %s" % (hy, hm, got, want))
    c.ok((last_y, n_last) == max(HEADLINES), "the last report %s-%02d has no headline reference" % (last_y, n_last))
    # ---- latest
    lt = ex["latest"]
    c.ok(lt["month"] == n_last and lt["asOf"] == data[last_y]["asOf"][-1], "latest: month/asOf do not point at the last report")
    plan = ex["plan2026"]
    for col in ("kfp", "nat", "eu"):
        for rid, d in lt[col].items():
            cum = data[last_y][col][rid][n_last - 1]
            prev = data[prev_y][col][rid][n_last - 1]
            c.near(d["cum"], round(cum, 1), 0.0001, "latest %s/%s cum" % (col, rid))
            c.near(d["prevYearCum"], round(prev, 1), 0.0001, "latest %s/%s prevYearCum" % (col, rid))
            pv = plan[col].get(rid)
            c.ok(("plan" in d) == (pv is not None), "latest %s/%s: plan present only where plan2026 has the row" % (col, rid))
            if "plan" in d:
                c.near(d["plan"], pv, 0.0001, "latest %s/%s plan" % (col, rid))
            c.ok(("pctPlan" in d) == ("plan" in d and rid != "balance"), "latest %s/%s: pctPlan present exactly for plan rows other than balance" % (col, rid))
            if "pctPlan" in d:
                c.near(d["pctPlan"], 100.0 * cum / pv, 0.0051, "latest %s/%s pctPlan" % (col, rid))
            c.ok(("yoyPct" in d) == (prev >= 50.0 and cum >= 0), "latest %s/%s: yoyPct only on a base of 50+ млн. €" % (col, rid))
            if "yoyPct" in d:
                c.near(d["yoyPct"], 100.0 * (cum / prev - 1.0), 0.0501, "latest %s/%s yoyPct" % (col, rid))
    r0 = lt["kfp"]["rev"]
    c.fact("%s-%02d cumulative: revenue %s · expenditure %s · balance %s млн. € (%s of the year's plan, +%s%% on %s)" % (
        last_y, n_last, fmt(head[0]), fmt(head[1]), fmt(head[2]), str(r0["pctPlan"]).replace(".", ","), str(r0["yoyPct"]).replace(".", ","), prev_y))
    # ---- pace and monthly
    for y, py in ex["pace"].items():
        s = data[y]["kfp"]
        c.ok(data[y]["months"] == 12, "pace: %s is not a complete year" % y)
        for rid, arr in py.items():
            c.ok(len(arr) == 12 and arr[-1] == 100.0, "pace %s/%s: 12 values ending at 100" % (y, rid))
            for i in range(12):
                c.near(arr[i], 100.0 * s[rid][i] / s[rid][11], 0.0051, "pace %s/%s month %d" % (y, rid, i + 1))
    for y, my in ex["monthly"].items():
        for col, mc in my.items():
            for rid, arr in mc.items():
                cum = data[y][col][rid]
                for i in range(len(cum)):
                    c.near(arr[i], cum[i] - (cum[i - 1] if i else 0.0), CONV_TOL, "monthly %s/%s/%s month %d" % (y, col, rid, i + 1))
    # ---- plan 2026 against the other Annex 3 datasets
    pk = plan["kfp"]
    ec = L.by_id(exp_["economic"]["rows"])
    rr = L.by_id(rev_["rows"])
    c.near(pk["rev"], out_["kfp"]["revenue"]["mln"][2], 0.0001, "plan2026 rev vs outlook")
    c.near(pk["exp.total"], out_["kfp"]["expenditure"]["mln"][2], 0.0001, "plan2026 exp.total vs outlook")
    c.near(pk["balance"], out_["kfp"]["balance"]["mln"][2], 0.0001, "plan2026 balance vs outlook")
    c.near(pk["fin"], out_["kfp"]["financing"]["mln"][2], 0.0001, "plan2026 fin vs outlook")
    for k, rid in PLAN_REV.items():
        c.near(pk[k], _rowval(rr, rid, 2), 0.0001, "plan2026 %s vs revenue.json" % k)
    for k, rid in PLAN_EXP.items():
        c.near(pk[k], _rowval(ec, rid, 2), 0.0001, "plan2026 %s vs expenditure.json economic" % k)
    c.near(pk["exp.social"], round(_rowval(ec, "x.social", 2) + _rowval(ec, "x.scholarships", 2), 1), 0.0001, "plan2026 exp.social (social + scholarships)")
    c.ok(abs(pk["rev.tax"] + pk["rev.nontax"] + pk["rev.grants"] - pk["rev"]) <= 0.3, "plan2026: revenue parts do not add up")
    c.ok(abs(sum(pk[k] for k in ("exp.personnel", "exp.maint", "exp.interest", "exp.social", "exp.subsidies", "exp.abroad",
                                  "exp.capex", "exp.reserve", "exp.contingency")) - pk["exp"]) <= 0.3, "plan2026: expenditure parts do not add up")
    c.near(pk["exp"] + pk["eucontrib"], pk["exp.total"], 0.15, "plan2026 exp + eucontrib vs exp.total")
    c.near(pk["rev"] - pk["exp.total"], pk["balance"], 0.15, "plan2026 rev - exp.total vs balance")
    c.near(plan["nat"]["exp.total"] + plan["eu"]["exp.total"], pk["exp.total"], 0.15, "plan2026 national + EU expenditure")
    c.near(plan["nat"]["rev"] + plan["eu"]["rev"], pk["rev"], 0.15, "plan2026 national + EU revenue")
    c.near(plan["nat"]["balance"] + plan["eu"]["balance"], pk["balance"], 0.15, "plan2026 national + EU balance")
    c.ok(plan.get("source") == ["asbp"] and plan.get("asOf") and plan.get("unit") == "млн. €", "plan2026 must carry source/asOf/unit")
    c.ok("Приложение 3 е публикувано в две версии" in plan["note"], "plan2026.note must disclose the two Annex 3 versions")
    # ---- reconcile: the December reports against Annex 3 ("2024 Отчет" = column 0, "2025 Предв. отчет" = column 1)
    bigs = {}
    for key, y, ai in (("dec2024VsAnnex3", "2024", 0), ("dec2025VsAnnex3", "2025", 1)):
        rec = ex["reconcile"].get(key)
        if not c.ok(isinstance(rec, dict) and rec, "reconcile.%s missing" % key):
            continue
        for rid, d in rec.items():
            c.near(d["kfp"], data[y]["kfp"][rid][11], 0.0006, "reconcile %s %s kfp" % (y, rid))
            c.near(d["diff"], round(d["kfp"] - d["annex3"], 1), 0.0501, "reconcile %s %s diff" % (y, rid))
        for rid, src in (("rev", ("r.total", rr)), ("exp", ("x.exp", ec)), ("exp.total", ("x.total", ec)), ("eucontrib", ("x.eucontrib", ec)),
                         ("exp.personnel", ("x.personnel", ec)), ("exp.capex", ("x.capex", ec)), ("rev.tax", ("r.tax", rr))):
            c.near(rec[rid]["annex3"], _rowval(src[1], src[0], ai), 0.0001, "reconcile %s %s annex3 vs the dataset row" % (y, rid))
        c.near(rec["balance"]["annex3"], out_["kfp"]["balance"]["mln"][ai], 0.0001, "reconcile %s balance annex3 vs outlook" % y)
        bigs[y] = max(abs(d["diff"]) for d in rec.values())
    # December 2024 against the national / EU split of Tables II-3 and II-4 (components.json): reported, not enforced (the
    # December monthly report is not the annual report the motives use)
    comp = ctx.get("components.json")
    if comp is not None and comp["nationalVsEu"]["years"][0] == 2024:
        nve = comp["nationalVsEu"]
        d24 = data["2024"]
        parts = []
        for col, name in (("kfp", "kfp"), ("nat", "national"), ("eu", "eu")):
            t = nve[name]
            diffs = (d24[col]["rev"][11] - t["revMln"][0], d24[col]["exp.total"][11] - t["expMln"][0], d24[col]["balance"][11] - t["balanceMln"][0])
            parts.append("%s rev %+.1f exp %+.1f balance %+.1f" % (col, *diffs))
            c.ok(all(abs(x) < 100.0 for x in diffs), "December 2024 %s differs from Tables II-3/II-4 by 100+ млн. € (%s)" % (col, diffs))
        c.fact("December 2024 report minus Annex 3 / Tables II-3, II-4 (2024 Отчет), млн. €: " + "; ".join(parts))
    c.fact("%d raw reports re-read (%d values compared, 3 columns); December report vs Annex 3 differs by at most %s" % (
        files_n, compared, ", ".join("%s млн. € (%s)" % (fmt(v), y) for y, v in sorted(bigs.items()))))
    if known_seen:
        c.fact("known source differences (млн. лв., not corrected): financing vs −balance " + "; ".join(sorted(known_seen)))
    c.fact("max deviation on the raw numbers (млн.): " + ", ".join("%s %.6f" % (k, v) for k, v in sorted(max_dev.items())))
    # ---- pending month
    pm = ex["pendingMonths"]
    c.ok(len(pm) == 1 and pm[0]["month"] == (n_last % 12) + 1 and pm[0]["status"] == "pending" and pm[0]["id"] == "P04", "pendingMonths: the next month must be the single P04 block")
    if pm and n_last < 12:
        c.ok(pm[0]["asOf"] == "%s-%02d-%02d" % (last_y, n_last + 1, calendar.monthrange(int(last_y), n_last + 1)[1]),
             "pendingMonths: asOf %s is not the last day of the next month" % pm[0]["asOf"])
    if RAW_PRESENT:
        want_n = sum(data[y]["months"] for y in years)
        c.ok(files_n == want_n, "%d of %d raw reports found" % (files_n, want_n))
        for y in years:                       # a report on disk that execution.json does not have yet: run extract_kfp_full.py
            on_disk = len([f for f in os.listdir(os.path.join(PROTO, "data", "raw", "kfp_%s" % y)) if f.endswith(".xls")]) \
                if os.path.isdir(os.path.join(PROTO, "data", "raw", "kfp_%s" % y)) else 0
            c.ok(on_disk <= data[y]["months"], "%s: %d raw reports on disk, execution.json has %d (extract_kfp_full.py not run?)" % (y, on_disk, data[y]["months"]))
    elif not files_n:
        c.warn("the raw monthly reports are not in the repository (prototype/data/raw, see docs/data-sources.md): the independent re-read was skipped")
    return c
