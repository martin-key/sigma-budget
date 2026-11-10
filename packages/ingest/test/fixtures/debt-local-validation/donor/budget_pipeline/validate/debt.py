"""DEBT group of base.py: debt.json (D13 + D14), state debt 2024-2028, Maastricht debt, quarterly series, limits.

Every identity of the file is recomputed here: total = external + domestic, the printed percentages against the GDP of outlook.json,
the structure shares against 100, the issuance and limit figures against each other, and the stored `check` block against the
recomputed values. Printed values carry one decimal, so a sum may be off by 0.06 and a share by 0.051. Pure standard library.
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import re

import budget_pipeline.validate.checks as L
from budget_pipeline.validate.checks import Check, isnum

TOL = 0.06                      # a printed value of one decimal on each side of an identity


def _tol_sum(n):
    """The rounding error of a printed total against n printed parts: each of the n + 1 values is within 0.05."""
    return 0.05 * (n + 1) + 0.01
TOL_PCT = 0.051                 # a printed percentage against total / GDP
TOL_STORED = 0.0051             # a stored deviation is rounded to two decimals
# Eurostat releases (maastricht.asOf) whose GDP is newer than the one of Annex 3 (June 2026): for these years the printed share follows
# Eurostat's GDP, so it is held to TOL_GDP_VINTAGE instead of TOL_PCT. A new release is listed here after review (debt.EUROSTAT_REVISIONS).
GDP_VINTAGE = {"2026-10-21": (2024, 2025)}
TOL_GDP_VINTAGE = 0.2
# the quarterly series as published: first and last quarter (a new quarter is a reviewed change of these values)
QUARTERS = (("eurostat", "2024-Q1", "2026-Q2"), ("bnbGg", "2015-Q4", "2026-Q2"), ("bnbCg", "2008-Q1", "2026-Q2"))
SPACES = re.compile(r"[\s\u00a0\u202f]+")
WORD = {"actual": "Отчет", "plan": "Проект", "forecast": "Прогноза"}
GROUP_IDS = ("maturity", "instrument", "rate", "currency", "creditor")
LIMIT_IDS = ("debtCap", "newDebt", "newGuarantees", "guaranteesAll", "fiscalReserve")
NOTE_IDS = ("projection", "quarterly", "maturities")


def _quarters(first, n):
    """'2024-Q1', 3 -> ['2024-Q1', '2024-Q2', '2024-Q3']."""
    y, q = int(first[:4]), int(first[-1])
    out = []
    for _ in range(n):
        out.append("%d-Q%d" % (y, q))
        q += 1
        if q == 5:
            y, q = y + 1, 1
    return out


def _printed_mln(s):
    """'37,7 млрд. евро' -> 37700.0, '2 020 млн. евро' -> 2020.0, anything else -> None."""
    m = re.match(r"^([\d\s\u00a0\u202f]+(?:,\d+)?)\s*(млрд|млн)\.?\s+евро$", s or "")
    if not m:
        return None
    v = float(SPACES.sub("", m.group(1)).replace(",", "."))
    return round(v * (1000.0 if m.group(2) == "млрд" else 1.0), 6)


def _printed_months(s):
    """'8 г. и 3 м.' -> 99, '10 г.' -> 120, anything else -> None."""
    m = re.match(r"^(\d+) г\.(?: и (\d+) м\.)?$", s or "")
    return None if not m else int(m.group(1)) * 12 + int(m.group(2) or 0)


def _same_len(c, arrs, n, where):
    c.ok(all(isinstance(a, list) and len(a) == n for a in arrs), "%s: every array must have %d entries" % (where, n))


def g_debt(ctx):
    c = Check("DEBT")
    d = ctx.get("debt.json")
    o, ex = ctx.get("outlook.json"), ctx.get("execution.json")
    c.ok(set(d) == {"meta", "defaultScope", "scopes", "latest", "zdd", "maastricht", "quarterly", "compare", "structure", "interest",
                    "guaranteed", "newDebt", "limits", "financing", "notes", "check"}, "debt keys %s" % sorted(d))
    m = d["meta"]
    c.ok(m["id"] == "D13+D14" and m["status"] == "real" and m["source"] == ["asbp", "eurostat", "bnb"] and m["pending"] == ["P06"] and m["mock"] is False,
         "meta id/status/source/pending/mock")
    # --- zdd: table VI-1
    z = d["zdd"]
    yrs = z["years"]
    n = len(yrs)
    c.ok(yrs == o["years"], "zdd.years %s must equal the outlook years %s" % (yrs, o["years"]))
    c.ok(z["vintage"] == ["actual", "actual", "plan", "forecast", "forecast"] and all(v in WORD for v in z["vintage"]), "zdd.vintage %s" % z["vintage"])
    c.ok(z["columns"] == ["%d %s" % (y, WORD[v]) for y, v in zip(yrs, z["vintage"])], "zdd.columns %s" % z["columns"])
    keys = ("totalMln", "externalMln", "domesticMln", "pctGdp", "externalPctGdp", "domesticPctGdp", "gdpMln")
    _same_len(c, [z[k] for k in keys], n, "zdd")
    c.ok(all(isnum(v) for k in keys for v in z[k]), "zdd: a non-numeric value")
    c.ok(z["gdpMln"] == o["gdp"]["mlnPrecise"], "zdd.gdpMln %s must equal outlook.gdp.mlnPrecise %s" % (z["gdpMln"], o["gdp"]["mlnPrecise"]))
    c.ok(z["table"] == "VI-1" and z["source"] == ["asbp"] and z["asOf"] == "2026-07-01", "zdd table / source / asOf")
    dev_pct = 0.0
    for i, y in enumerate(yrs):
        c.near(z["totalMln"][i], z["externalMln"][i] + z["domesticMln"][i], _tol_sum(2), "zdd %d: total = external + domestic" % y)
        c.near(z["externalPctGdp"][i] + z["domesticPctGdp"][i], z["pctGdp"][i], _tol_sum(2), "zdd %d: external + domestic percent" % y)
        for mln, pct, what in (("totalMln", "pctGdp", "total"), ("externalMln", "externalPctGdp", "external"), ("domesticMln", "domesticPctGdp", "domestic")):
            calc = 100.0 * z[mln][i] / z["gdpMln"][i]
            c.near(z[pct][i], calc, TOL_PCT, "zdd %d: printed %s percent of GDP against value / GDP" % (y, what))
            dev_pct = max(dev_pct, abs(z[pct][i] - calc))
    c.ok(all(z["totalMln"][i] < z["totalMln"][i + 1] for i in range(n - 1)), "zdd.totalMln should grow in this projection")
    # --- scopes and the latest block
    sc = {s["id"]: s for s in d["scopes"]}
    c.ok(list(sc) == ["zdd", "maastricht"] and d["defaultScope"] in sc, "scopes %s, default %r" % (list(sc), d["defaultScope"]))
    c.ok(sc["zdd"]["years"] == [yrs[0], yrs[-1]] and sc["zdd"]["latestActual"] == 2025 and sc["zdd"]["source"] == ["asbp"], "scopes.zdd")
    mx = d["maastricht"]
    c.ok(sc["maastricht"]["years"] == [mx["years"][0], mx["years"][-1]] and sc["maastricht"]["latestActual"] == mx["years"][-1], "scopes.maastricht")
    c.ok(sc["maastricht"]["source"] == ["eurostat", "bnb"], "scopes.maastricht.source")
    for s in sc.values():
        c.ok(all(isinstance(s[k], str) and s[k].strip() for k in ("label", "short", "note")), "scope %s: texts" % s["id"])
    lz, lm = d["latest"]["zdd"], d["latest"]["maastricht"]
    i25 = yrs.index(2025)
    c.ok(lz["year"] == 2025 and lz["vintage"] == z["vintage"][i25] == "actual" and lz["asOf"] == z["asOf"], "latest.zdd year / vintage / asOf")
    c.ok(lz["mln"] == z["totalMln"][i25] and lz["pctGdp"] == z["pctGdp"][i25], "latest.zdd must equal the 2025 column of table VI-1")
    nx = lz["next"]
    c.ok(nx["year"] == 2026 and nx["vintage"] == z["vintage"][i25 + 1] == "plan" and nx["mln"] == z["totalMln"][i25 + 1] and nx["pctGdp"] == z["pctGdp"][i25 + 1],
         "latest.zdd.next must equal the 2026 column of table VI-1")
    # --- Maastricht debt (annual)
    my = mx["years"]
    c.ok(my == list(range(my[0], my[0] + len(my))) and my[0] == 2015 and my[-1] == 2025, "maastricht.years %s..%s" % (my[0], my[-1]))
    _same_len(c, [mx["bg"]["mln"], mx["bg"]["pctGdp"], mx["eu27"]["mln"], mx["eu27"]["pctGdp"]], len(my), "maastricht")
    c.ok(all(isnum(v) for k in ("bg", "eu27") for kk in ("mln", "pctGdp") for v in mx[k][kk]), "maastricht: a non-numeric value")
    c.ok(mx["thresholdPctGdp"] == 60 and mx["dataset"] == "gov_10dd_edpt1" and mx["source"] == ["eurostat"], "maastricht threshold / dataset / source")
    c.ok(max(mx["bg"]["pctGdp"]) < mx["thresholdPctGdp"], "Bulgaria stays under the 60% reference value in the series")
    c.ok(lm["year"] == my[-1] and lm["mln"] == mx["bg"]["mln"][-1] and lm["pctGdp"] == mx["bg"]["pctGdp"][-1] and lm["asOf"] == mx["asOf"],
         "latest.maastricht must equal the last year of the annual series")
    for k in (2024, 2025):                               # the GDP of both years is known: the printed share must follow
        i = my.index(k)
        newer = k in GDP_VINTAGE.get(mx["asOf"], ())
        c.near(mx["bg"]["pctGdp"][i], 100.0 * mx["bg"]["mln"][i] / z["gdpMln"][yrs.index(k)], TOL_GDP_VINTAGE if newer else TOL_PCT,
               "maastricht %d: percent against the GDP%s" % (k, " of Annex 3 (Eurostat GDP of %s is newer)" % mx["asOf"] if newer else ""))
    # --- quarterly series
    q = d["quarterly"]
    eu, gg, cg = q["eurostat"], q["bnbGg"], q["bnbCg"]
    for name, first, last in QUARTERS:
        s = q[name]
        qs = s["quarters"]
        c.ok(qs[0] == first and qs[-1] == last and qs == _quarters(first, len(qs)), "quarterly.%s: quarters must run %s..%s without a gap" % (name, first, last))
        c.ok(len(s["mln"]) == len(qs) and all(isnum(v) and v > 0 for v in s["mln"]), "quarterly.%s: mln" % name)
    c.ok(eu["dataset"] == "gov_10q_ggdebt" and gg["indicator"] == "GGALN_G01_XDC" and cg["indicator"] == "GCALN_G01_AC_XDC", "quarterly dataset / indicators")
    c.ok(len(eu["pctGdp"]) == len(eu["flags"]) == len(eu["quarters"]), "quarterly.eurostat: pctGdp / flags length")
    n_p = 0                                              # Eurostat marks the newest quarter(s) provisional
    while n_p < len(eu["flags"]) and eu["flags"][-1 - n_p] == "p":
        n_p += 1
    c.ok(n_p >= 1 and eu["flags"] == [""] * (len(eu["flags"]) - n_p) + ["p"] * n_p and set(eu["flagLabels"]) == {"p"},
         "quarterly.eurostat.flags: only the newest quarters are provisional")
    lq = lm["quarter"]
    c.ok(lq["id"] == eu["quarters"][-1] and lq["mln"] == eu["mln"][-1] and lq["pctGdp"] == eu["pctGdp"][-1] and lq["flag"] == eu["flags"][-1] and lq["asOf"] == eu["asOf"],
         "latest.maastricht.quarter must equal the last Eurostat quarter")
    gmap = dict(zip(gg["quarters"], gg["mln"]))
    dev_q = max(abs(v - gmap[k]) for k, v in zip(eu["quarters"], eu["mln"]) if k in gmap)
    c.ok(all(k in gmap for k in eu["quarters"]), "every Eurostat quarter has a BNB general-government quarter")
    c.ok(dev_q <= 0.05, "Eurostat quarterly debt differs from the BNB general-government series by %.3f (> 0.05)" % dev_q)
    dev_a = 0.0
    for k, v in zip(my, mx["bg"]["mln"]):                # the annual figure is the fourth quarter of the same series
        key = "%d-Q4" % k
        if key in gmap:
            dev_a = max(dev_a, abs(v - gmap[key]))
    c.ok(dev_a <= 0.06, "the BNB fourth quarter differs from the Eurostat annual debt by %.3f (> 0.06)" % dev_a)
    c.ok(all(("%d-Q4" % k) in gmap for k in my[1:]), "every year after 2015 has a BNB fourth quarter")
    # --- three definitions side by side
    cp = d["compare"]
    r = {x["id"]: x for x in cp["rows"]}
    cmap = dict(zip(cg["quarters"], cg["mln"]))
    c.ok(cp["years"] == [2024, 2025] and list(r) == ["zdd", "cg", "gg"], "compare years / rows %s" % list(r))
    c.ok(r["zdd"]["mln"] == [z["totalMln"][yrs.index(y)] for y in cp["years"]] and r["zdd"]["source"] == ["asbp"], "compare.zdd must equal table VI-1")
    c.ok(r["cg"]["mln"] == [cmap["%d-Q4" % y] for y in cp["years"]] and r["cg"]["source"] == ["bnb"], "compare.cg must equal the BNB central-government fourth quarter")
    c.ok(r["gg"]["mln"] == [mx["bg"]["mln"][my.index(y)] for y in cp["years"]] and r["gg"]["source"] == ["eurostat"], "compare.gg must equal the Maastricht series")
    c.ok(isinstance(cp["note"], str) and "експерт по публични финанси" in cp["note"], "compare.note must carry the generic verification wording")
    for x in r.values():
        c.ok(isinstance(x["label"], str) and x["label"].strip(), "compare.%s: label" % x["id"])
    # --- structure, table VI-2
    st = d["structure"]
    c.ok([g["id"] for g in st["groups"]] == list(GROUP_IDS), "structure.groups %s" % [g["id"] for g in st["groups"]])
    dev_g = {}
    for g in st["groups"]:
        per = {}
        for row in g["rows"]:
            c.ok(len(row["years"]) == len(row["values"]) and all(isnum(v) and 0.0 <= v <= 100.0 for v in row["values"]), "structure %s/%s: years / values" % (g["id"], row["id"]))
            c.ok(all(y in yrs for y in row["years"]) and row["years"] == sorted(row["years"]), "structure %s/%s: years %s" % (g["id"], row["id"], row["years"]))
            for y, v in zip(row["years"], row["values"]):
                per.setdefault(y, []).append(v)
        dev_g[g["id"]] = 0.0
        c.ok(sorted(per) == yrs, "structure %s: every projection year needs at least one row" % g["id"])
        for y, vs in per.items():
            dev_g[g["id"]] = max(dev_g[g["id"]], abs(sum(vs) - 100.0))
        c.ok(dev_g[g["id"]] <= 0.101, "structure %s: shares sum to %.2f%% at worst (> 100 +/- 0.1)" % (g["id"], 100.0 + dev_g[g["id"]]))
    c.ok(st["table"] == "VI-2" and st["source"] == ["asbp"] and st["asOf"] == z["asOf"] and st["unit"] == "% от държавния дълг", "structure table / source / asOf / unit")
    am = st["avgMaturity"]
    c.ok(am["years"] == yrs and len(am["months"]) == len(am["printed"]) == n, "avgMaturity: years / lengths")
    c.ok(all(_printed_months(p) == mo for p, mo in zip(am["printed"], am["months"])), "avgMaturity.printed %s must equal the months %s" % (am["printed"], am["months"]))
    c.ok(am["months"] == sorted(am["months"]), "avgMaturity grows over the projection")
    # --- interest and state-guaranteed debt
    it = d["interest"]
    c.ok(it["years"] == [2024, 2025], "interest.years")
    for i, y in enumerate(it["years"]):
        c.near(it["totalMln"][i], it["externalMln"][i] + it["domesticMln"][i], _tol_sum(2), "interest %d: total = external + domestic" % y)
    c.near(it["pctGdpPrinted"]["2024"], 100.0 * it["totalMln"][0] / z["gdpMln"][0], TOL_PCT, "interest 2024: printed percent of GDP")
    c.ok(it["pctGdpPrinted"]["2028"] == 1.2 and it["source"] == ["asbp"], "interest: printed 2028 percent / source")
    gu = d["guaranteed"]
    c.ok(gu["years"] == [2024, 2025], "guaranteed.years")
    for i, y in enumerate(gu["years"]):
        c.near(gu["totalMln"][i], gu["externalMln"][i] + gu["domesticMln"][i], _tol_sum(2), "guaranteed %d: total = external + domestic" % y)
        c.near(gu["pctGdpPrinted"][i], 100.0 * gu["totalMln"][i] / z["gdpMln"][yrs.index(y)], TOL_PCT, "guaranteed %d: printed percent of GDP" % y)
        c.near(sum(s["values"][i] for s in gu["sectors"]), 100.0, 0.05 * 6 + 0.01, "guaranteed %d: the sector shares" % y)
    c.ok(len(gu["sectors"]) == 6 and all(len(s["values"]) == 2 for s in gu["sectors"]), "guaranteed.sectors")
    c.ok(isnum(gu["newGuarantees2025Mln"]) and gu["newGuarantees2025Mln"] > 0 and gu["source"] == ["asbp"], "guaranteed: new guarantees / source")
    # --- new debt, limits
    nd = d["newDebt"]
    c.ok(len(nd["uses"]) == 4 and all(isinstance(u, str) and u.strip() for u in nd["uses"]), "newDebt.uses: four statements")
    y5 = nd["y2025"]
    c.near(y5["totalMln"], sum(p["mln"] for p in y5["parts"]), _tol_sum(3), "newDebt.y2025: total = parts")
    c.ok([p["id"] for p in y5["parts"]] == ["eurobonds", "domesticBonds", "structuralLoans"], "newDebt.y2025.parts ids")
    c.ok(isnum(y5["repaymentsBln"]) and y5["repaymentsBln"] > 0, "newDebt.y2025.repaymentsBln")
    iss = nd["issued2026"]
    c.near(iss["totalMln"], sum(x["mln"] for x in iss["months"]), _tol_sum(5), "newDebt.issued2026: total = months")
    c.ok([x["month"] for x in iss["months"]] == ["януари", "февруари", "март", "април", "май"], "newDebt.issued2026.months must be the consecutive months of the year")
    lim = {x["id"]: x for x in d["limits"]["items"]}
    c.ok(list(lim) == list(LIMIT_IDS) and d["limits"]["year"] == 2026 and d["limits"]["source"] == ["zdb"], "limits.items %s" % list(lim))
    for k, x in lim.items():
        c.ok(isnum(x["mln"]) and _printed_mln(x["printed"]) == x["mln"], "limits.%s: printed %r must equal %s million" % (k, x["printed"], x["mln"]))
        c.ok(isinstance(x["art"], int) and x["art"] >= 65 and x["label"].strip(), "limits.%s: article / label" % k)
    c.ok(lim["newDebt"]["includesMln"] == 3261.7 and lim["newDebt"]["includesMln"] < lim["newDebt"]["mln"], "limits.newDebt.includesMln (SAFE)")
    c.ok(lim["guaranteesAll"]["mln"] >= lim["newGuarantees"]["mln"] and lim["fiscalReserve"]["kind"] == "min", "limits: guarantees, reserve")
    c.ok(z["totalMln"][yrs.index(2026)] <= lim["debtCap"]["mln"], "the 2026 state debt of table VI-1 must stay under the legal cap")
    p26 = nd["plan"][0]
    c.ok([(p["year"], p["kind"]) for p in nd["plan"]] == [(2026, "limit"), (2027, "plan"), (2028, "plan")], "newDebt.plan kinds")
    c.near(p26["bln"] * 1000.0, lim["newDebt"]["mln"], 0.01, "newDebt.plan 2026 must equal the legal limit of art. 67")
    c.near(nd["limitEnd2026Bln"] * 1000.0, lim["debtCap"]["mln"], 0.01, "newDebt.limitEnd2026Bln must equal the cap of art. 66")
    c.ok(all(isnum(p["bln"]) and p["bln"] > 0 and p.get("refinancedBln", 0) <= p["bln"] for p in nd["plan"]), "newDebt.plan values")
    c.ok(set(nd["kindLabels"]) == {"limit", "plan"} and nd["source"] == ["asbp"], "newDebt.kindLabels / source")
    # --- financing rows come from the execution file
    fi = d["financing"]
    ids = {r_["id"] for r_ in ex["rows"]}
    c.ok(fi["ref"] == "execution" and fi["asOf"] == ex["latest"]["asOf"], "financing.ref / asOf must equal the execution data")
    c.ok(all(r_ in ids for r_ in fi["rows"]) and set(fi["labels"]) == set(fi["rows"]), "financing.rows must be rows of execution.json with a label each")
    c.ok([x["id"] for x in d["notes"]] == list(NOTE_IDS) and all(x["text"].strip() for x in d["notes"]), "notes ids %s" % [x["id"] for x in d["notes"]])
    # --- the stored check block against the recomputed numbers
    ck = d["check"]
    c.near(ck["zddPrintedPctMaxDev"], dev_pct, TOL_STORED, "check.zddPrintedPctMaxDev")
    c.near(ck["eurostatQuarterlyVsBnbGgMaxDev"], dev_q, TOL_STORED, "check.eurostatQuarterlyVsBnbGgMaxDev")
    c.near(ck["bnbGgQ4VsEurostatAnnualMaxDev"], dev_a, TOL_STORED, "check.bnbGgQ4VsEurostatAnnualMaxDev")
    for g, v in ck["structureGroupMaxDevFrom100"].items():
        c.near(v, dev_g[g], TOL_STORED, "check.structureGroupMaxDevFrom100.%s" % g)
    c.ok(set(ck["structureGroupMaxDevFrom100"]) == set(GROUP_IDS) and ck["limitsMatchMotives"] is True, "check block keys / limitsMatchMotives")
    c.fact("table VI-1 %d years (2026 plan %s of the %s cap), Maastricht %d years + %d quarters, GG vs BNB max dev %.3f, structure 5 groups, 5 legal limits" % (
        n, L.fmt(z["totalMln"][yrs.index(2026)]), L.fmt(lim["debtCap"]["mln"], 0), len(my), len(eu["quarters"]), dev_q))
    return c


GROUPS = (
    ("DEBT", g_debt, "debt.json: table VI-1 identities, Maastricht and quarterly series against each other, structure shares, legal limits"),
)
