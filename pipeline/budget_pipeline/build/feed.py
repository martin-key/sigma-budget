"""feed.json (+ feed.xml): the "what's new" stream behind screen S16 and the news dot of the shell.

Every event is derived from a dataset we built (monthly КФП reports, the legislative path of the 2026 budget, the new
insurance ceilings, Eurostat releases, the СЕБРА publication) - nothing is typed in except the wording. Dates are ISO
(`YYYY-MM-DD`); `dateKind` says what the date means, because a monthly report has no publication date in our files
(it is the day the data are as of) and a Eurostat release has (it is the day the dataset was updated).

Runs after the datasets it reads (debt, rates, law, sebra, expenditure) and before core.json. `feed.xml` is the same
list as RSS 2.0; the site address is a placeholder until the real one is known (env BNS_SITE_URL).
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import calendar
import datetime
import os
from xml.sax.saxutils import escape

from budget_pipeline.build.definitions import PENDING_DEFS, POPULATION_ASOF, fmt_date, fmt_eur, fmt_money, fmt_num, fmt_pct, month_name
from budget_pipeline.build.fiscal import population_latest
from budget_pipeline.build.data_io import BUILD_DATE, jsonstat_series, meta

BASE_URL_DEFAULT = "https://budget-na-svetlo.example/"        # reserved TLD: never resolves, never impersonates a real site

KINDS = [
    {"id": "report", "label": "Месечен отчет"},
    {"id": "law", "label": "Законодателен път"},
    {"id": "plenary", "label": "Гласуване в залата"},
    {"id": "rates", "label": "Данъци и осигуровки"},
    {"id": "eurostat", "label": "Евростат"},
    {"id": "data", "label": "Нови данни"},
]
DATE_KINDS = {
    "occurred": "Дата на събитието",
    "asOf": "Данни към",
    "published": "Публикувано на",
    "effective": "В сила от",
}
_PLENARY = {"plenary-1", "plenary-2", "adopted"}
_ORDINAL = {1: "първото", 2: "второто", 3: "третото", 4: "четвъртото"}
SOURCE_ORDER = ["kfp", "parliament", "zdb", "zbdoo", "zbnzok", "nap", "eurostat", "sebra"]       # every source an event cites


def _need(ctx, rel):
    obj = ctx.get(rel)
    if obj is None:
        raise ValueError("feed needs %s built first" % rel)
    return obj


def _bal(v):
    """'дефицитът е 2,20 млрд. €' / 'излишъкът е 0,21 млрд. €'."""
    return ("дефицитът" if v < 0 else "излишъкът", fmt_money(abs(v)))


def _more(v):
    return "с %s %s" % (fmt_pct(abs(v)), "повече" if v >= 0 else "по-малко")


# ------------------------------------------------------------------------------------------------ events
def _report_events(ctx):
    ex = ctx.execution
    d26, d25 = ex["data"]["2026"], ex["data"]["2025"]
    n = int(d26["months"])
    out = []
    for m in range(1, n + 1):
        rev, exp, bal = (d26["kfp"][k][m - 1] for k in ("rev", "exp.total", "balance"))
        prev = d25["kfp"]["rev"][m - 1]
        yoy = round(100.0 * (rev / prev - 1.0), 1)
        word, amount = _bal(bal)
        text = ("От началото на годината приходите са %s, разходите — %s, %s е %s. Приходите са %s от същия период на 2025 г."
                % (fmt_money(rev), fmt_money(exp), word, amount, _more(yoy)))
        if m == n:
            lat = ex["latest"]["kfp"]
            if abs(lat["rev"]["yoyPct"] - yoy) > 0.05:
                raise ValueError("feed: YoY of the latest month differs from execution.latest (%s vs %s)" % (yoy, lat["rev"]["yoyPct"]))
            text += " Това е %s от годишния план за приходите." % fmt_pct(lat["rev"]["pctPlan"])
        out.append({"id": "kfp-2026-%02d" % m, "date": d26["asOf"][m - 1], "dateKind": "asOf", "kind": "report",
                    "title": "Месечен отчет на КФП към края на %s 2026 г." % month_name(m), "text": text,
                    "href": "#/izpalnenie?mesec=%d" % m, "status": "real", "source": ["kfp"]})
    return out


def _law_events(ctx):
    law = _need(ctx, "law.json")
    out, seen = [], {}
    for e in law["timeline"]:
        if e.get("phase") != "parliament":
            continue
        base = "law-%s-%s" % (e["date"], e["kind"])
        seen[base] = seen.get(base, 0) + 1
        ev = {"id": base if seen[base] == 1 else "%s-%d" % (base, seen[base]), "date": e["date"], "dateKind": "occurred"}
        if e.get("dateTo"):
            ev["dateTo"] = e["dateTo"]
        ev["kind"] = "plenary" if e["kind"] in _PLENARY else "law"
        ev["title"] = e["title"]
        if e.get("detail"):
            ev["text"] = e["detail"]
        ev.update({"href": "#/zakon", "status": "real", "source": list(e.get("source") or ["parliament"])})
        out.append(ev)
    if len(out) != 11:
        raise ValueError("feed: expected 11 parliament events in law.timeline, found %d" % len(out))
    return out


def _rates_events(ctx):
    rates = _need(ctx, "rates.json")
    ch = {c["id"]: c for c in rates["changes"]}
    mx, mn, emp = ch["max-insurable"], ch["min-self-employed"], ch["civil-servant-employee-share"]
    n_cat = len(rates["napCategories"])
    letter = fmt_date(rates["meta"]["asOf"], long=True) + " г."
    mi = ch["min-income-by-activity"]
    cells = ("във всички %d попълнени клетки" % mi["filled"]) if mi["changed"] == mi["filled"] \
        else ("в %d от %d попълнени клетки" % (mi["changed"], mi["filled"]))
    return [
        {"id": "rates-2026-08-01", "date": "2026-08-01", "dateKind": "effective", "kind": "rates",
         "title": "Нови граници на осигурителния доход от 1 август",
         "text": "Максималният месечен осигурителен доход става %s (дотогава %s). Минималният за самоосигуряващите се е %s "
                 "(дотогава %s). Минималният доход по икономически дейности и групи професии се променя %s на таблицата."
                 % (fmt_eur(mx["from"], 0), fmt_eur(mx["until"], 2), fmt_eur(mn["from"], 2), fmt_eur(mn["until"], 2), cells),
         "href": "#/danaci", "status": "real", "source": ["zbdoo"]},
        {"id": "rates-2026-08-12", "date": rates["meta"]["asOf"], "dateKind": "published", "kind": "rates",
         "title": "НАП публикува таблицата с осигурителните ставки",
         "text": "Писмо ВК-30-10237 от %s подрежда осигурителните ставки в %d категории осигурени лица. За държавните служители "
                 "(категория 5) от 1 август %s от осигурителния доход се внася от самия служител (дотогава %s), а работодателят "
                 "внася %s вместо %s." % (letter, n_cat, fmt_pct(emp["from"]), fmt_pct(emp["until"]),
                                          fmt_pct(ch["civil-servant-employer-share"]["from"]),
                                          fmt_pct(ch["civil-servant-employer-share"]["until"])),
         "href": "#/danaci", "status": "real", "source": ["nap"]},
    ]


def _quarter_text(quarter_id):
    year, q = quarter_id.split("-Q")
    return "%s тримесечие на %s г." % (_ORDINAL[int(q)], year)


def _eurostat_events(ctx):
    debt, exp = _need(ctx, "debt.json"), _need(ctx, "expenditure.json")
    mst = debt["latest"]["maastricht"]
    q = mst["quarter"]
    d_annual = ctx.raw("eurostat/gov_10dd_edpt1_BG_EU.json")["updated"][:10]
    d_quarter = ctx.raw("eurostat/gov_10q_ggdebt_BG.json")["updated"][:10]
    d_cofog = ctx.src("cofog_bg")["updated"][:10]
    if mst["asOf"] != d_annual or q["asOf"] != d_quarter:
        raise ValueError("feed: debt.latest asOf dates differ from the Eurostat update dates")
    cy = exp["cofog"]["years"][-1]
    pop_src = ctx.src("population")
    pop = population_latest(pop_src)
    # the population is the one of data/inputs/population.json (release POPULATION_ASOF); the downloaded tps00001 may be a later
    # release: the event keeps the date of the numbers it shows, as the downloaded file still gives the same numbers
    tps = jsonstat_series(ctx.raw("eurostat/tps00001_BG.json"), "time", {"geo": "BG"})
    if any(str(y) in tps and int(tps[str(y)][0]) != int(v) for y, v in zip(pop_src["years"], pop_src["persons"])):
        raise ValueError("feed: Eurostat tps00001 now gives other population numbers than data/inputs/population.json")
    pop_raw = POPULATION_ASOF
    return [
        {"id": "eurostat-gov_10dd_edpt1-" + d_annual, "date": d_annual, "dateKind": "published", "kind": "eurostat",
         "title": "Евростат: дългът на държавното управление за %d г." % mst["year"],
         "text": "Дългът по Маастрихт е %s (%s от БВП). Това е друг обхват от държавния дълг в закона."
                 % (fmt_money(mst["mln"]), fmt_pct(mst["pctGdp"])),
         "href": "#/dalg?obhvat=maastricht", "status": "real", "source": ["eurostat"]},
        {"id": "eurostat-gov_10q_ggdebt-" + d_quarter, "date": d_quarter, "dateKind": "published", "kind": "eurostat",
         "title": "Евростат: дългът в края на %s" % _quarter_text(q["id"]),
         "text": "Дългът по Маастрихт е %s (%s от БВП); данните са предварителни." % (fmt_money(q["mln"]), fmt_pct(q["pctGdp"])),
         "href": "#/dalg?obhvat=maastricht", "status": "real", "source": ["eurostat"]},
        {"id": "eurostat-gov_10a_exp-" + d_cofog, "date": d_cofog, "dateKind": "published", "kind": "eurostat",
         "title": "Евростат: разходите по функции (COFOG) са допълнени до %d г." % cy,
         "text": "Разходите на сектор „Държавно управление“ за %d г. са %s (%s от БВП). Разрезът по функции на Евростат не съвпада "
                 "с функциите на КФП." % (cy, fmt_money(exp["cofog"]["total"]["mln"][-1]), fmt_pct(exp["cofog"]["total"]["pctGdp"][-1])),
         "href": "#/razhodi", "status": "real", "source": ["eurostat"]},
        {"id": "eurostat-tps00001-" + pop_raw, "date": pop_raw, "dateKind": "published", "kind": "eurostat",
         "title": "Евростат: населението на 1 януари %d г." % pop["year"],
         "text": "Населението на България е %s души. Ползваме го за показателите „на човек“." % fmt_num(pop["persons"]),
         "href": "#/pari", "status": "real", "source": ["eurostat"]},
    ]


def _data_events(ctx):
    sebra = _need(ctx, "sebra.json")
    files = sebra["publication"]["files"]
    listed = sorted({f["listedOn"] for f in files})
    if len(listed) != 1:
        raise ValueError("feed: the СЕБРА files were listed on different days: %s" % listed)
    ov = sebra["overall"]
    day_list = [fmt_date(f["day"]).rsplit(".", 1)[0] for f in files]
    days = day_list[0] if len(day_list) == 1 else ", ".join(day_list[:-1]) + " и " + day_list[-1]          # 27.08, 28.08 и 31.08
    return [{"id": "sebra-" + listed[0], "date": listed[0], "dateKind": "published", "kind": "data",
             "title": "СЕБРА: дневни обобщения на плащанията за август",
             "text": "Страницата на МИДТ показва %d дневни файла (%s): общо %d плащания на стойност %s. Файловете не "
                     "съдържат получателите и не са сума за месеца." % (len(files), days, ov["count"], fmt_eur(ov["eur"], 2)),
             "href": "#/plashtania", "status": "real", "source": ["sebra"]}]


# ------------------------------------------------------------------------------------------------ highlights
def _highlights(ctx):
    ex = ctx.execution
    lat = ex["latest"]
    k = lat["kfp"]
    return {
        "month": lat["month"], "asOf": lat["asOf"],
        "revenueMln": k["rev"]["cum"], "revenueYoyPct": k["rev"]["yoyPct"],
        "expenditureMln": k["exp.total"]["cum"], "expenditureYoyPct": k["exp.total"]["yoyPct"],
        "deficitMln": -k["balance"]["cum"], "deficitPrevYearMln": -k["balance"]["prevYearCum"],
        "capexPctPlan": k["exp.capex"]["pctPlan"],
        "newBorrowingMln": k["fin.ext.markets"]["cum"], "newBorrowingPrevYearMln": k["fin.ext.markets"]["prevYearCum"],
    }


def _sentences(h):
    when = "към края на %s 2026 г." % month_name(h["month"])
    return [
        "Приходите на консолидираната фискална програма %s са %s — %s от година по-рано." % (when, fmt_money(h["revenueMln"]), _more(h["revenueYoyPct"])),
        "Разходите (с вноската в бюджета на ЕС) са %s — %s." % (fmt_money(h["expenditureMln"]), _more(h["expenditureYoyPct"])),
        "Дефицитът е %s, при %s година по-рано." % (fmt_money(h["deficitMln"]), fmt_money(h["deficitPrevYearMln"])),
        "Капиталовите разходи са %s от годишния план." % fmt_pct(h["capexPctPlan"]),
        "Нетното външно финансиране от международните капиталови пазари е %s, при %s година по-рано."
        % (fmt_money(h["newBorrowingMln"]), fmt_money(h["newBorrowingPrevYearMln"])),
    ]


def _expected(ctx):
    ex = ctx.execution
    law = _need(ctx, "law.json")
    out = []
    for p in ex["pendingMonths"]:
        d = PENDING_DEFS[p["id"]]
        out.append({"id": p["id"], "title": "Месечен отчет на КФП към края на %s %s г." % (month_name(p["month"]), p["asOf"][:4]),
                    "status": "pending", "note": d["reason"], "expected": d["expected"]})
    nxt = law["next"]
    out.append({"title": nxt["title"], "status": nxt["status"], "note": nxt["note"], "expected": nxt["expected"]})
    return out


# ------------------------------------------------------------------------------------------------ RSS
def _rfc822(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    dow = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")[datetime.date(y, m, d).weekday()]
    mon = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")[m - 1]
    return "%s, %02d %s %04d 12:00:00 +0000" % (dow, d, mon, y)


def rss(feed, base):
    base = base if base.endswith("/") else base + "/"
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">', "<channel>",
             "<title>Бюджет на светло: какво е ново</title>", "<link>%s</link>" % escape(base),
             "<description>Събития по данните за държавния бюджет: месечни отчети, законодателен път, ставки и нови набори. "
             "Прототип с примерни данни, където е отбелязано.</description>",
             "<language>bg</language>", "<lastBuildDate>%s</lastBuildDate>" % _rfc822(BUILD_DATE),
             '<atom:link href="%sdata/feed.xml" rel="self" type="application/rss+xml"/>' % escape(base)]
    for e in feed["events"][:30]:
        kind_label = {k["id"]: k["label"] for k in feed["kinds"]}[e["kind"]]
        lines += ["<item>", "<title>%s</title>" % escape(e["title"]), "<link>%s%s</link>" % (escape(base), escape(e["href"])),
                  '<guid isPermaLink="false">%s</guid>' % escape(e["id"]), "<pubDate>%s</pubDate>" % _rfc822(e["date"]),
                  "<category>%s</category>" % escape(kind_label),
                  "<description>%s</description>" % escape(e.get("text", "")), "</item>"]
    lines += ["</channel>", "</rss>"]
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------------------------------------------ build
def build_feed(ctx):
    events = []
    for fam in (_report_events(ctx), _law_events(ctx), _rates_events(ctx), _eurostat_events(ctx), _data_events(ctx)):
        events.extend(fam)
    ids = [e["id"] for e in events]
    if len(set(ids)) != len(ids):
        raise ValueError("feed: duplicate event ids")
    for e in events:
        if e["date"] > BUILD_DATE:
            raise ValueError("feed: %s is dated after the build day" % e["id"])
    order = {e["id"]: i for i, e in enumerate(events)}
    events.sort(key=lambda e: (e["date"], order[e["id"]]), reverse=True)          # newest first; later steps of a day first
    kinds_used = {e["kind"] for e in events}
    h = _highlights(ctx)
    sources = [s for s in SOURCE_ORDER if any(s in e["source"] for e in events)]
    feed = {
        "meta": meta("feed", "Какво е ново: събития по данните за бюджета", source=sources,
                     source_note="Събитията са изведени от наборите на сайта (месечни отчети на КФП, законодателен път, ставки, "
                                 "Евростат, СЕБРА); датите са по източниците.",
                     as_of=events[0]["date"]),
        "kinds": [k for k in KINDS if k["id"] in kinds_used],
        "dateKinds": DATE_KINDS,
        "events": events,
        "expected": _expected(ctx),
        "highlights": h,
        "sentences": _sentences(h),
    }
    ctx.put("feed.json", feed)
    ctx.put_text("feed.xml", rss(feed, os.environ.get("BNS_SITE_URL", BASE_URL_DEFAULT)))
    return feed
