"""search-index.json (DATA_SPEC 3.21): the rows behind the search box of the shell and screen S28.

One flat table, `fields` = g, title, sub, value, period, status, href, kw. `g` is an index into `groups`. The client
(site/js/searchlib.js) adds the "screens" group itself from its route table, so it is NOT here; it falls back to the
glossary only when the index has no `terms` rows, so the terms ARE here (built with the same rules as the client).

Six groups: indicators (the headline numbers and the rows of the money screens), institutions (46 budgets + their
policies and programmes), municipalities (265), measures (52), terms (64, from DATA2's glossary.json) and datasets
(the catalog entries, the seven pending sets and the clearly marked mock rows). Every number comes from a built file;
only the wording of a few synonyms (kw) is typed in. Budget: < 250 KB raw (§6.7), checked here.

Runs after core.json (it reads it) and before catalog.json (which lists this file with its size).
"""
import json
import re

import bd_common
from bd_common import (BUDGET_INFO, FUNCTION_DEFS, KIND_LABELS, PENDING_DEFS, fmt_eur, fmt_khil, fmt_money, fmt_num, fmt_pct,
                       month_name)
from catalog_defs import DEFS, GROUPS as CATALOG_GROUPS
from dlib import DATA, isnum, jdumps, meta

GROUPS = ["indicators", "institutions", "municipalities", "measures", "terms", "datasets"]
FIELDS = ["g", "title", "sub", "value", "period", "status", "href", "kw"]
POPULAR_QUERIES = ["ДДС", "дълг", "Пловдив", "образование", "МВР", "пенсии", "заплати"]   # same list as searchlib.js POPULAR
LIMIT_BYTES = 250_000
PLAN_YEAR = 2026
STATUSES = ("real", "mock", "pending")

# Words a person may type for a row that its title does not contain. Wording only: no number is typed here.
_RG_KW = {
    "dds": "данък добавена стойност",
    "osiguritelni": "осигуровки вноски",
    "nedanachni": "такси глоби",
    "pomoshti": "европейски средства еврофондове дарения",
    "ddfl": "подоходен данък доходи физически лица ддфл",
    "akcizi": "акциз гориво цигари алкохол",
    "korporativen": "данък печалба фирми",
    "drugi": "мита застрахователни премии",
}
_FN_KW = {
    "obshti-sluzhbi": "администрация",
    "otbrana-sigurnost": "армия полиция сигурност",
    "obrazovanie": "училища университети учители",
    "zdraveopazvane": "болници лекари лечение",
    "sotsialni": "пенсии пенсионери помощи",
    "zhilishtno-sreda": "жилища ВиК",
    "kultura-sport": "култура спорт",
    "ikonomika": "икономика транспорт земеделие енергетика",
    "drugi": "резерв",
}
_ECON = {   # Annex 3 expenditure row id -> extra words
    "x.personnel": "заплати възнаграждения персонал",
    "x.wages": "заплата възнаграждения",
    "x.otherpay": "възнаграждения",
    "x.insurance": "осигуровки",
    "x.maint": "издръжка",
    "x.scholarships": "стипендии",
    "x.subsidies": "субсидии трансфери",
    "x.social": "пенсии помощи здравна каса",
    "x.pensions": "пенсия пенсионери",
    "x.household": "помощи обезщетения домакинства",
    "x.health": "здравна каса НЗОК болници",
    "x.capex": "инвестиции",
    "x.contingency": "резерв",
    "x.interest": "лихви дълг",
    "x.interest.ext": "лихви дълг",
    "x.interest.dom": "лихви дълг",
    "x.eucontrib": "вноска ЕС членски внос",
    "x.reserve": "държавен резерв",
    "x.abroad": "чужбина",
}
_MEASURE_KIND = {"revenue": "Мярка за приходите", "expenditure": "Мярка за разходите", "law": "Законодателна промяна"}
_DS_STATUS = {"real": "реални данни", "mock": "примерни данни", "pending": "предстои"}


# ----------------------------------------------------------------------------------------------- helpers
def _obj(ctx, rel, optional=False):
    """A built file: from this run (ctx.out) or, for DATA2's files, from site/data on disk."""
    if rel in ctx.out:
        return ctx.out[rel]
    p = DATA / rel
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    if optional:
        return None
    raise ValueError("search-index: %s is missing (build order or a failed step?)" % rel)


