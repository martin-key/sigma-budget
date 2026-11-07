"""The data contract of execution.json, version 2 (docs/approach-specification.md, section 6.1; docs/data-spec.md, D06).

Version 2 keeps the shape of version 1 and adds what the specification asks of a dataset:
  * `contract`: schema version, currency, unit and scale, the scope of each column, the accounting basis (cash), the three statuses
    kept apart (evidence: real/mock/pending, budget: draft/law/report/forecast, value: observed/derived/estimate), the rule for a
    missing value (null, never 0) and the provenance file;
  * money as decimal strings with the number of places of its block (`"33898.456"`, `"-3669.2"`): no binary float in the canonical file.
Percentages (pctPlan, yoyPct, pace) stay numbers: they are ratios, not money.

    canonical(doc)  version-1 shape with float money -> version 2 (money formatted with the places of its block)
    numbers(doc)    version 2 -> float money, for the readers that compute with it (the builders, the validators, the checks); `contract`
                    and meta.schema stay. A version-1 document passes unchanged. This is the adapter of section 6.1 ("the old numeric forms").
    load(path)      read execution.json and return numbers(...)
    money(value, places)   one canonical string; Decimal or float in, half away from zero
"""
import copy
import json
from decimal import Decimal, ROUND_HALF_UP

SCHEMA = 2
PLACES = {"data": 3, "monthly": 3, "plan2026": 1, "latest": 1, "reconcile.kfp": 3, "reconcile.annex3": 1, "reconcile.diff": 1}
LATEST_MONEY = ("cum", "plan", "prevYearCum")
RECONCILE_MONEY = ("kfp", "annex3", "diff")
COLS = ("kfp", "nat", "eu")

CONTRACT = {
    "schema": SCHEMA,
    "money": {"encoding": "decimal-string", "currency": "EUR", "unit": "млн. €", "scale": 1000000, "rounding": "half away from zero (as Excel and the MF releases)",
              "places": PLACES},
    "scope": {"kfp": "Консолидирана фискална програма (к.2 на отчета)", "nat": "Национален бюджет (к.3)", "eu": "Европейски средства (к.4)"},
    "accountingBasis": "cash",
    "missing": "null; a missing value is never 0",
    "conversion": {"from": "BGN", "rate": "1 € = 1.95583 лв.", "years": "2024 and 2025",
                   "rule": "the original number in млн. лв. ÷ 1.95583, rounded to 3 places after dividing"},
    "blocks": {
        "data": {"evidence": "real", "budget": "report", "value": "observed",
                 "note": "cumulative since 1 January; 2024 and 2025 are derived by the conversion from BGN"},
        "monthly": {"evidence": "real", "budget": "report", "value": "derived", "rule": "cumulative(m) − cumulative(m − 1); January = cumulative(1)"},
        "plan2026": {"evidence": "real", "budget": "draft", "value": "observed", "note": "Приложение 3 to the bill and Табл. II-3/II-4 of the motives"},
        "latest": {"evidence": "real", "budget": "report", "value": "derived",
                   "rule": "cum and prevYearCum: data at the latest month, rounded to 1 place; plan: plan2026 (budget status draft); "
                           "pctPlan and yoyPct: % from the unrounded cumulative values"},
        "pace": {"evidence": "real", "budget": "report", "value": "derived", "rule": "% of the year's December cumulative value"},
        "reconcile": {"evidence": "real", "budget": "report", "value": "derived",
                      "rule": "the December report against Приложение 3 (annex3: budget status report for 2024, expected report for 2025)"},
    },
    "provenance": "execution-provenance.json",
}


def money(value, places):
    """Decimal | float | int | None -> '123.456' (exactly `places` decimals), None stays None. A float is taken by its repr, which is the
    decimal the extractor rounded it to."""
    if value is None:
        return None
    d = value if isinstance(value, Decimal) else Decimal(repr(float(value)))
    s = format(d.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP), "f")
    return "0." + "0" * places if s.lstrip("-").strip("0.") == "" else s       # never "-0.000"


def _num(s):
    return None if s is None else float(s)


def _map_money(doc, fn):
    """Apply fn(value, places) to every money field; returns a new document."""
    out = copy.deepcopy(doc)
    for block in out["data"].values():
        for col in COLS:
            for rid, arr in block[col].items():
                block[col][rid] = [fn(v, PLACES["data"]) for v in arr]
    for block in out["monthly"].values():
        for col in COLS:
            for rid, arr in block[col].items():
                block[col][rid] = [fn(v, PLACES["monthly"]) for v in arr]
    for col in COLS:
        for rid, v in list(out["plan2026"][col].items()):
            out["plan2026"][col][rid] = fn(v, PLACES["plan2026"])
        for rid, d in out["latest"][col].items():
            for k in LATEST_MONEY:
                if k in d:
                    d[k] = fn(d[k], PLACES["latest"])
    for key, rec in out["reconcile"].items():
        if isinstance(rec, dict) and key.startswith("dec"):
            for rid, d in rec.items():
                for k in RECONCILE_MONEY:
                    d[k] = fn(d[k], PLACES["reconcile." + k])
    return out


def canonical(doc):
    out = _map_money(doc, money)
    out["meta"] = dict(out["meta"], schema="execution/%d" % SCHEMA)
    rest = {k: v for k, v in out.items() if k != "meta"}
    return dict({"meta": out["meta"], "contract": CONTRACT}, **rest)


def numbers(doc):
    if not isinstance(doc, dict) or (doc.get("contract") or {}).get("schema") != SCHEMA:
        return doc
    return _map_money(doc, lambda v, _p: _num(v))


def load(path):
    with open(path, encoding="utf-8") as fh:
        return numbers(json.load(fh))
