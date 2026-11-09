"""Fiscal groups of base.py: ANNEX3 (outlook), REVENUE, EXPENDITURE, MEASURES (+ KFP from execution_reports).

Every check recomputes a published number from other published numbers or from a documented reference value; tolerances are
the rounding of the printed source (1 decimal in млн. €, 1 or 2 decimals in % of GDP). Pure standard library.
"""



from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
from pathlib import Path as _Path
import hashlib
import os

import budget_pipeline.validate.checks as L
from budget_pipeline.validate.execution_reports import g_kfp
from budget_pipeline.validate.checks import Check, fmt, isnum

KFP_KEYS = ("revenue", "expenditure", "balance", "interest", "primaryBalance", "financing")


def _dec(series):
    """Printed decimals of a % series (3.0 prints with 1 decimal): the longest fractional part seen."""
    return max([len(repr(float(v)).partition(".")[2]) for v in series] or [0])


def _ptol(series):
    """Half a printed unit plus a hair for the GDP rounding."""
    return 0.5 * 10 ** (-_dec(series)) + 0.001


def _at(row, i):
    """Row value for year index i of the file's `years` axis (leading blanks via y0, trailing blanks: shorter array)."""
    j = i - row.get("y0", 0)
    return row["mln"][j] if 0 <= j < len(row["mln"]) else None


def _tree(c, rows, what, gdp, tol_cap=0.3):
    """parent = sum(children) per year (memo rows excluded, blanks count 0); pctGdp = mln / GDP; parent/level consistent."""
    by = L.by_id(rows)
    kids = {}
    for q in rows:
        c.ok(isnum(q["level"]), "%s %s: level" % (what, q["id"]))
        p = q.get("parent")
        if p:
            if c.ok(p in by, "%s %s: parent %s not in the table" % (what, q["id"], p)):
                c.ok(by[p]["level"] == q["level"] - 1, "%s %s: level %s under parent level %s" % (what, q["id"], q["level"], by[p]["level"]))
                kids.setdefault(p, []).append(q)
        else:
            c.ok(q["level"] == 0, "%s %s: a row without parent must be level 0" % (what, q["id"]))
        y0 = q.get("y0", 0)
        c.ok(len(q["mln"]) == len(q["pctGdp"]) and y0 + len(q["mln"]) <= 5, "%s %s: mln/pctGdp lengths %d/%d (y0 %d)" % (
            what, q["id"], len(q["mln"]), len(q["pctGdp"]), y0))
        tol = _ptol(q["pctGdp"])
        for j, (m, p_) in enumerate(zip(q["mln"], q["pctGdp"])):
            c.ok(isnum(m) and isnum(p_), "%s %s: non-number at %d" % (what, q["id"], j))
            if isnum(m) and isnum(p_):
                c.near(p_, 100.0 * m / gdp[j + y0], tol, "%s %s pctGdp %d" % (what, q["id"], j + y0))
    worst = 0.0
    for pid, ks in kids.items():
        real = [k for k in ks if not k.get("memo")]
        tol = min(tol_cap, 0.05 * (len(real) + 1) + 0.01)
        for i in range(5):
            pv = _at(by[pid], i)
            if pv is None:
                continue
            d = abs(pv - sum(_at(k, i) or 0.0 for k in real))
            worst = max(worst, d)
            c.ok(d <= tol, "%s %s year %d: %s differs from the sum of its %d parts by %.2f" % (what, pid, i, fmt(pv), len(real), d))
    return worst


