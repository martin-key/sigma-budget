"""Annex 3 (Приложение № 3, КФП 2023–2028) of the MF motives: the revenue/expenditure trees.

The source rows come from data/originals/asbp/asbp_tables.json (tables `annex3_mln`, `annex3_pct_gdp`).
The PDF indentation does not follow the arithmetic (interest is printed at the level of "Разходи" but is
part of "Текущи разходи"; "Нелихвени разходи" is a memo line), so the tree below is defined by hand and every
parent is verified against its children (tolerance 0.3 млн. €, the source rounds each cell to 0.1).

Columns (years): 2024 actual, 2025 preliminary, 2026 project, 2027 forecast, 2028 forecast.
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
from budget_pipeline.build.data_io import RAW, jload

YEARS = [2024, 2025, 2026, 2027, 2028]
VINTAGE = ["actual", "prelim", "plan", "forecast", "forecast"]
JUNK_LABELS = {"191", "192", "193", "194"}

# (id, expected label, parent id, level, flags)   -- order is the order of the printed table
# idx = position in the table after the junk rows are dropped.
REVENUE = [
    ("r.total", "Приходи, помощи и дарения", None, 0),
    ("r.tax", "Данъчно-осигурителни приходи", "r.total", 1),
    ("r.direct", "Преки данъци", "r.tax", 2),
    ("r.corp", "Корпоративни данъци", "r.direct", 3),
    ("r.corp.nonfin", "от нефинансови предприятия", "r.corp", 4),
    ("r.corp.fin", "от финансови институции", "r.corp", 4),
    ("r.pit", "Данъци върху доходите на физическите лица", "r.direct", 3),
    ("r.social", "Приходи на социалното и здравното осигуряване", "r.tax", 2),
    ("r.social.doo", "Осигурителни вноски за държавно обществено осигуряване", "r.social", 3),
    ("r.social.health", "Здравноосигурителни вноски", "r.social", 3),
    ("r.indirect", "Косвени данъци", "r.tax", 2),
    ("r.vat", "ДДС", "r.indirect", 3),
    ("r.excise", "Акцизи", "r.indirect", 3),
    ("r.insprem", "Данък върху застрахователните премии", "r.indirect", 3),
    ("r.customs", "Мита и митнически такси", "r.indirect", 3),
    ("r.othertax", "Други данъци", "r.tax", 2),
    ("r.property", "Имуществени данъци", "r.othertax", 3),
    ("r.citother", "Други данъци по Закона за корпоративното подоходно облагане", "r.othertax", 3),
    ("r.othertax.rest", "Други данъци", "r.othertax", 3),
    ("r.nontax", "Неданъчни приходи", "r.total", 1),
    ("r.bnb", "Превишение на приходите над разходите на БНБ", "r.nontax", 2),
    ("r.nontax.other", "Други", "r.nontax", 2),
    ("r.fees", "Приходи от такси", "r.nontax.other", 3),
    ("r.propinc", "Приходи и доходи от собственост", "r.nontax.other", 3),
    ("r.fines", "Глоби, санкции и наказателни лихви", "r.nontax.other", 3),
    ("r.assetsales", "Постъпления от продажба на нефинансови активи", "r.nontax.other", 3),
    ("r.concessions", "Приходи от концесии", "r.nontax.other", 3),
    ("r.otherinc", "Други приходи", "r.nontax.other", 3),
    ("r.grants", "Помощи и дарения", "r.total", 1),
    ("r.grants.dom", "помощи от страната", "r.grants", 2),
    ("r.grants.foreign", "помощи от чужбина", "r.grants", 2),
]

EXPENDITURE = [
    ("x.total", "Общо разходи и Вноска в общия бюджет на ЕС", None, 0),
    ("x.exp", "Разходи", "x.total", 1),
    ("x.nonint", "Нелихвени разходи", "x.exp", 2),            # memo line: x.exp - x.interest
    ("x.current", "Текущи разходи", "x.exp", 2),
    ("x.personnel", "Персонал", "x.current", 3),
    ("x.wages", "Заплати", "x.personnel", 4),
    ("x.otherpay", "Други възнаграждения и плащания за персонала", "x.personnel", 4),
    ("x.insurance", "Осигурителни вноски", "x.personnel", 4),
    ("x.maint", "Издръжка - общо", "x.current", 3),
    ("x.scholarships", "Стипендии", "x.current", 3),
    ("x.subsidies", "Субсидии и други текущи трансфери - общо", "x.current", 3),
    ("x.subsidies.main", "Субсидии и други текущи трансфери", "x.subsidies", 4),
    ("x.subsidies.hospital", "Субсидии и други текущи трансфери за осъществяване на болнична помощ", "x.subsidies", 4),
    ("x.social", "Социални и здравноосигурителни плащания", "x.current", 3),
    ("x.pensions", "Пенсии", "x.social", 4),
    ("x.household", "Текущи трансфери, обезщетения и помощи за домакинствата", "x.social", 4),
    ("x.health", "Здравноосигурителни плащания", "x.social", 4),
    ("x.abroad", "Предоставени текущи и капиталови трансфери за чужбина", "x.exp", 2),
    ("x.reserve", "Прираст на държавния резерв и изкупуване на земеделска продукция", "x.exp", 2),
    ("x.capex", "Капиталови разходи", "x.exp", 2),
    ("x.contingency", "Резерв за непредвидени и/или неотложни разходи", "x.exp", 2),
    ("x.contingency.orgs", "- по бюджетите на бюджетните организации", "x.contingency", 3),
    ("x.contingency.nzok", "НЗОК", "x.contingency.orgs", 4),
    ("x.contingency.na", "Народно събрание", "x.contingency.orgs", 4),
    ("x.contingency.judiciary", "Съдебна власт", "x.contingency.orgs", 4),
    ("x.contingency.disasters", "- за предотвратяване, овладяване и преодоляване на последиците от бедствия", "x.contingency", 3),
    ("x.interest", "Лихви", "x.current", 3),                   # interest is part of "Текущи разходи"
    ("x.interest.ext", "Външни лихви", "x.interest", 4),
    ("x.interest.dom", "Вътрешни лихви", "x.interest", 4),
    ("x.eucontrib", "Вноска в общия бюджет на ЕС", "x.total", 1),
    ("x.balance", "Бюджетно салдо (+/-)", None, 0),
    ("x.fin", "Финансиране (+/-)", None, 0),
]
MEMO = {"x.nonint"}                                            # printed, but not an addend of its parent

# children sums that must hold (parent == sum(children)), tolerance 0.3
SUM_RULES = {
    "r.total": ["r.tax", "r.nontax", "r.grants"],
    "r.tax": ["r.direct", "r.social", "r.indirect", "r.othertax"],
    "r.direct": ["r.corp", "r.pit"],
    "r.corp": ["r.corp.nonfin", "r.corp.fin"],
    "r.social": ["r.social.doo", "r.social.health"],
    "r.indirect": ["r.vat", "r.excise", "r.insprem", "r.customs"],
    "r.othertax": ["r.property", "r.citother", "r.othertax.rest"],
    "r.nontax": ["r.bnb", "r.nontax.other"],
    "r.nontax.other": ["r.fees", "r.propinc", "r.fines", "r.assetsales", "r.concessions", "r.otherinc"],
    "r.grants": ["r.grants.dom", "r.grants.foreign"],
    "x.total": ["x.exp", "x.eucontrib"],
    "x.exp": ["x.current", "x.abroad", "x.reserve", "x.capex", "x.contingency"],
    "x.current": ["x.personnel", "x.maint", "x.scholarships", "x.subsidies", "x.social", "x.interest"],
    "x.personnel": ["x.wages", "x.otherpay", "x.insurance"],
    "x.subsidies": ["x.subsidies.main", "x.subsidies.hospital"],
    "x.social": ["x.pensions", "x.household", "x.health"],
    "x.contingency": ["x.contingency.orgs", "x.contingency.disasters"],
    "x.contingency.orgs": ["x.contingency.nzok", "x.contingency.na", "x.contingency.judiciary"],
    "x.interest": ["x.interest.ext", "x.interest.dom"],
}


def _content_rows(table):
    """Rows of one Annex 3 table without the page-number junk rows (labels '191'…'194')."""
    return [r for r in table["rows"] if r["label"].strip() not in JUNK_LABELS]


def load():
    """Return {'mln': {id: values}, 'pct': {id: values}, 'labels': {id: label}, 'tree': [...], 'gdp': [...]}.

    `values` are lists of 5 numbers (None kept where the source is blank: BNB profit 2027–2028, NA 2024–2025);
    the caller decides how to present a missing year (the key is absent in the published files).
    """
    d = jload(RAW / "asbp" / "asbp_tables.json")["tables"]
    mln_rows = _content_rows(d["annex3_mln"])
    pct_rows = _content_rows(d["annex3_pct_gdp"])
    spec = REVENUE + EXPENDITURE
    out = {"mln": {}, "pct": {}, "labels": {}, "tree": [], "gdp": None}
    if len(mln_rows) != len(spec):
        raise ValueError("annex3_mln: %d content rows, expected %d" % (len(mln_rows), len(spec)))
    for (rid, label, parent, level), r in zip(spec, mln_rows):
        if r["label"].strip() != label:
            raise ValueError("annex3_mln label mismatch for %s: %r != %r" % (rid, r["label"], label))
        out["mln"][rid] = r["values"]
        out["labels"][rid] = label
        out["tree"].append({"id": rid, "label": label, "level": level, "parent": parent, "memo": rid in MEMO})
    # pct table: same rows + the trailing "Б В П" row (GDP, млн. €)
    if len(pct_rows) != len(spec) + 1 or pct_rows[-1]["label"].replace(" ", "") != "БВП":
        raise ValueError("annex3_pct_gdp layout changed")
    for (rid, label, parent, level), r in zip(spec, pct_rows[:-1]):
        if r["label"].strip() != label:
            raise ValueError("annex3_pct_gdp label mismatch for %s: %r != %r" % (rid, r["label"], label))
        out["pct"][rid] = r["values"]
    out["gdp"] = pct_rows[-1]["values"]
    return out


def check_sums(a, tol=0.3):
    """Verify SUM_RULES on the loaded Annex 3; returns a list of problem strings (empty when fine)."""
    problems = []
    for parent, kids in SUM_RULES.items():
        for yi, year in enumerate(YEARS):
            pv = a["mln"][parent][yi]
            if pv is None:
                continue
            s = sum((a["mln"][k][yi] or 0.0) for k in kids)
            if abs(pv - s) > tol + 1e-9:
                problems.append("%s %d: %.1f != sum(%s)=%.1f" % (parent, year, pv, ",".join(kids), s))
    # identities across the two blocks
    for yi, year in enumerate(YEARS):
        bal = a["mln"]["r.total"][yi] - a["mln"]["x.total"][yi]
        if abs(bal - a["mln"]["x.balance"][yi]) > tol + 1e-9:
            problems.append("balance %d: %.1f != %.1f" % (year, bal, a["mln"]["x.balance"][yi]))
        if abs(a["mln"]["x.fin"][yi] + a["mln"]["x.balance"][yi]) > 1e-9:
            problems.append("fin != -balance %d" % year)
        nonint = a["mln"]["x.exp"][yi] - a["mln"]["x.interest"][yi]
        if abs(nonint - a["mln"]["x.nonint"][yi]) > tol + 1e-9:
            problems.append("nonint %d: %.1f != %.1f" % (year, nonint, a["mln"]["x.nonint"][yi]))
    return problems
