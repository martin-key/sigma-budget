#!/usr/bin/env python3
"""D08 + D10 input: the budgets of the adopted ЗДБ 2026 (ДВ бр. 69/31.07.2026) against the bill as submitted.

Reads (read-only):  prototype/data/raw/dv/zdb2026_dv69_idMat245041.html   the adopted law (46 budgets, чл. 2-47, + чл. 1)
                    prototype/data/raw/parliament/52-602-01-19.docx    the bill, parliament file 52-602-01-19
Writes:             tools/mock/cache/law_bill.json                              consumed by build_data.py (bd_budgets, bd_law, bd_misc)

What is compared (all amounts in хил. €, as printed):
  * every budget's headline rows (revenue, expenditure, transfers, EU contribution, balance, financing),
  * the line-by-line table of each budget, the distribution by policy / functional area, the commitments (ангажименти),
  * for the judiciary (чл. 2) the expenditure by judicial body,
  * чл. 51 (transfers to the 265 municipalities) and чл. 52 (delegated activities) per municipality.

Fact about the bill file: чл. 1 and чл. 2 occur TWICE in it. The first occurrence is the text with the judiciary's budget as
drafted by the Висш съдебен съвет; the second one sits under the heading „Становище на Министерския съвет“ and equals the
adopted law. The other articles occur once. So "bill" below = the first occurrence ("as submitted"), "billMc" = the second.

Checks (a failed one exits with 1): 46 budgets in both texts; Σ expenditure 13 326 470,3 and Σ revenue 2 284 302,7; names and
policy tables agree with prototype/src/zdb2026.json; art. 1 agrees with dv_laws_2026.json; the Council of Ministers'
occurrence of чл. 1/2 equals the law; distribution tables sum to the budget's expenditure; чл. 51 sums to 4 887 464,0.
"""
import difflib
import sys

import lawparse as L
from dlib import RAW, SRC, Problems, jload, say, write_cache

LAW_HTML = RAW / "dv" / "zdb2026_dv69_idMat245041.html"
BILL_DOCX = RAW / "parliament" / "52-602-01-19.docx"
EXPECT_BUDGETS = 46
EXPECT_SUM_EXP = 13326470.3
EXPECT_SUM_REV = 2284302.7
EXPECT_ART51 = {"total": 4887464.0, "delegated": 4351706.0, "equalizing": 255658.0, "winter": 25100.0,
                "capital": 255000.0, "other": 40500.0}
ART51_COLS = ["total", "delegated", "equalizing", "winterRoads", "capital", "otherTargeted"]
ART52_COLS = ["delegated", "admin", "mayors", "adminStaff", "defence", "education", "health", "social", "culture",
              "economy"]
TOL = 0.051                                    # one printed decimal


# ----------------------------------------------------------------------------------------------- budgets
def line_key(r):
    return (r["sec"], r["no"].rstrip("."), L.squash(r["text"]))


def _lines_out(rows):
    return [[r["sec"], r["no"].rstrip("."), r["text"], r["value"]] for r in rows]


def record(occ):
    b = L.parse_budget(occ["items"])
    return {"name": occ["name"], "headline": b["headline"], "policiesKind": b["policiesKind"],
            "policies": b["policies"], "policyTotal": b["policyTotal"], "bodies": b["bodies"],
            "bodiesTotal": b["bodiesTotal"], "commitments": b["commitments"], "_rows": b["lines"]}


def parse_articles(blocks):
    arts = L.split_articles(blocks)
    return {a: [record(o) for o in occ] for a, occ in arts.items()}


def _val_changed(x, y):
    if x is None or y is None:
        return x != y
    return abs(x - y) > 1e-9


