"""SEARCH and FEED groups of validate_data.py.

FEED: every event of feed.json is recomputed from the dataset it was derived from (execution.json, law.json, rates.json,
debt.json, expenditure.json, sebra.json, core.json); the amounts printed in a text are parsed back and compared with the
dataset (so a wrong number fails, a different wording does not); highlights and the five sentences are tied to the latest
KFP report; feed.xml is parsed and compared item by item with the events.
SEARCH: every row of search-index.json is checked for shape, link (must resolve in the route table), status and for its
numbers against the dataset it was copied from; the groups are tied 1:1 to their sources (265 municipalities, 52 measures,
the glossary, the catalog, the mock sets); a Python port of the client engine (site/js/searchlib.js: norm, lat, stem, SYN,
parse, tokScore, score) confirms that each popular query of the search page has hits.
Pure standard library; nothing here writes a file.
"""
import datetime
import email.utils
import os
import re
import unicodedata
import xml.etree.ElementTree as ET

import vd_lib as L
from vd_comp import dig
from vd_lib import Check, isnum

NNBSP, NBSP, MINUS = "\u202f", "\u00a0", "\u2212"
MONTHS = ("януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември")
SRC_ORDER = ("kfp", "parliament", "zdb", "zbdoo", "zbnzok", "nap", "eurostat", "sebra")
BASE_DEFAULT = "https://budget-na-svetlo.example/"

# a number as the site prints it: typographic minus, narrow no-break space between thousands, decimal comma
_NUM = "(" + MINUS + ")?(\\d{1,3}(?:" + NNBSP + "\\d{3})+|\\d+)(?:,(\\d+))?"
MONEY_RE = re.compile(_NUM + NBSP + "(млрд|млн|хил)\\." + NBSP + "€")
EUR_RE = re.compile(_NUM + NBSP + "€")
PCT_RE = re.compile(_NUM + "%")
UNIT = {"млрд": 1000.0, "млн": 1.0, "хил": 0.001}


def _val(m):
    """(value, decimals) of a number match."""
    s = m.group(2).replace(NNBSP, "") + ("." + m.group(3) if m.group(3) else "")
    return (-1.0 if m.group(1) else 1.0) * float(s), len(m.group(3) or "")


def money_in(text):
    """[(value in млн. €, rounding tolerance)] of every 'N млн. €' / 'N млрд. €' / 'N хил. €' in the text, in order."""
    out = []
    for m in MONEY_RE.finditer(text or ""):
        v, d = _val(m)
        f = UNIT[m.group(4)]
        out.append((v * f, 0.5 * 10 ** -d * f))
    return out


def eur_in(text):
    """[(value in €, tolerance)] of every plain 'N €' in the text."""
    out = []
    for m in EUR_RE.finditer(text or ""):
        v, d = _val(m)
        out.append((v, 0.5 * 10 ** -d))
    return out


def pct_in(text):
    """[(value, tolerance)] of every 'N%' in the text."""
    out = []
    for m in PCT_RE.finditer(text or ""):
        v, d = _val(m)
        out.append((v, 0.5 * 10 ** -d))
    return out


def amounts(c, label, text, money=(), eur=(), pct=()):
    """The amounts printed in `text` are exactly the expected ones (same count, same order, within their rounding)."""
    for kind, got, want in (("млн. €", money_in(text), list(money)), ("€", eur_in(text), list(eur)), ("%", pct_in(text), list(pct))):
        good = len(got) == len(want) and all(isnum(w) and abs(g - w) <= t + 1e-9 for (g, t), w in zip(got, want))
        c.ok(good, "%s: amounts in %s are %s, expected %s" % (label, kind, [round(g, 4) for g, _t in got], want))


def clean_text(c, label, s, sentence=False):
    """Typography of one user-facing string: no stray spaces, double dots, placeholders or ASCII quotes."""
    if not c.ok(isinstance(s, str) and s.strip() != "", "%s: empty or not a string" % label):
        return
    c.ok(s == s.strip(), "%s: leading or trailing space" % label)
    c.ok(re.search("[ " + NBSP + NNBSP + "]{2,}|[\\t\\r\\n]", s) is None, "%s: double space or line break: %r" % (label, s))
    c.ok(".." not in s and re.search("[ " + NBSP + "][,.;:!?]", s) is None, "%s: stray dot or a space before punctuation: %r" % (label, s))
    c.ok(re.search("\\b(?:None|null|NaN|undefined)\\b|%[sd]|\\{|\\}|\"", s) is None, "%s: placeholder or ASCII quote: %r" % (label, s))
    c.ok("private channel" not in s.lower(), "%s: mentions a private channel" % label)
    if sentence:
        c.ok(s[-1] in ".!?)»“", "%s: does not end with a full stop: %r" % (label, s))