def _clean(s):
    """One line; plain spaces collapsed, the no-break spaces of the number formats kept."""
    return re.sub(r"[ \t\r\n]+", " ", str(s if s is not None else "")).strip()


def _words(*parts):
    """Space-joined search words without repeats (case-insensitive), skipping empties."""
    seen, out = set(), []
    for p in parts:
        for w in _clean(p).split(" "):
            if w and w.lower() not in seen:
                seen.add(w.lower())
                out.append(w)
    return " ".join(out)


def _money_khil(khil):
    """A sum given in thousand euro -> '5,12 млн. €' / '373,3 хил. €' / '1,23 млрд. €' (the client reads млрд|млн|хил for ties)."""
    if not isnum(khil):
        return ""
    return fmt_money(khil / 1000.0) if abs(khil) >= 1000 else fmt_khil(khil, 1)


def _first_sentence(text):
    """Same rule as searchlib.js firstSentence()."""
    t = _clean(text)
    m = re.match(r"^(.{20,160}?[.!?])(\s|$)", t)
    return m.group(1) if m else t[:160]


class _Rows:
    def __init__(self):
        self.rows = []
        self.seen = set()
        self.bytes_by_group = {g: 0 for g in GROUPS}

    def add(self, group, title, sub="", value="", period="", status="real", href="", kw=""):
        title, href = _clean(title), _clean(href)
        if not title:
            raise ValueError("search-index: a %s row has no title (href %s)" % (group, href))
        if not href.startswith("#/"):
            raise ValueError("search-index: row %r has a link that is not an in-app hash link: %r" % (title, href))
        if status not in STATUSES:
            raise ValueError("search-index: row %r has status %r" % (title, status))
        key = (group, title, href)
        if key in self.seen:
            return
        self.seen.add(key)
        row = [GROUPS.index(group), title, _clean(sub), _clean(value), _clean(period), status, href, _clean(kw)]
        self.rows.append(row)
        self.bytes_by_group[group] += len(jdumps(row).encode("utf-8")) + 1


# ----------------------------------------------------------------------------------------------- indicators
def _year_index(years, year):
    if year not in years:
        raise ValueError("search-index: year %s is not in %s" % (year, years))
    return years.index(year)


