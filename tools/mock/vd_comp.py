"""COMPONENTS and RATES groups of validate_data.py: components.json (D07) and rates.json (D17).

COMPONENTS: the five constituent budgets (state, DOO, NZOK, municipalities, EU accounts) and the other recipients of art. 1 of the law,
the transfers between them, the national vs EU split of the consolidated programme, the Sankey links and the pending monthly split.
Every figure is tied to another file where one exists (law.json art. 1, outlook.json, execution.json, municipalities.json).
RATES: the contribution and tax rates of 2026 (NAP table, ZBDOO, ZBNZOK, ASBP annex 2): the scenario identities are recomputed from
the verbatim ASBP assumption strings, and the two annex tables (minimum insurable income, TZPB rate) from their cells.
Pure standard library.
"""
import re

import vd_lib as L
from vd_lib import Check, isnum


def _tol_sum(n):
    """Sum of n printed parts (one decimal each) against a printed total, or any two rounded values built from them."""
    return 0.05 * (n + 1) + 0.01


def dig(o, *path):
    """o[p0][p1]... or None when a step is missing (so a damaged file is reported by a check, not by a crash)."""
    for p in path:
        try:
            o = o[p]
        except (KeyError, IndexError, TypeError):
            return None
    return o


def _all(vals):
    return all(isnum(v) for v in vals)


def _rows(rs):
    """[{'id', 'khil'}, ...] -> {id: khil}."""
    return dict((r.get("id"), r.get("khil")) for r in rs if isinstance(r, dict))


def _law_lines(ctx):
    """law.json art. 1 as {(section, number): law value}; the 'в т.ч.' lines have no number and are skipped."""
    out = {}
    for r in ctx.get("law.json")["art1"]["lines"]:
        if r.get("no") and "law" in r:
            out[(r["sec"], r["no"])] = r["law"]
    return out


# ------------------------------------------------------------------------------------------------ COMPONENTS
TOP = ["meta", "budgets", "transfers", "nationalVsEu", "sankey", "monthlyByBudget", "notes", "pending"]
BUDGET_KEYS = ["state", "doo", "nzok", "municipalities", "euAccounts", "other"]
BUDGET_SRC = {"state": ["zdb"], "doo": ["zbdoo"], "nzok": ["zbnzok"], "municipalities": ["zdb", "asbp"], "euAccounts": ["asbp", "zdb"], "other": ["asbp"]}
DOO_REV = ["contributions", "nonTax", "vat", "transfers", "transfersShortage"]
DOO_EXP = ["pensions", "benefits", "programmes", "defence", "transfersOut"]
DOO_PENS = ["fromDoo", "fromState", "euRights"]
NZOK_REV = ["contributions", "transfersInsurance", "nonTax", "transfersHealthMinistry"]
NZOK_EXP = ["staff", "admin", "payments", "healthMinistry", "assets", "reserve"]
NZOK_PAY = ["primary", "specialised", "dental", "diagnostics", "medicines", "devicesHospital", "hospital", "other"]
OTHER_IDS = ["bnt", "bnr", "bta", "banMon", "universities", "banMoew", "militaryUniversities"]
KIND_IDS = ["delegated", "equalizing", "winterRoads", "capital"]
LINK_TARGETS = ["municipalities", "doo", "nzok", "euNf", "euDfz", "other"]
NODE_IDS = ["state"] + LINK_TARGETS


def _same_len(c, rows, ids, what):
    c.ok([r.get("id") for r in rows] == ids, "%s: row ids %s" % (what, [r.get("id") for r in rows]))