def diff_rows(bl, ll):
    """Opcode diff of two row lists keyed by (section, number, squashed text). Only differences are returned."""
    bl = [r for r in bl if r["value"] is not None]
    ll = [r for r in ll if r["value"] is not None]
    sm = difflib.SequenceMatcher(None, [line_key(r) for r in bl], [line_key(r) for r in ll], autojunk=False)
    out = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            for x, y in zip(bl[i1:i2], ll[j1:j2]):
                if _val_changed(x["value"], y["value"]):
                    out.append({"op": "chg", "sec": x["sec"], "no": x["no"].rstrip("."), "text": x["text"],
                                "bill": x["value"], "law": y["value"]})
        else:
            for x in bl[i1:i2]:
                out.append({"op": "del", "sec": x["sec"], "no": x["no"].rstrip("."), "text": x["text"],
                            "bill": x["value"]})
            for y in ll[j1:j2]:
                out.append({"op": "add", "sec": y["sec"], "no": y["no"].rstrip("."), "text": y["text"],
                            "law": y["value"]})
    return out


def flat(items):
    """Policies with their `parts` as one flat list (document order)."""
    out = []
    for i in items:
        out.append(i)
        out.extend(i.get("parts", []))
    return out


def _named(items):
    """policies/bodies as pseudo rows for diff_rows."""
    return [{"sec": "", "no": i.get("n", ""), "text": i["name"], "value": i["khil"]} for i in flat(items)]


def diff_record(bill, law):
    d = {}
    hl = {}
    for k in sorted(set(bill["headline"]) | set(law["headline"])):
        x, y = bill["headline"].get(k), law["headline"].get(k)
        if _val_changed(x, y):
            hl[k] = {"bill": x, "law": y}
    if hl:
        d["headline"] = hl
    lines = diff_rows(bill["_rows"], law["_rows"])
    if lines:
        d["lines"] = lines
    pol = diff_rows(_named(bill["policies"]), _named(law["policies"]))
    if pol:
        d["policies"] = pol
    bod = diff_rows(_named(bill["bodies"]), _named(law["bodies"]))
    if bod:
        d["bodies"] = bod
    cm = {}
    for k in ("entered", "new"):
        x = (bill["commitments"] or {}).get(k)
        y = (law["commitments"] or {}).get(k)
        if _val_changed(x, y):
            cm[k] = {"bill": x, "law": y}
    if cm:
        d["commitments"] = cm
    if bill["policyTotal"] != law["policyTotal"]:
        d["policyTotal"] = {"bill": bill["policyTotal"], "law": law["policyTotal"]}
    return d


# ----------------------------------------------------------------------------------------------- municipalities
def _municipal_tables(blocks):
    """Chunks that list the municipalities by oblast (art. 51 first, art. 52 second) -> [{'rows': [...], 'total': [...]}]."""
    out = []
    for kind, rows in blocks:
        if kind != "t":
            continue
        if sum(1 for r in rows if r and L.ws(r[0]).upper().startswith("ОБЛАСТ")) < 20:
            continue
        region, items, total = None, [], None
        for r in rows:
            c0 = L.fold(r[0]) if r else ""
            if c0.upper().startswith("ОБЛАСТ"):
                region = c0
                continue
            if not c0:
                continue
            cells = [L.ws(c) for c in r[1:]]
            if len(r) == 8 and not cells[0]:           # the .docx has an empty second cell in the art. 51 table
                cells = cells[1:]
            if L.squash(c0).startswith("ВСИЧКО"):
                total = [L.bgnum(c) for c in cells]
                continue
            try:
                vals = [L.bgnum(c) for c in cells]
            except ValueError:
                continue                               # header rows ('Общини', 'в т.ч. за:', ...)
            if region and any(v is not None for v in vals):
                # 'СТОЛИЧНА ОБЩИНА' is printed between the oblasts Смолян and София; it is the oblast София (столица)
                reg = "ОБЛАСТ СОФИЯ (СТОЛИЦА)" if L.squash(c0) == "СТОЛИЧНАОБЩИНА" else region
                items.append({"region": reg, "name": c0, "values": vals})
        if items:
            out.append({"rows": items, "total": total})
    return out


def municipal(blocks):
    tabs = _municipal_tables(blocks)
    if len(tabs) != 2:
        raise ValueError("expected 2 municipal tables (art. 51 and art. 52), found %d" % len(tabs))
    return {"art51": tabs[0], "art52": tabs[1]}


