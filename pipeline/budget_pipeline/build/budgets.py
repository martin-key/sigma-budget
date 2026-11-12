"""ministries.json (all 46 budgets of ЗДБ 2026), ministries/<code>.json (the published program budgets) and programs.json.

Facts come from three places and are never mixed silently:
  * the LAW (data/cache/law_bill.json, parsed from ДВ бр. 69): name, own revenue, expenditure, transfers, the policies
    (or functional areas) with their amounts - for EVERY budget, so a budget whose program budget is pending still shows
    its policies and total as real numbers;
  * the BILL (same cache): bill -> law differences of the headline figures (чл. 2, 3, 16, 17);
  * the PROGRAM BUDGETS (program_budgets.py): programs per year, only for budgets that pass the checks of program_budgets.
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
from budget_pipeline.build.definitions import ART_EBK, BUDGET_INFO, EBK_ART, KIND_LABELS, nominative
import budget_pipeline.build.program_budgets as program_budgets
from budget_pipeline.build.data_io import isnum, meta, pct, rnd

ARCHIVE = "архив към законопроекта 52-602-01-19, папка „7. Програмни формати на бюджети на ПРБ с бюджет по ДБ“"
ARCHIVE_URL = "https://www.parliament.bg/bills/52/52-602-01-19.zip"
LAW_NOTE = "Закон за държавния бюджет на Република България за 2026 г., ДВ бр. 69 от 31.07.2026 г. (чл. 2–47)"
PRB_NOTE = ("Програмни бюджети на първостепенните разпоредители към законопроект 52-602-01-19, внесен на 01.07.2026 г. "
            "(колона „Проект 2026“ е на законопроекта; приетият закон може да се различава)")
TIER_LABELS = {
    "validated": "Програмният бюджет съвпада със закона",
    "program-budget-differs": "Програмният бюджет към законопроекта се различава от приетия закон",
    "pending": "Програмите предстои да бъдат добавени",
}
SENTINEL_NO_DATA = -1
SENTINEL_NO_GROWTH = -101


def _chg(bill, law):
    """{"bill","law","diff"} for one headline figure that differs between the bill and the law, else None."""
    if not isnum(bill) or not isnum(law) or abs(law - bill) < 0.05:
        return None
    return {"bill": bill, "law": law, "diff": rnd(law - bill, 1)}


def _bill_vs_law(ctx, art):
    d = ctx.law["diff"].get(str(art))
    if not d:
        return None
    out = {}
    h = d.get("headline") or {}
    for key, name in (("rev", "revKhil"), ("exp", "expKhil"), ("transfers", "transfersKhil")):
        c = _chg((h.get(key) or {}).get("bill"), (h.get(key) or {}).get("law"))
        if c:
            out[name] = c
    ops = {"chg": 0, "add": 0, "del": 0}
    for ln in d.get("lines") or []:
        ops[ln["op"]] = ops.get(ln["op"], 0) + 1
    out["lines"] = ops
    return out


def _law_policies(L):
    out = []
    for q in L.get("policies") or []:
        item = {"n": int(q["n"]) if str(q["n"]).isdigit() else q["n"], "name": program_budgets.law_policy_name(q["name"]),
                "khil": q["khil"]}
        if q.get("parts"):
            item["parts"] = [{"n": p["n"], "name": program_budgets.law_policy_name(p["name"]), "khil": p["khil"]}
                             for p in q["parts"] if p.get("n")]
        out.append(item)
    return out


def _change(rec, law_exp):
    """Change of the budget against the 2025 law, with the basis that makes the two figures comparable.

    The 2025 figure is the "Закон 2025" total of the program budget. validated: law 2026 = PRB 2026, so law 2026 vs PRB
    2025. differs: both figures from the same program budget (like for like). pending: only when the 2025 table of the
    document is consistent; compared with the law's 2026 figure (the law's expenditure equals the PRB column in every
    verified budget)."""
    base = rec.get("exp2025Khil")
    if not isnum(base) or base <= 0:
        return None
    if rec["tier"] == "program-budget-differs":
        cur, basis = rec["check"]["prbTotal2026"], "program-budget"
    else:
        cur, basis = law_exp, "law"
    if not isnum(cur):
        return None
    return {"pct": rnd(100.0 * (cur / base - 1.0), 1), "basis": basis}


def build_budgets(ctx):
    recs = program_budgets.load(ctx)
    law = ctx.law["law"]
    items = []
    tot_rev = tot_exp = 0.0
    for code in sorted(EBK_ART):
        art = EBK_ART[code]
        L = law[str(art)]
        short, kind = BUDGET_INFO[code]
        rec = recs[code]
        h = L["headline"]
        law_exp = h["exp"]
        it = {"id": code, "art": art, "name": nominative(L["name"]), "lawName": L["name"], "short": short, "kind": kind}
        if isnum(h.get("rev")):
            it["revKhil"] = h["rev"]
            tot_rev += h["rev"]
        it["expKhil"] = law_exp
        tot_exp += law_exp
        if isnum(h.get("transfers")):
            it["transfersKhil"] = h["transfers"]
        if isnum(L.get("policyTotal")):
            it["policyTotalKhil"] = L["policyTotal"]
            if abs(L["policyTotal"] - law_exp) > 0.15:
                ctx.notes.append("budget %s: policies add up to %s, headline expenditure %s" % (code, L["policyTotal"], law_exp))
        it["policiesKind"] = L.get("policiesKind") or "policies"
        it["policies"] = _law_policies(L)
        if L.get("bodies"):
            it["bodies"] = [{"name": b["name"], "khil": b["khil"]} for b in L["bodies"]]
        if rec["tier"] == "pending":
            it["programs"] = {"status": "pending", "id": "P03", "reasonKind": rec["reasonKey"], "reason": rec["reason"]}
        else:
            it["programs"] = {"status": "real", "tier": rec["tier"], "count": rec["programCount"],
                              "policyCount": rec["policyCount"], "file": "ministries/%s.json" % code}
        if isnum(rec.get("exp2025Khil")):
            it["exp2025Khil"] = rec["exp2025Khil"]
        ch = _change(rec, law_exp)
        if ch:
            it["change"] = ch
        bvl = _bill_vs_law(ctx, art)
        if bvl:
            it["billVsLaw"] = bvl
        if rec.get("programBudgetVsLaw"):
            it["programBudgetVsLaw"] = rec["programBudgetVsLaw"]
        items.append(it)

    sums = ctx.law["sums"]
    if abs(tot_exp - sums["expKhil"]) > 0.05 or abs(tot_rev - sums["revKhil"]) > 0.05:
        raise ValueError("budget sums %.1f/%.1f differ from the law's %s/%s" % (tot_rev, tot_exp, sums["revKhil"], sums["expKhil"]))

    published = [r for r in recs.values() if r["tier"] != "pending"]
    tiers = {}
    for r in recs.values():
        tiers.setdefault(r["tier"], []).append(r["code"])
    ctx.notes.append("program budgets: %d validated, %d differ from the law, %d pending" % (
        len(tiers.get("validated", [])), len(tiers.get("program-budget-differs", [])), len(tiers.get("pending", []))))

    mins = {
        "meta": meta("D08+D09", "Бюджети на първостепенните разпоредители за 2026 г. и техните програми", source=["zdb", "bill", "prb"],
                     source_note=LAW_NOTE + "; програмите — " + PRB_NOTE, as_of="2026-07-31", unit="хил. €", pending=["P03"]),
        "totals": {"count": len(items), "revKhil": rnd(tot_rev, 1), "expKhil": rnd(tot_exp, 1)},
        "kinds": {k: v for k, v in KIND_LABELS.items() if any(i["kind"] == k for i in items)},
        "tiers": TIER_LABELS,
        "programTotals": {"budgets": len(published),
                          "policies": sum(r["policyCount"] for r in published),
                          "programs": sum(r["programCount"] for r in published),
                          "pending": len(tiers.get("pending", [])),
                          "differ": len(tiers.get("program-budget-differs", []))},
        "scopeNote": ("Сумата на бюджетите е разходите на първостепенните разпоредители по чл. 2–47 от закона; "
                      "не е целият държавен бюджет (без трансфери към общините и ЕС, осигурителните системи и др.)."),
        "items": items,
    }
    ctx.put("ministries.json", mins)

    # --------------------------------------------------------------------------------------- per-budget files
    for code in sorted(recs):
        rec = recs[code]
        if rec["tier"] == "pending":
            continue
        art = rec["art"]
        L = law[str(art)]
        check = {"prbTotal2026": rec["check"]["prbTotal2026"], "zdbExp": rec["check"]["lawExp"],
                 "matchesLaw": rec["check"]["matchesLaw"], "policiesSumToTotal": True, "programsSumToPolicies": True}
        if not rec["check"]["matchesLaw"]:
            check["diffKhil"] = rec["programBudgetVsLaw"]["diffKhil"]
        skipped = rec["skipped"]
        doc = {"file": rec["file"], "pages": rec["pages"], "pagesByYear": rec["pagesByYear"], "archive": ARCHIVE,
               "archiveUrl": ARCHIVE_URL}
        obj = {
            "meta": meta("D09", "Програмен бюджет: " + nominative(L["name"]), source=["prb"], source_note=PRB_NOTE, as_of="2026-07-01",
                         unit="хил. €"),
            "id": code, "art": art, "name": nominative(L["name"]), "short": BUDGET_INFO[code][0], "tier": rec["tier"],
            "years": program_budgets.YEARS,
            "yearLabels": program_budgets.SRC_YEARS,
            "vintage": program_budgets.VINTAGE,
            "cols": program_budgets.COLS_OUT,
            "policiesKind": L.get("policiesKind") or "policies",
            "total": rec["total"],
            "policies": rec["policies"],
            "yearsComplete": rec["yearsComplete"],
            "check": check,
            "skipped": skipped[:8],
            "skippedTotal": len(skipped),
            "doc": doc,
        }
        ctx.put("ministries/%s.json" % code, obj)

    # --------------------------------------------------------------------------------------- programs.json
    rows = []
    for code in sorted(recs):
        rec = recs[code]
        if rec["tier"] == "pending":
            continue
        for p in rec["policies"]:
            rows.append(_program_row(code, p, p["kind"], ""))
            for q in p.get("programs", []):
                rows.append(_program_row(code, q, "program", p["code"]))
    ctx.put("programs.json", {
        "meta": meta("D09", "Програми и политики на програмните бюджети: индекс за търсене и подреждане", source=["prb", "zdb"],
                     source_note=PRB_NOTE, as_of="2026-07-01", unit="хил. €", pending=["P03"]),
        "fields": ["ministry", "code", "name", "level", "policy", "y2026", "y2025", "growthPct", "isNew", "prb2026", "prb2025"],
        "sentinels": {"noData": SENTINEL_NO_DATA, "noGrowth": SENTINEL_NO_GROWTH},
        "note": ("y2026 и y2025 са консолидираните разходи (колона „общо“: бюджетът на разпоредителя плюс европейските и другите "
                 "средства), prb2026 и prb2025 — само по бюджета на разпоредителя (колоната, която съвпада със закона). "
                 "−1 = няма данни; growthPct −101 = не може да се изчисли; isNew 1 = нямало е средства през 2025 г."),
        "items": rows,
    })
    return mins


def _program_row(code, node, level, parent):
    v = node["values"]
    t26, t25 = (v.get("2026") or [None] * 9), (v.get("2025") or [None] * 9)

    def pick(arr, i):
        return arr[i] if isnum(arr[i]) else SENTINEL_NO_DATA

    y26, y25 = pick(t26, 0), pick(t25, 0)
    if y26 != SENTINEL_NO_DATA and y25 != SENTINEL_NO_DATA and y25 > 0:
        growth = rnd(100.0 * (y26 / y25 - 1.0), 1)
    else:
        growth = SENTINEL_NO_GROWTH
    is_new = 1 if (y25 == 0 and y26 not in (SENTINEL_NO_DATA, 0)) else 0
    return [code, node["code"], node["name"], level, parent, y26, y25, growth, is_new, pick(t26, 1), pick(t25, 1)]