def g_components(ctx):
    c = Check("COMPONENTS")
    d = ctx.get("components.json")
    law = _law_lines(ctx)
    art1 = ctx.get("law.json")["art1"]["headline"]
    outlook = ctx.get("outlook.json")
    execu = ctx.get("execution.json")
    munic = ctx.get("municipalities.json")
    core = ctx.get("core.json")
    c.ok(list(d) == TOP, "components keys %s" % list(d))
    me = d["meta"]
    c.ok(me["id"] == "D07" and me["status"] == "real" and me["source"] == ["zdb", "zbdoo", "zbnzok", "asbp", "kfp"] and me["unit"] == "хил. €" and me["mock"] is False,
         "meta id / status / source / unit")
    c.ok(me["pending"] == ["P02"] and d["pending"] == ["P02"], "pending is P02 in meta and at the top")
    c.ok(me["asOf"] == "2026-07-31" and me["retrieved"] == L.BUILD_DATE, "meta asOf / retrieved")
    c.ok(dig(core, "pending", "P02") == d["monthlyByBudget"], "core.pending.P02 equals components.monthlyByBudget")
    b = d["budgets"]
    c.ok(list(b) == BUDGET_KEYS, "budgets keys %s" % list(b))
    for k in BUDGET_KEYS:
        blk = b.get(k, {})
        c.ok(blk.get("source") == BUDGET_SRC[k], "%s: source %s" % (k, blk.get("source")))
        c.ok(isinstance(blk.get("name"), str) and blk["name"].strip() and isinstance(blk.get("unit"), str) and blk["unit"].strip(), "%s: name / unit" % k)
        sn = blk.get("sourceNote")
        c.ok(isinstance(sn, str) and sn.strip() and "  " not in sn, "%s: sourceNote" % k)

    # ---- the state budget (art. 1 of the law)
    s = b["state"]
    ks = ["revKhil", "taxKhil", "nonTaxKhil", "grantsKhil", "expKhil", "transfersNetKhil", "euContributionKhil", "balanceKhil", "financingKhil",
          "providedKhil", "receivedKhil", "nzokFromHealthMinistryKhil"]
    c.ok(_all([s.get(k) for k in ks]), "state: every figure is a number")
    c.near(s["revKhil"], s["taxKhil"] + s["nonTaxKhil"] + s["grantsKhil"], _tol_sum(3), "state: revenue = tax + non-tax + grants")
    c.near(s["balanceKhil"], s["revKhil"] - s["expKhil"] - s["transfersNetKhil"] - s["euContributionKhil"], _tol_sum(4),
           "state: balance = revenue - expenditure - net transfers - EU contribution")
    c.near(s["financingKhil"], -s["balanceKhil"], 0.011, "state: financing = - balance")
    c.near(s["transfersNetKhil"], s["providedKhil"] - s["receivedKhil"], _tol_sum(2), "state: net transfers = provided - received")
    for key, ref in (("revKhil", ("I", "I")), ("taxKhil", ("I", "1")), ("nonTaxKhil", ("I", "2")), ("grantsKhil", ("I", "3")), ("expKhil", ("II", "II")),
                     ("transfersNetKhil", ("III", "III")), ("providedKhil", ("III", "1")), ("receivedKhil", ("III", "2")),
                     ("euContributionKhil", ("IV", "IV")), ("balanceKhil", ("V", "V")), ("financingKhil", ("VI", "VI")),
                     ("nzokFromHealthMinistryKhil", ("III", "1.3.1"))):
        c.near(s[key], law.get(ref), 0.011, "state.%s vs law.json art. 1 line %s %s" % (key, ref[0], ref[1]))
    for key, hk in (("revKhil", "rev"), ("expKhil", "exp"), ("transfersNetKhil", "transfers"), ("euContributionKhil", "eucontrib"), ("balanceKhil", "balance"),
                    ("financingKhil", "financing")):
        c.near(s[key], dig(art1, hk, "law"), 0.011, "state.%s vs law.json art1.headline.%s.law" % (key, hk))

    # ---- DOO
    o = b["doo"]
    c.ok(o.get("short") == "ДОО", "doo: short")
    _same_len(c, o["rev"], DOO_REV, "doo.rev")
    _same_len(c, o["exp"], DOO_EXP, "doo.exp")
    _same_len(c, o["pensionsSplit"], DOO_PENS, "doo.pensionsSplit")
    rev, exp, pens = _rows(o["rev"]), _rows(o["exp"]), _rows(o["pensionsSplit"])
    c.ok(_all(list(rev.values()) + list(exp.values()) + list(pens.values())), "doo: row values are numbers")
    c.near(sum(rev.values()), o["revAndTransfersKhil"], _tol_sum(5), "doo: revenue rows add up")
    c.near(sum(exp.values()), o["expAndTransfersKhil"], _tol_sum(5), "doo: expenditure rows add up")
    c.near(o["revAndTransfersKhil"], o["expAndTransfersKhil"], 0.011, "doo: revenue = expenditure (balanced budget)")
    c.near(o["balanceKhil"], 0.0, 0.011, "doo: balance is zero")
    c.near(o["ownRevKhil"], rev["contributions"] + rev["nonTax"] + rev["vat"], _tol_sum(3), "doo: own revenue = contributions + non-tax + VAT")
    c.near(o["transfersFromCentralKhil"], rev["transfers"] + rev["transfersShortage"], _tol_sum(2), "doo: transfers from the centre = two transfer rows")
    c.near(o["ownRevKhil"] + o["transfersFromCentralKhil"], o["revAndTransfersKhil"], _tol_sum(2), "doo: own revenue + transfers = total")
    c.near(sum(pens.values()), exp["pensions"], _tol_sum(3), "doo: the three pension rows add up to pensions")
    c.near(o["transfersFromCentralKhil"], law.get(("III", "1.2")), 0.011, "doo: transfers from the centre vs law art. 1 III.1.2")
    c.near(exp["transfersOut"], law.get(("III", "2.1")), 0.011, "doo: transfers out vs law art. 1 III.2.1")
    pf = o["pensionFund"]
    c.ok(list(pf) == ["revAndTransfersKhil", "expAndTransfersKhil", "balanceKhil", "sourceNote"] and _all([pf.get("revAndTransfersKhil"), pf.get("expAndTransfersKhil"),
                                                                                                          pf.get("balanceKhil")]), "doo.pensionFund keys / numbers")
    c.near(pf["balanceKhil"], pf["revAndTransfersKhil"] - pf["expAndTransfersKhil"], _tol_sum(2), "doo.pensionFund: balance = revenue - expenditure")
    c.ok(pf["balanceKhil"] < 0 and pf["expAndTransfersKhil"] < o["expAndTransfersKhil"], "doo.pensionFund: a deficit, and a part of the DOO budget")

    # ---- NZOK
    z = b["nzok"]
    c.ok(z.get("short") == "НЗОК", "nzok: short")
    _same_len(c, z["rev"], NZOK_REV, "nzok.rev")
    _same_len(c, z["exp"], NZOK_EXP, "nzok.exp")
    _same_len(c, z["paymentsSplit"], NZOK_PAY, "nzok.paymentsSplit")
    zr, ze, zp = _rows(z["rev"]), _rows(z["exp"]), _rows(z["paymentsSplit"])
    c.ok(_all(list(zr.values()) + list(ze.values()) + list(zp.values())), "nzok: row values are numbers")
    c.near(sum(zr.values()), z["revAndTransfersKhil"], _tol_sum(4), "nzok: revenue rows add up")
    c.near(sum(ze.values()), z["expAndTransfersKhil"], _tol_sum(6), "nzok: expenditure rows add up")
    c.near(z["revAndTransfersKhil"], z["expAndTransfersKhil"], 0.011, "nzok: revenue = expenditure")
    c.near(z["balanceKhil"], 0.0, 0.011, "nzok: balance is zero")
    c.near(z["ownRevKhil"], zr["contributions"] + zr["nonTax"], _tol_sum(2), "nzok: own revenue = contributions + non-tax")
    c.near(z["transfersFromStateKhil"], zr["transfersInsurance"] + zr["transfersHealthMinistry"], _tol_sum(2), "nzok: transfers from the state = two rows")
    c.near(z["ownRevKhil"] + z["transfersFromStateKhil"], z["revAndTransfersKhil"], _tol_sum(2), "nzok: own revenue + transfers = total")
    c.near(sum(zp.values()), ze["payments"], _tol_sum(8), "nzok: the eight payment rows add up to payments")
    c.near(zr["transfersHealthMinistry"], ze["healthMinistry"], 0.011, "nzok: the Ministry of Health transfer comes in and goes out")
    c.near(z["transfersFromStateKhil"], law.get(("III", "1.3")), 0.011, "nzok: transfers from the state vs law art. 1 III.1.3")
    c.near(zr["transfersHealthMinistry"], law.get(("III", "1.3.1")), 0.011, "nzok: Ministry of Health part vs law art. 1 III.1.3.1")
    c.ok(z["contributionRatePct"] == 8.0, "nzok: contribution rate is 8.0 per cent (ZBNZOK art. 2)")
    rates = ctx.get("rates.json")
    emp = [x for x in rates["scenarios"] if x["id"] == "employment"][0]
    c.near(emp["split"]["employee"]["health"] + emp["split"]["employer"]["health"], z["contributionRatePct"], 0.011, "nzok: rate = employee + employer health share in rates.json")

    # ---- municipalities
    m = b["municipalities"]
    mt = m["transfers"]
    c.ok(m["count"] == 265 == munic["totals"]["count"] and m["year"] == 2026 and m["dataset"] == "municipalities", "municipalities: count / year / dataset")
    gdp26 = dig(outlook, "gdp", "mlnPrecise", 2)
    kfp_exp26 = dig(outlook, "kfp", "expenditure", "mln", 2)
    c.ok(outlook["years"][2] == 2026, "outlook: index 2 is the year 2026")
    c.near(m["expMln"], m["localExpMln"] + m["delegatedExpMln"], _tol_sum(2), "municipalities: local + delegated = expenditure")
    c.near(m["localExpPct"], 100.0 * m["localExpMln"] / m["expMln"], 0.051, "municipalities: local share of expenditure")
    c.near(m["expPctGdp"], 100.0 * m["expMln"] / gdp26, 0.051, "municipalities: expenditure as per cent of GDP 2026")
    c.near(m["expPctKfp"], 100.0 * m["expMln"] / (kfp_exp26 - s["euContributionKhil"] / 1000.0), 0.051,
           "municipalities: expenditure as per cent of the programme without the EU contribution")
    c.near(m["delegatedExpMln"], mt["mainSplit2026"]["delegatedKhil"] / 1000.0, 0.051, "municipalities: delegated expenditure = delegated part of the subsidy")
    c.near(mt["mainSplit2026"]["localKhil"] + mt["mainSplit2026"]["delegatedKhil"], mt["mainKhil"][0], _tol_sum(2), "municipalities: main subsidy split adds up")
    c.ok(mt["years"] == [2026, 2027, 2028] and len(mt["mainKhil"]) == 3, "municipalities.transfers: years / mainKhil length")
    c.ok([k.get("id") for k in mt["byKind"]] == KIND_IDS and all(len(k.get("khil", [])) == 3 and _all(k["khil"]) for k in mt["byKind"]), "municipalities.transfers.byKind ids / lengths")
    for i in range(3):
        c.near(sum(k["khil"][i] for k in mt["byKind"]), mt["mainKhil"][i], _tol_sum(4), "municipalities.transfers: kinds add up to the main subsidy in %d" % mt["years"][i])
    cs = munic["check"]["columnSums"]
    c.near(mt["mainKhil"][0], cs[0], 0.011, "municipalities: main subsidy 2026 vs municipalities.json column sum")
    for i, k in enumerate(mt["byKind"]):
        c.near(k["khil"][0], cs[i + 1], 0.011, "municipalities: %s 2026 vs municipalities.json column sum" % k["id"])
    c.near(mt["otherTargetedKhil"], cs[5], 0.011, "municipalities: other targeted transfers vs municipalities.json")
    c.near(mt["allKhil"], mt["mainKhil"][0] + mt["otherTargetedKhil"], _tol_sum(2), "municipalities: all = main + other targeted")
    c.near(mt["allKhil"], law.get(("III", "1.1")), 0.011, "municipalities: all transfers vs law art. 1 III.1.1")
    c.near(mt["allKhil"], munic["totals"]["allKhil"], 0.011, "municipalities: all transfers vs municipalities.json totals")

    # ---- EU accounts
    e = b["euAccounts"]
    fs = e["fromStateBudgetKhil"]
    c.ok(e["year"] == 2026 and e["vintage"] == "draft", "euAccounts: year / vintage")
    c.near(e["balanceMln"], e["revMln"] - e["expMln"] + e["transferFromStateMln"], _tol_sum(3), "euAccounts: balance = revenue - expenditure + transfer")
    c.ok(list(fs) == ["nf", "dfz", "sum"], "euAccounts.fromStateBudgetKhil keys")
    c.near(fs["sum"], fs["nf"] + fs["dfz"], _tol_sum(2), "euAccounts: the two accounts add up")
    c.near(fs["nf"], law.get(("III", "1.4")), 0.011, "euAccounts: National Fund vs law art. 1 III.1.4")
    c.near(fs["dfz"], law.get(("III", "1.5")), 0.011, "euAccounts: State Fund Agriculture vs law art. 1 III.1.5")
    c.ok(fs["sum"] / 1000.0 <= e["transferFromStateMln"], "euAccounts: the transfers named in the law do not exceed the table II-4 total")

    # ---- other recipients (annex 6)
    ot = b["other"]
    c.ok(ot["years"] == [2026, 2027, 2028], "other: years")
    c.ok([i.get("id") for i in ot["items"]] == OTHER_IDS and all(isinstance(i.get("label"), str) and i["label"].strip() and len(i.get("khil", [])) == 3 and _all(i["khil"])
                                                              for i in ot["items"]), "other: item ids / labels / three values each")
    for i in range(3):
        c.near(sum(it["khil"][i] for it in ot["items"]), ot["sumKhil"][i], _tol_sum(7), "other: items add up in %d" % ot["years"][i])
    c.ok(len(ot["sumKhil"]) == 3, "other: sumKhil length")
    c.ok(all(v >= 0 for it in ot["items"] for v in it["khil"]), "other: no negative amounts")

    # ---- the transfers block
    t = d["transfers"]
    c.ok(list(t) == ["unit", "toMunicipalitiesKhil", "toDooKhil", "toNzokKhil", "toEuNfKhil", "toEuDfzKhil", "itemisedKhil", "otherKhil", "providedKhil", "receivedKhil",
                     "netKhil", "toNzokFromHealthMinistryKhil", "source", "sourceNote"], "transfers keys %s" % list(t))
    c.ok(t["unit"] == "хил. €" and t["source"] == ["zdb"], "transfers: unit / source")
    five = [t["toMunicipalitiesKhil"], t["toDooKhil"], t["toNzokKhil"], t["toEuNfKhil"], t["toEuDfzKhil"]]
    c.ok(_all(five + [t["itemisedKhil"], t["otherKhil"], t["providedKhil"], t["receivedKhil"], t["netKhil"]]), "transfers: every figure is a number")
    c.near(sum(five), t["itemisedKhil"], _tol_sum(5), "transfers: the five named recipients add up")
    c.near(t["providedKhil"] - t["itemisedKhil"], t["otherKhil"], 0.06, "transfers: other = provided - named")
    c.near(t["providedKhil"] - t["receivedKhil"], t["netKhil"], 0.06, "transfers: net = provided - received")
    c.ok(t["otherKhil"] > 0, "transfers: the unnamed remainder is positive")
    for key, ref in (("toMunicipalitiesKhil", "1.1"), ("toDooKhil", "1.2"), ("toNzokKhil", "1.3"), ("toEuNfKhil", "1.4"), ("toEuDfzKhil", "1.5"),
                     ("toNzokFromHealthMinistryKhil", "1.3.1"), ("providedKhil", "1"), ("receivedKhil", "2")):
        c.near(t[key], law.get(("III", ref)), 0.011, "transfers.%s vs law art. 1 III.%s" % (key, ref))
    c.near(t["netKhil"], law.get(("III", "III")), 0.011, "transfers.netKhil vs law art. 1 III")
    for key in ("providedKhil", "receivedKhil", "netKhil"):
        c.near(t[key], s[{"providedKhil": "providedKhil", "receivedKhil": "receivedKhil", "netKhil": "transfersNetKhil"}[key]], 0.011, "transfers.%s vs the state block" % key)
    c.near(t["toMunicipalitiesKhil"], m["transfers"]["allKhil"], 0.011, "transfers: municipalities vs the municipalities block")
    c.near(t["toDooKhil"], o["transfersFromCentralKhil"], 0.011, "transfers: DOO vs the DOO block")
    c.near(t["toNzokKhil"], z["transfersFromStateKhil"], 0.011, "transfers: NZOK vs the NZOK block")
    c.near(t["toEuNfKhil"] + t["toEuDfzKhil"], fs["sum"], 0.11, "transfers: EU accounts vs the EU block")

    # ---- Sankey
    sk = d["sankey"]
    c.ok(list(sk) == ["unit", "nodes", "links"] and sk["unit"] == "млн. €", "sankey keys / unit")
    c.ok([n.get("id") for n in sk["nodes"]] == NODE_IDS and all(isinstance(n.get("name"), str) and n["name"].strip() for n in sk["nodes"]), "sankey nodes")
    c.ok([lk.get("target") for lk in sk["links"]] == LINK_TARGETS and all(lk.get("source") == "state" for lk in sk["links"]), "sankey links: one from the state to each recipient")
    ref = dict(zip(LINK_TARGETS, [t["toMunicipalitiesKhil"], t["toDooKhil"], t["toNzokKhil"], t["toEuNfKhil"], t["toEuDfzKhil"], t["otherKhil"]]))
    for lk in sk["links"]:
        w = "sankey link state -> %s" % lk.get("target")
        c.ok(_all([lk.get("value"), lk.get("khil")]) and lk["value"] > 0, "%s: value / khil" % w)
        c.near(lk.get("khil"), ref.get(lk.get("target")), 0.011, "%s: khil vs the transfers block" % w)
        c.near(lk.get("value"), (lk.get("khil") or 0) / 1000.0, 0.051, "%s: value = khil / 1000" % w)
    c.near(sum(lk["khil"] for lk in sk["links"]), t["providedKhil"], _tol_sum(6), "sankey: the links add up to the provided transfers")

    # ---- national vs EU
    n = d["nationalVsEu"]
    c.ok(list(n) == ["unit", "years", "vintage", "national", "eu", "kfp", "exec", "textSplit", "source", "sourceNote"], "nationalVsEu keys %s" % list(n))
    c.ok(n["unit"] == "млн. €" and n["source"] == ["asbp"], "nationalVsEu: unit / source")
    c.ok(n["years"] == outlook["years"] and n["vintage"] == outlook["vintage"], "nationalVsEu: years / vintage equal outlook.json")
    ny = len(n["years"])
    nat, eu, kfp = n["national"], n["eu"], n["kfp"]
    c.ok(list(nat) == ["revMln", "expMln", "spendingMln", "euContributionMln", "transferToEuMln", "balanceMln"], "national keys")
    c.ok(list(eu) == ["revMln", "expMln", "transferFromStateMln", "balanceMln"], "eu keys")
    c.ok(list(kfp) == ["revMln", "expMln", "balanceMln"], "kfp keys")
    for grp, blk in (("national", nat), ("eu", eu), ("kfp", kfp)):
        for k, v in blk.items():
            c.ok(isinstance(v, list) and len(v) == ny and _all(v), "%s.%s: %d numbers" % (grp, k, ny))
    if all(isinstance(v, list) and len(v) == ny for blk in (nat, eu, kfp) for v in blk.values()):
        for i, y in enumerate(n["years"]):
            c.near(nat["balanceMln"][i], nat["revMln"][i] - nat["expMln"][i] + nat["transferToEuMln"][i], _tol_sum(3), "national balance %d = revenue - expenditure + transfer" % y)
            c.near(eu["balanceMln"][i], eu["revMln"][i] - eu["expMln"][i] + eu["transferFromStateMln"][i], _tol_sum(3), "EU balance %d = revenue - expenditure + transfer" % y)
            c.near(nat["transferToEuMln"][i] + eu["transferFromStateMln"][i], 0.0, 0.011, "%d: the transfer leaves the national budget and enters the EU accounts" % y)
            c.near(nat["spendingMln"][i] + nat["euContributionMln"][i], nat["expMln"][i], _tol_sum(2), "national expenditure %d = spending + EU contribution" % y)
            for k, a, bb in (("revMln", nat["revMln"][i], eu["revMln"][i]), ("expMln", nat["expMln"][i], eu["expMln"][i]), ("balanceMln", nat["balanceMln"][i], eu["balanceMln"][i])):
                c.near(a + bb, kfp[k][i], _tol_sum(2), "national + EU = programme (%s, %d)" % (k, y))
            c.near(kfp["revMln"][i], outlook["kfp"]["revenue"]["mln"][i], 0.011, "kfp revenue %d vs outlook.json" % y)
            c.near(kfp["expMln"][i], outlook["kfp"]["expenditure"]["mln"][i], 0.011, "kfp expenditure %d vs outlook.json" % y)
            c.near(kfp["balanceMln"][i], outlook["kfp"]["balance"]["mln"][i], 0.011, "kfp balance %d vs outlook.json" % y)
        c.near(nat["euContributionMln"][2], s["euContributionKhil"] / 1000.0, 0.051, "national: 2026 EU contribution vs the state block")
        c.near(eu["transferFromStateMln"][2], e["transferFromStateMln"], 0.011, "EU: 2026 transfer vs the euAccounts block")
        c.near(eu["revMln"][2], e["revMln"], 0.011, "EU: 2026 revenue vs the euAccounts block")
        c.near(eu["expMln"][2], e["expMln"], 0.011, "EU: 2026 expenditure vs the euAccounts block")
        c.near(eu["balanceMln"][2], e["balanceMln"], 0.011, "EU: 2026 balance vs the euAccounts block")
    ts = n["textSplit"]
    c.ok(ts["years"] == [2024, 2025] and ts["pages"] == [171, 175] and ts["unit"] == "млн. €", "textSplit: years / pages / unit")
    for i, y in enumerate(ts["years"]):
        j = n["years"].index(y)
        c.near(ts["diffNationalMln"][i], ts["nationalMln"][i] - nat["balanceMln"][j], 0.011, "textSplit %d: national difference = text - table" % y)
        c.near(ts["diffEuMln"][i], ts["euMln"][i] - eu["balanceMln"][j], 0.011, "textSplit %d: EU difference = text - table" % y)
        c.near(ts["nationalMln"][i] + ts["euMln"][i], kfp["balanceMln"][j], _tol_sum(2), "textSplit %d: the two parts add up to the programme balance" % y)
        c.ok(ts["diffNationalMln"][i] != 0 and ts["diffEuMln"][i] != 0, "textSplit %d: the text and the table do differ (otherwise the note is wrong)" % y)
    ex = n["exec"]
    lat = execu["latest"]
    c.ok(ex["asOf"] == lat["asOf"] and ex["month"] == lat["month"] and ex["ref"] == "execution" and ex["unit"] == "млн. €", "exec: asOf / month / ref / unit equal execution.json latest")
    for grp, key, src in (("national", "rev", "rev"), ("national", "exp", "exp.total"), ("national", "balance", "balance"),
                          ("eu", "rev", "rev"), ("eu", "exp", "exp.total"), ("eu", "balance", "balance")):
        got = dig(ex, grp, key)
        c.ok(got == dig(lat, "nat" if grp == "national" else "eu", src), "exec.%s.%s equals execution.json latest" % (grp, key))
        plan = dig(got, "plan")
        want = {"rev": "revMln", "exp": "expMln", "balance": "balanceMln"}[key]
        c.near(plan, dig({"national": nat, "eu": eu}[grp], want, 2), 0.011, "exec.%s.%s plan equals the 2026 figure of the table" % (grp, key))
        if key != "balance" and isinstance(got, dict) and isnum(got.get("cum")) and isnum(plan) and plan:
            c.near(got.get("pctPlan"), 100.0 * got["cum"] / plan, 0.0051, "exec.%s.%s: pctPlan" % (grp, key))

    # ---- the pending monthly split
    mb = d["monthlyByBudget"]
    c.ok(mb.get("status") == "pending" and mb.get("id") == "P02" and list(mb) == ["status", "id", "title", "reason", "expected", "source", "screens"], "monthlyByBudget: pending P02 keys %s" % list(mb))
    c.ok(L.numbers_in(mb) == 0, "monthlyByBudget: no numbers while pending")
    c.ok(all(isinstance(mb.get(k), str) and mb[k].strip() for k in ("title", "reason", "expected")) and mb.get("source") == ["minfin"] and mb.get("screens") == ["S15"],
         "monthlyByBudget: texts / source / screens")
    # ---- notes
    notes = d["notes"]
    c.ok(isinstance(notes, list) and len(notes) == 7 and all(isinstance(x, str) and x.strip() and "  " not in x for x in notes), "notes: seven non-empty strings")
    c.fact("COMPONENTS: %d notes; transfers provided %s thousand EUR, of which %s to the five named recipients" % (len(notes), L.fmt(t["providedKhil"]), L.fmt(t["itemisedKhil"])))
    return c


