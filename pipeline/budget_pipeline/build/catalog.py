"""catalog.json (D25): the inventory behind screens S24 (Откъде са данните?) and S25 (Отворени данни и API).

One entry per file of data/release/ (plus one per pending set P01-P07 without a file), the six traps of reading Bulgarian
budget numbers, the methodology notes and the checksums of the primary source files.

Runs LAST in datasets.py: it reads my files from `ctx.out` and DATA2's files (glossary, guide, mock/*) from disk, so that
every size is the size of the byte stream that is written. Static texts live in catalog_definitions.py; every NUMBER in a text is
computed from the data (nothing is typed in). Raises ValueError (never sys.exit) on a problem.

Shape (DATA_SPEC §3.20):
  datasets[]  id, slug, file, title, description, group, status, source[], period, asOf, unit, format, mediaType, bytes,
              gzipBytes, screens[], eager, contains[], pending[], mock, schema[]   (+ parts[] / fileTemplate for the
              multi-file entry "ministries-programs"; + expected / reason for pending sets, which have NO file and NO sizes)
  groups[], counts, traps[], methodology[], files[] (primary sources with sha256), meta
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import json
import re
import urllib.parse
from pathlib import Path

import budget_pipeline.build.catalog_definitions as catalog_definitions
from budget_pipeline.build.definitions import NBSP, PENDING_DEFS, SOURCES as SOURCE_REGISTRY, fmt_date, fmt_money, fmt_num, fmt_pct, month_name
from budget_pipeline.build.data_io import BUILD_DATE, DATA, EUR, RAW, CACHE, gz_size, jdumps, meta, sha256_file

KHIL = NBSP + "хил." + NBSP + "€"


# ------------------------------------------------------------------------------------------------ file access
def _blob(ctx, rel):
    """(object or None, bytes or None) of data/release/<rel>: from this build when we make the file, else from disk."""
    if rel in ctx.out:
        obj = ctx.out[rel]
        return obj, (jdumps(obj) + "\n").encode("utf-8")
    if rel in ctx.texts:
        return None, ctx.texts[rel].encode("utf-8")
    path = DATA / rel
    if not path.exists():
        return None, None
    data = path.read_bytes()
    return (json.loads(data.decode("utf-8")) if rel.endswith(".json") else None), data


def _need(ctx, rel):
    obj = ctx.get(rel)
    if obj is None:
        raise ValueError("catalog needs %s built first" % rel)
    return obj


def _type_name(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return "string"
    return "array" if isinstance(v, list) else "object"


def _schema(obj):
    """Top-level keys of a JSON file (without `meta`): [{key, type, length?}] - a map of the file for S25."""
    if not isinstance(obj, dict):
        return []
    out = []
    for k, v in obj.items():
        if k == "meta":
            continue
        row = {"key": k, "type": _type_name(v)}
        if isinstance(v, (list, dict)):
            row["length"] = len(v)
        out.append(row)
    return out


# ------------------------------------------------------------------------------------------------ facts for the texts
def facts(ctx):
    """Every number that the catalog texts print, taken from the built data."""
    revenue, exp = _need(ctx, "revenue.json"), _need(ctx, "expenditure.json")
    mins, progs = _need(ctx, "ministries.json"), _need(ctx, "programs.json")
    meas, muni = _need(ctx, "measures.json"), _need(ctx, "municipalities.json")
    rates, sebra, feed = _need(ctx, "rates.json"), _need(ctx, "sebra.json"), _need(ctx, "feed.json")
    core = _need(ctx, "core.json")
    gl, _ = _blob(ctx, "glossary.json")
    guide, _ = _blob(ctx, "guide.json")
    ind, _ = _blob(ctx, "mock/indicators.json")
    asof = core["kpis"]["asOf"]
    return {
        "n_rev_groups": len(revenue["groups"]), "n_rev_rows": len(revenue["rows"]),
        "n_functions": len(exp["functions"]["items"]),
        "cofog_from": exp["cofog"]["years"][0], "cofog_to": exp["cofog"]["years"][-1],
        "n_budgets": len(mins["items"]),
        "n_pending_programs": sum(1 for m in mins["items"] if m["programs"]["status"] != "real"),
        "n_programs": len(progs["items"]), "n_measures": len(meas["items"]), "n_munis": len(muni["items"]),
        "n_activities": len(rates["tzpb"]["activities"]), "n_days": len(sebra["days"]),
        "n_terms": len(gl["terms"]) if gl else core["counts"]["terms"],
        "n_steps": len(guide["steps"]) if guide else 8,
        "n_events": len(feed["events"]),
        "n_indicator_programs": len(ind["items"]) if ind else 0,
        "asof_month": "%s %s" % (month_name(int(asof[5:7])), asof[:4]),
    }


# ------------------------------------------------------------------------------------------------ periods
def _yrs(a, b):
    return "%s–%s" % (a, b) if a != b else str(a)


def _span_dates(dates):
    dates = sorted(d for d in dates if d)
    return "%s … %s" % (dates[0], dates[-1]) if dates else None


def _period(slug, obj, ctx):
    """A short human period string, computed from the file itself (None when a file has no period)."""
    if obj is None:
        return None
    if slug in ("outlook", "revenue", "gva-sectors"):
        return _yrs(obj["years"][0], obj["years"][-1])
    if slug == "core":
        return _yrs(obj["years"]["list"][0], obj["years"]["list"][-1])
    if slug == "expenditure":
        ys = obj["functions"]["years"] + obj["economic"]["years"] + obj["cofog"]["years"]
        return _yrs(min(ys), max(ys))
    if slug == "components":
        return _yrs(obj["nationalVsEu"]["years"][0], obj["nationalVsEu"]["years"][-1])
    if slug == "ministries":
        return str(_need(ctx, "outlook.json")["years"][2])
    if slug == "programs":
        ys = sorted(int(f[1:]) for f in obj["fields"] if f[0] == "y" and f[1:].isdigit())
        return _yrs(ys[0], ys[-1])
    if slug == "measures":
        ys = sorted(int(y) for y in obj["totals"]["discretionary"]["II-8"])
        return _yrs(ys[0], ys[-1])
    if slug == "law":
        dates = [e.get("date") for e in obj["timeline"]] + [e.get("dateTo") for e in obj["timeline"]] + [g["date"] for g in obj["gazette"]]
        return _span_dates(dates)
    if slug == "execution":
        yrs = sorted(obj["data"])
        return "%s-01 … %s-%02d" % (yrs[0], yrs[-1], int(obj["data"][yrs[-1]]["months"]))
    if slug == "debt":
        ys = obj["zdd"]["years"] + obj["maastricht"]["years"]
        return _yrs(min(ys), max(ys))
    if slug == "rates":
        return str(obj["rules"]["year"])
    if slug == "municipalities":
        return str(obj["year"])
    if slug == "geo-obshtini":
        return str(obj["meta"]["asOf"][:4])
    if slug == "sebra":
        return _span_dates([d["date"] for d in obj["days"]])
    if slug in ("feed", "feed-rss"):
        return _span_dates([e["date"] for e in _need(ctx, "feed.json")["events"]])
    if slug == "mock-activities":
        return _yrs(obj["meta"]["years"][0], obj["meta"]["years"][-1])
    if slug == "mock-indicators":
        return "2024–2026"
    if slug in ("mock-municipal-finance", "mock-projects"):
        return str(_need(ctx, "outlook.json")["years"][2])
    if slug == "mock-payments":
        return "%s … %s" % (obj["months"][0]["month"], obj["months"][-1]["month"])
    return None


# ------------------------------------------------------------------------------------------------ datasets
def _entry(ctx, d, fct, self_meta):
    slug, rel = d["slug"], d["file"]
    e = {}
    if d.get("multi"):
        keys = sorted(k for k in ctx.out if k.startswith("ministries/"))
        if not keys:
            raise ValueError("catalog: no ministries/*.json built")
        parts = []
        gz_total = raw_total = 0
        for k in keys:
            data = (jdumps(ctx.out[k]) + "\n").encode("utf-8")
            gz = gz_size(data)
            parts.append({"code": Path(k).stem, "file": "data/" + k, "bytes": len(data), "gzipBytes": gz})
            raw_total += len(data)
            gz_total += gz
        first = ctx.out[keys[0]]
        m = first["meta"]
        e = {"id": m["id"], "slug": slug, "file": None, "fileTemplate": "data/ministries/<код>.json"}
        obj, raw, gz, as_of = first, raw_total, gz_total, max(ctx.out[k]["meta"]["asOf"] for k in keys)
        period = _yrs(first["years"][0], first["years"][-1])
    elif d.get("self"):
        obj, data, m = None, None, self_meta                    # this very file: no sizes (they would change the file), schema added by catalog
        e = {"id": m["id"], "slug": slug, "file": "data/" + rel}
        raw = gz = None
        period, as_of = None, m["asOf"]
    else:
        obj, data = _blob(ctx, rel)
        if obj is None and data is None:
            return None                                         # DATA2's file is not built yet: left out, the validator reports it
        m = (obj or {}).get("meta") if isinstance(obj, dict) else None
        if m is None and slug == "feed-rss":
            m = _need(ctx, "feed.json")["meta"]
        if m is None:
            raise ValueError("catalog: %s has no meta" % rel)
        raw = len(data)
        gz = gz_size(data)
        period = _period(slug, obj if obj is not None else _need(ctx, "feed.json"), ctx)
        as_of = m["asOf"]
        ids = m["id"].split("+")
        e = {"id": ids[0], "slug": slug, "file": "data/" + rel}
    contains = d["contains"] if "contains" in d else [x for x in m["id"].split("+") if re.fullmatch(r"[DMP]\d{2}", x)]
    e["title"] = d["title"]
    e["description"] = d["desc"].format(**fct)
    e["group"] = d["group"]
    e["status"] = m["status"]
    e["source"] = list(m.get("source") or [])
    if period:
        e["period"] = period
    e["asOf"] = as_of
    if m.get("unit"):
        e["unit"] = m["unit"]
    e["format"] = d.get("format", "JSON")
    e["mediaType"] = d.get("mediaType", "application/json")
    if raw is not None:
        e["bytes"] = raw
        e["gzipBytes"] = gz
    e["screens"] = list(d["screens"])
    e["eager"] = bool(d.get("eager"))
    e["contains"] = list(contains)
    if m.get("pending"):
        e["pending"] = list(m["pending"])
    e["mock"] = bool(m.get("mock")) or m["status"] == "mock"
    if d.get("multi"):
        e["parts"] = parts
    elif obj is not None:
        sc = _schema(obj)
        if sc:
            e["schema"] = sc
    if d.get("multi"):
        sc = _schema(obj)
        if sc:
            e["schema"] = sc
    return e


def _pending_entries():
    out = []
    for pid in sorted(PENDING_DEFS):
        p = PENDING_DEFS[pid]
        out.append({"id": pid, "slug": pid.lower(), "title": p["title"], "description": p["reason"], "group": "pending",
                    "status": "pending", "source": list(p["source"]), "screens": list(p["screens"]), "eager": False,
                    "contains": [pid], "expected": p["expected"], "mock": False})
    return out


# ------------------------------------------------------------------------------------------------ traps and methodology
def _list_and(items):
    items = [str(i) for i in items]
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " и " + items[-1]


# the probed sites, in the order the access trap names them
ACCESS_SITES = [("www.minfin.bg", "на Министерството на финансите (minfin.bg)"), ("data.egov.bg", "на портала data.egov.bg"),
                ("www.nsi.bg", "на НСИ")]


def _probes():
    """The automatic-access checks recorded in the download manifest: only URL, HTTP status and day (no notes)."""
    man = json.loads((RAW / "MANIFEST.json").read_text(encoding="utf-8"))
    out = []
    for key in sorted(man):
        if key.startswith("probes/"):
            v = man[key]
            out.append({"url": v["url"], "httpStatus": v["http_status"], "checked": v["retrieved"][:10]})
    return out


def traps(ctx):
    outlook, exp = _need(ctx, "outlook.json"), _need(ctx, "expenditure.json")
    comp, law, core = _need(ctx, "components.json"), _need(ctx, "law.json"), _need(ctx, "core.json")
    if exp["functions"]["years"][1] != 2026 or outlook["years"][2] != 2026:
        raise ValueError("catalog traps: the year index of 2026 changed")
    state_exp = comp["budgets"]["state"]["expKhil"] / 1000.0
    kfp_exp = outlook["kfp"]["expenditure"]["mln"][2]
    fn_total = exp["functions"]["totalMln"][1]
    cy = exp["cofog"]["years"][-1]
    if cy not in outlook["years"]:
        raise ValueError("catalog traps: COFOG year %s is not in the outlook years" % cy)
    cofog_total = exp["cofog"]["total"]["mln"][-1]
    kfp_same_year = outlook["kfp"]["expenditure"]["mln"][outlook["years"].index(cy)]
    ver = outlook["versions"]
    n_rows = sum(1 for r in ver if any(abs(x) > 1e-9 for x in r["diff"]))
    max_diff = max(abs(x) for r in ver for x in r["diff"])
    n_fn = len(exp["functions"]["versions"])
    changed = [b["art"] for b in law["budgets"] if b["changed"]]
    dif = law["totals"]["diff"]
    probes = _probes()
    bad = [p for p in probes if p["httpStatus"] == 403]
    if not bad:
        raise ValueError("catalog traps: no recorded 403 probe for the access trap")
    # only the sites whose probe answered 403 (from Bulgaria data.egov.bg and nsi.bg open: docs/data-acquisition.md, 2.1)
    blocked = [label for host, label in ACCESS_SITES if any(urllib.parse.urlsplit(p["url"]).hostname == host for p in bad)]
    return [
        {"id": "eur-bgn", "title": "Евро и лева",
         "text": "От 1 януари 2026 г. България е в еврозоната, а курсът е фиксиран: 1 € = %s лв. Месечните отчети за 2025 г. са "
                 "публикувани в млн. лв.; тук са превърнати в евро (делене на %s и закръгляне след делението), затова сборът на "
                 "редовете може да се разминава с до 0,1 млн. €. Отчетите и законите за 2026 г. са в евро. Преди да сравниш две "
                 "числа, провери в каква валута са." % (fmt_num(EUR, 5), fmt_num(EUR, 5)),
         "related": ["execution", "outlook", "components"]},
        {"id": "scope", "title": "Обхват: държавен бюджет не е КФП",
         "text": "„Държавният бюджет“ по чл. 1 от ЗДБ и „консолидираната фискална програма“ (КФП) не са едно и също. Разходите на "
                 "държавния бюджет за 2026 г. са %s, а КФП събира и бюджетите на ДОО и НЗОК, общините и европейските средства и е "
                 "%s (с вноската в бюджета на ЕС). Числата от закона и от месечните отчети не се събират и не се сравняват "
                 "направо: всеки екран казва кой обхват показва." % (fmt_money(state_exp), fmt_money(kfp_exp)),
         "related": ["components", "outlook", "execution", "ministries"]},
        {"id": "kfp-cofog", "title": "Функции на КФП и COFOG",
         "text": "Разходите „по функции“ в мотивите (Табл. III-1, %s за 2026 г.) са разрез на КФП без вноската в бюджета на ЕС. "
                 "COFOG на Евростат е друг разрез на сектор „Държавно управление“ с различни обхват и методика: за %s г. дава "
                 "общо %s, а КФП по Приложение 3 е %s. Двата разреза не са сравними ред срещу ред."
                 % (fmt_money(fn_total), cy, fmt_money(cofog_total), fmt_money(kfp_same_year)),
         "related": ["expenditure"]},
        {"id": "access", "title": "Достъп до първичните данни",
         "text": "Страниците %s връщат отказ (403) към автоматични заявки (проверено на %s) и се отварят само през браузър. Затова "
                 "месечните отчети на КФП са изтеглени ръчно, а данните, които са само там (разбивка по данъци, съставни бюджети, "
                 "отчетите след %s), са означени „предстои“. Огледалото на данните на Министерството на финансите в "
                 "data.europa.eu не е винаги актуално."
                 % (_list_and(blocked), fmt_date(bad[0]["checked"], long=True), month_name(ctx.execution["latest"]["month"])),
         "related": ["p01", "p02", "p04", "p06"], "evidence": probes},
        {"id": "two-versions", "title": "Две версии на мотивите (АСБП)",
         "text": "Мотивите към законопроекта са в две версии: PDF (проект от юни 2026 г.), от който са числата на Приложение 3, и "
                 "внесеният на 01.07.2026 г. документ (.docx). Приложение 3 се различава в %d реда за 2026–2028 г., най-много с "
                 "%s млн. €; общите суми и осемте групи приходи са еднакви. В Табл. III-1 се различават %d реда. Всеки набор "
                 "казва коя версия ползва; разликите са в полето „versions“ на файловете „outlook“ и „expenditure“."
                 % (n_rows, fmt_num(round(max_diff, 1), 1), n_fn),
         "related": ["outlook", "expenditure"]},
        {"id": "bill-law", "title": "Проект и закон",
         "text": "Законопроектът (внесен на 01.07.2026 г.) не е приетият закон (ДВ бр. 69 от 31.07.2026 г.). От %d бюджета по чл. "
                 "2–47 се различават %d (чл. %s); чл. 1 (държавният бюджет) се променя заедно с тях: приходите с %s, разходите с %s. "
                 "Програмните бюджети са към законопроекта, не към закона: сравнението им със закона е във файловете на "
                 "ведомствата. Всеки екран казва дали числото е „проект“ или „закон“."
                 % (law["counts"].get("budgets", len(law["budgets"])), len(changed), _list_and(changed),
                    fmt_num(dif["rev"], 1, True) + KHIL, fmt_num(dif["exp"], 1, True) + KHIL),
         "related": ["law", "ministries", "ministries-programs"]},
    ]


def methodology(ctx):
    core = _need(ctx, "core.json")
    k = core["kpis"]
    gdp = k["gdp"]["mlnPrecise"]
    return [
        {"id": "calculator", "title": "Как работи калкулаторът за данъци и осигуровки",
         "text": "Калкулаторът прилага ставките от набора „Данъци и осигуровки“ (ЗБДОО, ЗБНЗОК и таблицата на НАП) към заплатата, "
                 "която въведеш, и показва как сумата се разпределя по функции според дяла им в разходите на КФП. Косвените "
                 "данъци (ДДС и акцизи) са по модел с допускания и са означени „ориентировъчно“. Резултатът е илюстрация, не "
                 "данъчна консултация.",
         "related": ["rates", "mock-tax-assumptions", "expenditure"]},
        {"id": "cash-accrual", "title": "Касова и начислена основа",
         "text": "Месечните отчети на КФП са на касова основа: показват какво е събрано и платено до края на месеца. "
                 "Европейските показатели (дефицит по ESA, дълг по Маастрихт) са на начислена основа и се различават. Годишният "
                 "бюджет е план, а не сума от месечни плащания: към %s са събрани %s от годишния план за приходите; това е ход "
                 "на плана, не прогноза за годината." % (fmt_date(k["asOf"], long=True), fmt_pct(k["revenue"]["execPct"])),
         "related": ["execution", "debt"]},
        {"id": "conversion", "title": "Превръщане на лева в евро",
         "text": "1 € = %s лв. (фиксиран курс). Данните в лева, които публикуваме в евро, са разделени на %s и закръглени след "
                 "делението; сборовете на закръглените редове може да се разминават с 0,1 млн. €." % (fmt_num(EUR, 5), fmt_num(EUR, 5)),
         "related": ["execution"]},
        {"id": "statuses", "title": "Реални, примерни и предстоящи данни",
         "text": "„Реален“ набор е взет от официален документ и може да се възпроизведе със скриптовете на проекта. „Примерен“ "
                 "набор е измислен с фиксирано семе, означен е „ПРИМЕРНИ ДАННИ“, а сборът му е равен на реалното число, което "
                 "разбива. „Предстои“ значи, че данните съществуват при издателя, но още не са извлечени; такъв набор няма "
                 "числа. Всеки набор и всеки ред има статус, източник и дата.",
         "related": ["mock-activities", "p01"]},
        {"id": "vintages", "title": "Отчет, предварителен отчет, план и прогноза",
         "text": "Годините са означени с етикет, който винаги е видим: 2024 г. е отчет, 2025 г. е предварителен отчет, 2026 г. е "
                 "план по закона (или проект, ако не е посочено друго), 2027 и 2028 г. са прогноза.",
         "related": ["outlook"]},
        {"id": "units", "title": "Единици и закръгляне",
         "text": "Консолидираната програма е в млн. €, законите за бюджетите и програмните бюджети — в хил. €, плащанията по СЕБРА "
                 "— в евро. Процентите от БВП са по незакръглен БВП за 2026 г. (%s млн. €); в таблицата с макропрогнозата БВП е "
                 "закръглен до цели милиони. Празна клетка („—“) значи „няма данни“, а 0 е реална нула."
                 % fmt_num(gdp, 1),
         "related": ["outlook", "law"]},
    ]


# ------------------------------------------------------------------------------------------------ primary source files
# (manifest key, title, source keys, datasets that use it)
_MANIFEST_FILES = [
    ("dv/zdb2026_dv69_idMat245041.html", "Закон за държавния бюджет на Република България за 2026 г. (ДВ бр. 69 от 31.07.2026 г.)",
     ["zdb"], ["law", "ministries", "municipalities", "components", "debt"]),
    ("dv/zbdoo2026_dv68_idMat244982.html", "Закон за бюджета на държавното обществено осигуряване за 2026 г. (ДВ бр. 68)",
     ["zbdoo"], ["components", "rates"]),
    ("dv/zbnzok2026_dv68_idMat244981.html", "Закон за бюджета на Националната здравноосигурителна каса за 2026 г. (ДВ бр. 68)",
     ["zbnzok"], ["components", "rates"]),
    ("parliament/52-602-01-19.docx", "Законопроект № 52-602-01-19 с мотивите (.docx, внесен на 01.07.2026 г.)",
     ["bill", "asbp"], ["outlook", "revenue", "expenditure", "measures", "law", "components", "rates"]),
    ("parliament/52-602-01-19.zip", "Законопроект № 52-602-01-19: архив с приложенията и програмните бюджети",
     ["bill", "prb"], ["ministries", "ministries-programs", "programs"]),
    ("parliament/bill_167157.json", "Народно събрание: движение на законопроекта за държавния бюджет (API)", ["parliament"], ["law"]),
    ("parliament/bill_167156.json", "Народно събрание: движение на законопроекта за бюджета на ДОО (API)", ["parliament"], ["law"]),
    ("parliament/bill_167155.json", "Народно събрание: движение на законопроекта за бюджета на НЗОК (API)", ["parliament"], ["law"]),
    ("nap/nap_prilozhenie_1_VK-30-10237_12.08.2026.pdf",
     "НАП: Приложение 1 към писмо ВК-30-10237 от 12.08.2026 г. (осигурителни ставки по категории)", ["nap"], ["rates"]),
    ("eurostat/gov_10dd_edpt1_BG_EU.json", "Евростат gov_10dd_edpt1: държавен дълг по Маастрихт, България и ЕС (годишно)",
     ["eurostat"], ["debt"]),
    ("eurostat/gov_10q_ggdebt_BG.json", "Евростат gov_10q_ggdebt: дълг на държавното управление (тримесечно)", ["eurostat"], ["debt"]),
    ("eurostat/tps00001_BG.json", "Евростат tps00001: население на България", ["eurostat"], ["core"]),
    ("bnb_sdmx/ggd.xml", "БНБ (SDMX): дълг на сектор „Държавно управление“", ["bnb"], ["debt"]),
    ("bnb_sdmx/cgd.xml", "БНБ (SDMX): дълг на централното управление", ["bnb"], ["debt"]),
    ("sebra/midt_sebra_2026_page.html", "МИДТ: страница „СЕБРА 2026“ със списъка на файловете", ["sebra"], ["sebra"]),
    ("sebra/midt_sebra_31.08.2026.xlsx", "СЕБРА: дневно обобщение на МИДТ за 31.08.2026 г.", ["sebra"], ["sebra"]),
]
_SEBRA_BASE = "https://midt.gov.bg/upload/"
_SEBRA_CACHE = [("sebra_27.08.2026.xlsx", "3789/27.08..2026.xlsx", "27.08.2026"),
                ("sebra_28.08.2026.xlsx", "3790/28.08..2026.xlsx", "28.08.2026")]
_ASBP_PDF = RAW / "asbp" / "UMTBF-2026-2028-motivi.pdf"


# the two saved Eurostat answers behind gva-sectors.json (gva_sectors.py); they are not in data/originals, so their record is
# written out here as it was taken on 2026-10-09
GVA_FILES = [
    {"name": "nama_10_a10_BG_B1G.json", "title": "Евростат nama_10_a10: брутна добавена стойност по отрасли, България (годишно, текущи цени)",
     "url": "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nama_10_a10?format=JSON&lang=EN&geo=BG&unit=CP_MEUR"
            "&na_item=B1G&sinceTimePeriod=2019",
     "sha256": "681101ff7faf0a533bc7f754500fe901d80f2722174b42ca15d40aed286d6b4e", "bytes": 5125, "retrieved": "2026-10-09",
     "source": ["eurostat"], "usedBy": ["gva-sectors"], "role": "source"},
    {"name": "nama_10_gdp_BG.json", "title": "Евростат nama_10_gdp: БВП и данъци върху продуктите минус субсидии, България (годишно, текущи цени)",
     "url": "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nama_10_gdp?format=JSON&lang=EN&geo=BG&unit=CP_MEUR"
            "&na_item=B1GQ&na_item=D21X31&sinceTimePeriod=2019",
     "sha256": "f1a7d8a93d840b36d67062129f879877cbb19070e65ee02b644ff355f89a8b23", "bytes": 3330, "retrieved": "2026-10-09",
     "source": ["eurostat"], "usedBy": ["gva-sectors"], "role": "source"},
]


def _url_name(url):
    return urllib.parse.unquote(url.split("?")[0].rsplit("/", 1)[-1])


def primary_files(ctx):
    """Checksums of the primary source files: name, official address, sha256, size, which datasets read the file."""
    man = json.loads((RAW / "MANIFEST.json").read_text(encoding="utf-8"))
    out = []
    for key, title, src, used in _MANIFEST_FILES:
        v = man[key]
        if not v.get("sha256") or v.get("http_status") != 200:
            raise ValueError("catalog: manifest entry %s has no checksum" % key)
        local = RAW / key
        if local.exists() and local.stat().st_size != v["bytes"]:
            raise ValueError("catalog: %s differs in size from the manifest" % key)
        out.append({"name": _url_name(v["url"]) if key.startswith(("sebra/", "nap/", "parliament/52")) else Path(key).name,
                    "title": title, "url": v["url"], "sha256": v["sha256"], "bytes": v["bytes"], "retrieved": v["retrieved"][:10],
                    "source": src, "usedBy": used, "role": "source"})
    # the original PDF of the explanatory notes: local file only, hashed here (the download address was not recorded)
    if _ASBP_PDF.exists():
        out.append({"name": _ASBP_PDF.name, "title": "Мотиви към законопроекта: PDF версия (проект от юни 2026 г.)",
                    "sha256": sha256_file(_ASBP_PDF), "bytes": _ASBP_PDF.stat().st_size, "source": ["asbp"],
                    "usedBy": ["outlook", "revenue", "expenditure", "measures", "debt", "components"], "role": "source",
                    "note": "Първоначалната версия на мотивите; адресът, от който е изтеглена, не е записан, затова няма връзка. "
                            "Контролната сума позволява да сравниш своето копие."})
    for name, path, day in _SEBRA_CACHE:
        f = CACHE / name
        if f.exists():
            out.append({"name": _url_name(_SEBRA_BASE + path), "title": "СЕБРА: дневно обобщение на МИДТ за %s г." % day,
                        "url": _SEBRA_BASE + path, "sha256": sha256_file(f), "bytes": f.stat().st_size, "source": ["sebra"],
                        "usedBy": ["sebra"], "role": "source"})
    # the monthly КФП reports: file names as the Ministry of Finance publishes them, checksums from the extraction
    page = SOURCE_REGISTRY["kfp"]["url"]
    execu = ctx.execution
    for year in sorted(execu["data"]):
        for f in execu["data"][year]["files"]:
            local = RAW / ("kfp_" + year) / f["file"]
            row = {"name": f["file"], "title": "КФП: месечен отчет към края на %s %s г. (xls)" % (month_name(f["month"]), year),
                   "page": page, "sha256": f["sha256"]}
            if local.exists():
                row["bytes"] = local.stat().st_size
            row.update({"source": ["kfp"], "usedBy": ["execution"], "role": "source"})
            out.append(row)
    out.extend(dict(f) for f in GVA_FILES)
    if len({r["sha256"] for r in out}) != len(out):
        raise ValueError("catalog: two primary files share a checksum")
    return out


# ------------------------------------------------------------------------------------------------ build
def catalog(ctx):
    fct = facts(ctx)
    cat_meta = meta("D25", "Каталог на данните: набори, капани, методика и контролни суми", source=["wg"],
                    source_note="Описание на файловете на сайта; контролните суми са на първичните файлове, изтеглени от издателите.",
                    as_of=BUILD_DATE)
    datasets, skipped = [], []
    for d in catalog_definitions.DEFS:
        e = _entry(ctx, d, fct, cat_meta)
        if e is None:
            skipped.append(d["file"])
            continue
        datasets.append(e)
    datasets.extend(_pending_entries())
    if skipped:
        ctx.notes.append("catalog: files not found and left out: " + ", ".join(skipped))
    groups = [g for g in catalog_definitions.GROUPS if any(e["group"] == g["id"] for e in datasets)]
    files = primary_files(ctx)
    n_files = sum(len(e["parts"]) if "parts" in e else (1 if e.get("file") else 0) for e in datasets)
    counts = {"datasets": len(datasets), "files": n_files,
              "real": sum(1 for e in datasets if e["status"] == "real"),
              "mock": sum(1 for e in datasets if e["status"] == "mock"),
              "pending": sum(1 for e in datasets if e["status"] == "pending"),
              "primarySources": len(files)}
    obj = {
        "meta": cat_meta,
        "groups": groups,
        "counts": counts,
        "datasets": datasets,
        "traps": traps(ctx),
        "methodology": methodology(ctx),
        "files": files,
    }
    for e in datasets:                                          # the catalog describes its own top-level shape
        if e.get("slug") in catalog_definitions.SELF_SLUGS:
            e["schema"] = _schema(obj)
    return ctx.put("catalog.json", obj)
