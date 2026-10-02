"""MUNIC and SEBRA groups of validate_data.py: municipalities.json (D19 + D20 + D21), geo/obshtini.json and sebra.json (D24).

MUNIC: 265 municipalities, thousand euro of transfers by kind, population (GISCO LAU 2024 with the Dobrich swap corrected), the 28
oblasts, per-capita values, and the boundary file. SEBRA: the daily payment summaries of one ministry, three days of August 2026.
Pure standard library.
"""
import re

import vd_lib as L
from vd_lib import Check, isnum

KHIL = 0.05                     # a printed value in thousand euro has one decimal
ID = re.compile(r"^([A-Z]{3})(\d{2})$")
COLUMNS = ["total", "delegated", "equalizing", "winterRoads", "capital", "otherTargeted"]
PARTS = COLUMNS[1:5]            # the four kinds that add up to `total` (point 1 of art. 51)
POP_TOTAL = 6445481             # Bulgaria on 1 January 2024 (Eurostat; the sum of the GISCO municipality values after the fix)
POP_2025 = 6437360              # Bulgaria on 1 January 2025 (Eurostat demo_r_pjanaggr3, the sum of the 28 oblasts)
BG_BOX = (22.0, 41.0, 29.0, 44.5)
MONTHS = {8: "август"}
CODE = re.compile(r"^\d{2} xxxx$")


def _coords(geom):
    """Every (lon, lat) pair of a Polygon or MultiPolygon."""
    def rings(g):
        return g["coordinates"] if g["type"] == "Polygon" else [r for poly in g["coordinates"] for r in poly]
    for ring in rings(geom):
        for pt in ring:
            yield pt


