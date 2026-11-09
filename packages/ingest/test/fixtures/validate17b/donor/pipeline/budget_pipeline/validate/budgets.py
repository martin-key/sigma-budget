"""LAW (from law), BUDGETS and PROGRAMS groups of base.py.

BUDGETS = ministries.json (the 46 budgets of art. 2-47 of the law, their policies, the bill-to-law differences, the tiers of the
program budgets); PROGRAMS = the 42 ministries/<code>.json files and the search index programs.json built from them.
Every number is re-derived from other published numbers; tolerances are the rounding of the printed sources (one decimal in
thousand euro; the program tables print each of three summands rounded, so a sum may be off by 0.1).
Pure standard library.
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import collections
import os
import re

import budget_pipeline.validate.checks as L
from budget_pipeline.validate.catalog import INTERNAL
from budget_pipeline.validate.law import g_law
from budget_pipeline.validate.checks import Check, fmt, isnum

TOL = 0.06                      # one printed decimal
TOL_SUM = 0.15                  # a sum of a few printed values
TOL_COL = 0.12                  # total = budget + other in the program tables (three rounded values)
KINDS = ("ministry", "agency", "commission", "judiciary", "constitutional", "legislature", "fund", "other")
TIERS = ("validated", "program-budget-differs", "pending")
COLS = ["consTotal", "consPrb", "consOther", "deptTotal", "deptPrb", "deptOther", "admTotal", "admPrb", "admOther"]
YEARS = [2023, 2024, 2025, 2026, 2027, 2028]
YEAR_LABELS = ["Отчет 2023", "Отчет 2024", "Закон 2025", "Проект 2026", "Прогноза 2027", "Прогноза 2028"]
VINTAGE = ["actual", "actual", "plan", "plan", "forecast", "forecast"]
FIELDS = ["ministry", "code", "name", "level", "policy", "y2026", "y2025", "growthPct", "isNew", "prb2026", "prb2025"]
ARCHIVE = "https://www.parliament.bg/bills/52/52-602-01-19.zip"
SENTINELS = {"noData": -1, "noGrowth": -101}
BLANK = [0.0] * 9


def _same(c, a, b, msg, tol=TOL):
    """Two optional numbers: both missing, or within tol."""
    if a is None or b is None:
        return c.ok(a is None and b is None, "%s: %s vs %s" % (msg, a, b))
    return c.near(a, b, tol, msg)


def _clean_name(s):
    """A program / policy name that came out of a real heading: no junk quotes, no stray code, not the table header 'Код'."""
    return (isinstance(s, str) and s == s.strip() and len(s) >= 4 and s != "Код" and "  " not in s and '"' not in s
            and s.count("„") == s.count("“") and len(re.findall("[А-Яа-я]", s)) >= 3
            and not re.match(r"^[\d.\s]+$", s))


def _prog_rows(d):
    """(level, policy code, row) of a program file the way programs.json lists them: a policy without programs is a program."""
    out = []
    for pol in d["policies"]:
        progs = pol.get("programs")
        if progs:
            out.append(("policy", "", pol))
            for pr in progs:
                out.append(("program", pol["code"], pr))
        else:
            out.append(("program", "", pol))
    return out


# ------------------------------------------------------------------------------------------------ BUDGETS
def g_budgets(ctx):
    c = Check("BUDGETS")
    m = ctx.get("ministries.json")
    law = ctx.get("law.json")
    core = ctx.get("core.json")
    mm = m["meta"]
    c.ok(list(m) == ["meta", "totals", "kinds", "tiers", "programTotals", "scopeNote", "items"], "ministries.json keys %s" % list(m))
    c.ok(mm["id"] == "D08+D09" and mm["status"] == "real" and mm["unit"] == "хил. €" and mm["pending"] == ["P03"] and mm["mock"] is False,
         "meta id/status/unit/pending")
    c.ok(L.ISO.match(mm["asOf"]) and mm["asOf"] <= L.BUILD_DATE and set(mm["source"]) <= set(core["sources"]), "meta asOf/source")
    c.ok(any(p["id"] == "P03" for p in (core["pending"] if isinstance(core["pending"], list) else core["pending"].values())), "core.pending has P03")
    c.ok(list(m["kinds"]) == list(KINDS) or sorted(m["kinds"]) == sorted(KINDS), "kinds %s" % list(m["kinds"]))
    c.ok(sorted(m["tiers"]) == sorted(TIERS) and all(isinstance(v, str) and v for v in m["tiers"].values()), "tiers %s" % list(m["tiers"]))
    c.ok(isinstance(m["scopeNote"], str) and m["scopeNote"].strip() != "", "scopeNote")
    items = m["items"]
    ids = [x["id"] for x in items]
    c.ok(len(items) == 46 == m["totals"]["count"], "%d items, totals.count %s (46 expected)" % (len(items), m["totals"]["count"]))
    c.ok(ids == sorted(ids) and len(set(ids)) == len(ids), "items are unique and sorted by id")
    lb = dict((b["id"], b) for b in law["budgets"])
    c.ok(set(ids) == set(lb), "ministries.json and law.json list different budgets: %s" % sorted(set(ids) ^ set(lb)))
    rev = exp = 0.0
    tiers = collections.Counter()
    kinds = collections.Counter()
    pol_total = prog_total = 0
    for x in items:
        i = x["id"]
        w = "budget %s" % i
        b = lb.get(i)
        if not c.ok(b is not None, w + ": not in law.json"):
            continue
        c.ok(x["art"] == b["art"] and x["name"] == b["name"] and x["short"] == b["short"] and x["kind"] == b["kind"],
             w + ": art/name/short/kind differ from law.json")
        c.ok(x["kind"] in m["kinds"], w + ": kind %s" % x["kind"])
        kinds[x["kind"]] += 1
        c.ok(isinstance(x["lawName"], str) and _clean_name(x["lawName"]), w + ": lawName %r" % x["lawName"])
        for key, k in (("revKhil", "rev"), ("expKhil", "exp"), ("transfersKhil", "transfers")):
            _same(c, x.get(key), b["law"][k], "%s %s = law.json" % (w, key))
        rev += x.get("revKhil") or 0.0
        exp += x["expKhil"]
        # policies / areas
        pols = x["policies"]
        c.ok(x["policiesKind"] in ("policies", "areas") and pols, w + ": policiesKind / policies")
        c.ok([q["n"] for q in pols] == list(range(1, len(pols) + 1)), w + ": policy numbers %s" % [q["n"] for q in pols])
        c.ok(all(_clean_name(q["name"]) and isnum(q["khil"]) for q in pols), w + ": policy names / amounts")
        c.near(sum(q["khil"] for q in pols), x["policyTotalKhil"], TOL_SUM, w + ": policies sum to policyTotalKhil")
        c.near(x["policyTotalKhil"], x["expKhil"], TOL, w + ": policyTotalKhil = expKhil")
        for q in pols:
            if q.get("parts"):
                c.near(sum(p["khil"] for p in q["parts"]), q["khil"], TOL_SUM, "%s policy %s: parts sum" % (w, q["n"]))
                c.ok(all(_clean_name(p["name"]) for p in q["parts"]), "%s policy %s: part names" % (w, q["n"]))
        if "bodies" in x:
            c.near(sum(q["khil"] for q in x["bodies"]), x["expKhil"], TOL_SUM, w + ": bodies sum to the expenditure")
        # change against 2025
        pb = x.get("programBudgetVsLaw")
        ch = x.get("change")
        c.ok((ch is None) == (x.get("exp2025Khil") is None), w + ": change and exp2025Khil must come together")
        if ch is not None:
            c.ok(ch["basis"] in ("law", "program-budget") and (ch["basis"] == "program-budget") == (pb is not None), w + ": change.basis %s" % ch["basis"])
            base = pb["prbKhil"] if (pb and ch["basis"] == "program-budget") else x["expKhil"]
            if x["exp2025Khil"] > 0:
                c.near(ch["pct"], 100.0 * (base / x["exp2025Khil"] - 1.0), 0.051, w + ": change.pct")
        # bill against law
        bl = x.get("billVsLaw")
        c.ok((bl is not None) == bool(b["changed"]), w + ": billVsLaw must exist exactly for the changed budgets")
        if bl is not None:
            for key, k in (("revKhil", "rev"), ("expKhil", "exp"), ("transfersKhil", "transfers")):
                moved = abs(b["diff"][k] or 0.0) > 0.05
                c.ok((key in bl) == moved, "%s billVsLaw.%s present only when the amount moved" % (w, key))
                if key in bl:
                    for s in ("bill", "law", "diff"):
                        c.near(bl[key][s], b[s][k], TOL, "%s billVsLaw.%s.%s" % (w, key, s))
            c.ok(bl["lines"] == b["lines"], w + ": billVsLaw.lines")
        # programs
        p = x["programs"]
        tiers[p.get("tier", "pending")] += 1
        if p["status"] == "real":
            c.ok(p["tier"] in ("validated", "program-budget-differs") and p["file"] == "ministries/%s.json" % i and L.exists(p["file"]),
                 w + ": programs block %s" % p)
            c.ok(isinstance(p["count"], int) and isinstance(p["policyCount"], int) and p["count"] >= p["policyCount"] >= 1, w + ": programs counts")
            pol_total += p["policyCount"]
            prog_total += p["count"]
            c.ok((p["tier"] == "program-budget-differs") == (pb is not None), w + ": tier vs programBudgetVsLaw")
            if pb is not None:
                c.near(pb["lawKhil"], x["expKhil"], TOL, w + ": programBudgetVsLaw.lawKhil")
                c.near(pb["diffKhil"], pb["lawKhil"] - pb["prbKhil"], TOL, w + ": programBudgetVsLaw.diffKhil = law - program budget")
                c.near(pb["billKhil"], b["bill"]["exp"], TOL, w + ": programBudgetVsLaw.billKhil = the bill")
                c.ok(pb["matchesBill"] == (abs(pb["prbKhil"] - pb["billKhil"]) <= 0.05), w + ": programBudgetVsLaw.matchesBill")
                c.ok(abs(pb["diffKhil"]) > 0.05, w + ": a 'differs' tier needs a difference")
        else:
            c.ok(p["status"] == "pending" and p["id"] == "P03" and p["reasonKind"] in ("format", "source-sums") and p["reason"].strip()
                 and "file" not in p and L.numbers_in(p) == 0 and not L.exists("ministries/%s.json" % i), w + ": pending programs block %s" % p)
            c.ok(pb is None, w + ": a pending budget has no programBudgetVsLaw")
    c.near(m["totals"]["revKhil"], rev, TOL_SUM, "totals.revKhil = sum of the items")
    c.near(m["totals"]["expKhil"], exp, TOL_SUM, "totals.expKhil = sum of the items")
    c.near(m["totals"]["revKhil"], law["totals"]["law"]["rev"], TOL, "totals.revKhil = law totals")
    c.near(m["totals"]["expKhil"], law["totals"]["law"]["exp"], TOL, "totals.expKhil = law totals (13 326 470,3)")
    pt = m["programTotals"]
    c.ok(pt["budgets"] == tiers["validated"] + tiers["program-budget-differs"] == 42 and pt["pending"] == tiers["pending"] == 4
         and pt["differ"] == tiers["program-budget-differs"] == 3, "programTotals %s vs tiers %s" % (pt, dict(tiers)))
    c.ok(pt["policies"] == pol_total == 82 and pt["programs"] == prog_total == 190, "programTotals policies/programs %s/%s vs %s/%s" % (
        pt["policies"], pt["programs"], pol_total, prog_total))
    c.ok(sorted(kinds) == sorted(KINDS) and sum(kinds.values()) == 46, "kinds used %s" % dict(kinds))
    c.ok(sorted(x["id"] for x in items if x.get("change") is None) == ["0100", "0500", "1800", "2300", "3200", "4700"],
         "budgets without a 2025 total: %s" % [x["id"] for x in items if x.get("change") is None])
    c.fact("46 budgets: revenue %s, expenditure %s хил. €; program budgets: %d validated / %d differ from the law / %d pending (P03); %d policies, %d programs" % (
        fmt(m["totals"]["revKhil"]), fmt(m["totals"]["expKhil"]), tiers["validated"], tiers["program-budget-differs"], tiers["pending"],
        pt["policies"], pt["programs"]))
    return c


# ------------------------------------------------------------------------------------------------ PROGRAMS
def _check_file(c, ctx, item, d):
    """One ministries/<code>.json against its ministries.json item; returns its (level, policy, row) list."""
    i = item["id"]
    w = "ministries/%s.json" % i
    c.ok(list(d) == ["meta", "id", "art", "name", "short", "tier", "years", "yearLabels", "vintage", "cols", "policiesKind", "total", "policies",
                     "yearsComplete", "check", "skipped", "skippedTotal", "doc"], w + ": keys %s" % list(d))
    mt = d["meta"]
    c.ok(mt["id"] == "D09" and mt["status"] == "real" and mt["source"] == ["prb"] and mt["unit"] == "хил. €" and mt["mock"] is False
         and L.ISO.match(mt["asOf"]) and mt["asOf"] <= L.BUILD_DATE, w + ": meta")
    c.ok(d["id"] == i and d["art"] == item["art"] and d["name"] == item["name"] and d["short"] == item["short"] and d["tier"] == item["programs"]["tier"]
         and d["policiesKind"] == item["policiesKind"], w + ": id/art/name/short/tier/policiesKind differ from ministries.json")
    c.ok(d["years"] == YEARS and d["yearLabels"] == YEAR_LABELS and d["vintage"] == VINTAGE and d["cols"] == COLS, w + ": years/labels/vintage/cols")
    yc = d["yearsComplete"]
    c.ok(yc == sorted(set(yc)) and set(yc) <= set(YEARS) and 2026 in yc, w + ": yearsComplete %s" % yc)
    c.ok(len(d["skipped"]) == d["skippedTotal"] and all(isinstance(s, str) and s.strip() for s in d["skipped"]), w + ": skipped list vs skippedTotal")
    rows = _prog_rows(d)
    codes = [r["code"] for _l, _p, r in rows]
    c.ok(len(set(codes)) == len(codes), w + ": duplicate codes")
    for lvl, parent, r in rows:
        ww = "%s %s" % (w, r["code"])
        c.ok(_clean_name(r["name"]), ww + ": name %r" % r["name"])
        if lvl == "policy" or (lvl == "program" and not parent):
            # a policy that has programs is a policy; one that has none is listed by the budget as a program of its own
            c.ok(re.match(r"^%s\.\d{2}\.00$" % i, r["code"]) and r["kind"] == ("policy" if lvl == "policy" else "program"), ww + ": policy code/kind")
        else:
            c.ok(re.match(r"^%s\.\d{2}\.(?!00)\d{2}$" % i, r["code"]) and r["code"][:7] == parent[:7], ww + ": program code under policy %s" % parent)
        c.ok(set(r["values"]) <= set(str(y) for y in YEARS), ww + ": value years %s" % sorted(r["values"]))
        for y, v in r["values"].items():
            if not c.ok(len(v) == 9 and all(isnum(x) for x in v), ww + " %s: nine numbers" % y):
                continue
            for k in (0, 3, 6):
                c.near(v[k], v[k + 1] + v[k + 2], TOL_COL, "%s %s: %s = budget + other" % (ww, y, COLS[k]))
            c.near(v[0], v[3] + v[6], TOL_COL, "%s %s: consolidated = department + administration" % (ww, y))
    # totals: the policies add up to the total, the programs to their policy, in every complete year
    pol_ok = prog_ok = True
    for y in yc:
        ys = str(y)
        if not c.ok(ys in d["total"] and len(d["total"][ys]) == 9 and all(isnum(v) for v in d["total"][ys]), "%s: total %s" % (w, y)):
            continue
        pols = d["policies"]
        tol = min(0.3, 0.05 * (len(pols) + 1) + 0.01)
        for k in range(9):
            s = sum(p["values"].get(ys, BLANK)[k] for p in pols)             # a row without a value for the year counts 0
            if abs(s - d["total"][ys][k]) > tol + 1e-9:
                pol_ok = False
                c.fail("%s %s %s: policies sum to %.1f, total %.1f" % (w, y, COLS[k], s, d["total"][ys][k]))
        for pol in pols:
            progs = pol.get("programs")
            if not progs:
                continue
            tol = min(0.3, 0.05 * (len(progs) + 1) + 0.01)
            for k in range(9):
                s = sum(r["values"].get(ys, BLANK)[k] for r in progs)
                pv = pol["values"].get(ys, BLANK)[k]
                if abs(s - pv) > tol + 1e-9:
                    prog_ok = False
                    c.fail("%s %s %s: programs of %s sum to %.1f, policy %.1f" % (w, y, COLS[k], pol["code"], s, pv))
    ck = d["check"]
    c.ok(ck["policiesSumToTotal"] is pol_ok and ck["programsSumToPolicies"] is prog_ok and pol_ok and prog_ok, w + ": check flags vs recomputed sums")
    t26 = d["total"].get("2026")
    if t26:
        c.near(ck["prbTotal2026"], t26[1], TOL, w + ": check.prbTotal2026 = total 2026 (budget column)")
        c.near(ck["zdbExp"], item["expKhil"], TOL, w + ": check.zdbExp = the law")
        same = abs(ck["prbTotal2026"] - ck["zdbExp"]) <= 0.05
        c.ok(ck["matchesLaw"] is same and same == (d["tier"] == "validated"), w + ": matchesLaw %s tier %s" % (ck["matchesLaw"], d["tier"]))
        c.ok(("diffKhil" in ck) == (not same), w + ": diffKhil exists exactly when the program budget differs")
        if "diffKhil" in ck:
            c.near(ck["diffKhil"], ck["zdbExp"] - ck["prbTotal2026"], TOL, w + ": diffKhil = law - program budget")
    # the counts that ministries.json announces
    p = item["programs"]
    c.ok(p["policyCount"] == sum(1 for _l, _p, r in rows if _l == "policy") and p["count"] == sum(1 for _l, _p, r in rows if _l == "program"),
         "%s: counts %s vs %d policies / %d programs" % (w, (p["policyCount"], p["count"]), sum(1 for r in rows if r[0] == "policy"),
                                                        sum(1 for r in rows if r[0] == "program")))
    # the source document
    doc = d["doc"]
    c.ok(sorted(doc) == ["archive", "archiveUrl", "file", "pages", "pagesByYear"] and doc["file"].lower().endswith(".pdf") and "/" not in doc["file"]
         and doc["archiveUrl"] == ARCHIVE and isinstance(doc["archive"], str) and doc["archive"], w + ": doc %s" % sorted(doc))
    c.ok(doc["pages"] == sorted(set(doc["pages"])) and all(isinstance(n, int) and n > 0 for n in doc["pages"]), w + ": doc.pages")
    c.ok(set(doc["pagesByYear"]) <= set(str(y) for y in YEARS) and all(set(v) <= set(doc["pages"]) for v in doc["pagesByYear"].values()),
         w + ": doc.pagesByYear")
    text = " ".join(str(v) for k, v in doc.items() if k != "pages" and k != "pagesByYear").lower()
    c.ok(not any(t in text for t in INTERNAL if t not in ("/lov", "state/")), w + ": internal wording in doc")
    return rows


def g_programs(ctx):
    c = Check("PROGRAMS")
    m = ctx.get("ministries.json")
    pj = ctx.get("programs.json")
    files = sorted(f for f in os.listdir(os.path.join(L.DATA, "ministries")) if f.endswith(".json"))
    real = sorted(x["id"] for x in m["items"] if x["programs"]["status"] == "real")
    c.ok([f[:-5] for f in files] == real and len(real) == 42, "ministries/ holds %d files, ministries.json announces %d: %s" % (
        len(files), len(real), sorted(set(f[:-5] for f in files) ^ set(real))))
    byid = dict((x["id"], x) for x in m["items"])
    expect = {}
    for i in real:
        d = ctx.get("ministries/%s.json" % i)
        for lvl, parent, r in _check_file(c, ctx, byid[i], d):
            expect[r["code"]] = (i, lvl, parent, r)
    # programs.json: one row per policy / program, identical numbers
    pm = pj["meta"]
    c.ok(pm["id"] == "D09" and pm["status"] == "real" and set(pm["source"]) == {"prb", "zdb"} and pm["unit"] == "хил. €" and L.ISO.match(pm["asOf"]),
         "programs.json meta")
    c.ok(list(pj) == ["meta", "fields", "sentinels", "note", "items"] and pj["fields"] == FIELDS and pj["sentinels"] == SENTINELS
         and isinstance(pj["note"], str) and pj["note"], "programs.json keys / fields / sentinels")
    rows = pj["items"]
    c.ok(len(rows) == len(expect) == 272, "programs.json has %d rows, the files %d (272 expected)" % (len(rows), len(expect)))
    seen = set()
    levels = collections.Counter()
    for row in rows:
        c.ok(len(row) == len(FIELDS), "programs.json row length %d" % len(row))
        r = dict(zip(FIELDS, row))
        code = r["code"]
        w = "programs.json %s" % code
        c.ok(code not in seen, w + ": duplicate row")
        seen.add(code)
        if not c.ok(code in expect, w + ": no such row in ministries/<code>.json"):
            continue
        i, lvl, parent, src = expect[code]
        levels[r["level"]] += 1
        c.ok(r["ministry"] == i and r["level"] == lvl and r["policy"] == parent and r["name"] == src["name"], w + ": ministry/level/policy/name differ from the file")
        v = src["values"]                                       # column 0 = consolidated total, column 1 = the budget's own column
        y26, p26 = (v["2026"][0], v["2026"][1]) if "2026" in v else (-1, -1)
        y25, p25 = (v["2025"][0], v["2025"][1]) if "2025" in v else (-1, -1)
        c.near(r["y2026"], y26, TOL, w + " y2026")
        c.near(r["prb2026"], p26, TOL, w + " prb2026")
        c.near(r["y2025"], y25, TOL, w + " y2025")
        c.near(r["prb2025"], p25, TOL, w + " prb2025")
        if y25 > 0 and y26 >= 0:
            c.near(r["growthPct"], 100.0 * (y26 / y25 - 1.0), 0.051, w + " growthPct")
        else:
            c.ok(r["growthPct"] == SENTINELS["noGrowth"], w + ": growthPct must be the no-growth sentinel, got %s" % r["growthPct"])
        c.ok(r["isNew"] == (1 if (0 <= y25 <= 0.05 and y26 > 0) else 0), w + ": isNew %s" % r["isNew"])
    c.ok(set(expect) == seen, "rows missing from programs.json: %s" % sorted(set(expect) - seen)[:5])
    c.ok(levels == {"policy": 82, "program": 190}, "programs.json levels %s (82 policies, 190 programs expected)" % dict(levels))
    c.fact("%d program files; %d rows in programs.json (%d policies, %d programs); every policy sums to its programs and the total, every name clean" % (
        len(files), len(rows), levels["policy"], levels["program"]))
    return c


GROUPS = (
    ("LAW", g_law, "law.json: 46 budgets, bill against law, arts 2 + 3 + 17 = art. 1, legislative path, 69 proposals without author names"),
    ("BUDGETS", g_budgets, "ministries.json: 46 budgets against the law, policies, change %, tiers 39 / 3 / 4"),
    ("PROGRAMS", g_programs, "ministries/<code>.json (42) and programs.json: sums, names, flags, index rows"),
)