def _long_date(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    return "%d[%s ]%s[%s ]%d[%s ]г\\." % (d, NBSP, MONTHS[m - 1], NBSP, y, NBSP)


def _fmt_ok(iso):
    try:
        datetime.date(*[int(x) for x in iso.split("-")])
        return L.ISO.match(iso) is not None
    except (ValueError, TypeError, AttributeError):
        return False


# ------------------------------------------------------------------------------------------------------- FEED
def _event(c, evs, eid, want, money=(), eur=(), pct=(), has=()):
    """One event against what its dataset says: the fields in `want`, the printed amounts, regexes the text must contain."""
    ev = evs.get(eid)
    if not c.ok(ev is not None, "event %s is missing" % eid):
        return
    for k, v in want.items():
        c.ok(ev.get(k) == v, "event %s: %s is %r, the dataset says %r" % (eid, k, ev.get(k), v))
    t = ev.get("text", "")
    amounts(c, "event %s text" % eid, t, money, eur, pct)
    for h in has:
        c.ok(re.search(h, t) is not None, "event %s: text lacks /%s/" % (eid, h))


def _feed_events(c, f, ctx):
    """Shape of the events (18 + one per monthly report of 2026) and their recomputation from the datasets."""
    core, ex, law = ctx.get("core.json"), ctx.get("execution.json"), ctx.get("law.json")
    rates, debt, exp, seb = ctx.get("rates.json"), ctx.get("debt.json"), ctx.get("expenditure.json"), ctx.get("sebra.json")
    evs_list = f["events"]
    kinds = [k.get("id") for k in f["kinds"]]
    ids = [e.get("id") for e in evs_list]
    evs = {e["id"]: e for e in evs_list if isinstance(e, dict) and "id" in e}
    c.ok(len(set(ids)) == len(ids) and all(isinstance(i, str) and re.match("^[a-z0-9][a-z0-9_.-]*$", i) for i in ids), "event ids: duplicates or odd characters")
    allowed = {"id", "date", "dateTo", "dateKind", "kind", "title", "text", "href", "status", "source"}
    for e in evs_list:
        eid = e.get("id")
        c.ok(set(e) <= allowed and {"id", "date", "dateKind", "kind", "title", "href", "status", "source"} <= set(e), "event %s: keys %s" % (eid, sorted(e)))
        c.ok(_fmt_ok(e.get("date", "")) and e["date"] <= L.BUILD_DATE, "event %s: date %r must be a real day not after the build day" % (eid, e.get("date")))
        if "dateTo" in e:
            c.ok(_fmt_ok(e["dateTo"]) and e["dateTo"] >= e["date"], "event %s: dateTo %r before date" % (eid, e["dateTo"]))
        c.ok(e.get("dateKind") in f["dateKinds"], "event %s: dateKind %r" % (eid, e.get("dateKind")))
        c.ok(e.get("kind") in kinds, "event %s: kind %r is not in kinds[]" % (eid, e.get("kind")))
        c.ok(e.get("status") in ("real", "mock", "pending"), "event %s: status %r" % (eid, e.get("status")))
        c.ok(isinstance(e.get("source"), list) and e["source"] and all(s in core["sources"] for s in e["source"]), "event %s: source %r" % (eid, e.get("source")))
        h = e.get("href", "")
        c.ok(isinstance(h, str) and h.startswith("#/") and ctx.routes().match(h) is not None, "event %s: href %r does not open a screen" % (eid, h))
        clean_text(c, "event %s title" % eid, e.get("title"))
        if "text" in e:
            clean_text(c, "event %s text" % eid, e["text"], sentence=True)
    dates = [e.get("date", "") for e in evs_list]
    c.ok(dates == sorted(dates, reverse=True), "events must be newest first")
    n_rep = int(ex["data"]["2026"]["months"])          # one report event per month of 2026 + 18 other events (law, rates, Eurostat, data)
    c.ok(len(evs_list) == 18 + n_rep, "expected %d events, found %d" % (18 + n_rep, len(evs_list)))
    c.ok(f["meta"].get("asOf") == (dates[0] if dates else None), "meta.asOf must be the date of the newest event")

    # --- monthly KFP reports
    d26, d25 = ex["data"]["2026"], ex["data"]["2025"]
    n = d26["months"] if isinstance(d26["months"], int) else len(d26["months"])
    lat = ex["latest"]
    c.ok(n == lat["month"] and d26["asOf"][n - 1] == lat["asOf"], "execution.json: months / latest.month / latest.asOf disagree")
    c.ok(sorted(e for e in evs if e.startswith("kfp-")) == ["kfp-2026-%02d" % m for m in range(1, n + 1)], "report events must be one per month of 2026")
    for m in range(1, n + 1):
        rev, expd, bal = (d26["kfp"][k][m - 1] for k in ("rev", "exp.total", "balance"))
        prev = d25["kfp"]["rev"][m - 1]
        yoy = 100.0 * (rev / prev - 1.0)
        pct = [abs(yoy)] + ([lat["kfp"]["rev"]["pctPlan"]] if m == n else [])
        _event(c, evs, "kfp-2026-%02d" % m,
               {"date": d26["asOf"][m - 1], "dateKind": "asOf", "kind": "report", "href": "#/izpalnenie?mesec=%d" % m, "status": "real", "source": ["kfp"],
                "title": "Месечен отчет на КФП към края на %s 2026 г." % MONTHS[m - 1]},
               money=[rev, expd, abs(bal)], pct=pct,
               has=["дефицитът" if bal < 0 else "излишъкът", "повече" if yoy >= 0 else "по-малко"])

    # --- legislative path: the 11 parliament steps of law.json
    par = [t for t in law["timeline"] if t.get("phase") == "parliament"]
    c.ok(len(par) == 11, "law.json timeline: %d parliament steps, expected 11" % len(par))
    seen, want_ids = {}, []
    for t in par:
        base = "law-%s-%s" % (t["date"], t["kind"])
        seen[base] = seen.get(base, 0) + 1
        eid = base if seen[base] == 1 else "%s-%d" % (base, seen[base])
        want_ids.append(eid)
        want = {"date": t["date"], "dateKind": "occurred", "kind": "plenary" if t["kind"] in ("plenary-1", "plenary-2", "adopted") else "law",
                "title": t["title"], "href": "#/zakon", "status": "real", "source": list(t.get("source") or ["parliament"])}
        if t.get("dateTo"):
            want["dateTo"] = t["dateTo"]
        _event(c, evs, eid, want)
        ev = evs.get(eid, {})
        c.ok(ev.get("text") == (t.get("detail") or None) and (("text" in ev) == bool(t.get("detail"))), "event %s: text must be the detail of the timeline step" % eid)
        c.ok(("dateTo" in ev) == bool(t.get("dateTo")), "event %s: dateTo" % eid)
    c.ok(sorted(e for e in evs if e.startswith("law-")) == sorted(want_ids), "law events %s vs timeline steps %s" % (sorted(e for e in evs if e.startswith("law-")), sorted(want_ids)))

    # --- rates
    ch = {x["id"]: x for x in rates["changes"]}
    mx, mn, mi = ch["max-insurable"], ch["min-self-employed"], ch["min-income-by-activity"]
    es, er = ch["civil-servant-employee-share"], ch["civil-servant-employer-share"]
    cells = "във всички %d попълнени клетки" % mi["filled"] if mi["changed"] == mi["filled"] else "в %d от %d попълнени клетки" % (mi["changed"], mi["filled"])
    _event(c, evs, "rates-2026-08-01", {"date": "2026-08-01", "dateKind": "effective", "kind": "rates", "href": "#/danaci", "status": "real", "source": ["zbdoo"]},
           eur=[mx["from"], mx["until"], mn["from"], mn["until"]], has=[re.escape(cells)])
    _event(c, evs, "rates-2026-08-12", {"date": rates["meta"]["asOf"], "dateKind": "published", "kind": "rates", "href": "#/danaci", "status": "real", "source": ["nap"]},
           pct=[es["from"], es["until"], er["from"], er["until"]], has=[_long_date(rates["meta"]["asOf"]), "в %d категории|%d категории" % (len(rates["napCategories"]), len(rates["napCategories"]))])

    # --- Eurostat releases
    ms = dig(debt, "latest", "maastricht")
    q = ms["quarter"]
    qy, qn = q["id"].split("-Q")
    cy = exp["cofog"]["years"][-1]
    pop = core["population"]
    ordinal = {1: "първото", 2: "второто", 3: "третото", 4: "четвъртото"}[int(qn)]
    _event(c, evs, "eurostat-gov_10dd_edpt1-" + ms["asOf"],
           {"date": ms["asOf"], "dateKind": "published", "kind": "eurostat", "href": "#/dalg?obhvat=maastricht", "status": "real", "source": ["eurostat"],
            "title": "Евростат: дългът на държавното управление за %d г." % ms["year"]}, money=[ms["mln"]], pct=[ms["pctGdp"]])
    _event(c, evs, "eurostat-gov_10q_ggdebt-" + q["asOf"],
           {"date": q["asOf"], "dateKind": "published", "kind": "eurostat", "href": "#/dalg?obhvat=maastricht", "status": "real", "source": ["eurostat"],
            "title": "Евростат: дългът в края на %s тримесечие на %s г." % (ordinal, qy)}, money=[q["mln"]], pct=[q["pctGdp"]])
    _event(c, evs, "eurostat-gov_10a_exp-" + exp["cofog"]["asOf"],
           {"date": exp["cofog"]["asOf"], "dateKind": "published", "kind": "eurostat", "href": "#/razhodi", "status": "real", "source": ["eurostat"],
            "title": "Евростат: разходите по функции (COFOG) са допълнени до %d г." % cy},
           money=[exp["cofog"]["total"]["mln"][-1]], pct=[exp["cofog"]["total"]["pctGdp"][-1]], has=["%d г\\." % cy])
    persons = "{:,}".format(pop["persons"]).replace(",", NNBSP)
    _event(c, evs, "eurostat-tps00001-" + pop["asOf"],
           {"date": pop["asOf"], "dateKind": "published", "kind": "eurostat", "href": "#/pari", "status": "real", "source": ["eurostat"],
            "title": "Евростат: населението на 1 януари %d г." % pop["year"]}, has=[persons + " души"])
    c.ok(sorted(e for e in evs if e.startswith("eurostat-")) == sorted(["eurostat-gov_10dd_edpt1-" + ms["asOf"], "eurostat-gov_10q_ggdebt-" + q["asOf"],
                                                                         "eurostat-gov_10a_exp-" + exp["cofog"]["asOf"], "eurostat-tps00001-" + pop["asOf"]]),
         "Eurostat events: ids vs dates in the datasets")

    # --- SEBRA publication
    files = dig(seb, "publication", "files") or []
    listed = sorted({x["listedOn"] for x in files})
    c.ok(len(listed) == 1, "sebra.json: the files were listed on %s" % listed)
    days = [x["day"][8:10] + "." + x["day"][5:7] for x in files]
    pretty = days[0] if len(days) == 1 else ", ".join(days[:-1]) + " и " + days[-1]
    ov = seb["overall"]
    if listed:
        _event(c, evs, "sebra-" + listed[0], {"date": listed[0], "dateKind": "published", "kind": "data", "href": "#/plashtania", "status": "real", "source": ["sebra"]},
               eur=[ov["eur"]], has=["%d дневни файла" % len(files), re.escape("(" + pretty + ")"), "%d плащания" % ov["count"]])
    c.ok(len(evs) == len(want_ids) + n + 2 + 4 + 1, "events: %d, the datasets explain %d" % (len(evs), len(want_ids) + n + 2 + 4 + 1))


def _feed_rest(c, f, ctx):
    """kinds, dateKinds, meta, highlights, sentences, expected."""
    core, ex, law = ctx.get("core.json"), ctx.get("execution.json"), ctx.get("law.json")
    evs = f["events"]
    # --- meta
    m = f["meta"]
    c.ok(set(m) == {"id", "title", "status", "source", "sourceNote", "asOf", "retrieved", "mock"}, "meta keys %s" % sorted(m))
    c.ok(m.get("id") == "feed" and m.get("status") == "real" and m.get("mock") is False and m.get("retrieved") == L.BUILD_DATE, "meta id / status / mock / retrieved")
    used = {s for e in evs for s in e.get("source", [])}
    c.ok(m.get("source") == [s for s in SRC_ORDER if s in used] and used <= set(SRC_ORDER), "meta.source %s vs the sources of the events %s" % (m.get("source"), sorted(used)))
    clean_text(c, "meta.title", m.get("title"))
    clean_text(c, "meta.sourceNote", m.get("sourceNote"), sentence=True)
    # --- kinds and dateKinds
    k = f["kinds"]
    c.ok(all(set(x) == {"id", "label"} for x in k) and len({x["id"] for x in k}) == len(k), "kinds: shape")
    c.ok({x["id"] for x in k} == {e["kind"] for e in evs}, "kinds %s must be exactly the kinds used by the events" % [x["id"] for x in k])
    c.ok([x["id"] for x in k] == [i for i in ("report", "law", "plenary", "rates", "eurostat", "data") if i in {x["id"] for x in k}], "kinds are in the fixed order")
    for x in k:
        clean_text(c, "kind %s label" % x.get("id"), x.get("label"))
    dk = f["dateKinds"]
    c.ok(set(dk) == {"occurred", "asOf", "published", "effective"} and set(dk) >= {e["dateKind"] for e in evs}, "dateKinds %s" % sorted(dk))
    for key, lab in dk.items():
        clean_text(c, "dateKind %s" % key, lab)
    # --- highlights = the latest report
    lat = ex["latest"]
    kf = lat["kfp"]
    h = f["highlights"]
    want = {"month": lat["month"], "asOf": lat["asOf"], "revenueMln": kf["rev"]["cum"], "revenueYoyPct": kf["rev"]["yoyPct"],
            "expenditureMln": kf["exp.total"]["cum"], "expenditureYoyPct": kf["exp.total"]["yoyPct"], "deficitMln": -kf["balance"]["cum"],
            "deficitPrevYearMln": -kf["balance"]["prevYearCum"], "capexPctPlan": kf["exp.capex"]["pctPlan"],
            "newBorrowingMln": kf["fin.ext.markets"]["cum"], "newBorrowingPrevYearMln": kf["fin.ext.markets"]["prevYearCum"]}
    c.ok(set(h) == set(want), "highlights keys %s" % sorted(h))
    for key, v in want.items():
        if isnum(v):
            c.near(h.get(key), v, 1e-9, "highlights.%s must equal the latest report of execution.json" % key)
        else:
            c.ok(h.get(key) == v, "highlights.%s is %r, execution.json says %r" % (key, h.get(key), v))
    kp = core["kpis"]
    c.near(h.get("revenueMln"), kp["revenue"]["execMln"], 1e-9, "highlights.revenueMln vs core.kpis.revenue.execMln")
    c.near(h.get("expenditureMln"), kp["expenditure"]["execMln"], 1e-9, "highlights.expenditureMln vs core.kpis.expenditure.execMln")
    c.near(-h.get("deficitMln", 0), kp["balance"]["execMln"], 1e-9, "highlights.deficitMln vs core.kpis.balance.execMln")
    c.ok(h["deficitMln"] > 0 and h["deficitPrevYearMln"] > 0, "highlights: a deficit is stored as a positive number (the sentence says 'Дефицитът е')")
    last = [e for e in evs if e["id"] == "kfp-2026-%02d" % lat["month"]]
    c.ok(len(last) == 1 and last[0]["date"] == lat["asOf"], "the newest report event must be the latest month of execution.json")
    # --- sentences
    s = f["sentences"]
    c.ok(isinstance(s, list) and len(s) == 5, "sentences: expected 5, found %r" % (len(s) if isinstance(s, list) else s))
    if isinstance(s, list) and len(s) == 5:
        for i, t in enumerate(s):
            clean_text(c, "sentence %d" % i, t, sentence=True)
        more = lambda v: "повече" if v >= 0 else "по-малко"        # noqa: E731
        amounts(c, "sentence 0", s[0], money=[h["revenueMln"]], pct=[abs(h["revenueYoyPct"])])
        amounts(c, "sentence 1", s[1], money=[h["expenditureMln"]], pct=[abs(h["expenditureYoyPct"])])
        amounts(c, "sentence 2", s[2], money=[h["deficitMln"], h["deficitPrevYearMln"]])
        amounts(c, "sentence 3", s[3], pct=[h["capexPctPlan"]])
        amounts(c, "sentence 4", s[4], money=[h["newBorrowingMln"], h["newBorrowingPrevYearMln"]])
        c.ok(re.search("към края на %s 2026 г\\." % MONTHS[h["month"] - 1], s[0]) is not None, "sentence 0 must name the month of the latest report")
        c.ok(more(h["revenueYoyPct"]) in s[0] and more(h["expenditureYoyPct"]) in s[1], "sentences 0-1: more / less than a year earlier")
        c.ok("Приходите" in s[0] and "Разходите" in s[1] and "Дефицитът" in s[2] and "Капиталовите" in s[3] and "външно финансиране" in s[4], "sentences are in the fixed order")
    # --- expected: the announced, not yet published
    ex_l = f["expected"]
    pm = ex["pendingMonths"]
    c.ok(isinstance(ex_l, list) and len(ex_l) == len(pm) + 1, "expected: %d entries, execution.json has %d pending months + the next budget" % (len(ex_l), len(pm)))
    for i, p in enumerate(pm):
        e = ex_l[i] if i < len(ex_l) else {}
        pend = core["pending"].get(p["id"], {})
        c.ok(e.get("id") == p["id"] and e.get("status") == "pending" and e.get("title") == "Месечен отчет на КФП към края на %s %s г." % (MONTHS[p["month"] - 1], p["asOf"][:4]),
             "expected[%d]: id / status / title vs execution.pendingMonths" % i)
        c.ok(e.get("note") == pend.get("reason") and e.get("expected") == pend.get("expected"), "expected[%d]: note / expected must be the text of core.pending.%s" % (i, p["id"]))
    nx = ex_l[-1] if ex_l else {}
    c.ok(all(nx.get(x) == law["next"].get(x) for x in ("title", "status", "note", "expected")), "expected[-1] must be law.json next")
    for i, e in enumerate(ex_l):
        c.ok(e.get("status") == "pending", "expected[%d]: status must be pending" % i)
        for key in ("title", "note", "expected"):
            clean_text(c, "expected[%d].%s" % (i, key), e.get(key))
        c.ok(not money_in(e.get("note", "")) and not eur_in(e.get("note", "")), "expected[%d]: a pending note must carry no amount" % i)


def _feed_xml(c, f, ctx):
    """feed.xml is the same list as RSS 2.0."""
    try:
        root = ET.fromstring(ctx.text("feed.xml").encode("utf-8"))
    except ET.ParseError as e:
        c.fail("feed.xml is not well-formed XML: %s" % e)
        return
    ch = root.find("channel")
    c.ok(root.tag == "rss" and root.get("version") == "2.0" and ch is not None, "feed.xml must be an RSS 2.0 document")
    if ch is None:
        return
    base = os.environ.get("BNS_SITE_URL", BASE_DEFAULT)
    base = base if base.endswith("/") else base + "/"
    if base == BASE_DEFAULT:
        c.fact("feed.xml uses the placeholder address %s" % base)
    else:
        c.warn("feed.xml uses the address from BNS_SITE_URL: %s" % base)
    atom = "{http://www.w3.org/2005/Atom}link"
    txt = lambda tag: (ch.findtext(tag) or "")                    # noqa: E731
    c.ok(txt("link") == base and txt("language") == "bg", "feed.xml channel link / language: %r %r" % (txt("link"), txt("language")))
    for tag in ("title", "description"):
        clean_text(c, "feed.xml channel %s" % tag, txt(tag))
    lb = ch.findtext("lastBuildDate") or ""
    y, mo, d = (int(x) for x in L.BUILD_DATE.split("-"))
    c.ok(lb == email.utils.format_datetime(datetime.datetime(y, mo, d, 12, 0, 0, tzinfo=datetime.timezone.utc)), "feed.xml lastBuildDate %r vs the build day" % lb)
    a = ch.find(atom)
    c.ok(a is not None and a.get("href") == base + "data/feed.xml" and a.get("rel") == "self", "feed.xml atom:link rel=self")
    items = ch.findall("item")
    evs = f["events"][:30]
    c.ok(len(items) == len(evs), "feed.xml has %d items, feed.json %d events" % (len(items), len(evs)))
    label = {k["id"]: k["label"] for k in f["kinds"]}
    for it, e in zip(items, evs):
        eid = e["id"]
        g = it.find("guid")
        c.ok(g is not None and g.text == eid and g.get("isPermaLink") == "false", "feed.xml item %s: guid" % eid)
        c.ok(it.findtext("title") == e["title"], "feed.xml item %s: title differs from feed.json" % eid)
        c.ok(it.findtext("link") == base + e["href"], "feed.xml item %s: link %r" % (eid, it.findtext("link")))
        yy, mm, dd = (int(x) for x in e["date"].split("-"))
        c.ok(it.findtext("pubDate") == email.utils.format_datetime(datetime.datetime(yy, mm, dd, 12, 0, 0, tzinfo=datetime.timezone.utc)),
             "feed.xml item %s: pubDate %r vs %s" % (eid, it.findtext("pubDate"), e["date"]))
        c.ok(it.findtext("category") == label.get(e["kind"]), "feed.xml item %s: category" % eid)
        c.ok((it.findtext("description") or "") == e.get("text", ""), "feed.xml item %s: description differs from the text" % eid)
    c.ok("private channel" not in ctx.text("feed.xml").lower(), "feed.xml mentions a private channel")


def g_feed(ctx):
    c = Check("FEED")
    f = ctx.get("feed.json")
    c.ok(set(f) == {"meta", "kinds", "dateKinds", "events", "expected", "highlights", "sentences"}, "feed keys %s" % sorted(f))
    _feed_events(c, f, ctx)
    _feed_rest(c, f, ctx)
    _feed_xml(c, f, ctx)
    c.fact("%d events, %d kinds, the newest on %s; %d announced" % (len(f["events"]), len(f["kinds"]), f["events"][0]["date"], len(f["expected"])))
    return c


# ================================================================================================ SEARCH
# A Python port of the client engine (site/js/searchlib.js): norm, lat, stem, parse, tokScore, osa, near, score, mag, run. It lets the
# validator answer "what would the search box show for this word" without a browser. The group "screens" (built from the route
# table in the browser) is not part of it: only the rows of search-index.json are searched. If searchlib.js changes its rules, this
# port has to follow (the port self-tests below fail when they drift apart from the expectations derived from the JS code).
MAX_QUERY = 120
S_GROUPS = ["indicators", "institutions", "municipalities", "measures", "terms", "datasets"]
S_FIELDS = ["g", "title", "sub", "value", "period", "status", "href", "kw"]
S_WEIGHT = {"indicators": 2.5, "institutions": 2.5, "municipalities": 1, "measures": 1.2, "terms": 1.5, "screens": 1.8, "datasets": 0.6}
S_LABEL = {"indicators": "Показатели", "institutions": "Институции", "municipalities": "Общини", "measures": "Мерки", "terms": "Понятия",
           "datasets": "Данни", "screens": "Екрани"}
S_STATUS = ("real", "mock", "pending")
_LAT = {"а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
        "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sht",
        "ъ": "a", "ь": "y", "ю": "yu", "я": "ya"}
_QUOTES = "„“”\"«»'’`"
_UNIT_MLN = {"млрд": 1000.0, "млн": 1.0, "хил": 0.001}


def _fold(s):
    s = unicodedata.normalize("NFD", str("" if s is None else s).lower())
    return "".join(ch for ch in s if not "\u0300" <= ch <= "\u036f")


def norm(s):
    """fold + quotes dropped + every run of other signs one space (the form words are compared in)."""
    out, gap = [], False
    for ch in _fold(s):
        if ch in _QUOTES:
            continue
        if ch == "%" or unicodedata.category(ch)[0] in "LN":
            out.append(ch)
            gap = False
        elif not gap:
            out.append(" ")
            gap = True
    return "".join(out).strip()


def lat(s):
    return "".join(_LAT.get(ch, ch) if "а" <= ch <= "я" else ch for ch in s)


_SYN_RAW = [
    ["ддс", "данък добавена стойност", "данък върху добавената стойност"],
    ["дълг", "задлъжнялост", "задлъжняване"],
    ["мвр", "вътрешните работи", "полиция", "вътрешен ред"], ["мвнр", "външните работи"], ["мон", "образованието и науката"],
    ["мз", "здравеопазването"], ["мф", "финансите"], ["мо", "отбраната", "армия"], ["мтсп", "труда и социалната политика"],
    ["мррб", "регионалното развитие"], ["мзх", "земеделието и храните"], ["мтс", "транспорта и съобщенията"],
    ["мосв", "околната среда и водите"],
    ["нои", "доо", "обществено осигуряване", "общественото осигуряване"], ["нзок", "здравна каса", "здравноосигурителна каса"],
    ["бвп", "брутен вътрешен продукт"], ["кфп", "консолидирана фискална програма", "консолидираната фискална програма"],
    ["дфл", "данък общ доход", "данък върху доходите"], ["пенсии", "пенсия", "пенсионно"], ["заплати", "заплата", "възнаграждения", "персонал"],
    ["еврофондове", "европейски средства", "средства от ес"], ["болници", "здравеопазване"], ["училища", "образование"], ["дефицит", "салдо"],
    ["мерки", "мярка"], ["данък", "данъци", "данъчни"], ["осигуровки", "осигуровка", "вноски"], ["ес", "европейски съюз", "евросъюз"],
]
SYN = [[norm(m) for m in g] for g in _SYN_RAW]
SYN_LAT = [[lat(m) for m in g] for g in SYN]
STOP = frozenset(["и", "в", "във", "на", "за", "от", "по", "с", "със", "към", "до", "при", "да", "се", "е", "са", "ли", "как", "колко", "кой",
                  "коя", "кое", "кои", "какво", "къде"])
_STEM_END = re.compile(r"(ите|ата|ята|ото|ето|ът|ят|та|то|те)$")
_STEM_VOWEL = re.compile(r"[аяиеоуъ]$")


def stem(t):
    if len(t) < 5 or re.search("[a-z]", t):
        return t
    s = _STEM_END.sub("", t)
    return _STEM_VOWEL.sub("", s) if len(s) >= 5 else s


def parse(raw):
    """The query -> words {t, lat, alts}; the result list also carries .phrase when it has several words (a Toks list)."""
    q = " %s " % norm(str(raw if raw is not None else "")[:MAX_QUERY])
    for g in SYN:
        for m in g:
            if " " in m and (" %s " % m) in q:
                q = q.replace(" %s " % m, " %s " % g[0], 1)
    toks = [t for t in q.strip().split(" ") if t]
    if any(t not in STOP for t in toks):
        toks = [t for t in toks if t not in STOP]
    out = Toks()
    if all(len(t) < 2 for t in toks):
        return out
    for t in toks[:8]:
        is_lat = re.search("[a-z]", t) is not None
        st = stem(t)
        alts = {t, st}
        for g in (SYN_LAT if is_lat else SYN):
            if any(m == x or (len(x) >= 4 and " " not in m and m.startswith(x)) for m in g for x in (t, st)):
                alts.update(g)
        out.append({"t": t, "lat": is_lat, "alts": sorted(alts)})
    if len(out) > 1:
        out.phrase = " ".join(k["t"] for k in out)
    return out


class Toks(list):
    phrase = None


def entry(group, title, sub="", kw="", period="", value="", status="real", href=""):
    name = str(title)
    nn = norm(name)
    t = norm("%s %s %s %s %s" % (name, sub or "", kw or "", period or "", S_LABEL.get(group, "Друго")))
    return {"group": group, "title": name, "status": status if status in S_STATUS else "real", "href": href, "w": S_WEIGHT.get(group, 1),
            "nn": nn, "t": t, "nl": lat(nn), "tl": lat(t), "mag": mag(value)}


def mag(v):
    m = re.search(r"(\d[\d\s]*(?:,\d+)?)\s*(млрд|млн|хил)", str("" if v is None else v))
    return float(re.sub(r"\s", "", m.group(1)).replace(",", ".")) * _UNIT_MLN[m.group(2)] if m else 0.0


def tok_score(e, k):
    nn, t = (e["nl"], e["tl"]) if k["lat"] else (e["nn"], e["t"])
    best = 0
    for a in k["alts"]:
        short = len(a) <= 3
        if nn == a:
            s = 10
        elif (" %s " % a) in (" %s " % nn):
            s = 7
        elif (" %s" % a) in (" %s" % nn):
            s = 6
        elif not short and a in nn:
            s = 3
        elif (" %s" % a) in (" %s" % t):
            s = 2
        elif not short and a in t:
            s = 1
        else:
            s = 0
        if s and a != k["t"]:
            s -= 0.5
        best = max(best, s)
    return best


def osa(a, b, mx):
    """Optimal-string-alignment distance, mx + 1 when it is more than mx."""
    la, lb = len(a), len(b)
    if abs(la - lb) > mx:
        return mx + 1
    prev2, prev = None, list(range(lb + 1))
    for i in range(1, la + 1):
        cur = [i]
        low = i
        for j in range(1, lb + 1):
            v = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (0 if a[i - 1] == b[j - 1] else 1))
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                v = min(v, prev2[j - 2] + 1)
            cur.append(v)
            if v < low:
                low = v
        if low > mx:
            return mx + 1
        prev2, prev = prev, cur
    return min(prev[lb], mx + 1)


