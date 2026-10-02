"""municipalities.json (D19 + D20 + D21) and geo/obshtini.json (D20): transfers, population and borders of the 265 municipalities.

Sources, all read from caches/prototype inputs (no network):
  * ЗДБ 2026 чл. 51 (law_bill.json -> municipal.art51; cross-checked row by row against prototype/src/municipal_transfers_2026.json);
  * Eurostat GISCO LAU 2024 (gisco_lau_bg.json): id, official name, population on 01.01.2024, borders;
  * Eurostat demo_r_pjanaggr3 (eurostat_pop_nuts3_bg.json): population of the 28 oblasts, 2025.

Facts that are checked, not assumed: the 265 law rows match the 265 LAU ids one to one (names, region), the law's column sums equal the
printed total row, total = delegated + equalizing + winterRoads + capital in every row (a blank cell is then a real zero), the LAU
population adds up to the national figure of 01.01.2024, the oblast mapping LAU prefix <-> NUTS3 reproduces Eurostat's 2024 population of
every oblast exactly. The borders are rounded to 3 decimals and thinned (Douglas-Peucker, 0.0005 deg ~ 50 m) to fit the 400 KB budget; the
area of every municipality is compared before/after.
"""
import math
import re

from bd_common import fmt_num
from dlib import isnum, jsonstat_series, meta, rnd

# (LAU id prefix, oblast as printed in the law, display name, NUTS3). The data decide whether this table is right (see _check_regions).
REGIONS = [
    ("BLG", "ОБЛАСТ БЛАГОЕВГРАД", "Благоевград", "BG413"), ("BGS", "ОБЛАСТ БУРГАС", "Бургас", "BG341"),
    ("VAR", "ОБЛАСТ ВАРНА", "Варна", "BG331"), ("VTR", "ОБЛАСТ ВЕЛИКО ТЪРНОВО", "Велико Търново", "BG321"),
    ("VID", "ОБЛАСТ ВИДИН", "Видин", "BG311"), ("VRC", "ОБЛАСТ ВРАЦА", "Враца", "BG313"),
    ("GAB", "ОБЛАСТ ГАБРОВО", "Габрово", "BG322"), ("DOB", "ОБЛАСТ ДОБРИЧ", "Добрич", "BG332"),
    ("KRZ", "ОБЛАСТ КЪРДЖАЛИ", "Кърджали", "BG425"), ("KNL", "ОБЛАСТ КЮСТЕНДИЛ", "Кюстендил", "BG415"),
    ("LOV", "ОБЛАСТ ЛОВЕЧ", "Ловеч", "BG315"), ("MON", "ОБЛАСТ МОНТАНА", "Монтана", "BG312"),
    ("PAZ", "ОБЛАСТ ПАЗАРДЖИК", "Пазарджик", "BG423"), ("PER", "ОБЛАСТ ПЕРНИК", "Перник", "BG414"),
    ("PVN", "ОБЛАСТ ПЛЕВЕН", "Плевен", "BG314"), ("PDV", "ОБЛАСТ ПЛОВДИВ", "Пловдив", "BG421"),
    ("RAZ", "ОБЛАСТ РАЗГРАД", "Разград", "BG324"), ("RSE", "ОБЛАСТ РУСЕ", "Русе", "BG323"),
    ("SLS", "ОБЛАСТ СИЛИСТРА", "Силистра", "BG325"), ("SLV", "ОБЛАСТ СЛИВЕН", "Сливен", "BG342"),
    ("SML", "ОБЛАСТ СМОЛЯН", "Смолян", "BG424"), ("SOF", "ОБЛАСТ СОФИЯ (СТОЛИЦА)", "София (столица)", "BG411"),
    ("SFO", "ОБЛАСТ СОФИЙСКА", "Софийска", "BG412"), ("SZR", "ОБЛАСТ СТАРА ЗАГОРА", "Стара Загора", "BG344"),
    ("TGV", "ОБЛАСТ ТЪРГОВИЩЕ", "Търговище", "BG334"), ("HKV", "ОБЛАСТ ХАСКОВО", "Хасково", "BG422"),
    ("SHU", "ОБЛАСТ ШУМЕН", "Шумен", "BG333"), ("JAM", "ОБЛАСТ ЯМБОЛ", "Ямбол", "BG343"),
]
# law spelling -> LAU id, for the three names that differ from the official one after normalising case, quotes and hyphens
MANUAL = {("ОБЛАСТ ДОБРИЧ", "Добричка"): "DOB15", ("ОБЛАСТ КЮСТЕНДИЛ", "Бобовдол"): "KNL04",
          ("ОБЛАСТ СОФИЯ (СТОЛИЦА)", "СТОЛИЧНА ОБЩИНА"): "SOF46"}