def g_annex3(ctx):
    c = Check("ANNEX3")
    o = ctx.get("outlook.json")
    c.ok(o["years"] == [2024, 2025, 2026, 2027, 2028], "years %s" % o["years"])
    c.ok(o["vintage"] == ["actual", "prelim", "plan", "forecast", "forecast"], "vintage %s" % o["vintage"])
    g = o["gdp"]
    c.ok(len(g["mln"]) == 5 and len(g["mlnPrecise"]) == 5, "gdp lengths")
    for i in range(5):
        c.near(g["mln"][i], round(g["mlnPrecise"][i]), 0.0, "gdp.mln[%d] is the rounded precise value" % i)
    gdp = g["mlnPrecise"]
    k = o["kfp"]
    c.ok(set(k) == set(KFP_KEYS), "kfp keys %s" % sorted(k))
    for name in KFP_KEYS:
        b = k[name]
        c.ok(len(b["mln"]) == 5 and len(b["pctGdp"]) == 5 and all(isnum(v) for v in b["mln"] + b["pctGdp"]), "%s: five numbers each" % name)
        tol = _ptol(b["pctGdp"])
        for i in range(5):
            c.near(b["pctGdp"][i], 100.0 * b["mln"][i] / gdp[i], tol, "%s pctGdp %d" % (name, 2024 + i))
    rev, exp_, bal, itr, pb, fin = [k[n]["mln"] for n in KFP_KEYS]
    for i in range(5):
        y = 2024 + i
        c.near(rev[i] - exp_[i], bal[i], 0.3, "%d: revenue - expenditure vs balance" % y)
        c.near(fin[i], -bal[i], 0.3, "%d: financing vs -balance" % y)
        c.near(pb[i], bal[i] + itr[i], 0.3, "%d: primary balance vs balance + interest" % y)
    c.ok(k["primaryBalance"].get("computed") is True and k["primaryBalance"].get("note"), "primaryBalance must be flagged computed with a note")
    head = (rev[2], exp_[2], bal[2], itr[2], g["mlnPrecise"][2])
    c.ok(head == (49615.3, 56807.2, -7191.9, 1059.2, 125246.7), "2026 headline %s" % (head,))
    # macro
    for name, arr in o["macro"].items():
        c.ok(len(arr) == 5 and all(isnum(v) for v in arr), "macro.%s: five numbers" % name)
    c.ok(len(o["macroVintage"]) == 5, "macroVintage length")
    rows = o["macroRows"]
    ids = [r["id"] for r in rows]
    c.ok(len(ids) == len(set(ids)) and len(rows) == 16, "macroRows: 16 unique ids, got %d" % len(rows))
    in_groups = [i for gr in o["macroGroups"] for i in gr["rows"]]
    c.ok(sorted(in_groups) == sorted(ids), "macroGroups must list every macroRow exactly once")
    for r in rows:
        c.ok(len(r["values"]) == 5 and all(isnum(v) for v in r["values"]), "macroRow %s: five numbers" % r["id"])
    mr = L.by_id(rows)
    c.ok(mr["gdp"]["values"] == g["mln"], "macroRows gdp must equal gdp.mln")
    # two versions of Annex 3
    vs = o["versions"]
    c.ok(len(vs) == 9, "versions: %d rows, expected 9" % len(vs))
    other = {}
    other.update(L.by_id(ctx.get("revenue.json")["rows"]))
    other.update(L.by_id(ctx.get("expenditure.json")["economic"]["rows"]))
    mx = 0.0
    for v in vs:
        c.ok(len(v["pdf"]) == len(v["docx"]) == len(v["diff"]) == 5, "versions %s: five values" % v["id"])
        c.ok(v["pdf"][:2] == v["docx"][:2] and v["diff"][:2] == [0.0, 0.0], "versions %s: 2024-2025 must be equal" % v["id"])
        for i in range(5):
            c.near(v["diff"][i], v["docx"][i] - v["pdf"][i], 0.0501, "versions %s diff %d" % (v["id"], i))
            mx = max(mx, abs(v["diff"][i]))
        row = other.get(v["id"])
        if c.ok(row is not None, "versions %s: no such row in revenue/economic" % v["id"]):
            c.ok(row["mln"] == v["pdf"][row.get("y0", 0):row.get("y0", 0) + len(row["mln"])], "versions %s: the published row must be the PDF version" % v["id"])
    c.ok(abs(mx - 4.3) < 0.001, "versions: largest difference %.1f, documented 4.3" % mx)
    c.ok(o["notes"][0]["id"] == "twoVersions" and "9 реда" in o["notes"][0]["text"], "notes[0] must be twoVersions and name the 9 rows")
    c.fact("2026: revenue %s, expenditure %s, balance %s, interest %s млн. €; GDP %s; %d rows differ between the two Annex 3 versions (max %.1f)" % (
        fmt(rev[2]), fmt(exp_[2]), fmt(bal[2]), fmt(itr[2]), fmt(gdp[2]), len(vs), mx))
    return c