def g_munic(ctx):
    c = Check("MUNIC")
    m = ctx.get("municipalities.json")
    geo = ctx.get("geo/obshtini.json")
    c.ok(list(m) == ["meta", "year", "populationYear", "columns", "kinds", "note", "perCapitaNote", "nameNote", "popFix", "items", "regions", "totals",
                     "unmatched", "check"], "municipalities keys %s" % list(m))
    me = m["meta"]
    c.ok(me["id"] == "D19+D20+D21" and me["status"] == "real" and me["source"] == ["zdb", "gisco", "eurostat"] and me["unit"] == "хил. €" and me["mock"] is False,
         "meta id / status / source / unit")
    c.ok(m["year"] == 2026 and m["populationYear"] == 2024 and m["columns"] == COLUMNS, "year / populationYear / columns")
    ks = {k["id"]: k for k in m["kinds"]}
    c.ok(list(ks) == COLUMNS and [ks[k].get("partOfTotal") for k in COLUMNS] == [None, True, True, True, True, False], "kinds ids / partOfTotal flags")
    c.ok(all(isinstance(k.get("label"), str) and k["label"].strip() and isinstance(k.get("short"), str) and k["short"].strip() for k in m["kinds"]), "kinds: labels")
    c.ok(all(isinstance(m[k], str) and m[k].strip() for k in ("note", "perCapitaNote", "nameNote")), "note texts")
    # --- popFix: GISCO has the populations of the two Dobrich municipalities interchanged
    pf = m["popFix"]
    c.ok(pf["ids"] == ["DOB15", "DOB28"] and pf["used"] == {"DOB15": pf["gisco"]["DOB28"], "DOB28": pf["gisco"]["DOB15"]}, "popFix: used = gisco, swapped")
    c.ok(pf["areaKm2"]["DOB15"] > pf["areaKm2"]["DOB28"] and pf["used"]["DOB15"] < pf["used"]["DOB28"], "popFix: the rural municipality is the larger one with fewer people")
    # --- items
    items = m["items"]
    ids = [i["id"] for i in items]
    c.ok(len(items) == 265 and len(set(ids)) == 265 and all(ID.match(x) for x in ids), "items: 265 unique ids of the form XXX00")
    dev_row = 0.0
    pop_sum = 0
    sums = dict((k, 0.0) for k in COLUMNS)
    all_sum = 0.0
    manual = []
    for it in items:
        w = "%s %s" % (it["id"], it["name"])
        base = {"id", "name", "region", "regionId", "population", "transfers", "perCapita", "match"}
        c.ok(set(it) == base | ({"lawName"} if it["match"] == "manual" else set()), "%s: keys %s" % (w, sorted(it)))
        c.ok(isinstance(it["name"], str) and it["name"].strip() and isinstance(it["region"], str) and it["region"].strip(), "%s: name / region" % w)
        c.ok(it["regionId"] == it["id"][:3], "%s: regionId %s" % (w, it["regionId"]))
        c.ok(it["match"] in ("exact", "manual") and (it["match"] == "manual") == ("lawName" in it), "%s: match %s / lawName" % (w, it["match"]))
        if it["match"] == "manual":
            manual.append(it["id"])
            c.ok(isinstance(it.get("lawName"), str) and it["lawName"].strip() and it["lawName"] != it["name"], "%s: lawName" % w)
        pop = it["population"]
        c.ok(isinstance(pop, int) and not isinstance(pop, bool) and pop > 0, "%s: population %s" % (w, pop))
        pop_sum += pop if isinstance(pop, int) else 0
        if it["id"] in pf["used"]:
            c.ok(pop == pf["used"][it["id"]], "%s: population %s must equal popFix.used" % (w, pop))
        t = it["transfers"]
        c.ok(list(t) == COLUMNS + ["all"] and all(isnum(t[k]) and t[k] >= 0 for k in t), "%s: transfers keys / values" % w)
        if not all(isnum(t.get(k)) for k in COLUMNS + ["all"]):
            continue
        row = abs(t["total"] - sum(t[k] for k in PARTS))
        dev_row = max(dev_row, row)
        c.ok(row <= 0.26, "%s: total %s differs from its four kinds by %.2f" % (w, t["total"], row))
        c.near(t["all"], t["total"] + t["otherTargeted"], KHIL * 3, "%s: all = total + otherTargeted" % w)
        pc = it["perCapita"]
        c.ok(list(pc) == COLUMNS, "%s: perCapita keys" % w)
        for k in COLUMNS:
            if isinstance(pop, int) and pop > 0 and isnum(pc.get(k)):
                c.near(pc[k], t[k] * 1000.0 / pop, 0.0051, "%s: perCapita.%s" % (w, k))
        for k in COLUMNS:
            sums[k] += t[k]
        all_sum += t["all"]
    c.ok(sorted(manual) == ["DOB15", "KNL04", "SOF46"], "manual matches %s" % sorted(manual))
    # --- oblasts
    regs = m["regions"]
    rid = [r["id"] for r in regs]
    c.ok(len(regs) == 28 and len(set(rid)) == 28 and set(rid) == {i["regionId"] for i in items}, "regions: 28 oblasts, each with municipalities")
    for r in regs:
        w = "oblast %s" % r["id"]
        mine = [i for i in items if i["regionId"] == r["id"]]
        c.ok(r["municipalities"] == len(mine) and all(i["region"] == r["name"] for i in mine), "%s: municipality count / name" % w)
        c.near(r["transfersKhil"], sum(i["transfers"]["total"] for i in mine), KHIL, "%s: transfers = Σ municipalities" % w)
        c.near(r["otherTargetedKhil"], sum(i["transfers"]["otherTargeted"] for i in mine), KHIL, "%s: other targeted = Σ municipalities" % w)
        c.ok(isinstance(r["population2025"], int) and r["population2025"] > 0 and re.match(r"^BG\d{3}$", r["nuts3"]), "%s: population2025 / nuts3" % w)
        pop_r = sum(i["population"] for i in mine)
        c.ok(abs(pop_r - r["population2025"]) < 0.05 * r["population2025"], "%s: municipality population %s is far from the oblast figure %s" % (w, pop_r, r["population2025"]))
    # --- totals
    tt = m["totals"]
    c.ok(tt["count"] == 265 and tt["populationSum"] == pop_sum == POP_TOTAL, "totals.populationSum %s, Σ items %s (expected %s)" % (tt["populationSum"], pop_sum, POP_TOTAL))
    c.ok(tt["population2025Sum"] == sum(r["population2025"] for r in regs) == POP_2025, "totals.population2025Sum")
    c.near(tt["transfersKhil"], sums["total"], 0.5, "totals.transfersKhil = Σ items")
    c.near(tt["otherTargetedKhil"], sums["otherTargeted"], 0.5, "totals.otherTargetedKhil = Σ items")
    c.near(tt["allKhil"], all_sum, 0.5, "totals.allKhil = Σ items")
    c.near(tt["allKhil"], tt["transfersKhil"] + tt["otherTargetedKhil"], KHIL * 3, "totals.allKhil = main + other targeted")
    c.near(sum(r["transfersKhil"] for r in regs), tt["transfersKhil"], 0.5, "Σ oblast transfers = national")
    # --- the stored check block
    ck = m["check"]
    c.ok(ck["populationSumEqualsNational2024"] is True and ck["oblastPopulation2024EqualsEurostat"] is True and ck["populationFixApplied"] is True, "check flags")
    c.ok(len(ck["columnSums"]) == 6 and all(abs(a - sums[k]) <= 0.5 for a, k in zip(ck["columnSums"], COLUMNS)), "check.columnSums %s vs %s" % (ck["columnSums"], [round(sums[k], 1) for k in COLUMNS]))
    c.near(ck["rowSumMaxDev"], dev_row, 0.0051, "check.rowSumMaxDev")
    c.ok(sorted(x.split(" = ")[0] for x in ck["manualMatches"]) == sorted(["Добричка", "Бобовдол", "СТОЛИЧНА ОБЩИНА"]) and m["unmatched"] == [], "check.manualMatches / unmatched")
    # --- the boundaries
    gm = geo["meta"]
    c.ok(gm["id"] == "D20" and gm["status"] == "real" and gm["source"] == ["gisco"] and geo["type"] == "FeatureCollection", "geo meta / type")
    feats = geo["features"]
    gids = [f["properties"]["id"] for f in feats]
    c.ok(len(feats) == 265 and len(set(gids)) == 265 and set(gids) == set(ids), "geo: 265 unique features with the ids of municipalities.json")
    names = dict((i["id"], i["name"]) for i in items)
    n_pts = 0
    for f in feats:
        p = f["properties"]
        c.ok(set(p) == {"id", "name"} and p["name"] == names.get(p["id"]), "geo %s: properties %s" % (p.get("id"), p))
        g = f["geometry"]
        c.ok(g["type"] in ("Polygon", "MultiPolygon") and g["coordinates"], "geo %s: geometry" % p["id"])
        bad = [pt for pt in _coords(g) if not (isnum(pt[0]) and isnum(pt[1]) and BG_BOX[0] <= pt[0] <= BG_BOX[2] and BG_BOX[1] <= pt[1] <= BG_BOX[3])]
        n_pts += sum(1 for _ in _coords(g))
        c.ok(not bad, "geo %s: coordinates outside Bulgaria: %s" % (p["id"], bad[:2]))
    c.ok(geo.get("idProperty") == "id", "geo.idProperty")
    # --- the mock municipal finance (DATA2) must describe the same 265 municipalities
    if L.exists("mock/municipal-finance.json"):
        mf = ctx.get("mock/municipal-finance.json")
        by = dict((i["id"], i) for i in mf["items"])
        c.ok(set(by) == set(ids), "mock/municipal-finance.json: the same 265 ids")
        c.ok(all(by[i["id"]]["population"] == i["population"] for i in items if i["id"] in by), "mock/municipal-finance.json: population equals municipalities.json")
        c.ok(all(by[i["id"]]["region"] == i["region"] and by[i["id"]]["name"] == i["name"] for i in items if i["id"] in by), "mock/municipal-finance.json: names / oblast")
    c.fact("%d municipalities in 28 oblasts, transfers %s thousand euro (+ %s other targeted), population %s, %d boundary points, %d manual name matches" % (
        len(items), L.fmt(tt["transfersKhil"]), L.fmt(tt["otherTargetedKhil"]), L.fmt(pop_sum, 0), n_pts, len(manual)))
    return c