# ------------------------------------------------------------------------------------------------ RATES
SCEN_IDS = ["employment", "management-contract", "self-employed", "pensioner"]
PARTS = ("doo", "upf", "health")
NUM = r"(\d+(?:[  ]\d{3})*(?:,\d+)?)"


def _bg(s):
    """'2 111,64' -> 2111.64"""
    return float(re.sub(r"[  ]", "", s).replace(",", "."))


def _assump(rates):
    """The ASBP assumption rows by number; the 2026 column as the verbatim string."""
    out = {}
    for a in rates["assumptions"]:
        out[a["no"]] = a
    return out


def _first(rx, s):
    m = re.search(rx, s)
    return m.groups() if m else None


def _scenario_checks(c, rates, a):
    """Recompute the contribution shares from the ASBP assumption strings and compare them with the stored scenarios."""
    sc = dict((x["id"], x) for x in rates["scenarios"])
    y26 = lambda no: (a.get(no) or {}).get("years", {}).get("2026", "")
    pension = _first(r"^" + NUM + r" за родените преди 1 януари 1960 г\.; " + NUM + r" за родените след 31 декември 1959 г\.", y26("11.1"))
    sick = float(y26("11.3").replace(",", ".")) if re.match(r"^\d+(,\d+)?$", y26("11.3")) else None
    unemp = float(y26("11.5").replace(",", ".")) if re.match(r"^\d+(,\d+)?$", y26("11.5")) else None
    health = float(y26("12").replace(",", ".")) if re.match(r"^\d+(,\d+)?$", y26("12")) else None
    upf = float(y26("13").replace(",", ".")) if re.match(r"^\d+(,\d+)?$", y26("13")) else None
    gvrs = float(y26("16").replace(",", ".")) if re.match(r"^\d+(,\d+)?$", y26("16")) else None
    split = _first(r"^" + NUM + r":" + NUM + r" за лицата родени преди 1 януари 1960 г\. " + NUM + r":" + NUM + r" за лицата, родени след 31 декември 1959 г\.$", y26("20.2"))
    c.ok(pension is not None and sick is not None and unemp is not None and health is not None and upf is not None and gvrs is not None and split is not None,
         "assumptions: the 2026 strings of rows 11.1, 11.3, 11.5, 12, 13, 16, 20.2 have the printed form")
    if not (pension and split and None not in (sick, unemp, health, upf, gvrs)):
        return
    p_old, p_new = _bg(pension[0]), _bg(pension[1])
    emp_old, ee_old, emp_new, ee_new = [_bg(x) for x in split]      # employer : employee, before 1960 and after 1959
    c.near(emp_old + ee_old, p_old, 0.011, "ASBP row 20.2 (before 1960) adds up to row 11.1")
    c.near(emp_new + ee_new, p_new, 0.011, "ASBP row 20.2 (after 1959) adds up to row 11.1")
    c.ok(_first(r"^60:40$", y26("20.1")) is not None and _first(r"^60:40$", y26("20.3")) is not None, "ASBP rows 20.1 and 20.3: split 60:40")
    er, ee = 0.6, 0.4                                               # employer / employee share of sickness, unemployment and health
    # employment (born after 1959, UPF): doo = pension + 40/60 of sickness and unemployment
    e = sc["employment"]
    c.near(e["split"]["employee"]["doo"], ee_new + ee * sick + ee * unemp, 0.0051, "employment: employee DOO share from the ASBP rows")
    c.near(e["split"]["employer"]["doo"], emp_new + er * sick + er * unemp, 0.0051, "employment: employer DOO share from the ASBP rows")
    c.near(e["split"]["employee"]["health"], ee * health, 0.0051, "employment: employee health share = 40 per cent of 8")
    c.near(e["split"]["employer"]["health"], er * health, 0.0051, "employment: employer health share = 60 per cent of 8")
    c.near(e["split"]["employee"]["upf"] + e["split"]["employer"]["upf"], upf, 0.0051, "employment: UPF shares add up to row 13")
    c.near(e["gvrsPct"], gvrs, 0.0051, "employment: GVRS rate = row 16")
    v = [x for x in e["variants"] if x["id"] == "born-before-1960"]
    c.ok(len(v) == 1 and len(e["variants"]) == 1, "employment: exactly one variant, born-before-1960")
    if v:
        v = v[0]
        c.near(v["split"]["employee"]["doo"], ee_old + ee * sick + ee * unemp, 0.0051, "born-before-1960: employee DOO share")
        c.near(v["split"]["employer"]["doo"], emp_old + er * sick + er * unemp, 0.0051, "born-before-1960: employer DOO share")
        c.ok(v["split"]["employee"]["upf"] == 0.0 and v["split"]["employer"]["upf"] == 0.0, "born-before-1960: no UPF share")
        c.near(v["split"]["employee"]["health"], e["split"]["employee"]["health"], 0.0051, "born-before-1960: the same employee health share")
        c.near(v["split"]["employer"]["health"], e["split"]["employer"]["health"], 0.0051, "born-before-1960: the same employer health share")
        c.near(v["employeePct"], e["employeePct"], 0.0051, "born-before-1960: the same employee total (only the fund split differs)")
        c.near(v["employerPctWithoutTzpb"], e["employerPctWithoutTzpb"], 0.0051, "born-before-1960: the same employer total")
    # self-employed: the whole pension contribution (before 1960 the rate is 19.8, after 1959 14.8), UPF, health
    se = sc["self-employed"]
    c.near(se["split"]["employee"]["doo"], p_new, 0.0051, "self-employed: DOO share = row 11.1 (born after 1959)")
    c.near(se["split"]["employee"]["upf"], upf, 0.0051, "self-employed: UPF share = row 13")
    c.near(se["split"]["employee"]["health"], health, 0.0051, "self-employed: health share = row 12")
    sv = [x for x in se["variants"] if x["id"] == "with-sickness-maternity"]
    c.ok(len(sv) == 1 and len(se["variants"]) == 1, "self-employed: exactly one variant, with-sickness-maternity")
    if sv:
        c.near(sv[0]["split"]["employee"]["doo"], p_new + sick, 0.0051, "with-sickness-maternity: DOO share = pension + sickness fund (row 11.3)")
        c.near(sv[0]["employeePct"], p_new + sick + upf + health, 0.0051, "with-sickness-maternity: total")