COLS = ["total", "delegated", "equalizing", "winterRoads", "capital", "otherTargeted"]
KINDS = [
    {"id": "total", "label": "Основни бюджетни взаимоотношения (т. 1 от чл. 51): сборът на първите четири вида", "short": "Общо основни трансфери"},
    {"id": "delegated", "label": "Обща субсидия за делегираните от държавата дейности", "short": "Делегирани дейности", "partOfTotal": True},
    {"id": "equalizing", "label": "Обща изравнителна субсидия", "short": "Изравнителна субсидия", "partOfTotal": True},
    {"id": "winterRoads", "label": "За зимно поддържане и снегопочистване на общински пътища", "short": "Зимно поддържане", "partOfTotal": True},
    {"id": "capital", "label": "Целева субсидия за капиталови разходи", "short": "Капиталови разходи", "partOfTotal": True},
    {"id": "otherTargeted", "label": "Трансфери за други целеви разходи за местни дейности (т. 2 от чл. 51)", "short": "Други целеви разходи",
     "partOfTotal": False},
]
GEO_ND = 3            # decimals of the published coordinates
GEO_EPS = 0.0005      # Douglas-Peucker tolerance in degrees (~ 50 m)
GEO_MAX_AREA_DEV = 0.02


DOBRICH = ("DOB15", "DOB28")      # Добрич-селска (1 294,9 km2) and Добрич, the city municipality (109,0 km2)


def _fix_dobrich(gis):
    """Eurostat GISCO's LAU table carries the population of the two Dobrich municipalities interchanged: the rural one (1 294,9 km2) is
    recorded with 70 411 residents and the city one (109,0 km2) with 17 232. The city municipality is the more populous one, so the two
    values are put back (the national and oblast sums do not change). Returns None when the table is already right, so a corrected GISCO
    release makes the fix switch itself off. Modifies `gis` in place."""
    by = {i["id"]: i for i in gis}
    rural, city = by[DOBRICH[0]], by[DOBRICH[1]]
    if rural["areaKm2"] < 5 * city["areaKm2"]:
        raise ValueError("the Dobrich areas are not what the population correction assumes")
    if rural["pop"] < city["pop"]:
        return None
    old = {rural["id"]: rural["pop"], city["id"]: city["pop"]}
    rural["pop"], city["pop"] = city["pop"], rural["pop"]
    return {"ids": list(DOBRICH), "gisco": old, "used": {rural["id"]: rural["pop"], city["id"]: city["pop"]},
            "areaKm2": {rural["id"]: rural["areaKm2"], city["id"]: city["areaKm2"]}}


def _norm(s):
    s = re.sub(r"[„“”\"«»]", "", s).lower().replace("ё", "е")
    return re.sub(r"[\s\-–—]+", " ", s).strip()


def _num(v):
    return 0.0 if v is None else float(v)


# =================================================================================================== borders
def _dp(points, eps):
    n = len(points)
    if n < 3:
        return points[:]
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            if l2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(points, keep) if k]


def _ring(ring):
    """Round, drop repeated points, thin out; the ring stays closed. Returns [] for a ring that collapses."""
    pts = []
    for x, y in ring:
        p = [round(x, GEO_ND), round(y, GEO_ND)]
        if not pts or pts[-1] != p:
            pts.append(p)
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    if len(pts) > 5:
        far = max(range(len(pts) - 1), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
        a, b = _dp(pts[:far + 1], GEO_EPS), _dp(pts[far:], GEO_EPS)
        pts = a[:-1] + b
    return pts if len(pts) >= 4 else []


def _area(rings):
    """Shoelace area (square degrees) of a polygon given as [outer, hole, ...]."""
    def one(r):
        return 0.5 * sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1))
    return abs(one(rings[0])) - sum(abs(one(r)) for r in rings[1:])