def g_revenue(ctx):
    c = Check("REVENUE")
    r = ctx.get("revenue.json")
    o = ctx.get("outlook.json")
    gdp = o["gdp"]["mlnPrecise"]
    c.ok(r["years"] == o["years"] and r["vintage"] == o["vintage"], "years/vintage must equal outlook")
    t = r["total"]
    c.ok(t["mln"] == o["kfp"]["revenue"]["mln"] and t["pctGdp"] == o["kfp"]["revenue"]["pctGdp"], "total must equal outlook.kfp.revenue")
    rows = r["rows"]
    by = L.by_id(rows)
    c.ok(len(rows) == 31 and len(by) == 31, "rows: %d (unique %d), expected 31" % (len(rows), len(by)))
    c.ok(by["r.total"]["mln"] == t["mln"], "r.total must equal total")
    worst = _tree(c, rows, "revenue", gdp)
    groups = r["groups"]
    c.ok(len(groups) == 8 and len({gr["id"] for gr in groups}) == 8, "groups: 8 unique ids")
    used = [i for gr in groups for i in gr["rowIds"]]
    c.ok(len(used) == len(set(used)) and all(i in by for i in used), "groups: rowIds unique and existing")
    gsum = []
    for i in range(5):
        s = sum(gr["mln"][i] for gr in groups)
        gsum.append(round(s, 1))
        c.near(s, t["mln"][i], 0.15, "groups sum vs total, year %d" % (2024 + i))
        c.near(r["groupSums"][i], round(s, 1), 0.0501, "groupSums[%d]" % i)
    for gr in groups:
        if not all(x in by for x in gr["rowIds"]):
            continue                                        # already reported above
        c.ok(gr["annex3Rows"] == [by[i]["label"] for i in gr["rowIds"]], "group %s: annex3Rows differ from the row labels" % gr["id"])
        for i in range(5):
            c.near(gr["mln"][i], sum(_at(by[x], i) or 0.0 for x in gr["rowIds"]), 0.0501, "group %s mln %d" % (gr["id"], 2024 + i))
        tol = _ptol(gr["pctGdp"])
        for i in range(5):
            c.near(gr["pctGdp"][i], 100.0 * gr["mln"][i] / gdp[i], tol, "group %s pctGdp %d" % (gr["id"], 2024 + i))
        c.near(gr["share2026"], 100.0 * gr["mln"][2] / t["mln"][2], 0.0051, "group %s share2026" % gr["id"])
        c.near(gr["yoy2026Pct"], 100.0 * (gr["mln"][2] / gr["mln"][1] - 1.0), 0.0501, "group %s yoy2026Pct" % gr["id"])
    c.near(sum(gr["share2026"] for gr in groups), 100.0, 0.05, "shares add up to 100")
    ex = ctx.get("execution.json")
    c.ok(r["execution"]["ref"] == "execution" and all(k in {x["id"] for x in ex["rows"]} for k in r["execution"]["rows"]), "execution.rows must be ids of execution.json")
    c.ok([n["id"] for n in r["notes"]] == ["groups", "rounding", "byTax"], "notes ids %s" % [n["id"] for n in r["notes"]])
    c.fact("2026 revenue %s млн. €, %d groups (sum differs from the total by at most %s), tree identities within %.1f" % (
        fmt(t["mln"][2]), len(groups), fmt(max(abs(a - b) for a, b in zip(gsum, t["mln"])), 1), worst))
    return c