def _indicators(ctx, rows):
    core = _obj(ctx, "core.json")
    outlook = _obj(ctx, "outlook.json")
    exp = _obj(ctx, "expenditure.json")
    debt = _obj(ctx, "debt.json")
    rates = _obj(ctx, "rates.json")
    comp = _obj(ctx, "components.json")
    k, Y = core["kpis"], str(PLAN_YEAR)
    mon = "януари–%s %s" % (month_name(k["month"]), Y) if k["month"] > 1 else "януари %s" % Y
    # the six headline numbers (plan 2026) and the execution to the last report
    rows.add("indicators", "Приходи на КФП", "Консолидирана фискална програма, бюджет %s" % Y, fmt_money(k["revenue"]["planMln"]), Y,
             href="#/prihodi", kw="приходи постъпления бюджет общо кфп")
    rows.add("indicators", "Разходи на КФП", "Консолидирана фискална програма, бюджет %s" % Y, fmt_money(k["expenditure"]["planMln"]), Y,
             href="#/razhodi", kw="разходи харчене бюджет общо кфп")
    rows.add("indicators", "Бюджетно салдо (дефицит) на КФП", "Приходи минус разходи, бюджет %s" % Y, fmt_money(k["balance"]["planMln"]), Y,
             href="#/pari", kw="дефицит салдо недостиг излишък бюджет")
    rows.add("indicators", "Брутен вътрешен продукт (БВП)", "Макроикономическа прогноза, %s" % Y, fmt_money(k["gdp"]["mln"]), Y,
             href="#/prognoza", kw="бвп икономика размер на икономиката")
    rows.add("indicators", "Капиталови разходи на КФП", "Инвестиции от бюджета, %s" % Y, fmt_money(k["capex"]["planMln"]), Y,
             href="#/izpalnenie?pera=exp", kw="инвестиции капиталови разходи строителство")
    rows.add("indicators", "Изпълнение на приходите на КФП, %s" % mon, "%s от годишния план" % fmt_pct(k["revenue"]["execPct"]),
             fmt_money(k["revenue"]["execMln"]), Y, href="#/izpalnenie", kw="приходи събрани изпълнение отчет")
    rows.add("indicators", "Изпълнение на разходите на КФП, %s" % mon, "%s от годишния план" % fmt_pct(k["expenditure"]["execPct"]),
             fmt_money(k["expenditure"]["execMln"]), Y, href="#/izpalnenie", kw="разходи изпълнени изпълнение отчет")
    rows.add("indicators", "Салдо на КФП, %s" % mon, "Приходи минус разходи към края на периода", fmt_money(k["balance"]["execMln"]), Y,
             href="#/izpalnenie", kw="дефицит салдо изпълнение отчет")
    # revenue groups and the nine functions: the numbers of core.json
    for g in core["revenueGroups"]:
        rows.add("indicators", g["name"], "Приходи на КФП по видове, %s · %s от приходите" % (Y, fmt_pct(g["share"])), fmt_money(g["mln"]), Y,
                 href="#/prihodi/%s" % g["id"], kw=_RG_KW.get(g["id"], ""))
    mains = {f[0]: f[3] for f in FUNCTION_DEFS}
    for f in core["functions"]:
        names = [BUDGET_INFO[c][0] for c in mains.get(f["id"], []) if c in BUDGET_INFO]
        rows.add("indicators", f["name"], "Разходи на КФП по функции, %s · %s от разходите" % (Y, fmt_pct(f["share"])), fmt_money(f["mln"]), Y,
                 href="#/razhodi/%s" % f["id"], kw=_words(_FN_KW.get(f["id"], ""), *names))
    # economic types (Annex 3)
    ei = _year_index(exp["economic"]["years"], PLAN_YEAR)
    for r in exp["economic"]["rows"]:
        if r["id"] in _ECON and isnum(r["mln"][ei]):
            rows.add("indicators", r["label"], "Разходи на КФП по икономически вид, %s" % Y, fmt_money(r["mln"][ei]), Y,
                     href="#/razhodi?po=vid", kw=_ECON[r["id"]])
    # macro forecast
    mi = _year_index(outlook["years"], PLAN_YEAR)
    for r in outlook["macroRows"]:
        v = r["values"][mi]
        if not isnum(v):
            continue
        unit = r.get("unit", "")
        txt = fmt_money(v) if unit == "млн. €" else fmt_pct(v) if unit == "%" else "%s%s" % (fmt_num(v, 1), unit)
        rows.add("indicators", r["short"], "Макроикономическа прогноза, %s" % Y, txt, Y, href="#/prognoza",
                 kw={"hicp": "инфлация цени", "unemployment": "безработица", "gdpGrowth": "растеж икономика", "employment": "работа",
                     "compensation": "заплати доходи", "gfcf": "инвестиции", "currentAccount": "износ внос платежен баланс"}.get(r["id"], ""))
    # debt
    z, ms = debt["latest"]["zdd"], debt["latest"]["maastricht"]
    rows.add("indicators", "Държавен дълг към края на %s г." % z["next"]["year"], "%s от БВП · по бюджет %s" % (fmt_pct(z["next"]["pctGdp"]), z["next"]["year"]),
             fmt_money(z["next"]["mln"]), str(z["next"]["year"]), href="#/dalg", kw="дълг задлъжнялост заеми държавен дълг")
    rows.add("indicators", "Държавен дълг към края на %s г." % z["year"], "%s от БВП · отчет" % fmt_pct(z["pctGdp"]), fmt_money(z["mln"]), str(z["year"]),
             href="#/dalg", kw="дълг задлъжнялост заеми държавен дълг")
    rows.add("indicators", "Дълг по Маастрихт към края на %s г." % ms["year"], "Дълг на сектор „Държавно управление“ · %s от БВП" % fmt_pct(ms["pctGdp"]),
             fmt_money(ms["mln"]), str(ms["year"]), href="#/dalg?obhvat=maastricht", kw="дълг маастрихт критерий 60% евростат")
    ki = _year_index(outlook["years"], PLAN_YEAR)
    interest = outlook["kfp"]["interest"]["mln"][ki]
    rows.add("indicators", "Лихви по държавния дълг", "Разходи за лихви в КФП, бюджет %s" % Y, fmt_money(interest), Y, href="#/dalg", kw="лихви разходи за лихви дълг")
    for it in debt["limits"]["items"]:
        art = it.get("art")
        rows.add("indicators", it["label"], "Закон за държавния бюджет%s" % (", чл. %s" % art if art else ""), fmt_money(it["mln"]), str(debt["limits"]["year"]),
                 href="#/dalg", kw="таван лимит дълг заеми")
    # rates and ceilings (S18)
    emp = next(s for s in rates["scenarios"] if s["id"] == "employment")
    ch = {c["id"]: c for c in rates["changes"]}
    rows.add("indicators", "Осигурителни вноски за наето лице", "От служителя %s, от работодателя %s (от 01.08.%s г.)" % (fmt_pct(emp["employeePct"], 2), fmt_pct(emp["employerPctWithoutTzpb"], 2), Y),
             "", Y, href="#/danaci", kw="осигуровки вноски заплата нето брутно трудов договор калкулатор")
    rows.add("indicators", "Данък върху доходите на физическите лица", "Основна ставка по Приложение 2 към законопроекта", fmt_pct(rates["incomeTax"]["ratePct"]), Y,
             href="#/danaci", kw="ддфл данък доходи заплата нето брутно подоходен")
    if "max-insurable" in ch:
        c = ch["max-insurable"]
        rows.add("indicators", "Максимален месечен осигурителен доход", "От 01.08.%s г. (до тогава %s)" % (Y, fmt_eur(c["until"], 2)), fmt_eur(c["from"], 0), Y,
                 href="#/danaci", kw="осигурителен доход таван осигуровки заплата")
    if "min-self-employed" in ch:
        c = ch["min-self-employed"]
        rows.add("indicators", "Минимален осигурителен доход на самоосигуряващите се", "От 01.08.%s г. (до тогава %s)" % (Y, fmt_eur(c["until"], 2)), fmt_eur(c["from"], 2), Y,
                 href="#/danaci", kw="самоосигуряващи свободна професия еднолични търговци осигуровки")
    # the component budgets (S15)
    doo, nz, st = comp["budgets"]["doo"], comp["budgets"]["nzok"], comp["budgets"]["state"]
    rows.add("indicators", "Държавен бюджет", "Разходи по Закона за държавния бюджет %s" % Y, _money_khil(st["expKhil"]), Y,
             href="#/izpalnenie/byudzheti", kw="държавен бюджет съставни бюджети")
    rows.add("indicators", "Бюджет на държавното обществено осигуряване (ДОО)", "Разходи и трансфери по Закона за бюджета на ДОО %s" % Y,
             _money_khil(doo["expAndTransfersKhil"]), Y, href="#/izpalnenie/byudzheti", kw="доо нои пенсии осигуровки съставни бюджети")
    rows.add("indicators", "Бюджет на Националната здравноосигурителна каса (НЗОК)", "Разходи и трансфери по Закона за бюджета на НЗОК %s" % Y,
             _money_khil(nz["expAndTransfersKhil"]), Y, href="#/izpalnenie/byudzheti", kw="нзок здравна каса болници лечение съставни бюджети")
    # payments of the budget organisations (S23)
    rows.add("indicators", "Плащания на бюджетните организации (СЕБРА)", "Дневни плащания, публикувани от Министерството на иновациите и дигиталната трансформация",
             "", "", href="#/plashtania", kw="плащания доставчици фирми договори себра")