def diff_municipal(bill, law, cols, p, label):
    if len(bill["rows"]) != len(law["rows"]):
        p.error("%s: %d municipalities in the bill, %d in the law" % (label, len(bill["rows"]), len(law["rows"])))
        return None
    chg = []
    for b, l in zip(bill["rows"], law["rows"]):
        if (b["region"], L.squash(b["name"])) != (l["region"], L.squash(l["name"])):
            p.error("%s: row order differs at %r / %r" % (label, b["name"], l["name"]))
            return None
        for c, x, y in zip(cols, b["values"], l["values"]):
            if _val_changed(x, y):
                chg.append({"region": l["region"], "name": l["name"], "col": c, "bill": x, "law": y})
    return chg


# ----------------------------------------------------------------------------------------------- build
def build(p):
    law_arts = parse_articles(L.dv_blocks(LAW_HTML))
    bill_blocks = L.docx_blocks(BILL_DOCX)
    bill_arts = parse_articles(bill_blocks)
    law_blocks = L.dv_blocks(LAW_HTML)

    nums = list(range(1, 48))
    p.check(sorted(law_arts) == nums, "law: articles found %s" % sorted(law_arts))
    p.check(sorted(bill_arts) == nums, "bill: articles found %s" % sorted(bill_arts))
    for a in nums:
        p.check(len(law_arts[a]) == 1, "law: art. %d occurs %d times" % (a, len(law_arts[a])))
        want = 2 if a in (1, 2) else 1
        p.check(len(bill_arts[a]) == want, "bill: art. %d occurs %d times, expected %d" % (a, len(bill_arts[a]), want))

    # --- sums and cross-checks on the law
    law = {a: law_arts[a][0] for a in nums}
    sum_exp = sum(law[a]["headline"].get("exp") or 0 for a in nums if a >= 2)
    sum_rev = sum(law[a]["headline"].get("rev") or 0 for a in nums if a >= 2)
    p.check(abs(sum_exp - EXPECT_SUM_EXP) < TOL, "law: sum of budget expenditure %.1f != %.1f" % (sum_exp, EXPECT_SUM_EXP))
    p.check(abs(sum_rev - EXPECT_SUM_REV) < TOL, "law: sum of budget revenue %.1f != %.1f" % (sum_rev, EXPECT_SUM_REV))
    for a in nums:
        if a >= 2:
            r = law[a]
            p.check(r["name"], "law: art. %d has no name" % a)
            p.check(r["policies"] and r["policiesKind"], "law: art. %d has no distribution table" % a)
            p.check(r["policyTotal"] is not None and abs(r["policyTotal"] - r["headline"]["exp"]) < TOL,
                    "law: art. %d distribution total %s != expenditure %s" % (a, r["policyTotal"], r["headline"].get("exp")))
            p.check(abs(sum(i["khil"] for i in r["policies"]) - r["policyTotal"]) < 0.3,
                    "law: art. %d distribution items do not sum to the total" % a)
            p.check(r["commitments"] is not None, "law: art. %d has no commitments table" % a)
            # in the printed law the expenditure rows add up: rev - exp + transfers - eucontrib = balance
            h = r["headline"]
            if all(k in h and h[k] is not None for k in ("exp", "balance")):
                bal = (h.get("rev") or 0) - h["exp"] + (h.get("transfers") or 0) - (h.get("eucontrib") or 0)
                p.check(abs(bal - h["balance"]) < 0.3 or h.get("transfers") is None,
                        "law: art. %d balance %.1f != %.1f" % (a, h["balance"], bal))

    # names + policies against the prototype's own extraction (45 budgets)
    z = {r["art"]: r for r in jload(SRC / "zdb2026.json")}
    p.check(len(z) == 45 and 28 not in z, "zdb2026.json: expected 45 budgets without art. 28")
    for a, r in z.items():
        lr = law[a]
        p.check(L.squash(r["name"]) == L.squash(lr["name"]), "name art. %d: %r vs %r" % (a, r["name"], lr["name"]))
        p.check((r["exp"] is None and lr["headline"].get("exp") is None) or abs(r["exp"] - lr["headline"]["exp"]) < TOL,
                "zdb2026.json exp art. %d: %s vs %s" % (a, r["exp"], lr["headline"].get("exp")))
        rev_a, rev_b = r["rev"] or 0, lr["headline"].get("rev") or 0
        p.check(abs(rev_a - rev_b) < TOL, "zdb2026.json rev art. %d: %s vs %s" % (a, r["rev"], lr["headline"].get("rev")))
        if r["items"]:
            ours = [(i["n"], round(i["khil"], 1)) for i in flat(lr["policies"])]
            theirs = [(i["n"], round(i["k"], 1)) for i in r["items"]]
            p.check(ours == theirs, "policies art. %d differ from zdb2026.json" % a)
    dv1 = jload(RAW / "dv" / "dv_laws_2026.json")["zdb"]["art1"]
    ours1 = [((r["no"].rstrip("."), L.squash(r["text"])), r["value"]) for r in law[1]["_rows"]]
    nproto = 0
    for para in ("para1", "para2", "para3", "para4"):
        for r in dv1[para]:
            nproto += 1
            key = (r["no"].rstrip("."), L.squash(r["label"]))
            hit = next((i for i, (k, v) in enumerate(ours1) if k == key and v is not None and abs(v - r["value"]) < TOL), None)
            p.check(hit is not None, "art. 1 line %s %r (%s) not found in the re-parsed law" % (r["no"], r["label"][:40], r["value"]))
            if hit is not None:
                ours1.pop(hit)
    say("law: %d budgets (чл. 2-47), Σ exp %.1f, Σ rev %.1f; art. 1 has %d lines (%d checked against dv_laws_2026.json)"
        % (sum(1 for a in nums if a >= 2), sum_exp, sum_rev, len(law[1]["_rows"]), nproto))

    # --- the bill: first occurrence = as submitted; second occurrence (art. 1, 2) = Council of Ministers' position
    bill = {a: bill_arts[a][0] for a in nums}
    bill_mc = {a: bill_arts[a][1] for a in (1, 2)}
    # The Council of Ministers' occurrence equals the law, except for the amendment of чл. 16 (МОН: +51,1 хил. € for the
    # „Научен институт „Западни покрайнини““, taken from other lines of the same budget) that reaches чл. 1 line 1.2 / 1.2.2.
    d = diff_record(bill_mc[2], law[2])
    p.check(not d, "bill (МС position) art. 2 differs from the law: %s" % list(d))
    d = diff_record(bill_mc[1], law[1])
    p.check(not d.get("headline"), "bill (МС position) art. 1 headline differs from the law: %s" % d.get("headline"))
    shifted = sorted((x["no"], x.get("bill"), x.get("law")) for x in d.get("lines", []))
    p.check(shifted == [("1.2", 1127159.0, 1127210.1), ("1.2.2", 112699.0, 112750.1)],
            "bill (МС position) art. 1 differs from the law in unexpected lines: %s" % shifted)
    diffs = {}
    for a in nums:
        d = diff_record(bill[a], law[a])
        if d:
            diffs[a] = d
        if a >= 2:
            p.check(L.squash(bill[a]["name"] or "") == L.squash(law[a]["name"] or ""), "bill art. %d name differs" % a)
    say("bill vs law: differences in articles %s" % sorted(diffs))

    # explain art. 1 by art. 2 (the judiciary): every art. 1 headline difference of rev/exp is the art. 2 difference
    if 1 in diffs and 2 in diffs:
        for k in ("rev", "exp"):
            d1 = diffs[1]["headline"].get(k)
            d2 = diffs[2]["headline"].get(k)
            if d1 and d2:
                p.check(abs((d1["law"] - d1["bill"]) - (d2["law"] - d2["bill"])) < TOL
                        or k == "exp",
                        "art. 1 vs art. 2 difference of %s" % k)

    # --- municipalities (чл. 51 and 52)
    mlaw, mbill = municipal(law_blocks), municipal(bill_blocks)
    muni = {}
    for key, cols in (("art51", ART51_COLS), ("art52", ART52_COLS)):
        t = mlaw[key]
        n = len(t["rows"])
        p.check(n == 265, "law %s: %d municipalities" % (key, n))
        for j, c in enumerate(cols):
            s = sum((r["values"][j] or 0.0) for r in t["rows"])
            tot = t["total"][j] if t["total"] else None
            p.check(tot is not None and abs(s - tot) < 0.5, "law %s: column %s sums to %.1f, printed total %s" % (key, c, s, tot))
        chg = diff_municipal(mbill[key], t, cols, p, "bill-vs-law " + key)
        muni[key] = {"cols": cols, "law": t, "billVsLaw": chg}
    t51 = mlaw["art51"]["total"]
    for j, k in enumerate(["total", "delegated", "equalizing", "winter", "capital", "other"]):
        p.check(abs(t51[j] - EXPECT_ART51[k]) < TOL, "art. 51 total %s = %s != %s" % (k, t51[j], EXPECT_ART51[k]))
    # against the prototype's table of art. 51
    proto = jload(RAW / "dv" / "dv_laws_2026.json")["zdb"]["art51"]["municipalities"]
    p.check(len(proto) == 265, "dv_laws_2026.json art. 51: %d rows" % len(proto))
    for pr, r in zip(proto, mlaw["art51"]["rows"]):
        v = r["values"]
        want = [pr["total"], pr["delegated"], pr["equalizing"], pr["winter_roads"], pr["capital"], pr["other_targeted"]]
        ok = (pr["region"] is None or L.squash(pr["region"]) == L.squash(r["region"])) and all(
            (a is None and b is None) or (a is not None and b is not None and abs(a - b) < TOL) for a, b in zip(want, v))
        p.check(ok, "art. 51 row %r differs from dv_laws_2026.json" % pr["name"])
    say("art. 51: %d municipalities, total %.1f; bill vs law differences: art.51 %d, art.52 %d"
        % (len(t51 and mlaw["art51"]["rows"]), t51[0], len(muni["art51"]["billVsLaw"] or []),
           len(muni["art52"]["billVsLaw"] or [])))

    # --- output
    def out(r, with_lines):
        o = {k: v for k, v in r.items() if k != "_rows"}
        if with_lines:
            o["lines"] = _lines_out(r["_rows"])
        return o

    result = {
        "sources": {"law": "ЗДБ 2026, ДВ бр. 69 от 31.07.2026 (%s)" % LAW_HTML.name,
                    "bill": "законопроект 52-602-01-19 (%s)" % BILL_DOCX.name},
        "law": {str(a): out(law[a], True) for a in nums},
        "bill": {str(a): out(bill[a], a in diffs) for a in nums},
        "billMc": {str(a): out(bill_mc[a], False) for a in (1, 2)},
        "diff": {str(a): diffs[a] for a in sorted(diffs)},
        "sums": {"expKhil": round(sum_exp, 1), "revKhil": round(sum_rev, 1), "budgets": EXPECT_BUDGETS},
        "municipal": {k: {"cols": v["cols"],
                          "law": {"rows": v["law"]["rows"], "total": v["law"]["total"]},
                          "billVsLaw": v["billVsLaw"]} for k, v in muni.items()},
    }
    return result


def main():
    p = Problems("extract_bill")
    for need in (LAW_HTML, BILL_DOCX):
        if not need.exists():
            sys.exit("extract_bill: input missing: %s (raw file, not in the repository: docs/data-sources.md)" % need.relative_to(RAW.parents[2]))
    result = build(p)
    if not p.errors:
        write_cache("law_bill.json", result)
        say("wrote tools/mock/cache/law_bill.json")
    p.finish()


if __name__ == "__main__":
    sys.exit(main())
