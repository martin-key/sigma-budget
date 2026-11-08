"""The figures the v6 checks expect on the plan block (S01, S15) and in the year-on-year table of S15, read from data/release/execution.json.

The checks had them written in for August 2026 (accept, motion, screens), so every new monthly report broke them. Here they
follow the latest report the way the screens compute them (js/ui/plan.js, js/pages/s15-izpalnenie.js): sums in млрд. € with 2 decimals,
shares of the plan in % with 1 decimal. Numbers are written as the screen writes them: decimal comma, U+2212 for minus.

    plan()     -> {"month", "sums": ['30,12 от 49,62', …], "cur": ['60,7%', …], "prev": ['61,2%', …], "bars": cur and prev interleaved,
                   "widths": the style width of those bars, ['60.7%', '61.2%', …] (js/ui/progress.js: Number(share.toFixed(1)) + '%')}
    compare()  -> {"prev": [rev, exp, balance], "cur": […], "diff": [rev, exp], "balanceDiff": '0,41'}   (млрд. €, same months of the two years)
"""


from pathlib import Path as _Path
import json
from pathlib import Path

EXECUTION = Path(__file__).resolve().parents[2] / "data" / "release" / "execution.json"
PLAN_ROWS = ("rev", "exp.total", "exp.capex")          # js/ui/plan.js PLAN_ROWS
COMPARE_ROWS = ("rev", "exp.total", "balance")


def _ex():
    import budget_pipeline.validate.execution_contract as execution_contract                                # contract v2: money as decimal strings, read as floats
    return execution_contract.load(EXECUTION)


def num(v, d=2, sign=False):
    s = "%.*f" % (d, abs(v))
    s = s.replace(".", ",")
    if v < 0 and float(s.replace(",", ".")) != 0:
        return "−" + s
    return ("+" + s) if sign else s


def plan():
    ex = _ex()
    L = ex["latest"]
    n, k = L["month"], L["kfp"]
    sums = ["%s от %s" % (num(k[r]["cum"] / 1000), num(k[r]["plan"] / 1000)) for r in PLAN_ROWS]
    cur_v = [k[r]["cum"] / k[r]["plan"] * 100 for r in PLAN_ROWS]
    prev_v = [ex["pace"]["2025"][r][n - 1] for r in PLAN_ROWS]
    bars_v = [x for pair in zip(cur_v, prev_v) for x in pair]
    width = lambda v: ("%.1f" % v).removesuffix(".0") + "%"     # Number('60.0') prints 60
    return {"month": n, "sums": sums, "cur": [num(v, 1) + "%" for v in cur_v], "prev": [num(v, 1) + "%" for v in prev_v],
            "bars": [num(v, 1) + "%" for v in bars_v], "widths": [width(v) for v in bars_v]}


def compare():
    ex = _ex()
    n, y = ex["latest"]["month"], ex["latest"]["asOf"][:4]
    a = [ex["data"][str(int(y) - 1)]["kfp"][r][n - 1] for r in COMPARE_ROWS]
    b = [ex["data"][y]["kfp"][r][n - 1] for r in COMPARE_ROWS]
    return {"prev": [num(v / 1000) for v in a], "cur": [num(v / 1000) for v in b],
            "diff": [num((b[i] - a[i]) / 1000, sign=True) for i in range(2)], "balanceDiff": num(abs(b[2] - a[2]) / 1000)}


if __name__ == "__main__":
    print(json.dumps({"plan": plan(), "compare": compare()}, ensure_ascii=False, indent=1))