# ----------------------------------------------------------------------------------------------- institutions
def _institutions(ctx, rows):
    mi = _obj(ctx, "ministries.json")
    prog = _obj(ctx, "programs.json")
    names = {}
    for b in mi["items"]:
        names[b["id"]] = b
        pol = b.get("policies") or []
        bodies = b.get("bodies") or []
        pol_names = [p["name"] for p in pol] if pol else [p["name"] for p in bodies]
        short = b["short"] if b["short"] != b["name"] else ""
        sub = " · ".join(x for x in (short, KIND_LABELS.get(b["kind"], ""), "чл. %s от ЗДБ" % b["art"] if b.get("art") else "") if x)
        # an abbreviation goes into the title ("Министерство на вътрешните работи – МВР", as the terms do): the engine ranks a word of the
        # title above one of the description, so „МВР“ then finds the ministry before the „Военна полиция“ programme of another one
        abbr = short if re.fullmatch(r"[A-Za-zА-Яа-я]{2,8}", short or "") and short[0].isupper() else ""
        rows.add("institutions", "%s – %s" % (b["name"], abbr) if abbr else b["name"], sub, _money_khil(b.get("expKhil")), "ЗДБ %d" % PLAN_YEAR,
                 href="#/vedomstvo/%s" % b["id"],
                 kw=_words(short, b.get("lawName", ""), b["id"], *pol_names))
    f = {n: i for i, n in enumerate(prog["fields"])}
    for r in prog["items"]:
        code, name, level, y26 = r[f["code"]], r[f["name"]], r[f["level"]], r[f["y2026"]]
        if not name:
            continue                                     # a nameless row cannot be found by name (the page lists it by code)
        b = names.get(r[f["ministry"]])
        who = (b["short"] if b else r[f["ministry"]])
        val = "" if y26 == prog["sentinels"]["noData"] else _money_khil(y26)
        if level == "policy":
            rows.add("institutions", name, "%s · политика %s" % (who, code), val, str(PLAN_YEAR), href="#/vedomstvo/%s" % r[f["ministry"]], kw=code)
        else:
            rows.add("institutions", name, "%s · програма %s" % (who, code), val, str(PLAN_YEAR),
                     href="#/vedomstvo/%s/%s" % (r[f["ministry"]], code), kw=code)