def g_expenditure(ctx):
    c = Check("EXPENDITURE")
    e = ctx.get("expenditure.json")
    o = ctx.get("outlook.json")
    core = ctx.get("core.json")
    gdp = o["gdp"]["mlnPrecise"]
    f = e["functions"]
    c.ok(f["years"] == [2025, 2026, 2027, 2028] and len(f["vintage"]) == 4 and len(f["yearLabels"]) == 4, "functions: years/vintage/yearLabels")
    items = f["items"]
    c.ok(len(items) == 9 and len({i["id"] for i in items}) == 9, "functions: 9 unique items")
    tot = f["totalMln"]
    for k in range(4):
        s = sum(i["mln"][k] for i in items)
        c.near(s, tot[k], 0.0011, "functions: items sum vs totalMln, %d" % (2025 + k))
        c.near(f["totalPctGdp"][k], 100.0 * tot[k] / gdp[k + 1], 0.0051, "functions: totalPctGdp %d" % (2025 + k))
    c.ok(tot[1] == 55525.0, "functions: 2026 total %s, expected 55 525,0" % tot[1])
    gaps = [0.0] * 4
    for it in items:
        c.ok(all(len(it[x]) == 4 for x in ("mln", "pctGdp", "share")) and all(isnum(v) for x in ("mln", "pctGdp", "share") for v in it[x]),
             "functions %s: four numbers each" % it["id"])
        for k in range(4):
            gaps[k] = max(gaps[k], abs(it["pctGdp"][k] - 100.0 * it["mln"][k] / gdp[k + 1]))
            c.near(it["share"][k], 100.0 * it["mln"][k] / tot[k], 0.0061, "functions %s share %d" % (it["id"], 2025 + k))
        c.near(it["yoy2026Pct"], 100.0 * (it["mln"][1] / it["mln"][0] - 1.0), 0.0501, "functions %s yoy2026Pct" % it["id"])
        if it.get("parts"):
            for k in range(4):
                c.near(sum(p["mln"][k] for p in it["parts"]), it["mln"][k], 0.15, "functions %s: parts vs item, %d" % (it["id"], 2025 + k))
    rc = f["reconcile"]
    for k in range(4):
        c.ok(gaps[k] <= rc["printedPctGdpMaxGap"][k] + 0.006, "functions: printed %% of GDP gap %.3f in %d exceeds the declared %s" % (gaps[k], 2025 + k, rc["printedPctGdpMaxGap"][k]))
    ec = L.by_id(e["economic"]["rows"])
    for k in range(4):
        c.near(rc["annex3ExpenditureMln"][k], _at(ec["x.exp"], k + 1), 0.0001, "reconcile: annex3ExpenditureMln %d vs economic x.exp" % (2025 + k))
        c.near(rc["diffMln"][k], round(tot[k] - rc["annex3ExpenditureMln"][k], 1), 0.0501, "reconcile: diffMln %d" % (2025 + k))
    c.ok(abs(rc["diffMln"][0]) > 1000 and all(abs(d) <= 0.15 for d in rc["diffMln"][1:]), "reconcile: only the 2025 'Програма' column may differ from Annex 3")
    # two versions of Table III-1: the published numbers are the .docx ones; the PDF totals differ by rounding
    vers = f["versions"]
    c.ok(len(vers) == 7, "functions.versions: %d rows, expected 7" % len(vers))
    byid = L.by_id(items)
    pdf_total = list(tot)
    for v in vers:
        it = byid[v["id"]]
        pub = [p for p in it["parts"] if p["name"] == v["part"]][0]["mln"] if "part" in v else it["mln"]
        c.ok(v["docx"] == pub, "functions.versions %s %s: the published numbers must be the .docx ones" % (v["id"], v.get("part", "")))
        c.ok(v["pdf"][0] == v["docx"][0], "functions.versions %s: 2025 must be equal" % v["id"])
        if "part" not in v:
            for k in range(4):
                pdf_total[k] += v["pdf"][k] - v["docx"][k]
    for k in range(4):
        c.near(rc["pdfTotalMln"][k], pdf_total[k], 0.0501, "reconcile: pdfTotalMln %d" % (2025 + k))
    note0 = f["notes"][0]["text"].replace("\u202f", " ").replace("\u00a0", " ")
    c.ok(f["notes"][0]["id"] == "base" and "55 525,0" in note0 and "56 807,2" in note0, "functions.notes[0] must quote 55 525,0 and 56 807,2")
    mins = {m["id"] for m in ctx.get("ministries.json")["items"]}
    for it in items:
        c.ok(all(m in mins for m in it.get("ministries", [])), "functions %s: unknown ministry code in %s" % (it["id"], it.get("ministries")))
    # economic rows
    z = e["economic"]
    c.ok(z["years"] == o["years"] and z["vintage"] == o["vintage"], "economic: years/vintage must equal outlook")
    rows = z["rows"]
    c.ok(len(rows) == 30 and len(ec) == 30, "economic: %d rows, expected 30" % len(rows))
    worst = _tree(c, rows, "economic", gdp)
    c.ok(ec["x.total"]["mln"] == o["kfp"]["expenditure"]["mln"], "economic x.total must equal outlook expenditure")
    c.ok(ec["x.interest"]["mln"] == o["kfp"]["interest"]["mln"], "economic x.interest must equal outlook interest")
    for i in range(5):
        c.near(ec["x.nonint"]["mln"][i], ec["x.exp"]["mln"][i] - ec["x.interest"]["mln"][i], 0.15, "economic: memo x.nonint %d" % (2024 + i))
    c.ok(ec["x.nonint"].get("memo") is True, "economic: x.nonint must be a memo row")
    c.near(ec["x.exp"]["mln"][2], tot[1], 0.0011, "economic x.exp 2026 vs functions total")
    c.ok((ec["x.total"]["mln"][2], ec["x.eucontrib"]["mln"][2]) == (56807.2, 1282.2), "economic 2026: x.total/x.eucontrib")
    c.near(ec["x.exp"]["mln"][2] + ec["x.eucontrib"]["mln"][2], ec["x.total"]["mln"][2], 0.15, "55 525,0 + 1 282,2 vs 56 807,2")
    # COFOG (Eurostat)
    cf = e["cofog"]
    cit = cf["items"]
    top = [x for x in cit if not x.get("memoOf")]
    c.ok(len(cf["years"]) == 10 and cf["years"][-1] == 2024 and cf["source"] == ["eurostat"], "cofog: ten years ending 2024, source eurostat")
    for k in range(10):
        c.ok(abs(sum(x["mln"][k] for x in top) - cf["total"]["mln"][k]) <= 0.3, "cofog %d: functions differ from the total" % cf["years"][k])
    for m in [x for x in cit if x.get("memoOf")]:
        p = L.by_id(cit, "code")[m["memoOf"]]
        c.ok(all(a <= b + 0.05 for a, b in zip(m["mln"], p["mln"])), "cofog memo %s exceeds its parent" % m["code"])
    c.ok(all(fn in byid for x in cit for fn in x.get("kfpFunctions", [])), "cofog: kfpFunctions must be function ids")
    implied = 100.0 * cf["total"]["mln"][-1] / cf["total"]["pctGdp"][-1]
    c.ok(abs(implied / gdp[0] - 1.0) < 0.003, "cofog: the GDP implied by the 2024 percentages (%s) differs from Annex 3's 2024 GDP" % fmt(implied, 0))
    pc = e["perCapita"]
    c.ok(pc["population"] == core["population"]["persons"] and pc["year"] == core["population"]["year"], "perCapita: population must equal core.population")
    c.fact("functions 2026 %s млн. € (+ EU contribution %s = %s); economic tree within %.1f; Annex 3 2025 column differs from the printed 'Програма' by %s млн. €" % (
        fmt(tot[1]), fmt(ec["x.eucontrib"]["mln"][2]), fmt(ec["x.total"]["mln"][2]), worst, fmt(rc["diffMln"][0])))
    return c


