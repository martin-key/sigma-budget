"""core.json: the ONLY eager file (loaded before the first paint of every page).

It carries what every screen needs without a second request: the source registry (popovers), the pending registry
(the dashed „Предстои“ state), counts, the population, the six headline numbers of the home page, the nine functions
and the eight revenue groups. Every number here is COPIED from the dataset that owns it (`outlook`, `revenue`,
`expenditure`, `execution`, VI-1); `base.py` asserts they are identical. Budget: <= 10 KB gzip, <= 40 KB raw.
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
from budget_pipeline.build.definitions import EBK_ART, PENDING_DEFS, POPULATION_ASOF, SOURCES, pending_block
from budget_pipeline.build.fiscal import population_latest, zdd_table
from budget_pipeline.build.data_io import DATA, EUR, DATA_VERSION, isnum, jload, meta, pct, rnd

I26 = 2          # index of 2026 in the Annex 3 arrays [2024..2028]
YEARS = [2024, 2025, 2026, 2027, 2028]
VINTAGE = {"2024": "actual", "2025": "prelim", "2026": "plan", "2027": "forecast", "2028": "forecast"}


def _glossary_terms(ctx):
    """Number of glossary terms: from the file DATA2 writes (data/release/glossary.json), else from the frozen input source."""
    p = DATA / "glossary.json"
    if p.exists():
        return len(jload(p)["terms"])
    return len(ctx.src("glossary")["terms"])


def _kpi(block, **extra):
    out = {}
    for k, v in extra.items():
        out[k] = v
    out.update(block)
    return out


def build_core(ctx):
    outlook = ctx.get("outlook.json")
    revenue = ctx.get("revenue.json")
    expenditure = ctx.get("expenditure.json")
    measures = ctx.get("measures.json")
    for name, obj in (("outlook", outlook), ("revenue", revenue), ("expenditure", expenditure), ("measures", measures)):
        if obj is None:
            raise RuntimeError("core.json needs %s.json built first" % name)

    execu = ctx.execution
    latest = execu["latest"]
    kfp = latest["kfp"]
    gdp_precise = outlook["gdp"]["mlnPrecise"][I26]
    zdd = zdd_table(ctx)

    # ------------------------------------------------------------------------------------------ the six numbers
    def pair(row, with_pct=True):
        r = {"planMln": row["plan"], "execMln": row["cum"]}
        if with_pct:
            r["execPct"] = row["pctPlan"]
            if "yoyPct" in row:
                r["yoyPct"] = row["yoyPct"]
        return r

    rev = pair(kfp["rev"])
    rev["prevYearMln"] = kfp["rev"]["prevYearCum"]
    rev["href"] = "#/izpalnenie"
    exp = pair(kfp["exp.total"])
    exp["prevYearMln"] = kfp["exp.total"]["prevYearCum"]
    exp["href"] = "#/izpalnenie"
    bal = {"planMln": kfp["balance"]["plan"], "execMln": kfp["balance"]["cum"], "prevYearMln": kfp["balance"]["prevYearCum"],
           "href": "#/izpalnenie"}
    cap = pair(kfp["exp.capex"])
    cap["pctGdp"] = pct(kfp["exp.capex"]["plan"], gdp_precise, 2)
    cap["href"] = "#/izpalnenie?pera=exp"
    debt = {"zddMln": zdd["totalMln"][I26], "pctGdp": zdd["totalPctGdp"][I26], "year": 2026, "scope": "zdd", "href": "#/dalg"}
    kpis = {
        "gdp": {"mln": outlook["gdp"]["mln"][I26], "mlnPrecise": gdp_precise, "year": 2026, "vintage": "plan", "href": "#/prognoza"},
        "revenue": rev, "expenditure": exp, "balance": bal, "capex": cap, "debt": debt,
        "asOf": latest["asOf"], "month": latest["month"],
    }

    # ------------------------------------------------------------------------------------------ functions / groups
    fn = expenditure["functions"]
    functions = []
    for it in fn["items"]:
        functions.append({"id": it["id"], "name": it["name"], "short": it["short"], "mln": it["mln"][1],
                          "pctGdp": it["pctGdp"][1], "share": it["share"][1], "yoyPct": it["yoy2026Pct"]})
    groups = []
    for g in revenue["groups"]:
        groups.append({"id": g["id"], "name": g["name"], "mln": g["mln"][I26], "share": g["share2026"]})

    # ------------------------------------------------------------------------------------------ counts
    n_budgets = len(EBK_ART)
    law_budgets = ctx.law["sums"]["budgets"]
    if law_budgets != n_budgets:
        raise ValueError("law has %d budgets, EBK_ART %d" % (law_budgets, n_budgets))
    counts = {"functions": len(functions), "budgets": n_budgets}
    mins = ctx.get("ministries.json")
    progs = ctx.get("programs.json")
    if mins is not None:
        counts["programBudgets"] = sum(1 for m in mins["items"] if m["programs"]["status"] == "real")
    if progs is not None:
        counts["programs"] = len(progs["items"])
    counts["terms"] = _glossary_terms(ctx)
    muni = ctx.get("municipalities.json")
    counts["municipalities"] = len(muni["items"]) if muni is not None else len(ctx.cache("gisco_lau_bg.json")["items"])
    counts["measures"] = len(measures["items"])
    counts["kfpReports"] = sum(int(d["months"]) for d in execu["data"].values())

    pop_src = ctx.src("population")
    pop = population_latest(pop_src)
    pop_years = [int(y) for y in pop_src["years"]]
    pop_persons = [int(v) for v in pop_src["persons"]]
    if len(pop_years) != len(pop_persons) or pop_years != list(range(pop_years[0], pop_years[0] + len(pop_years))):
        raise ValueError("population.json: years are not consecutive or differ in length from persons")
    obj = {
        "meta": meta("core", "Ядро: източници, предстоящи набори и основни числа", source=["asbp", "kfp", "eurostat"],
                     source_note="Числата са копирани от наборите, които ги притежават (Прогноза, Изпълнение, Дълг, Разходи, Приходи)",
                     as_of=latest["asOf"], unit="млн. €"),
        "build": {"dataVersion": DATA_VERSION, "kfpLatest": latest["asOf"], "kfpMonths2026": latest["month"],
                  "kfpNext": execu["pendingMonths"][0]["asOf"], "eurRate": EUR},
        "years": {"list": YEARS, "vintage": VINTAGE},
        "sources": SOURCES,
        "pending": {pid: pending_block(pid) for pid in sorted(PENDING_DEFS)},
        "counts": counts,
        "population": {"year": pop["year"], "date": pop["date"], "persons": pop["persons"], "source": ["eurostat"],
                       "asOf": POPULATION_ASOF, "series": {"years": pop_years, "persons": pop_persons}},
        "kpis": kpis,
        "functions": functions,
        "revenueGroups": groups,
    }
    return ctx.put("core.json", obj)