def _geometry(items):
    feats, worst, npts = [], 0.0, 0
    for it in items:
        polys, a_in, a_out = [], 0.0, 0.0
        for poly in it["rings"]:
            a_in += _area(poly)
            rs = [_ring(r) for r in poly]
            if not rs[0]:
                continue                              # the outer ring vanished: a speck, dropped
            rs = [r for r in rs if r]
            polys.append(rs)
            a_out += _area(rs)
            npts += sum(len(r) for r in rs)
        if not polys:
            raise ValueError("geometry of %s collapsed" % it["id"])
        dev = abs(a_out - a_in) / a_in
        worst = max(worst, dev)
        if dev > GEO_MAX_AREA_DEV:
            raise ValueError("geometry of %s changed its area by %.1f %%" % (it["id"], 100 * dev))
        geom = ({"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1
                else {"type": "MultiPolygon", "coordinates": polys})
        feats.append({"type": "Feature", "properties": {"id": it["id"], "name": it["name"]}, "geometry": geom})
    return feats, worst, npts


# =================================================================================================== build
def _check_regions(ctx, gis, est):
    """The hand-typed oblast table must be reproduced by the data: LAU sums == Eurostat 2024 per oblast."""
    codes = [r[0] for r in REGIONS]
    if sorted(codes) != sorted({i["id"][:3] for i in gis}) or len(set(codes)) != 28:
        raise ValueError("the LAU id prefixes differ from the oblast table")
    pop24 = {c: 0 for c in codes}
    for i in gis:
        pop24[i["id"][:3]] += i["pop"]
    out = {}
    for code, _law, _name, n3 in REGIONS:
        s = jsonstat_series(est, "time", {"geo": n3})
        if pop24[code] != s["2024"][0]:
            raise ValueError("oblast %s (%s): LAU 2024 population %d != Eurostat %s" % (code, n3, pop24[code], s["2024"][0]))
        out[code] = int(s["2025"][0])
    return pop24, out


def build_municipalities(ctx):
    art = ctx.law["municipal"]["art51"]
    if art["cols"] != COLS:
        raise ValueError("art. 51 columns changed: %r" % art["cols"])
    law_rows, law_total = art["law"]["rows"], art["law"]["total"]
    proto = ctx.src("municipal_transfers_2026")
    gis_cache = ctx.cache("gisco_lau_bg.json")
    gis = sorted(gis_cache["items"], key=lambda i: i["id"])
    pop_fix = _fix_dobrich(gis)
    est_cache = ctx.cache("eurostat_pop_nuts3_bg.json")
    if len(law_rows) != 265 or len(gis) != 265 or len(proto["municipalities"]) != 265:
        raise ValueError("expected 265 municipalities, got law %d / GISCO %d / prototype %d" % (len(law_rows), len(gis), len(proto["municipalities"])))

    # ----------------------------------------------------------------------------- the law table, twice
    pk = ["total", "delegated", "equalizing", "winter_roads", "capital", "other_targeted"]
    for r, p in zip(law_rows, proto["municipalities"]):
        # the prototype table has no oblast for the capital (it is its own oblast), hence the None test
        if (p["region"] is not None and r["region"] != p["region"]) or _norm(r["name"]) != _norm(p["name"]) \
                or [_num(v) for v in r["values"]] != [_num(p[k]) for k in pk]:
            raise ValueError("art. 51 row %r differs between the law parse and the prototype table" % r["name"])
    sums = [rnd(sum(_num(r["values"][c]) for r in law_rows), 1) for c in range(6)]
    if sums != [rnd(v, 1) for v in law_total] or sums != [rnd(proto["sums"][k], 1) for k in pk]:
        raise ValueError("art. 51 column sums %r differ from the printed total row %r" % (sums, law_total))
    worst_row = 0.0
    for r in law_rows:
        v = [_num(x) for x in r["values"]]
        worst_row = max(worst_row, abs(v[0] - (v[1] + v[2] + v[3] + v[4])))
    if worst_row > 0.05:
        raise ValueError("a row of art. 51 does not add up (%.2f)" % worst_row)

    # ----------------------------------------------------------------------------- identities and regions
    nat = ctx.src("population")
    nat_by_year = dict(zip(nat["years"], nat["persons"]))
    pop_sum = sum(i["pop"] for i in gis)
    if pop_sum != gis_cache["populationSum"] or pop_sum != nat_by_year["2024"]:
        raise ValueError("LAU population %d is not the national figure of 01.01.2024 (%s)" % (pop_sum, nat_by_year.get("2024")))
    pop24, pop25 = _check_regions(ctx, gis, est_cache["jsonstat"])
    if sum(pop25.values()) != nat_by_year["2025"]:
        raise ValueError("oblast population 2025 does not add up to the national %s" % nat_by_year["2025"])
    code_of = {r[1]: r[0] for r in REGIONS}
    name_of = {r[0]: r[2] for r in REGIONS}
    if sorted(code_of) != sorted({r["region"] for r in law_rows}):
        raise ValueError("the oblasts of the law differ from the oblast table")

    by_id = {i["id"]: i for i in gis}
    used, items, manual = set(), [], []
    for r in law_rows:
        code = code_of[r["region"]]
        key = (r["region"], r["name"])
        if key in MANUAL:
            lid, how = MANUAL[key], "manual"
        else:
            cand = [i["id"] for i in gis if i["id"][:3] == code and _norm(i["name"]) == _norm(r["name"])]
            if len(cand) != 1:
                raise ValueError("municipality %r (%s): %d GISCO matches" % (r["name"], r["region"], len(cand)))
            lid, how = cand[0], "exact"
        if lid in used or lid[:3] != code:
            raise ValueError("municipality %r matched wrongly to %s" % (r["name"], lid))
        used.add(lid)
        g = by_id[lid]
        v = [_num(x) for x in r["values"]]
        tr = {c: rnd(x, 1) for c, x in zip(COLS, v)}
        tr["all"] = rnd(v[0] + v[5], 1)
        pc = {c: rnd(tr[c] * 1000.0 / g["pop"], 2) for c in COLS}
        it = {"id": lid, "name": g["name"]}
        if how == "manual" or _norm(r["name"]) != _norm(g["name"]):
            it["lawName"] = r["name"]
        it.update({"region": name_of[code], "regionId": code, "population": g["pop"], "transfers": tr, "perCapita": pc, "match": how})
        items.append(it)
        if how == "manual":
            manual.append("%s = %s" % (r["name"], g["name"]))
    if len(used) != 265:
        raise ValueError("only %d of 265 LAU ids were matched" % len(used))
    items.sort(key=lambda i: i["id"])
    for i in items:                         # a population that is off by a factor shows up as a per-resident outlier
        if i["id"] in DOBRICH and not 300 <= i["transfers"]["all"] * 1000.0 / i["population"] <= 2000:
            raise ValueError("%s: %.0f EUR of transfers per resident is not plausible" % (i["id"], i["transfers"]["all"] * 1000.0 / i["population"]))

    # ----------------------------------------------------------------------------- oblasts (D21)
    regions = []
    for code, _law, name, n3 in sorted(REGIONS, key=lambda r: r[2]):
        mine = [i for i in items if i["regionId"] == code]
        regions.append({"id": code, "nuts3": n3, "name": name, "municipalities": len(mine), "population2025": pop25[code],
                        "transfersKhil": rnd(sum(i["transfers"]["total"] for i in mine), 1),
                        "otherTargetedKhil": rnd(sum(i["transfers"]["otherTargeted"] for i in mine), 1)})
    totals = {"count": 265, "transfersKhil": sums[0], "otherTargetedKhil": sums[5], "allKhil": rnd(sums[0] + sums[5], 1),
              "populationSum": pop_sum, "population2025Sum": sum(pop25.values())}
    if abs(sum(r["transfersKhil"] for r in regions) - totals["transfersKhil"]) > 0.05:
        raise ValueError("oblast sums differ from the national total")

    note = ("Трансферите са по чл. 51 от Закона за държавния бюджет за 2026 г. (ДВ бр. 69 от 31.07.2026 г.). „Общо“ са основните бюджетни "
            "взаимоотношения (т. 1): делегирани дейности, изравнителна субсидия, зимно поддържане и капиталови разходи. Трансферите за други "
            "целеви разходи (т. 2) са отделно и не са в „Общо“; „Общо с други целеви“ е сборът на двете. Празна клетка в закона е нула.")
    per_note = ("На жител е трансферът, разделен на населението на общината към 1 януари 2024 г. (Eurostat GISCO, LAU 2024): последното "
                "население, което се публикува по общини. За областите е показано и населението към 1 януари 2025 г. (Eurostat).")
    if pop_fix:
        nat_pc = (sums[0] + sums[5]) * 1000.0 / pop_sum
        tr_all = {i["id"]: i["transfers"]["all"] for i in items}
        wr = {k: tr_all[k] * 1000.0 / pop_fix["gisco"][k] for k in DOBRICH}      # per resident with the population as GISCO has it
        pop_fix["note"] = (
            "В таблицата на Eurostat GISCO населението на Добрич и на Добрич-селска е записано разменено: на селската община (%s км²) са "
            "записани %s души, а на градската (%s км²) — %s. Тук числата са върнати на мястото им; общото население на страната и на "
            "областта не се променя. Основания: градската община (град Добрич) е най-големият населен пункт в областта, а с разменените "
            "числа тя би получавала %s € трансфер на жител — %s пъти повече от средното за страната (%s €), докато селската — само %s €." % (
                fmt_num(pop_fix["areaKm2"][DOBRICH[0]], 1), fmt_num(pop_fix["gisco"][DOBRICH[0]]), fmt_num(pop_fix["areaKm2"][DOBRICH[1]], 1),
                fmt_num(pop_fix["gisco"][DOBRICH[1]]), fmt_num(wr[DOBRICH[1]]), fmt_num(wr[DOBRICH[1]] / nat_pc, 1), fmt_num(nat_pc),
                fmt_num(wr[DOBRICH[0]])))
    name_note = ("Имената са по официалния списък на НСИ (чрез Eurostat GISCO). В закона три общини са изписани различно: „Добричка“ "
                 "(Добрич-селска), „Столична община“ (Столична) и „Бобовдол“ (Бобов дол); старото изписване е в полето lawName.")
    obj = {
        "meta": meta("D19+D20+D21", "Трансфери към общините, население и области", source=["zdb", "gisco", "eurostat"],
                     source_note="ЗДБ 2026, чл. 51 (ДВ бр. 69 от 31.07.2026 г.); население по общини: Eurostat GISCO LAU 2024 (към 01.01.2024); "
                                 "население по области: Eurostat demo_r_pjanaggr3 (към 01.01.2025, обновено %s)" % est_cache["updated"][:10],
                     as_of="2026-07-31", unit="хил. €"),
        "year": 2026,
        "populationYear": 2024,
        "columns": list(COLS),
        "kinds": KINDS,
        "note": note,
        "perCapitaNote": per_note,
        "nameNote": name_note,
        **({"popFix": pop_fix} if pop_fix else {}),
        "items": items,
        "regions": regions,
        "totals": totals,
        "unmatched": [],
        "check": {"rowSumMaxDev": rnd(worst_row, 3), "columnSums": sums, "manualMatches": manual,
                  "populationSumEqualsNational2024": True, "oblastPopulation2024EqualsEurostat": True,
                  "populationFixApplied": pop_fix is not None},
    }
    ctx.put("municipalities.json", obj)

    # ----------------------------------------------------------------------------- borders
    feats, dev, npts = _geometry(gis)
    ctx.put("geo/obshtini.json", {
        "type": "FeatureCollection",
        "meta": meta("D20", "Граници на общините (GeoJSON, WGS84)", source=["gisco"],
                     source_note="Eurostat GISCO, LAU 2024 (LAU_RG_01M_2024_4326), България; координатите са закръглени до %d знака и "
                                 "опростени (допуск около 50 метра)" % GEO_ND, as_of="2024-01-01"),
        "idProperty": "id",
        "features": feats})
    ctx.notes.append("municipalities: 265 matched (%d manual), transfers %.1f, borders %d points, worst area change %.2f %%" % (
        len(manual), sums[0], npts, 100 * dev))
    return obj