def g_measures(ctx):
    c = Check("MEASURES")
    m = ctx.get("measures.json")
    o = ctx.get("outlook.json")
    t = m["totals"]
    c.ok((t["discretionary2026"]["II-8"], t["discretionary2026"]["II-9"]) == (482.0, 604.4), "discretionary 2026: II-8 / II-9 = %s / %s" % (t["discretionary2026"]["II-8"], t["discretionary2026"]["II-9"]))
    c.ok((t["revenueMln"], t["expenditureMln"], t["expenditureMlnWithoutIndicative"]) == (745.0, -1710.5, -1060.8), "short-term totals")
    c.ok((m["check"]["II-8"], m["check"]["II-9"]) == (482.0, 604.4), "check.II-8 / II-9")
    items = m["items"]
    ids = [i["id"] for i in items]
    c.ok(len(items) == 52 and len(set(ids)) == 52, "items: %d (unique %d), expected 52" % (len(items), len(set(ids))))
    byid = L.by_id(items)
    cnt = m["counts"]
    short = [i for i in items if i["tab"] == "short"]
    disc = [i for i in items if i["tab"] == "discretionary"]
    laws = [i for i in items if i["tab"] == "laws"]
    c.ok((len(short), len(disc), len(laws)) == (cnt["short"]["all"], cnt["discretionary"]["revenue"] + cnt["discretionary"]["expenditure"], cnt["laws"]),
         "counts by tab: %d / %d / %d" % (len(short), len(disc), len(laws)))
    c.ok(cnt["all"] == len(items) == 52, "counts.all")
    c.ok(sum(1 for i in short if i["kind"] == "revenue" and i["hasEstimate"]) == cnt["short"]["revenue"] == 8, "counts: short revenue with estimate")
    c.ok(sum(1 for i in short if i["kind"] == "expenditure" and i["hasEstimate"]) == cnt["short"]["expenditure"] == 9, "counts: short expenditure with estimate")
    c.ok(sum(1 for i in short if not i["hasEstimate"]) == cnt["short"]["noEstimate"] == 7, "counts: short without estimate")
    c.ok(sum(1 for i in disc if i["kind"] == "revenue") == cnt["discretionary"]["revenue"] == 14, "counts: discretionary revenue")
    c.ok(sum(1 for i in disc if i["kind"] == "expenditure") == cnt["discretionary"]["expenditure"] == 6, "counts: discretionary expenditure")
    for i in items:
        c.ok(i["tab"] in m["tabs"] and i["stage"] in m["stageLabels"], "%s: tab/stage" % i["id"])
        c.ok(all(isinstance(i.get(k), str) and i[k].strip() for k in ("name", "text", "quote")), "%s: name/text/quote must be text" % i["id"])
        c.ok(isinstance(i["page"], dict) and isinstance(i["page"].get("docx"), int), "%s: page.docx" % i["id"])
        if i["hasEstimate"]:
            c.ok(set(i["effectMln"]) <= {"2026", "2027", "2028"} and i["effectMln"] and all(isnum(v) for v in i["effectMln"].values()), "%s: effectMln" % i["id"])
            if i["tab"] == "short":
                c.ok(i.get("estimateKind") in m["estimateKinds"], "%s: estimateKind" % i["id"])
        else:
            c.ok("effectMln" not in i and "balanceEffectMln" not in i, "%s: no estimate, so no numbers" % i["id"])
        if "balanceEffectMln" in i:
            sign = 1.0 if i["kind"] == "revenue" else -1.0
            c.ok(set(i["balanceEffectMln"]) == set(i["effectMln"]) and all(abs(i["balanceEffectMln"][y] - sign * i["effectMln"][y]) < 1e-9 for y in i["effectMln"]),
                 "%s: balanceEffectMln must be +effect (revenue) or -effect (expenditure)" % i["id"])
        for rid in i.get("related", []):
            c.ok(rid in byid, "%s: related %s does not exist" % (i["id"], rid))
        if "from" in i:
            c.ok(bool(L.ISO.match(i["from"])), "%s: from %r" % (i["id"], i["from"]))
    # groups of the short-term tab
    grp = L.by_id(m["groups"])
    seen = []
    for gr in m["groups"]:
        seen += gr["items"]
        c.ok(all(x in byid and byid[x]["tab"] == "short" and byid[x]["kind"] == gr["kind"] for x in gr["items"]), "group %s: items must be short-term %s measures" % (gr["id"], gr["kind"]))
        if "totalMln" in gr:
            s = sum(byid[x]["effectMln"]["2026"] for x in gr["items"])
            c.near(s, gr["totalMln"], 0.05 * (len(gr["items"]) + 1), "group %s: items sum vs totalMln" % gr["id"])
    c.ok(sorted(seen) == sorted(i["id"] for i in short), "groups must cover every short-term measure exactly once")
    c.near(grp["short-revenue"]["totalMln"], t["revenueMln"], 0.0001, "group short-revenue vs totals.revenueMln")
    c.near(grp["short-expenditure"]["totalMln"], t["expenditureMln"], 0.0001, "group short-expenditure vs totals.expenditureMln")
    exp_items = [byid[x] for x in grp["short-expenditure"]["items"]]
    kk = [x for x in exp_items if x["estimateKind"] == "stated"]
    c.near(sum(x["effectMln"]["2026"] for x in kk), t["expenditureMlnWithoutIndicative"], 0.05 * (len(kk) + 1), "stated expenditure measures vs totals.expenditureMlnWithoutIndicative")
    # discretionary tables II-8 / II-9
    gdp = o["gdp"]["mlnPrecise"][2]
    for tab, kind in (("II-8", "revenue"), ("II-9", "expenditure")):
        its = [i for i in disc if i.get("table") == tab]
        c.ok(all(i["kind"] == kind for i in its) and len(its) == cnt["discretionary"][kind], "%s: items" % tab)
        sums = []
        for y in ("2026", "2027", "2028"):
            s = sum(i["effectMln"].get(y, 0.0) for i in its)
            sums.append(round(s, 1))
            c.near(s, t["discretionary"][tab][y], 0.15, "%s %s: items sum vs printed total" % (tab, y))
        c.ok(m["check"]["rowSums"][tab] == sums, "check.rowSums[%s] %s vs recomputed %s" % (tab, m["check"]["rowSums"][tab], sums))
        c.near(t["discretionaryPeriod"][tab], sum(t["discretionary"][tab].values()), 0.15, "%s: period total" % tab)
    c.near(t["gdpShare2026"]["revenue"], 100.0 * t["discretionary2026"]["II-8"] / gdp, 0.0051, "gdpShare2026 revenue")
    c.near(t["gdpShare2026"]["expenditure"], 100.0 * t["discretionary2026"]["II-9"] / gdp, 0.0051, "gdpShare2026 expenditure")
    # the source document
    d = m["document"]
    c.ok(d["url"].startswith("https://www.parliament.bg/") and len(d["sha256"]) == 64, "document: url/sha256")
    local = os.path.join(L.RAW, "parliament", "52-602-01-19.docx")
    if os.path.exists(local):
        h = hashlib.sha256()
        with open(local, "rb") as fh:
            h.update(fh.read())
        c.ok(h.hexdigest() == d["sha256"], "document.sha256 differs from the local copy of the bill")
    else:
        c.warn("local copy of the bill not found: document.sha256 not re-checked")
    c.fact("short-term: revenue %s, expenditure %s (%s without indicative) млн. €; discretionary 2026: II-8 %s, II-9 %s; %d items (24 + 20 + 8)" % (
        fmt(t["revenueMln"]), fmt(t["expenditureMln"]), fmt(t["expenditureMlnWithoutIndicative"]), fmt(t["discretionary2026"]["II-8"]),
        fmt(t["discretionary2026"]["II-9"]), len(items)))
    return c


GROUPS = (
    ("KFP", g_kfp, "monthly KFP reports: independent re-read of the 19 xls, identities, conversion, latest/pace/plan"),
    ("ANNEX3", g_annex3, "Annex 3 frame: balance identities, % of GDP, 2026 headline, the two document versions"),
    ("REVENUE", g_revenue, "revenue rows and the eight groups against the total"),
    ("EXPENDITURE", g_expenditure, "Table III-1 functions, economic rows, COFOG, per-capita population"),
    ("MEASURES", g_measures, "52 budget measures: 482,0 / 604,4 / +745,0 / -1 710,5"),
)
