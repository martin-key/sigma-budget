"""CONTRACT group of datasets.py: execution.json as written (contract v2, pipeline/budget_pipeline/validate/execution_contract.py) and its provenance index.

The other groups read execution.json through the adapter (money as floats). This one reads the file itself:
  * the contract block: schema 2, currency, unit and scale, the places of each block, the scope of each column, the accounting basis, and
    the three statuses of every block from their allowed sets;
  * every money value is a decimal string with exactly the places of its block (or null), never a binary number and never "-0.0…";
    the percentages stay numbers;
  * execution-provenance.json: one original per reported month with the file name and sha256 of the data block, a cell for every row and
    column, a rule for the computed row, and an Annex 3 locator (page and row) for every plan item.
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import json
import os
import re

import budget_pipeline.validate.execution_contract as C
from budget_pipeline.validate.checks import DATA, Check

EVIDENCE = {"real", "mock", "pending"}
BUDGET = {"draft", "law", "report", "forecast"}
VALUE = {"observed", "derived", "estimate"}
COL_LETTER = re.compile(r"^[A-Z]$")


def _raw(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as fh:
        return json.load(fh)


def _money_ok(c, v, places, where):
    if v is None:
        return
    pat = r"^-?\d+\.\d{%d}$" % places
    c.ok(isinstance(v, str) and re.match(pat, v) and not re.match(r"^-0\.0+$", v),
         "%s: %r is not a decimal string with %d places" % (where, v, places))


def g_contract(ctx):
    c = Check("CONTRACT")
    ex = _raw("execution.json")
    k = ex.get("contract") or {}
    if not c.ok(k.get("schema") == C.SCHEMA, "execution.json: contract.schema is %r, expected %d" % (k.get("schema"), C.SCHEMA)):
        return c
    c.ok(ex["meta"].get("schema") == "execution/%d" % C.SCHEMA, "execution.json: meta.schema must be execution/%d" % C.SCHEMA)
    m = k.get("money") or {}
    c.ok(m.get("encoding") == "decimal-string" and m.get("currency") == "EUR" and m.get("unit") == ex["meta"].get("unit")
         and m.get("scale") == 1000000, "contract.money: encoding, currency, unit (as meta.unit) and scale")
    c.ok(m.get("places") == C.PLACES, "contract.money.places must be %s" % C.PLACES)
    c.ok(set(k.get("scope") or {}) == set(C.COLS), "contract.scope must describe %s" % ", ".join(C.COLS))
    c.ok(k.get("accountingBasis") == "cash", "contract.accountingBasis must be cash (the КФП reports)")
    blocks = k.get("blocks") or {}
    c.ok(set(blocks) == {"data", "monthly", "plan2026", "latest", "pace", "reconcile"}, "contract.blocks: %s" % sorted(blocks))
    for name, b in blocks.items():
        c.ok(b.get("evidence") in EVIDENCE and b.get("budget") in BUDGET and b.get("value") in VALUE,
             "contract.blocks.%s: evidence/budget/value %r/%r/%r" % (name, b.get("evidence"), b.get("budget"), b.get("value")))
    c.ok(blocks.get("plan2026", {}).get("budget") == "draft", "the plan is the draft budget (budget status draft)")
    c.ok(blocks.get("monthly", {}).get("value") == "derived", "the monthly values are derived from the cumulative ones")

    # money: every value of every money block
    n = 0
    for y, block in ex["data"].items():
        for col in C.COLS:
            for rid, arr in block[col].items():
                for i, v in enumerate(arr):
                    _money_ok(c, v, C.PLACES["data"], "data.%s.%s.%s[%d]" % (y, col, rid, i))
                    n += 1
    for y, block in ex["monthly"].items():
        for col in C.COLS:
            for rid, arr in block[col].items():
                for i, v in enumerate(arr):
                    _money_ok(c, v, C.PLACES["monthly"], "monthly.%s.%s.%s[%d]" % (y, col, rid, i))
                    n += 1
    for col in C.COLS:
        for rid, v in ex["plan2026"][col].items():
            _money_ok(c, v, C.PLACES["plan2026"], "plan2026.%s.%s" % (col, rid))
            n += 1
        for rid, d in ex["latest"][col].items():
            for key in C.LATEST_MONEY:
                if key in d:
                    _money_ok(c, d[key], C.PLACES["latest"], "latest.%s.%s.%s" % (col, rid, key))
                    n += 1
            for key in ("pctPlan", "yoyPct"):
                if key in d:
                    c.ok(isinstance(d[key], (int, float)), "latest.%s.%s.%s: a percentage stays a number" % (col, rid, key))
    for key, rec in ex["reconcile"].items():
        if key.startswith("dec"):
            for rid, d in rec.items():
                for f in C.RECONCILE_MONEY:
                    _money_ok(c, d[f], C.PLACES["reconcile." + f], "reconcile.%s.%s.%s" % (key, rid, f))
                    n += 1
    for y, rows in ex["pace"].items():
        c.ok(all(isinstance(v, (int, float)) for arr in rows.values() for v in arr), "pace.%s: percentages stay numbers" % y)

    # provenance
    pname = k.get("provenance")
    if not c.ok(pname and os.path.exists(os.path.join(DATA, pname)), "contract.provenance names a file of data/release: %r" % pname):
        return c
    p = _raw(pname)
    c.ok(p.get("schema") == "provenance/1" and p.get("dataset") == "execution", "%s: schema provenance/1 for execution" % pname)
    files = {}
    for y, block in ex["data"].items():
        for f in block["files"]:
            files["%s-%02d" % (y, f["month"])] = f
    orig = p.get("originals") or {}
    c.ok(set(orig) == set(files), "%s: originals %d, reports in execution.json %d" % (pname, len(orig), len(files)))
    for key, f in files.items():
        o = orig.get(key) or {}
        c.ok(o.get("file") == f["file"] and o.get("sha256") == f["sha256"] and o.get("source") == "kfp",
             "%s: original %s must be %s with the sha256 of execution.json" % (pname, key, f["file"]))
    c.ok(set(p.get("columns") or {}) == set(C.COLS) and all(COL_LETTER.match(v) for v in p["columns"].values()),
         "%s: a column letter for every column" % pname)
    rids = [r["id"] for r in ex["rows"]]
    computed = set(p.get("computed") or {})
    rows = p.get("rows") or {}
    c.ok(set(rows) | computed == set(rids) and not set(rows) & computed, "%s: every row has a cell row or a rule, not both" % pname)
    c.ok(all(isinstance(v, int) and v > 0 for v in rows.values()), "%s: rows are Excel row numbers" % pname)
    for rid in computed:
        c.ok(set(p["computed"][rid].get("from", [])) <= set(rows), "%s: computed %s is made from rows with cells" % (pname, rid))
    plan = p.get("plan2026") or {}
    for col in C.COLS:
        have = set((plan.get(col) or {}).get("rows") or {})
        c.ok(have == set(ex["plan2026"][col]), "%s: a locator for every plan2026.%s item" % (pname, col))
    kfp_plan = plan.get("kfp") or {}
    c.ok(kfp_plan.get("source") == "asbp" and re.match(r"^[0-9a-f]{64}$", kfp_plan.get("sha256", "")),
         "%s: plan2026.kfp points to the forecast_tables PDF by sha256" % pname)
    for rid, loc in (kfp_plan.get("rows") or {}).items():
        cells = loc.get("cells", [loc])
        c.ok(all(isinstance(x.get("page"), int) and x.get("row") for x in cells), "%s: plan2026.kfp.%s needs a page and a row" % (pname, rid))
    c.fact("%d money values as decimal strings; %d originals; %d rows with a cell, %d computed; %d plan items with a locator"
           % (n, len(orig), len(rows), len(computed), sum(len((plan.get(col) or {}).get("rows") or {}) for col in C.COLS)))
    return c


GROUPS = (("CONTRACT", g_contract, "execution.json as written: contract v2, decimal strings, and execution-provenance.json"),)