def near(e, k):
    t = k["t"]
    mx = 2 if len(t) >= 8 else 1 if len(t) >= 4 else 0
    if not mx:
        return 0

    def dist(s):
        d = mx + 1
        for w in s.split(" "):
            if len(w) < 3:
                continue
            d = min(d, osa(t, w, mx), osa(t, w[:len(t)], mx) if len(w) > len(t) else mx + 1)
        return d
    in_name = dist(e["nl"] if k["lat"] else e["nn"])
    in_text = dist(e["tl"] if k["lat"] else e["t"])
    if in_name <= mx:
        return 4.5 - in_name * 0.5
    return 2 - (in_text - 1) * 0.5 if in_text <= mx else 0


def score(e, toks, fuzzy):
    total, in_name = 0, True
    for k in toks:
        best = tok_score(e, k) or (near(e, k) if fuzzy else 0)
        if not best:
            return 0
        if best < 3:
            in_name = False
        total += best
    if toks.phrase:
        def has(x, p):
            return (" %s " % p) in (" %s " % x)
        total += 2 if has(e["nn"], toks.phrase) or has(e["nl"], toks.phrase) else 1 if has(e["t"], toks.phrase) or has(e["tl"], toks.phrase) else 0
    return int((total + e["w"] - (min(1.5, len(e["title"]) / 80.0) if in_name else 0)) * 100 + 0.5) / 100.0