def _limits_checks(c, rates, a, sc):
    """Insurable income limits: the ASBP rows 18 and 19, the ZBDOO art. 9 quote and the scenarios."""
    q9 = rates["quotes"]["zbdoo_art9"]
    amounts = [_bg(x) for x in re.findall(NUM + r" евро", q9)]
    c.ok(amounts == [550.66, 2111.64, 620.20, 2300.0], "ZBDOO art. 9 quote: amounts %s" % amounts)
    r18 = (a.get("18") or {}).get("years", {}).get("2026", "")
    r19 = (a.get("19") or {}).get("years", {}).get("2026", "")
    m18 = _first(r"^" + NUM + r", считано от 1 януари; " + NUM + r", считано от 1 август$", r18)
    m19 = _first(r"^" + NUM + r", считано от 1 януари; " + NUM + r", считано от 1 август$", r19)
    c.ok(m18 is not None and m19 is not None, "ASBP rows 18 and 19: the 2026 strings have the printed form")
    mx = [{"id": "until", "from": "2026-01-01", "to": "2026-07-31", "eur": 2111.64}, {"id": "from", "from": "2026-08-01", "to": "2026-12-31", "eur": 2300.0}]
    mn = [{"id": "until", "from": "2026-01-01", "to": "2026-07-31", "eur": 550.66}, {"id": "from", "from": "2026-08-01", "to": "2026-12-31", "eur": 620.2}]
    if m18 and m19:
        c.ok([_bg(x) for x in m18] == [2111.64, 2300.0] and [_bg(x) for x in m19] == [550.66, 620.2], "ASBP rows 18 / 19 equal the law amounts")
    for sid in ("employment", "management-contract", "self-employed"):
        c.ok(sc[sid]["maxInsurableIncomeEur"] == mx, "%s: maxInsurableIncomeEur equals the ZBDOO art. 9 amounts" % sid)
    c.ok(sc["self-employed"]["minInsurableIncomeEur"] == mn, "self-employed: minInsurableIncomeEur equals the ZBDOO art. 9 amounts")
    c.ok(rates["minInsurableIncome"]["selfEmployedEur"] == mn, "minInsurableIncome.selfEmployedEur equals the same amounts")