# ----------------------------------------------------------------------------------------------- municipalities
def _municipalities(ctx, rows):
    mu = _obj(ctx, "municipalities.json")
    for m in mu["items"]:
        sub = "Община в област %s" % m["region"]
        if isnum(m.get("population")):
            sub += " · %s жители" % fmt_num(m["population"])
        rows.add("municipalities", m["name"], sub, _money_khil(m["transfers"]["all"]), str(mu["year"]), href="#/obshtina/%s" % m["id"],
                 kw=_words("община", m["id"]))


# ----------------------------------------------------------------------------------------------- measures
def _measures(ctx, rows):
    me = _obj(ctx, "measures.json")
    for it in me["items"]:
        eff = (it.get("effectMln") or {}).get(str(PLAN_YEAR))
        kind = _MEASURE_KIND.get(it["kind"], "Мярка")
        sub = "%s · ефект върху салдото през %d г.: %s" % (kind, PLAN_YEAR, fmt_money(eff)) if isnum(eff) and it.get("hasEstimate") else \
            "%s · без обявена оценка на ефекта" % kind
        rows.add("measures", it["name"], sub, fmt_money(eff) if isnum(eff) and it.get("hasEstimate") else "", str(PLAN_YEAR),
                 href="#/merki/%s" % it["id"], kw=it.get("text", ""))


# ----------------------------------------------------------------------------------------------- terms
def _terms(ctx, rows):
    g = _obj(ctx, "glossary.json", optional=True)
    if not g:
        ctx.notes.append("search-index: glossary.json is missing, the terms group is empty (the client falls back to the glossary)")
        return
    for t in g["terms"]:
        title = "%s – %s" % (t.get("name") or t.get("title"), t["abbr"]) if t.get("abbr") else (t.get("title") or t.get("name") or t["slug"])
        rows.add("terms", title, _first_sentence(t.get("def", "")), "", "", href="#/rechnik/%s" % t["slug"],
                 kw=_words(" ".join(t.get("aliases") or []), t.get("abbr", ""), t.get("name", "")))


# ----------------------------------------------------------------------------------------------- datasets
def _status_of(ctx, d):
    f = d["file"]
    if d.get("self") or f == "search-index.json":
        return "real"                                    # this file / the catalog are not on disk yet on the first build
    if d.get("multi"):
        pre = f.split("*")[0]
        for rel in sorted(ctx.out):
            if rel.startswith(pre):
                return ctx.out[rel]["meta"]["status"]
        return "real"
    if f in ctx.texts:
        return "real"
    o = _obj(ctx, f, optional=True)
    if isinstance(o, dict) and isinstance(o.get("meta"), dict):
        return o["meta"].get("status", "real")
    return None