def run(entries, toks, only_real=False):
    """(hits best first, hidden mock hits, fuzzy) exactly as searchlib.js run()."""
    def one_pass(fz):
        out, hidden = [], 0
        for e in entries:
            s = score(e, toks, fz)
            if s <= 0:
                continue
            if only_real and e["status"] == "mock":
                hidden += 1
                continue
            out.append((s, e))
        out.sort(key=lambda x: (-x[0], -x[1]["w"], -x[1]["mag"], len(x[1]["title"])))
        return [x[1] for x in out], hidden
    hits, hidden, fuzzy = [], 0, False
    if len(toks):
        hits, hidden = one_pass(False)
        if not hits and not hidden:
            hits, hidden = one_pass(True)
            fuzzy = bool(hits) or hidden > 0
    return hits, hidden, fuzzy


# ------------------------------------------------------------------------------------------------ SEARCH: the group check
_POPULAR = ("ДДС", "дълг", "Пловдив", "образование", "МВР", "пенсии", "заплати")        # the popular queries of the search page
_ID_RE = re.compile(r"^#/(vedomstvo|obshtina|merki|rechnik|danni)/([^/?#]+)(?:/([^/?#]+))?")


def g_search(ctx):
    """search-index.json: shape, the group counts tied to their datasets, every id and link resolves, mock rows are marked, the popular queries
    find something. A cheap gate: the values are copied by the builder (build_search.py), they are not re-derived here."""
    c = Check("SEARCH")
    s = ctx.get("search-index.json")
    c.ok(set(s) == {"meta", "version", "groups", "fields", "items"} and s["version"] == 1, "search-index keys %s" % sorted(s))
    c.ok(s["groups"] == S_GROUPS and s["fields"] == S_FIELDS, "groups/fields differ from the contract of searchlib.js")
    mi, mu, me = ctx.get("ministries.json"), ctx.get("municipalities.json"), ctx.get("measures.json")
    gl, cat, pr = ctx.get("glossary.json"), ctx.get("catalog.json"), ctx.get("programs.json")
    ids = {"vedomstvo": {b["id"] for b in mi["items"]}, "obshtina": {m["id"] for m in mu["items"]}, "merki": {m["id"] for m in me["items"]},
           "rechnik": {t["slug"] for t in gl["terms"]}, "danni": {d["slug"] for d in cat["datasets"]}}
    f = {n: i for i, n in enumerate(pr["fields"])}
    codes = {p[f["code"]] for p in pr["items"]}
    routes = ctx.routes()
    seen, per, n_mock, rows5 = set(), [0] * len(S_GROUPS), 0, {}
    items = s["items"]
    for i, r in enumerate(items):
        tag = "row %d %r" % (i, r[1] if isinstance(r, list) and len(r) > 1 else r)
        if not c.ok(isinstance(r, list) and len(r) == len(S_FIELDS) and isinstance(r[0], int) and 0 <= r[0] < len(S_GROUPS)
                    and all(isinstance(x, str) for x in r[1:]), "%s: shape" % tag):
            continue
        per[r[0]] += 1
        clean_text(c, tag + " title", r[1])
        c.ok(r[3] == "" or (re.search("\\d", r[3]) is not None and r[3][-1] in "€%" or r[3].endswith(" от БВП")), "%s: value %r" % (tag, r[3]))
        c.ok(r[5] in S_STATUS, "%s: status %r" % (tag, r[5]))
        c.ok(r[6].startswith("#/") and routes.match(r[6]) is not None, "%s: href %r opens no screen" % (tag, r[6]))
        m = _ID_RE.match(r[6])
        if m:
            c.ok(m.group(2) in ids[m.group(1)], "%s: %s id %r is not in its dataset" % (tag, m.group(1), m.group(2)))
            if m.group(3) and m.group(1) == "vedomstvo":
                c.ok(m.group(3) in codes, "%s: programme code %r is not in programs.json" % (tag, m.group(3)))
        key = (r[0], r[1], r[6])
        c.ok(key not in seen, "%s: duplicate row" % tag)
        seen.add(key)
        if r[0] == 5:
            rows5[r[6]] = r
        if r[5] == "mock":
            n_mock += 1
            c.ok(r[0] == 5, "%s: a mock row outside the datasets group" % tag)
    n_prog = sum(1 for p in pr["items"] if p[f["name"]])
    for g, n in ((1, len(mi["items"]) + n_prog), (2, len(mu["items"])), (3, len(me["items"])), (4, len(gl["terms"]))):
        c.ok(per[g] == n, "%s: %d rows, the datasets hold %d" % (S_GROUPS[g], per[g], n))
    c.ok(per[0] >= 15, "indicators: only %d rows" % per[0])
    n_src = len(ctx.get("mock/projects.json")["items"]) + len(ctx.get("mock/activities.json")["items"]) + len(ctx.get("mock/payments.json")["recipients"])
    n_cat_mock = sum(1 for d in cat["datasets"] if d["status"] == "mock")
    c.ok(per[5] == len(cat["datasets"]) + n_src, "datasets: %d rows, the catalog and the mock sets hold %d" % (per[5], len(cat["datasets"]) + n_src))
    c.ok(n_mock == n_src + n_cat_mock, "mock rows: %d, expected %d" % (n_mock, n_src + n_cat_mock))
    for d in cat["datasets"]:
        r = rows5.get("#/danni/%s" % d["slug"])
        c.ok(r is not None and r[5] == d["status"], "datasets: %s has no row or a different status" % d["slug"])
    entries = [entry(S_GROUPS[r[0]], r[1], r[2], r[7], r[4], r[3], r[5], r[6]) for r in items]
    for q in _POPULAR:
        hits, _hidden, _fz = run(entries, parse(q))
        c.ok(len(hits) > 0, "the popular query %r finds nothing" % q)
    top = {q: run(entries, parse(q))[0][:1] for q in ("МВР", "дълг")}
    c.ok(top["МВР"] and top["МВР"][0]["href"] == "#/vedomstvo/1300", "МВР: the first hit is not the ministry of the interior")
    c.ok(top["дълг"] and top["дълг"][0]["href"].startswith("#/dalg"), "дълг: the first hit is not a debt screen")
    c.fact("%d rows (%s), %d mock" % (len(items), " + ".join("%d %s" % (n, S_GROUPS[g]) for g, n in enumerate(per)), n_mock))
    return c


GROUPS = (("FEED", g_feed, "feed.json: events recomputed from the datasets, highlights and sentences vs the latest report, feed.xml vs the events"),
          ("SEARCH", g_search, "search-index.json: shape, counts and ids tied to the datasets, links resolve, mock rows marked, popular queries find something"))