def g_rates(ctx):
    c = Check("RATES")
    r = ctx.get("rates.json")
    c.ok(list(r) == ["meta", "scenarios", "rules", "incomeTax", "tzpb", "minInsurableIncome", "changes", "napCategories", "assumptions", "quotes", "notes", "checks"],
         "rates keys %s" % list(r))
    me = r["meta"]
    c.ok(me["id"] == "D17" and me["status"] == "real" and me["source"] == ["nap", "zbdoo", "zbnzok", "asbp"] and me["unit"] == "%" and me["pending"] == [] and me["mock"] is False,
         "meta id / status / source / unit / pending")
    c.ok(me["asOf"] == "2026-08-12" and me["retrieved"] == L.BUILD_DATE, "meta asOf / retrieved")
    c.ok(r["rules"] == {"validTo": "2026-07-31", "from": "2026-08-01", "year": 2026}, "rules: the two periods of 2026")
    a = _assump(r)
    c.ok(len(r["assumptions"]) == 15 and len(a) == 15, "assumptions: 15 distinct rows")
    c.ok(all(isinstance(x.get("label"), str) and x["label"].strip() and isinstance(x.get("years"), dict) and all(isinstance(v, str) and v.strip() for v in x["years"].values())
             for x in r["assumptions"]), "assumptions: verbatim strings in every year cell")
    sc = dict((x["id"], x) for x in r["scenarios"])
    c.ok([x["id"] for x in r["scenarios"]] == SCEN_IDS, "scenario ids %s" % [x["id"] for x in r["scenarios"]])
    if list(sc) != SCEN_IDS:
        return c
    core = ctx.get("core.json")
    src_keys = set(k for k in (core.get("sources") or {}))
    # ---- every scenario carries status + source; the three real ones are complete
    for s in r["scenarios"]:
        w = "scenario %s" % s["id"]
        c.ok(s.get("status") in ("real", "pending") and isinstance(s.get("source"), list) and s["source"] and set(s["source"]) <= src_keys, "%s: status / source" % w)
        c.ok(isinstance(s.get("label"), str) and s["label"].strip(), "%s: label" % w)
    pen = sc["pensioner"]
    c.ok(pen["status"] == "pending" and L.numbers_in(pen) == 0 and all(isinstance(pen.get(k), str) and pen[k].strip() for k in ("reason", "expected")), "pensioner: pending, texts, no numbers")
    c.ok(set(pen) == {"id", "label", "status", "source", "reason", "expected"}, "pensioner: keys %s" % sorted(pen))
    for sid in ("employment", "management-contract", "self-employed"):
        s = sc[sid]
        w = "scenario %s" % sid
        c.ok(s["status"] == "real", "%s: status real" % w)
        sp = s["split"]
        for who in ("employee", "employer"):
            c.ok(list(sp[who]) == list(PARTS) and _all(sp[who].values()) and all(v >= 0 for v in sp[who].values()), "%s: %s split parts" % (w, who))
        c.near(s["employeePct"], sum(sp["employee"].values()), 0.0051, "%s: employee total = sum of the three funds" % w)
        c.near(s["employerPctWithoutTzpb"] if "employerPctWithoutTzpb" in s else s["employerPct"], sum(sp["employer"].values()), 0.0051, "%s: employer total = sum of the three funds" % w)
        c.ok(isinstance(s.get("appliesTo"), str) and s["appliesTo"].strip() and isinstance(s.get("basis"), str) and s["basis"].strip(), "%s: appliesTo / basis" % w)
        c.ok(all(isinstance(p.get("field"), str) and isinstance(p.get("reason"), str) and p["reason"].strip() and isinstance(p.get("expected"), str) and p.get("source")
                 for p in s.get("pending", [])), "%s: pending entries carry field / reason / expected / source" % w)
    tz = r["tzpb"]
    for sid in ("employment", "management-contract"):
        s = sc[sid]
        c.ok(s["tzpbPct"] == {"min": tz["min"], "max": tz["max"], "used": tz["used"]}, "%s: tzpbPct equals the tzpb block" % sid)
        c.near(s["employerPct"], s["employerPctWithoutTzpb"] + tz["used"], 0.0051, "%s: employer total = funds + TZPB (the lowest rate)" % sid)
        c.near(s["gvrsPct"], 0.0, 0.0001, "%s: no GVRS contribution in 2026 (ZBDOO art. 15)" % sid)
    c.ok(sc["management-contract"]["sameRatesAs"] == "employment", "management-contract: same rates as employment")
    for k in ("employeePct", "employerPct", "employerPctWithoutTzpb", "split", "maxInsurableIncomeEur"):
        c.ok(sc["management-contract"][k] == sc["employment"][k], "management-contract: %s equals employment" % k)
    se = sc["self-employed"]
    c.ok(se["employerPct"] == 0.0 and all(v == 0.0 for v in se["split"]["employer"].values()), "self-employed: nothing paid by an employer")
    c.ok([p.get("field") for p in sc["management-contract"].get("pending", [])] == ["incomeTaxPct"] and [p.get("field") for p in se.get("pending", [])] == ["incomeTaxPct"],
         "pending income tax of the two scenarios")
    c.ok("incomeTaxPct" not in sc["management-contract"] and "incomeTaxPct" not in se, "no income-tax figure where it is pending")
    c.ok(sc["employment"].get("incomeTaxPct") == r["incomeTax"]["ratePct"] and "pending" not in sc["employment"], "employment: income tax equals the incomeTax block, nothing pending")
    _scenario_checks(c, r, a)
    _limits_checks(c, r, a, sc)
    # ---- income tax
    it = r["incomeTax"]
    c.ok(it["source"] == ["asbp"] and list(it["years"]) == ["2025", "2026", "2027", "2028"] and list(it["soleTraderBusinessPct"]) == ["2025", "2026", "2027", "2028"], "incomeTax: years")
    row3 = a.get("3") or {}
    for y in ("2025", "2026", "2027", "2028"):
        c.ok(re.match(r"^\d+(,\d+)?$", (row3.get("years") or {}).get(y, "")) is not None and _bg(row3["years"][y]) == it["years"][y] == it["ratePct"],
             "incomeTax %s: the ASBP row 3 string equals the stored rate" % y)
        sub = (row3.get("sub") or [{}])[0].get("years", {}).get(y, "")
        c.ok(re.match(r"^\d+(,\d+)?$", sub) is not None and _bg(sub) == it["soleTraderBusinessPct"][y], "incomeTax %s: the ASBP row 3 sole-trader string equals the stored rate" % y)
    # ---- TZPB by activity
    acts = tz["activities"]
    codes = [x.get("code") for x in acts]
    c.ok(len(acts) == 87 and len(set(codes)) == 87 and all(isinstance(x, str) and re.match(r"^\d{2}$", x) for x in codes), "tzpb: 87 distinct two-digit activity codes")
    c.ok(codes == sorted(codes), "tzpb: activities in code order")
    c.ok(all(isinstance(x.get("name"), str) and x["name"].strip() and "  " not in x["name"] for x in acts), "tzpb: activity names")
    vals = [v for x in acts for v in (x.get("until"), x.get("from"))]
    c.ok(_all(vals), "tzpb: every rate is a number")
    if _all(vals):
        c.near(min(vals), tz["min"], 0.0001, "tzpb: minimum rate")
        c.near(max(vals), tz["max"], 0.0001, "tzpb: maximum rate")
        changed = [x["code"] for x in acts if x["until"] != x["from"]]
        c.ok(tz["changed"] == len(changed) == 7, "tzpb: changed = %d" % len(changed))
        ch = [x for x in r["changes"] if x["id"] == "tzpb-by-activity"]
        c.ok(len(ch) == 1 and ch[0]["changedCodes"] == changed and ch[0]["changed"] == len(changed) and ch[0]["activities"] == len(acts), "changes: tzpb-by-activity matches the table")
    c.near(tz["used"], tz["min"], 0.0001, "tzpb: the calculator uses the lowest rate")
    c.ok(tz["min"] == 0.4 and tz["max"] == 1.1, "tzpb: range 0.4 to 1.1 per cent")
    t114 = _first(r"от " + NUM + r" до " + NUM + r" на сто", (a.get("11.4") or {}).get("years", {}).get("2026", ""))
    c.ok(t114 is not None and (_bg(t114[0]), _bg(t114[1])) == (tz["min"], tz["max"]), "tzpb: the range equals the ASBP row 11.4")
    # ---- minimum insurable income by activity and occupation group
    mi = r["minInsurableIncome"]
    rows, groups = mi["rows"], mi["groups"]
    c.ok(len(groups) == 9 and all(isinstance(g, str) and g.strip() for g in groups) and len(set(groups)) == 9, "minInsurableIncome: nine occupation groups")
    c.ok(len(rows) == 86 and [x.get("no") for x in rows] == list(range(1, 87)), "minInsurableIncome: rows numbered 1 to 86")
    c.ok(all(isinstance(x.get("name"), str) and x["name"].strip() and isinstance(x.get("code"), str) for x in rows), "minInsurableIncome: names / codes are strings")
    no_code = [x["no"] for x in rows if not x.get("code")]
    c.ok(no_code == [82] and rows[81]["name"] == "Централен кооперативен съюз", "minInsurableIncome: only row 82 (the Central Cooperative Union, listed without an activity code) has no code, got %s" % no_code)
    cells = filled = empty = changed_c = 0
    u_vals, f_vals = [], []
    holes_agree = True
    rises = True
    for x in rows:
        us, fs = x.get("until"), x.get("from")
        if not (isinstance(us, list) and isinstance(fs, list) and len(us) == len(fs) == 9):
            c.fail("minInsurableIncome row %s: until / from must have nine cells" % x.get("no"))
            continue
        for u, f in zip(us, fs):
            cells += 1
            if u is None or f is None:
                empty += 1
                holes_agree = holes_agree and u is None and f is None
                continue
            c.ok(isnum(u) and isnum(f) and u > 0 and f > 0, "minInsurableIncome row %s: cell values %s / %s" % (x.get("no"), u, f))
            filled += 1
            u_vals.append(u)
            f_vals.append(f)
            changed_c += 1 if u != f else 0
            rises = rises and f > u
    c.ok(holes_agree, "minInsurableIncome: an empty cell is empty in both periods")
    c.ok(cells == 774 == mi["cells"] and empty == 30 == mi["emptyCells"] and filled == 744, "minInsurableIncome: %d cells, %d empty, %d filled" % (cells, empty, filled))
    c.ok(rises, "minInsurableIncome: every filled cell rises on 1 August")
    ch = [x for x in r["changes"] if x["id"] == "min-income-by-activity"]
    c.ok(len(ch) == 1, "changes: min-income-by-activity")
    if len(ch) == 1 and u_vals:
        ch = ch[0]
        c.ok(ch["cells"] == cells and ch["filled"] == filled and ch["changed"] == changed_c, "changes: min-income-by-activity counts")
        c.ok((ch["untilMin"], ch["untilMax"], ch["fromMin"], ch["fromMax"]) == (min(u_vals), max(u_vals), min(f_vals), max(f_vals)), "changes: min-income-by-activity ranges")
        c.near(min(u_vals), se["minInsurableIncomeEur"][0]["eur"], 0.0001, "the smallest minimum income of the annex equals the self-employed minimum (until)")
        c.near(min(f_vals), se["minInsurableIncomeEur"][1]["eur"], 0.0001, "the smallest minimum income of the annex equals the self-employed minimum (from)")
    c.ok(isinstance(mi["notes"], list) and len(mi["notes"]) == 5 and all(isinstance(x, str) and x.strip() for x in mi["notes"]), "minInsurableIncome: five legal notes")
    # ---- the changes list
    cd = dict((x["id"], x) for x in r["changes"])
    c.ok([x["id"] for x in r["changes"]] == ["max-insurable", "min-self-employed", "min-income-by-activity", "tzpb-by-activity", "civil-servant-employee-share",
                                           "civil-servant-employer-share"], "changes ids %s" % [x["id"] for x in r["changes"]])
    for cid, key in (("max-insurable", "maxInsurableIncomeEur"), ("min-self-employed", "minInsurableIncomeEur")):
        x = cd.get(cid) or {}
        arr = (se if cid == "min-self-employed" else sc["employment"])[key]
        c.ok(x.get("until") == arr[0]["eur"] and x.get("from") == arr[1]["eur"], "changes.%s: until / from equal the scenario amounts" % cid)
        if isnum(x.get("until")) and isnum(x.get("from")):
            c.near(x["delta"], x["from"] - x["until"], 0.011, "changes.%s: delta" % cid)
            c.near(x["deltaPct"], 100.0 * (x["from"] - x["until"]) / x["until"], 0.0051, "changes.%s: deltaPct" % cid)
    for cid in ("civil-servant-employee-share", "civil-servant-employer-share"):
        x = cd.get(cid) or {}
        if isnum(x.get("until")) and isnum(x.get("from")):
            c.near(x["delta"], x["from"] - x["until"], 0.011, "changes.%s: delta" % cid)
            if "deltaPct" in x:
                c.near(x["deltaPct"], 100.0 * (x["from"] - x["until"]) / x["until"], 0.0051, "changes.%s: deltaPct" % cid)
    cs_e, cs_r = cd.get("civil-servant-employee-share") or {}, cd.get("civil-servant-employer-share") or {}
    if _all([cs_e.get("until"), cs_e.get("from"), cs_r.get("until"), cs_r.get("from")]):
        c.near(cs_e["until"] + cs_r["until"], cs_e["from"] + cs_r["from"], 0.0051, "civil servants: the two shares add up to the same total before and after 1 August")
    else:
        c.fail("civil servants: until / from of both shares must be numbers")
    for x in r["changes"]:
        c.ok(isinstance(x.get("label"), str) and x["label"].strip() and isinstance(x.get("basis"), str) and x["basis"].strip() and x.get("source") and set(x["source"]) <= src_keys,
             "changes.%s: label / basis / source" % x.get("id"))
    # ---- NAP categories
    nc = r["napCategories"]
    c.ok([x.get("no") for x in nc] == list(range(1, 20)), "napCategories: numbered 1 to 19")
    c.ok(all(isinstance(x.get("label"), str) and x["label"].strip() and isinstance(x.get("page"), int) and x["page"] >= 1 for x in nc), "napCategories: label / page")
    c.ok([x["page"] for x in nc] == sorted(x["page"] for x in nc), "napCategories: pages ascend")
    c.ok(all(set(x.get("modelledBy", [])) <= set(sc) and all(sc[i]["status"] == "real" for i in x.get("modelledBy", [])) for x in nc), "napCategories: modelledBy names real scenarios")
    mb = dict((x["no"], x["modelledBy"]) for x in nc)
    c.ok(mb.get(1) == ["employment", "management-contract"] and mb.get(10) == ["self-employed"] and all(not v for k, v in mb.items() if k not in (1, 10)),
         "napCategories: categories 1 and 10 are modelled, the other 17 are not")
    # ---- quotes, notes, checks
    q = r["quotes"]
    c.ok(list(q) == ["zbdoo_art9", "zbdoo_art14", "zbdoo_art15", "zbnzok_art2"] and all(isinstance(v, str) and v.strip() for v in q.values()), "quotes: four law articles")
    c.ok("8 на сто" in q["zbnzok_art2"] and "не се внасят" in q["zbdoo_art15"] and "приложение № 2А" in q["zbdoo_art14"], "quotes: ZBNZOK art. 2 = 8 per cent; ZBDOO art. 15 = no GVRS; art. 14 names annex 2A")
    c.ok(isinstance(r["notes"], list) and len(r["notes"]) == 7 and all(isinstance(x, str) and x.strip() and "  " not in x for x in r["notes"]), "notes: seven non-empty strings")
    ck = r["checks"]
    c.ok(list(ck) == ["napRowsAddUp", "napTotalsVsBill", "napSplitVsBill", "limitsVsLawAndBill", "tzpbRangeVsBill", "annexesAligned", "annexRows", "activities", "nameFixes"], "checks keys")
    c.ok(all(ck[k] is True for k in ("napRowsAddUp", "napTotalsVsBill", "napSplitVsBill", "limitsVsLawAndBill", "tzpbRangeVsBill", "annexesAligned")), "checks: every stored verdict is true")
    c.ok(ck["annexRows"] == len(rows) and ck["activities"] == len(acts) and isinstance(ck["nameFixes"], int) and ck["nameFixes"] >= 0, "checks: counts equal the tables")
    c.fact("RATES: employment %s / %s per cent (employee / employer incl. TZPB), self-employed %s per cent, %d annex cells (%d empty), %d TZPB activities (%d changed)"
           % (sc["employment"]["employeePct"], sc["employment"]["employerPct"], se["employeePct"], cells, empty, len(acts), tz["changed"]))
    return c


GROUPS = (
    ("COMPONENTS", g_components, "components.json (D07): constituent budgets, transfers, national vs EU, Sankey, ties to law / outlook / execution / municipalities"),
    ("RATES", g_rates, "rates.json (D17): scenarios recomputed from the ASBP strings, limits, TZPB and minimum-income tables"),
)