def _money(c, a, b, msg):
    return c.near(a, b, 0.011, msg)


def _by_code(rows):
    return dict((r["code"], (r["count"], r["eur"])) for r in rows)


def g_sebra(ctx):
    c = Check("SEBRA")
    s = ctx.get("sebra.json")
    c.ok(list(s) == ["meta", "period", "ministry", "ministryPrinted", "ministryCode", "publisher", "total", "byCode", "byOrganisation", "days", "overall",
                     "overallLabel", "publication", "notes", "check"], "sebra keys %s" % list(s))
    me = s["meta"]
    c.ok(me["id"] == "D24" and me["status"] == "real" and me["source"] == ["sebra"] and me["unit"] == "€" and me["mock"] is False, "meta id / status / source / unit")
    days = s["days"]
    c.ok(len(days) == 3 and [d["date"] for d in days] == sorted(d["date"] for d in days) and all(L.ISO.match(d["date"]) for d in days), "days: three ISO dates in order")
    last = days[-1]
    c.ok(me["asOf"] == last["date"] == s["period"]["to"] == s["period"]["from"] and me["asOf"] <= L.BUILD_DATE, "meta.asOf / period must be the latest published day")
    for d in days:
        w = "day %s" % d["date"]
        y, mo, dd = [int(x) for x in d["date"].split("-")]
        c.ok(d["label"] == "%d %s %d г." % (dd, MONTHS.get(mo, "?"), y), "%s: label %r" % (w, d["label"]))
        c.ok(d["count"] == sum(r["count"] for r in d["byCode"]) == sum(r["count"] for r in d["byOrganisation"]), "%s: counts add up" % w)
        _money(c, d["eur"], sum(r["eur"] for r in d["byCode"]), w + ": eur = Σ categories")
        _money(c, d["eur"], sum(r["eur"] for r in d["byOrganisation"]), w + ": eur = Σ organisations")
        c.ok(len({r["code"] for r in d["byCode"]}) == len(d["byCode"]) and all(CODE.match(r["code"]) and r["name"].strip() for r in d["byCode"]), "%s: category codes" % w)
        for o in d["byOrganisation"]:
            c.ok(o["count"] == sum(r["count"] for r in o["byCode"]), "%s %s: counts by category" % (w, o["name"]))
            _money(c, o["eur"], sum(r["eur"] for r in o["byCode"]), "%s %s: eur by category" % (w, o["name"]))
        for k in ("count", "eur"):
            c.ok(isnum(d[k]) and d[k] > 0, "%s: %s" % (w, k))
    # the headline block is the latest day
    c.ok(s["total"] == {"count": last["count"], "eur": last["eur"]} and s["byCode"] == last["byCode"] and s["byOrganisation"] == last["byOrganisation"],
         "total / byCode / byOrganisation must equal the latest day")
    # all published days together
    ov = s["overall"]
    c.ok(ov["count"] == sum(d["count"] for d in days), "overall.count %s" % ov["count"])
    _money(c, ov["eur"], sum(d["eur"] for d in days), "overall.eur = Σ days")
    acc = {}
    for d in days:
        for r in d["byCode"]:
            a = acc.setdefault(r["code"], [0, 0.0])
            a[0] += r["count"]
            a[1] += r["eur"]
    got = _by_code(ov["byCode"])
    c.ok(set(got) == set(acc) and all(got[k][0] == acc[k][0] and abs(got[k][1] - acc[k][1]) <= 0.011 for k in acc), "overall.byCode must be the Σ of the days")
    c.ok(ov["count"] == sum(v[0] for v in got.values()), "overall.byCode counts")
    c.ok(isinstance(s["overallLabel"], str) and "не на целия месец" in s["overallLabel"], "overallLabel must say it is not the whole month")
    # the published files
    pub = s["publication"]
    fs = pub["files"]
    c.ok([f["day"] for f in fs] == [d["date"] for d in days] and all(f["parsed"] is True for f in fs), "publication.files: one parsed file per day")
    for f in fs:
        c.ok(isinstance(f["bytes"], int) and f["bytes"] > 0 and abs(f["sizeKb"] - f["bytes"] / 1024.0) <= 0.0051 and f["format"] == "xlsx", "file %s: size / format" % f["day"])
        c.ok(L.ISO.match(f["listedOn"]) and f["day"] <= f["listedOn"] <= L.BUILD_DATE, "file %s: listedOn %s" % (f["day"], f["listedOn"]))
    c.ok(pub["page"].startswith("https://") and L.ISO.match(pub["retrieved"]) and pub["retrieved"] <= L.BUILD_DATE and L.ISO.match(pub["sectionPublished"]), "publication page / dates")
    ck = s["check"]
    c.ok(ck == {"daysParsed": len(days), "daysListed": len(fs), "categoriesAddUp": True, "organisationsAddUp": True, "fileSizesMatchListing": True},
         "check block %s" % ck)
    c.ok(len(s["notes"]) == 4 and all(isinstance(n, str) and n.strip() for n in s["notes"]), "notes: four statements")
    c.ok(any("не е пълният месец" in n for n in s["notes"]), "the notes must say that three days are not the whole month")
    c.ok(all(isinstance(s[k], str) and s[k].strip() for k in ("ministry", "ministryPrinted", "ministryCode", "publisher")), "ministry / publisher texts")
    c.fact("%d days (%s .. %s), %d payments / %s euro in all, latest day %d / %s euro" % (
        len(days), days[0]["date"], last["date"], ov["count"], L.fmt(ov["eur"], 2), last["count"], L.fmt(last["eur"], 2)))
    return c


GROUPS = (
    ("MUNIC", g_munic, "municipalities.json + geo: 265 municipalities, transfers by kind, population (GISCO fix), 28 oblasts, boundaries"),
    ("SEBRA", g_sebra, "sebra.json: daily payment summaries add up by category and by organisation, files and check block"),
)