def _datasets(ctx, rows):
    groups = {g["id"]: g["label"] for g in CATALOG_GROUPS}
    for d in DEFS:
        st = _status_of(ctx, d)
        if st is None:
            ctx.notes.append("search-index: %s is missing, no dataset row" % d["file"])
            continue
        if st not in STATUSES:
            st = "real"
        ids = d.get("contains") or []
        s = d.get("search", {})
        rows.add("datasets", d["title"], "%s · %s" % (groups[d["group"]], _DS_STATUS[st]), "", s.get("period", ""), status=st,
                 href="#/danni/%s" % d["slug"], kw=s.get("kw") or _words(d["slug"].replace("-", " "), *ids, d["file"].rsplit("/", 1)[-1]))
    for pid, p in sorted(PENDING_DEFS.items()):
        rows.add("datasets", p["title"], "Предстои · %s" % _first_sentence(p["reason"]), "", "", status="pending", href="#/danni/%s" % pid.lower(),
                 kw=_words(pid, p["expected"]))
    # mock rows: every title says "примерен"; the client hides them under "Само реални данни"
    pr = _obj(ctx, "mock/projects.json", optional=True)
    if pr:
        for it in pr["items"]:
            rows.add("datasets", it["name"], "Примерен проект · област %s" % it["region"], fmt_money(it["totalMln"]), "", status="mock",
                     href="#/proekti/%s" % it["id"], kw=_words("проект капиталови инвестиции", it["id"]))
    ac = _obj(ctx, "mock/activities.json", optional=True)
    if ac:
        fn = {f["id"]: f["name"] for f in ac["functions"]}
        for it in ac["items"]:
            yi = 1 if len(it["mln"]) > 1 else 0
            rows.add("datasets", it["name"], "Примерна дейност · %s" % fn.get(it["function"], ""), fmt_money(it["mln"][yi]), str(PLAN_YEAR),
                     status="mock", href="#/razhodi/%s/deynosti" % it["function"], kw="дейност")
    pa = _obj(ctx, "mock/payments.json", optional=True)
    if pa:
        for it in pa["recipients"]:
            rows.add("datasets", it["name"], "Примерен получател · %s" % it["kind"], fmt_money(it["eur"] / 1e6), "", status="mock",
                     href="#/plashtania/%s" % it["eik"], kw=_words("получател плащания фирма", it["eik"]))


# ----------------------------------------------------------------------------------------------- build
def build_search(ctx):
    rows = _Rows()
    _indicators(ctx, rows)
    _institutions(ctx, rows)
    _municipalities(ctx, rows)
    _measures(ctx, rows)
    _terms(ctx, rows)
    _datasets(ctx, rows)
    items = rows.rows                                   # built in group order
    used = [GROUPS[i] for i in sorted({r[0] for r in items})]
    if used != GROUPS:
        ctx.notes.append("search-index: groups without rows: %s" % ", ".join(g for g in GROUPS if g not in used))
    srcs = set()
    for rel in ("core.json", "outlook.json", "ministries.json", "programs.json", "municipalities.json", "measures.json", "debt.json", "rates.json"):
        srcs.update(_obj(ctx, rel)["meta"].get("source") or [])
    srcs.update(["wg", "mockgen"])
    sources = [s for s in bd_common.SOURCES if s in srcs]
    doc = {
        "meta": meta("search-index", "Индекс за търсене: показатели, институции, общини, мерки, понятия и набори от данни",
                     source=sources,
                     source_note="Редовете са изведени от наборите на сайта; числата са копирани от тях. Редовете с примерни данни са отбелязани и "
                                 "се скриват при „Само реални данни“. Екраните на сайта добавя самото търсене."),
        "version": 1,
        "groups": list(GROUPS),
        "fields": list(FIELDS),
        "items": items,
    }
    size = len((jdumps(doc) + "\n").encode("utf-8"))
    ctx.notes.append("search-index: %d rows, %s B raw (%s)" % (len(items), format(size, ","),
                     ", ".join("%s %s KB" % (g, round(b / 1000.0, 1)) for g, b in rows.bytes_by_group.items())))
    if size >= LIMIT_BYTES:
        raise ValueError("search-index.json is %d B raw, the budget is < %d B (by group: %s)" % (size, LIMIT_BYTES, rows.bytes_by_group))
    ctx.put("search-index.json", doc)
