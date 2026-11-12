"""debt.json (D13 + D14): state debt 2024-2028, Maastricht debt 2015-2025, quarterly series, structure and flows of the debt.

Inputs, all READ (nothing is typed in): Табл. VI-1 (asbp_tables.json), Табл. VI-2 and the prose of pp.138-145 (pdf_pages_clean.json,
via debt_pdf.py), Eurostat gov_10dd_edpt1 (annual, BG + EU27) and gov_10q_ggdebt (quarterly, BG) as JSON-stat, BNB SDMX
GGD (GGALN_G01_XDC) and CGD (GCALN_G01_AC_XDC), UNIT_MULT 6 = million euro. Every value is cross-checked against a second copy
(data/inputs/debt_stock.json, debt_gdp.json, Annex 3 GDP, the BNB-Eurostat overlap) and the build fails on a mismatch.
User-facing strings are Bulgarian, keys are English. "zdd" is a legacy key/route value: labels say "държавен дълг (МФ)".
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import math
from xml.etree import ElementTree as ET

import budget_pipeline.build.debt_pdf as pdf
import budget_pipeline.extract.budget_law_parser as budget_law_parser
from budget_pipeline.build.fiscal import VINTAGE, YEARS, zdd_table
from budget_pipeline.build.data_io import RAW, isnum, jsonstat_series, meta, pct, rnd

ASOF_BILL = "2026-07-01"
LAW_HTML = "dv/zdb2026_dv69_idMat245041.html"
LAW_DATE = "2026-07-31"
ESTAT_ANNUAL = "eurostat/gov_10dd_edpt1_BG_EU.json"
ESTAT_QUARTERLY = "eurostat/gov_10q_ggdebt_BG.json"
BNB_GG = ("bnb_sdmx/ggd.xml", "GGALN_G01_XDC")
BNB_CG = ("bnb_sdmx/cgd.xml", "GCALN_G01_AC_XDC")
PRINTED_VINTAGE = {"Отчет": "actual", "Проект": "plan", "Прогноза": "forecast"}
FINANCING_ROWS = ["fin", "fin.ext", "fin.ext.markets", "fin.dom", "fin.dom.advances", "fin.dom.refunds", "fin.priv"]


def _bnb(rel, indicator):
    """One BNB SDMX quarterly series -> {asOf, quarters, mln}; fails on NaN, a missing quarter or a non-final status."""
    root = ET.parse(str(RAW / rel)).getroot()
    prepared = None
    for el in root.iter():
        if el.tag.endswith("}Prepared"):
            prepared = (el.text or "")[:10]
    found = [s for s in root.iter("Series") if s.get("INDICATOR") == indicator]
    if len(found) != 1:
        raise ValueError("%s: indicator %s found %d times" % (rel, indicator, len(found)))
    s = found[0]
    if (s.get("UNIT_MULT"), s.get("REF_AREA"), s.get("FREQ")) != ("6", "BG", "Q"):
        raise ValueError("%s: unexpected series attributes %r" % (rel, s.attrib))
    obs = {}
    for o in s.iter("Obs"):
        v = float(o.get("OBS_VALUE"))
        if not math.isfinite(v) or o.get("OBS_STATUS") != "A":
            raise ValueError("%s: bad observation %r" % (rel, o.attrib))
        obs[o.get("TIME_PERIOD")] = v
    q = sorted(obs)
    return {"asOf": prepared, "indicator": indicator, "quarters": q, "mln": [rnd(obs[k], 2) for k in q]}


def _eurostat_annual(ctx):
    js = ctx.raw(ESTAT_ANNUAL)
    ser = {(g, u): jsonstat_series(js, "time", {"geo": g, "unit": u}) for g in ("BG", "EU27_2020") for u in ("MIO_EUR", "PC_GDP")}
    years = [str(y) for y in range(2015, 2026)]
    for k, s in ser.items():
        if sorted(s) != years:
            raise ValueError("Eurostat annual %r: years %r" % (k, sorted(s)))
    col = lambda g, u: [rnd(ser[(g, u)][y][0], 3) for y in years]      # noqa: E731
    return {"asOf": js["updated"][:10], "years": [int(y) for y in years], "bgMln": col("BG", "MIO_EUR"), "bgPct": col("BG", "PC_GDP"),
            "euMln": col("EU27_2020", "MIO_EUR"), "euPct": col("EU27_2020", "PC_GDP")}


def _eurostat_quarterly(ctx):
    js = ctx.raw(ESTAT_QUARTERLY)
    mln = jsonstat_series(js, "time", {"geo": "BG", "unit": "MIO_EUR"})
    pg = jsonstat_series(js, "time", {"geo": "BG", "unit": "PC_GDP"})
    q = sorted(mln)
    if sorted(pg) != q or any((mln[k][1] or "") != (pg[k][1] or "") for k in q):
        raise ValueError("Eurostat quarterly: the two units differ in quarters or flags")
    return {"asOf": js["updated"][:10], "quarters": q, "mln": [rnd(mln[k][0], 3) for k in q], "pctGdp": [rnd(pg[k][0], 3) for k in q],
            "flags": [mln[k][1] or "" for k in q]}


def _bg(x):
    """35.0 -> '35' / 37.7 -> '37,7' / 3261.7 -> '3 261,7' (Bulgarian number as printed in the law)."""
    whole, _, frac = ("%.1f" % x).partition(".")
    whole = "{:,}".format(int(whole)).replace(",", " ")
    return whole if frac == "0" else whole + "," + frac


def _same(a, b, tol, what):
    if len(a) != len(b) or any(abs(x - y) > tol for x, y in zip(a, b)):
        raise ValueError("cross-check failed: %s: %r vs %r" % (what, a, b))
    return max([abs(x - y) for x, y in zip(a, b)] + [0.0])


# Eurostat revises the annual series with every EDP notification (April, October); the frozen input copies it is checked against
# (data/inputs/debt_gdp.json, debt_stock.json) stay frozen. Each accepted revision is written out under the release ("updated" of
# gov_10dd_edpt1) as year: (frozen input, Eurostat). Any other difference, or a new release, stops the build until it is reviewed here.
EUROSTAT_REVISIONS = {"2026-10-21": {
    ("BG", "PC_GDP"): {2020: (24.5, 24.4), 2022: (22.5, 22.4), 2023: (22.9, 22.8), 2024: (23.8, 23.7)},
    ("BG", "MIO_EUR"): {2025: (34634.9, 34797.0)},
    ("EU27_2020", "PC_GDP"): {2015: (85.1, 85.0), 2016: (84.1, 84.0), 2018: (79.5, 79.4), 2019: (77.5, 77.4), 2020: (89.5, 89.4),
                              2021: (86.7, 86.6), 2022: (82.4, 82.3), 2023: (80.5, 80.3), 2024: (80.7, 80.3), 2025: (81.7, 81.5)},
}}


def _same_revised(new, old, years, key, release, what):
    """Eurostat (new) against the frozen frozen input copy (old), year by year: equal, or exactly the revision listed for the release."""
    listed = EUROSTAT_REVISIONS.get(release, {}).get(key, {})
    if len(new) != len(old) or len(new) != len(years):
        raise ValueError("cross-check failed: %s: %d / %d values for %d years" % (what, len(new), len(old), len(years)))
    for y, a, b in zip(years, new, old):
        if (a == b and y not in listed) or listed.get(y) == (b, a):
            continue
        raise ValueError("cross-check failed: %s %d: Eurostat %r, prototype %r, revision listed for %s: %r" % (
            what, y, a, b, release, listed.get(y)))


def build_debt(ctx):
    z = zdd_table(ctx)
    vintage = [PRINTED_VINTAGE[c.split(" ", 1)[1]] for c in ctx.tables["VI_1"]["columns"]]
    if [c.split(" ", 1)[0] for c in ctx.tables["VI_1"]["columns"]] != [str(y) for y in YEARS]:
        raise ValueError("VI-1 columns are not 2024..2028")
    check = {}

    # ----------------------------------------------------------------------------- state debt (Табл. VI-1)
    proto = ctx.src("debt_stock")["state_debt"]
    for mine, theirs in (("totalMln", "mln_eur"), ("totalPctGdp", "pct_gdp"), ("externalMln", "external_mln_eur"),
                         ("domesticMln", "domestic_mln_eur")):
        _same(z[mine], proto[theirs], 0.0, "VI-1 %s vs prototype debt_stock" % mine)
    _same(z["gdpMln"], ctx.annex["gdp"], 0.05, "VI-1 GDP row vs Annex 3")
    dev = 0.0
    for tot, pg in (("totalMln", "totalPctGdp"), ("externalMln", "externalPctGdp"), ("domesticMln", "domesticPctGdp")):
        dev = max(dev, _same([pct(v, g, 2) for v, g in zip(z[tot], z["gdpMln"])], z[pg], 0.06, "VI-1 %s printed %% vs computed" % tot))
    check["zddPrintedPctMaxDev"] = rnd(dev, 3)
    zdd = {"years": list(YEARS), "vintage": vintage, "columns": list(ctx.tables["VI_1"]["columns"]), "totalMln": z["totalMln"],
           "externalMln": z["externalMln"], "domesticMln": z["domesticMln"], "pctGdp": z["totalPctGdp"],
           "externalPctGdp": z["externalPctGdp"], "domesticPctGdp": z["domesticPctGdp"], "gdpMln": z["gdpMln"],
           "source": ["asbp"], "asOf": ASOF_BILL, "table": "VI-1"}

    # ----------------------------------------------------------------------------- Maastricht (Eurostat annual)
    ann = _eurostat_annual(ctx)
    gdp_proto = ctx.src("debt_gdp")
    yrs = [str(y) for y in ann["years"]]
    _same_revised(ann["bgPct"], [gdp_proto["BG"][y] for y in yrs], ann["years"], ("BG", "PC_GDP"), ann["asOf"],
                  "Eurostat BG %GDP vs prototype debt_gdp")
    _same_revised(ann["euPct"], [gdp_proto["EU27_2020"][y] for y in yrs], ann["years"], ("EU27_2020", "PC_GDP"), ann["asOf"],
                  "Eurostat EU27 %GDP vs prototype debt_gdp")
    ga = ctx.src("debt_stock")["gg_debt_annual"]
    _same_revised(ann["bgMln"][5:], ga["mln_eur"], ann["years"][5:], ("BG", "MIO_EUR"), ann["asOf"],
                  "Eurostat BG mln 2020-2025 vs prototype debt_stock")
    maastricht = {"years": ann["years"], "bg": {"mln": ann["bgMln"], "pctGdp": ann["bgPct"]},
                  "eu27": {"pctGdp": ann["euPct"], "mln": ann["euMln"]}, "thresholdPctGdp": 60,
                  "thresholdNote": "Референтна стойност от 60% от БВП (Протокол за процедурата при прекомерен дефицит към Договорите на ЕС).",
                  "dataset": "gov_10dd_edpt1", "source": ["eurostat"], "asOf": ann["asOf"]}

    # ----------------------------------------------------------------------------- quarterly (Eurostat, BNB)
    eq = _eurostat_quarterly(ctx)
    gg, cg = _bnb(*BNB_GG), _bnb(*BNB_CG)
    gg_by = dict(zip(gg["quarters"], gg["mln"]))
    cg_by = dict(zip(cg["quarters"], cg["mln"]))
    check["eurostatQuarterlyVsBnbGgMaxDev"] = rnd(_same(eq["mln"], [gg_by[k] for k in eq["quarters"]], 0.06, "Eurostat quarterly vs BNB GG"), 3)
    q4 = [(y, "%d-Q4" % y) for y in ann["years"] if "%d-Q4" % y in gg_by]
    check["bnbGgQ4VsEurostatAnnualMaxDev"] = rnd(_same([gg_by[k] for _, k in q4], [ann["bgMln"][ann["years"].index(y)] for y, _ in q4],
                                                      0.06, "BNB GG Q4 vs Eurostat annual"), 3)
    quarterly = {"eurostat": {"quarters": eq["quarters"], "mln": eq["mln"], "pctGdp": eq["pctGdp"], "flags": eq["flags"],
                              "flagLabels": {"p": "предварителни данни"}, "dataset": "gov_10q_ggdebt", "source": ["eurostat"],
                              "asOf": eq["asOf"]},
                 "bnbGg": {"quarters": gg["quarters"], "mln": gg["mln"], "indicator": gg["indicator"], "source": ["bnb"], "asOf": gg["asOf"]},
                 "bnbCg": {"quarters": cg["quarters"], "mln": cg["mln"], "indicator": cg["indicator"], "source": ["bnb"], "asOf": cg["asOf"]}}

    # ----------------------------------------------------------------------------- the three totals side by side
    cyears = [2024, 2025]
    ci = [YEARS.index(y) for y in cyears]
    compare = {"years": cyears, "rows": [
        {"id": "zdd", "label": "Държавен дълг (таблица VI-1 в мотивите към законопроекта, Министерство на финансите)",
         "mln": [zdd["totalMln"][i] for i in ci], "source": ["asbp"]},
        {"id": "cg", "label": "Дълг на централното управление (БНБ, край на годината)",
         "mln": [cg_by["%d-Q4" % y] for y in cyears], "source": ["bnb"]},
        {"id": "gg", "label": "Консолидиран брутен дълг на сектор „Държавно управление“ (по Маастрихт, Eurostat)",
         "mln": [ann["bgMln"][ann["years"].index(y)] for y in cyears], "source": ["eurostat"]}],
        "note": ("Трите реда не са еднакви, защото обхватът им е различен: таблица VI-1 на Министерството на финансите е държавният дълг, "
                 "БНБ показва дълга на централното управление, а по Маастрихт се брои консолидираният брутен дълг на целия сектор "
                 "„Държавно управление“. Съпоставката между редовете предстои да бъде проверена от експерт по публични финанси.")}

    # ----------------------------------------------------------------------------- headline numbers per scope
    i25, i26 = YEARS.index(2025), YEARS.index(2026)
    qlast = len(eq["quarters"]) - 1
    latest = {"zdd": {"year": 2025, "vintage": vintage[i25], "mln": zdd["totalMln"][i25], "pctGdp": zdd["pctGdp"][i25], "asOf": ASOF_BILL,
                      "next": {"year": 2026, "vintage": vintage[i26], "mln": zdd["totalMln"][i26], "pctGdp": zdd["pctGdp"][i26]}},
              "maastricht": {"year": 2025, "mln": maastricht["bg"]["mln"][-1], "pctGdp": maastricht["bg"]["pctGdp"][-1], "asOf": ann["asOf"],
                             "quarter": {"id": eq["quarters"][qlast], "mln": eq["mln"][qlast], "pctGdp": eq["pctGdp"][qlast],
                                         "flag": eq["flags"][qlast], "asOf": eq["asOf"]}}}
    scopes = [
        {"id": "zdd", "label": "Държавен дълг (данни на Министерството на финансите)", "short": "Държавен дълг",
         "years": [2024, 2028], "latestActual": 2025, "source": ["asbp"],
         "note": "Таблица VI-1 в мотивите към законопроекта: 2024 и 2025 г. са отчет, 2026 г. е проект, 2027–2028 г. са прогноза. Разделен е на външен и вътрешен."},
        {"id": "maastricht", "label": "Дълг по Маастрихт (сектор „Държавно управление“)", "short": "Дълг по Маастрихт",
         "years": [2015, 2025], "latestActual": 2025, "source": ["eurostat", "bnb"],
         "note": "Консолидиран брутен дълг на сектор „Държавно управление“: показателят, по който България се сравнява с ЕС и с прага от 60% от БВП."}]

    # ----------------------------------------------------------------------------- structure and flows (from the PDF text)
    structure = pdf.parse_structure(ctx)
    check["structureGroupMaxDevFrom100"] = structure.pop("maxDeviationFrom100")
    for g, d in check["structureGroupMaxDevFrom100"].items():
        if d > 0.25:
            raise ValueError("Табл. VI-2: group %s adds up to 100 %+.2f" % (g, d))
    structure.update({"table": "VI-2", "source": ["asbp"], "asOf": ASOF_BILL, "unit": "% от държавния дълг",
                      "note": "Поради закръгления сборът на групите може да се различава от 100%. От 01.01.2026 г. еврото е официалната валута; "
                              "редът „Левове“ е без стойност за 2026–2028 г. в източника."})
    interest = pdf.parse_interest(ctx)
    if abs(interest["totalMln"][0] - interest["externalMln"][0] - interest["domesticMln"][0]) > 0.05 or \
            abs(interest["totalMln"][1] - interest["externalMln"][1] - interest["domesticMln"][1]) > 0.05:
        raise ValueError("interest costs: external + domestic != total")
    interest.update({"source": ["asbp"], "asOf": ASOF_BILL,
                     "note": "Лихвени разходи за обслужването на държавния дълг. Не са същото като реда „Лихви“ в консолидираната фискална програма "
                             "(Приложение 3): обхватът е различен."})
    guar = pdf.parse_guaranteed(ctx)
    for i, y in enumerate(guar["years"]):
        if abs(guar["externalMln"][i] + guar["domesticMln"][i] - guar["totalMln"][i]) > 0.05:
            raise ValueError("guaranteed debt %d: external + domestic != total" % y)
        if abs(pct(guar["totalMln"][i], zdd["gdpMln"][YEARS.index(y)], 1) - guar["pctGdpPrinted"][i]) > 0.06:
            raise ValueError("guaranteed debt %d: printed %% of GDP differs from the computed one" % y)
    for i in range(2):
        if abs(sum(s["values"][i] for s in guar["sectors"]) - 100.0) > 0.25:
            raise ValueError("guaranteed debt sectors do not add up to 100")
    guar.update({"source": ["asbp"], "asOf": ASOF_BILL,
                 "note": "Държавногарантиран дълг: гаранциите на държавата за чужди заеми. Не е част от държавния дълг в таблица VI-1."})
    newdebt = pdf.parse_new_debt(ctx)
    y25 = newdebt["y2025"]
    if abs(sum(p["mln"] for p in y25["parts"]) - y25["totalMln"]) > 0.05:
        raise ValueError("new debt 2025: parts do not add up")
    iss = newdebt["issued2026"]
    if abs(sum(m["mln"] for m in iss["months"]) - iss["totalMln"]) > 0.05:
        raise ValueError("2026 domestic issues: months do not add up")
    newdebt.update({"source": ["asbp"], "asOf": ASOF_BILL,
                    "kindLabels": {"limit": "Най-голям размер на новия дълг (горна граница по закона)", "plan": "Планирано в средносрочната прогноза"},
                    "note": "2026 г. е горна граница по закона (чл. 67, ал. 1), не прогноза; 2027–2028 г. са плановете на Министерството на финансите."})

    # ----------------------------------------------------------------------------- the limits of the adopted law
    paras = [text for kind, text in budget_law_parser.dv_blocks(str(RAW / LAW_HTML)) if kind == "p"]
    lw = pdf.parse_law_limits(paras)
    plan26 = newdebt["plan"][0]
    if plan26["bln"] != lw["newDebtBln"] or newdebt["limitEnd2026Bln"] != lw["debtCapEnd2026Bln"]:
        raise ValueError("the motives (%s / %s) and the law (%s / %s) disagree on the 2026 debt limits" % (
            plan26["bln"], newdebt["limitEnd2026Bln"], lw["newDebtBln"], lw["debtCapEnd2026Bln"]))
    check["limitsMatchMotives"] = True
    if lw["safeLoanMln"] >= lw["newDebtBln"] * 1000:
        raise ValueError("the SAFE loan is not part of the new-debt limit")
    limits = {"year": 2026, "source": ["zdb"], "asOf": LAW_DATE, "items": [
        {"id": "debtCap", "art": 66, "label": "Най-голям размер на държавния дълг към края на 2026 г.", "mln": rnd(lw["debtCapEnd2026Bln"] * 1000, 1),
         "printed": "%s млрд. евро" % _bg(lw["debtCapEnd2026Bln"])},
        {"id": "newDebt", "art": 67, "para": 1, "label": "Най-голям размер на новия държавен дълг, който може да бъде поет през годината",
         "mln": rnd(lw["newDebtBln"] * 1000, 1), "printed": "%s млрд. евро" % _bg(lw["newDebtBln"]),
         "includesMln": lw["safeLoanMln"],
         "includes": "заем за финансова подкрепа по линия на инструмента „Мерки за сигурността на Европа (SAFE)“"},
        {"id": "newGuarantees", "art": 69, "para": 1, "label": "Най-голям размер на новите държавни гаранции", "mln": lw["newGuaranteesMln"],
         "printed": "%s млн. евро" % _bg(lw["newGuaranteesMln"])},
        {"id": "guaranteesAll", "art": 71, "label": "Общ най-голям размер на новите гаранции по чл. 69 и 70", "mln": lw["guaranteesAllMln"],
         "printed": "%s млн. евро" % _bg(lw["guaranteesAllMln"])},
        {"id": "fiscalReserve", "art": 65, "label": "Най-малък размер на фискалния резерв към 31 декември 2026 г.",
         "mln": rnd(lw["reserveMinBln"] * 1000, 1), "printed": "%s млрд. евро" % _bg(lw["reserveMinBln"]), "kind": "min"}],
        "note": "Закон за държавния бюджет на Република България за 2026 г., ДВ бр. 69 от 31.07.2026 г. Горните граници не са прогноза."}

    # ----------------------------------------------------------------------------- financing (monthly, from execution.json)
    rows = {r["id"]: r for r in ctx.execution["rows"]}
    financing = {"ref": "execution", "rows": list(FINANCING_ROWS),
                 "labels": {i: rows[i]["short"] for i in FINANCING_ROWS}, "asOf": ctx.execution["latest"]["asOf"]}

    notes = [
        {"id": "projection", "text": "2026 г. е проектът към законопроекта (01.07.2026 г.), а 2027–2028 г. са прогноза на Министерството на финансите: това не са отчетени данни."},
        {"id": "quarterly", "text": "Първото тримесечие на 2026 г. в данните на Eurostat е предварително (отбелязано с „p“)."},
        {"id": "maturities", "text": "Падежите и емисиите на държавните ценни книжа предстоят: регистърът на Министерството на финансите не се изтегля автоматично."},
    ]
    obj = {
        "meta": meta("D13+D14", "Дълг: държавен дълг 2024–2028, дълг по Маастрихт и тримесечни редове", source=["asbp", "eurostat", "bnb"],
                     source_note="Таблици VI-1 и VI-2 и текстът на част VI от мотивите към законопроекта; Eurostat gov_10dd_edpt1 и gov_10q_ggdebt; "
                                 "БНБ (SDMX): дълг на сектор „Държавно управление“ и на централното управление",
                     as_of=max(cg["asOf"], gg["asOf"], eq["asOf"]), unit="млн. €", pending=["P06"]),
        "defaultScope": "zdd",
        "scopes": scopes,
        "latest": latest,
        "zdd": zdd,
        "maastricht": maastricht,
        "quarterly": quarterly,
        "compare": compare,
        "structure": structure,
        "interest": interest,
        "guaranteed": guar,
        "newDebt": newdebt,
        "limits": limits,
        "financing": financing,
        "notes": notes,
        "check": check,
    }
    ctx.put("debt.json", obj)
    ctx.notes.append("debt: zdd 2025 %s mln, Maastricht 2025 %s mln, BNB GG/CG %d/%d quarters" % (
        zdd["totalMln"][i25], maastricht["bg"]["mln"][-1], len(gg["quarters"]), len(cg["quarters"])))
    return obj
