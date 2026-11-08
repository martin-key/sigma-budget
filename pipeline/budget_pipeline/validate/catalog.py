"""CORE and CATALOG groups of base.py.

CORE: core.json copies numbers that other datasets own (KPIs, counts, functions, revenue groups, population); every copy is
compared with its owner. CATALOG: catalog.json describes every file of data/release; each statement is compared with the file.
Pure standard library.
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import glob
import os
import re

import budget_pipeline.validate.checks as L
from budget_pipeline.validate.search_feed import MONTHS
from budget_pipeline.validate.checks import Check, fmt, isnum

SOURCE_KEYS = ("kfp", "asbp", "bill", "zdb", "zbdoo", "zbnzok", "prb", "parliament", "eurostat", "bnb", "nap", "sebra",
               "gisco", "dataeuropa", "minfin", "wg", "mockgen")
SOURCE_KINDS = ("xls", "pdf", "html", "doc", "api", "generator")
SOURCE_ACCESS = ("open", "browser-only", "none")
SHA = re.compile(r"^[0-9a-f]{64}$")
FORMATS = {"JSON": "application/json", "GeoJSON": "application/geo+json", "RSS": "application/rss+xml"}
DATA_ID = re.compile(r"^[DMP]\d\d$")
INTERNAL = ("gdoc", "lovable", "artifact-files", "sources/", "/lov", "state/", "scripts/", "playbook")


def _pct(a, b, nd):
    return round(100.0 * a / b, nd)


# ------------------------------------------------------------------------------------------------------- CORE
def g_core(ctx):
    c = Check("CORE")
    core = ctx.get("core.json")
    ex, o, e, r = ctx.get("execution.json"), ctx.get("outlook.json"), ctx.get("expenditure.json"), ctx.get("revenue.json")
    debt, mins, progs = ctx.get("debt.json"), ctx.get("ministries.json"), ctx.get("programs.json")
    gl, mu, me = ctx.get("glossary.json"), ctx.get("municipalities.json"), ctx.get("measures.json")
    c.ok(set(core) == {"meta", "build", "years", "sources", "pending", "counts", "population", "kpis", "functions", "revenueGroups"},
         "core keys %s" % sorted(core))
    # --- build
    b = core["build"]
    c.ok(re.match(r"^\d{4}-\d{2}-\d{2}\.\d+$", b["dataVersion"]) is not None and b["dataVersion"].startswith(L.BUILD_DATE), "build.dataVersion %r" % b["dataVersion"])
    c.ok(b["kfpLatest"] == ex["latest"]["asOf"] == core["kpis"]["asOf"] == core["meta"]["asOf"], "build.kfpLatest / kpis.asOf / meta.asOf must equal execution.latest.asOf")
    c.ok(b["kfpMonths2026"] == len(ex["data"]["2026"]["months"]) if isinstance(ex["data"]["2026"]["months"], list) else b["kfpMonths2026"] == ex["data"]["2026"]["months"],
         "build.kfpMonths2026")
    c.ok(b["kfpMonths2026"] == ex["latest"]["month"] == core["kpis"]["month"], "kfpMonths2026 vs execution.latest.month vs kpis.month")
    nxt = ex["pendingMonths"][0]
    c.ok(b["kfpNext"] == nxt["asOf"] and nxt["month"] == b["kfpMonths2026"] % 12 + 1, "build.kfpNext must be the first pending month of execution.json")
    c.ok(b["eurRate"] == 1.95583, "build.eurRate %s" % b["eurRate"])
    c.ok(core["years"]["list"] == o["years"] and [core["years"]["vintage"][str(y)] for y in o["years"]] == o["vintage"], "years must equal outlook")
    # --- sources
    src = core["sources"]
    c.ok(sorted(src) == sorted(SOURCE_KEYS), "sources: keys %s" % sorted(src))
    for k, s in src.items():
        c.ok(all(isinstance(s.get(x), str) and s[x].strip() for x in ("title", "publisher", "kind", "access")), "source %s: title/publisher/kind/access" % k)
        c.ok(s.get("kind") in SOURCE_KINDS and s.get("access") in SOURCE_ACCESS, "source %s: kind %r / access %r" % (k, s.get("kind"), s.get("access")))
        if s.get("url"):
            c.ok(s["url"].startswith("https://"), "source %s: url %r" % (k, s["url"]))
        c.ok(set(s) <= {"title", "publisher", "url", "kind", "access", "note"}, "source %s: keys %s" % (k, sorted(s)))
    # --- pending blocks P01-P07
    routes = ctx.routes().routes
    c.ok(sorted(core["pending"]) == ["P0%d" % i for i in range(1, 8)], "pending ids %s" % sorted(core["pending"]))
    for k, p in core["pending"].items():
        c.ok(p["status"] == "pending" and p["id"] == k and all(isinstance(p.get(x), str) and p[x].strip() for x in ("title", "reason", "expected")), "pending %s: shape" % k)
        c.ok(p["source"] and all(x in src for x in p["source"]), "pending %s: source keys" % k)
        c.ok(p["screens"] and all(x in routes for x in p["screens"]), "pending %s: screens %s" % (k, p["screens"]))
    # P04 names the next report and the last one added (definitions.set_kfp_pending), never a month written into the code
    p04, ny = core["pending"].get("P04", {}), nxt["asOf"][:4]
    c.ok(p04.get("title", "").startswith("Отчетът към %s г." % ".".join(reversed(nxt["asOf"].split("-"))))
         and "за %s %s г. още не е добавен" % (MONTHS[nxt["month"] - 1], ny) in p04.get("reason", "")
         and p04.get("reason", "").endswith("е за %s %s г." % (MONTHS[ex["latest"]["month"] - 1], ex["latest"]["asOf"][:4])),
         "pending P04 must name the pending report %s and the latest %s" % (nxt["asOf"], ex["latest"]["asOf"]))
    # --- counts
    n = core["counts"]
    mfiles = [f for f in L.json_files() if f.startswith("ministries/")]
    kfp_reports = sum(len(ex["data"][y]["files"]) for y in ex["data"])
    want = {"functions": len(e["functions"]["items"]), "budgets": len(mins["items"]), "programBudgets": len(mfiles),
            "programs": len(progs["items"]), "terms": len(gl["terms"]), "municipalities": len(mu["items"]), "measures": len(me["items"]),
            "kfpReports": kfp_reports}
    c.ok(n == want, "counts %s differ from the datasets %s" % (n, want))
    c.ok(mins["totals"]["count"] == n["budgets"] and mins["programTotals"]["budgets"] == n["programBudgets"], "counts vs ministries.json totals")
    c.ok(mu["totals"].get("count", n["municipalities"]) == n["municipalities"], "counts.municipalities vs municipalities.totals")
    # --- population (D18)
    p = core["population"]
    ser = p["series"]
    c.ok(len(ser["years"]) == len(ser["persons"]) == 7 and ser["years"] == list(range(2020, 2027)) and all(isnum(x) and x > 6e6 for x in ser["persons"]), "population.series shape")
    c.ok(p["persons"] == ser["persons"][-1] and p["year"] == ser["years"][-1] == 2026 and p["date"] == "2026-01-01", "population: persons/year/date vs the series")
    pro = ctx.proto("src/population.json")
    c.ok([int(x) for x in pro["years"]] == ser["years"] and pro["persons"] == ser["persons"], "population.series must equal the frozen Eurostat series")
    # --- KPIs copied from their owners
    k = core["kpis"]
    lat = ex["latest"]["kfp"]
    for key, row in (("revenue", "rev"), ("expenditure", "exp.total"), ("balance", "balance"), ("capex", "exp.capex")):
        q, w = k[key], lat[row]
        c.ok(q["planMln"] == w["plan"] and q["execMln"] == w["cum"], "kpis.%s: planMln/execMln vs execution.latest.%s" % (key, row))
        if key != "balance":
            c.ok(q["execPct"] == w["pctPlan"] and q.get("yoyPct") == w.get("yoyPct"), "kpis.%s: execPct/yoyPct" % key)
        if key in ("revenue", "expenditure", "balance"):
            c.ok(q["prevYearMln"] == w["prevYearCum"], "kpis.%s: prevYearMln" % key)
        c.ok(q["href"].startswith("#/") and ctx.routes().match(q["href"]) is not None, "kpis.%s: href %r matches no route" % (key, q["href"]))
    c.ok(k["revenue"]["planMln"] == o["kfp"]["revenue"]["mln"][2] and k["expenditure"]["planMln"] == o["kfp"]["expenditure"]["mln"][2]
         and k["balance"]["planMln"] == o["kfp"]["balance"]["mln"][2], "kpis plan values must equal Annex 3 2026 (outlook)")
    c.near(k["capex"]["pctGdp"], 100.0 * k["capex"]["planMln"] / o["gdp"]["mlnPrecise"][2], 0.006, "kpis.capex.pctGdp")
    g = k["gdp"]
    c.ok(g["mln"] == o["gdp"]["mln"][2] and g["mlnPrecise"] == o["gdp"]["mlnPrecise"][2] and g["year"] == 2026 and g["vintage"] == "plan", "kpis.gdp vs outlook")
    z = debt["zdd"]
    c.ok(k["debt"]["zddMln"] == z["totalMln"][2] and k["debt"]["pctGdp"] == z["pctGdp"][2] and k["debt"]["year"] == 2026 and z["years"][2] == 2026
         and k["debt"]["scope"] == "zdd", "kpis.debt vs debt.zdd")
    # --- functions and revenue groups for the home page
    c.ok(len(core["functions"]) == len(e["functions"]["items"]), "core.functions length")
    for cf, it in zip(core["functions"], e["functions"]["items"]):
        c.ok((cf["id"], cf["name"], cf["short"], cf["mln"]) == (it["id"], it["name"], it["short"], it["mln"][1]), "core.functions %s: id/name/short/mln" % it["id"])
        c.near(cf["pctGdp"], it["pctGdp"][1], 0.0011, "core.functions %s pctGdp" % it["id"])
        c.near(cf["share"], it["share"][1], 0.0011, "core.functions %s share" % it["id"])
        c.near(cf["yoyPct"], it["yoy2026Pct"], 0.051, "core.functions %s yoyPct" % it["id"])
    c.ok(len(core["revenueGroups"]) == len(r["groups"]), "core.revenueGroups length")
    for cg, gr in zip(core["revenueGroups"], r["groups"]):
        c.ok((cg["id"], cg["name"], cg["mln"], cg["share"]) == (gr["id"], gr["name"], gr["mln"][2], gr["share2026"]), "core.revenueGroups %s" % gr["id"])
    c.fact("core 2026: revenue %s / %s, expenditure %s / %s, balance %s / %s, debt %s; counts %s budgets, %s programs, %s municipalities; 7 pending blocks" % (
        fmt(k["revenue"]["execMln"]), fmt(k["revenue"]["planMln"]), fmt(k["expenditure"]["execMln"]), fmt(k["expenditure"]["planMln"]),
        fmt(k["balance"]["execMln"]), fmt(k["balance"]["planMln"]), fmt(k["debt"]["zddMln"]), n["budgets"], n["programs"], n["municipalities"]))
    return c


# ------------------------------------------------------------------------------------------------------- CATALOG
def _schema(obj):
    out = []
    for key, v in obj.items():
        if key == "meta":
            continue
        t = "boolean" if isinstance(v, bool) else "number" if isinstance(v, (int, float)) else "string" if isinstance(v, str) else \
            "array" if isinstance(v, list) else "object" if isinstance(v, dict) else "null"
        row = {"key": key, "type": t}
        if isinstance(v, (list, dict)):
            row["length"] = len(v)
        out.append(row)
    return out


def _page_needs():
    """{route id: [need names]} from `export const needs = [...]` of apps/web/client/pages/sNN-*.js (None when a page declares none)."""
    out = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "apps", "web", "client", "pages", "s[0-9][0-9]-*.js"))):
        rid = os.path.basename(path)[:3].upper()
        with open(path, "r", encoding="utf-8") as fh:
            m = re.search(r"export const needs\s*=\s*\[([^\]]*)\]", fh.read())
        if m:
            out[rid] = [x.strip().strip("'\"") for x in m.group(1).split(",") if x.strip()]
    return out


def g_catalog(ctx):
    c = Check("CATALOG")
    cat = ctx.get("catalog.json")
    core = ctx.get("core.json")
    mins = ctx.get("ministries.json")
    routes = ctx.routes().routes
    c.ok(set(cat) == {"meta", "groups", "counts", "datasets", "traps", "methodology", "files"}, "catalog keys %s" % sorted(cat))
    c.ok(cat["meta"]["id"] == "D25" and cat["meta"]["status"] == "real" and cat["meta"]["source"] == ["wg"], "catalog meta")
    gids = [x["id"] for x in cat["groups"]]
    c.ok(len(gids) == len(set(gids)) and all(isinstance(x["label"], str) and x["label"] for x in cat["groups"]), "groups")
    dss = cat["datasets"]
    slugs = [d["slug"] for d in dss]
    c.ok(len(slugs) == len(set(slugs)), "dataset slugs must be unique")
    ids = [d["id"] for d in dss]
    c.ok(sorted({i for i in ids if ids.count(i) > 1}) == ["D09", "feed"], "ids may repeat only for D09 and feed: %s" % sorted({i for i in ids if ids.count(i) > 1}))
    listed = set()
    real = mock = pend = 0
    for d in dss:
        sl = d["slug"]
        need = ("id", "slug", "title", "description", "group", "status", "source", "screens", "eager", "contains", "mock")
        c.ok(all(x in d for x in need), "%s: missing keys %s" % (sl, [x for x in need if x not in d]))
        if not all(x in d for x in need):
            continue
        c.ok(d["status"] in ("real", "mock", "pending") and d["group"] in gids and d["mock"] == (d["status"] == "mock"), "%s: status/group/mock" % sl)
        c.ok(d["source"] and all(x in core["sources"] for x in d["source"]), "%s: source keys %s" % (sl, d["source"]))
        c.ok(all(x in routes for x in d["screens"]) and len(d["screens"]) == len(set(d["screens"])), "%s: screens %s" % (sl, d["screens"]))
        c.ok(all(isinstance(d[x], str) and d[x].strip() for x in ("title", "description")), "%s: title/description" % sl)
        real += d["status"] == "real"
        mock += d["status"] == "mock"
        pend += d["status"] == "pending"
        if d["status"] == "pending":
            c.ok("file" not in d and "bytes" not in d and "gzipBytes" not in d and "schema" not in d, "%s: a pending dataset has no file" % sl)
            c.ok(d["slug"] == d["id"].lower() and d["contains"] == [d["id"]] and d["id"] in core["pending"], "%s: pending id" % sl)
            p = core["pending"][d["id"]]
            c.ok(d["title"] == p["title"] and d["screens"] == p["screens"] and d["expected"] == p["expected"] and d["source"] == p["source"],
                 "%s: must equal core.pending.%s" % (sl, d["id"]))
            continue
        c.ok(isinstance(d.get("asOf"), str) and L.ISO.match(d["asOf"]) is not None and d["asOf"] <= L.BUILD_DATE, "%s: asOf %r" % (sl, d.get("asOf")))
        c.ok(FORMATS.get(d["format"]) == d["mediaType"], "%s: format/mediaType %s / %s" % (sl, d["format"], d["mediaType"]))
        if d.get("fileTemplate"):                                   # ministries/<code>.json
            parts = d["parts"]
            c.ok(d["file"] is None and d["fileTemplate"] == "data/ministries/<код>.json", "%s: fileTemplate" % sl)
            codes = [pp["code"] for pp in parts]
            c.ok(len(parts) == len(set(codes)) == core["counts"]["programBudgets"], "%s: %d parts, expected %s" % (sl, len(parts), core["counts"]["programBudgets"]))
            c.ok(all(cc in {m["id"] for m in mins["items"]} for cc in codes), "%s: part codes must be ministry ids" % sl)
            tot = gz = 0
            for pp in parts:
                path = os.path.join(L.DATA, pp["file"].removeprefix("data/"))
                if not c.ok(os.path.exists(path) and pp["file"] == "data/ministries/%s.json" % pp["code"], "%s: part file %s" % (sl, pp["file"])):
                    continue
                listed.add(pp["file"][len("data/"):])
                raw = open(path, "rb").read()
                c.ok(pp["bytes"] == len(raw) and pp["gzipBytes"] == L.gz_size(raw), "%s: part %s bytes %s/%s vs %d/%d" % (
                    sl, pp["code"], pp["bytes"], pp["gzipBytes"], len(raw), L.gz_size(raw)))
                tot += len(raw)
                gz += L.gz_size(raw)
            c.ok(d["bytes"] == tot and d["gzipBytes"] == gz, "%s: bytes/gzipBytes %s/%s must be the sums of the parts %d/%d" % (sl, d["bytes"], d["gzipBytes"], tot, gz))
            continue
        rel = d["file"][len("data/"):]
        c.ok(d["file"].startswith("data/") and L.exists(rel), "%s: file %s does not exist" % (sl, d["file"]))
        if not L.exists(rel):
            continue
        listed.add(rel)
        raw = open(os.path.join(L.DATA, rel), "rb").read()
        if d["id"] == "D25":                                        # the catalog cannot state its own size
            c.ok("bytes" not in d and "gzipBytes" not in d, "%s: the catalog must not state its own size" % sl)
        else:
            c.ok(d["bytes"] == len(raw) and d["gzipBytes"] == L.gz_size(raw), "%s: bytes/gzipBytes %s/%s vs the file %d/%d (rebuild the catalog)" % (
                sl, d.get("bytes"), d.get("gzipBytes"), len(raw), L.gz_size(raw)))
        if d["format"] in ("JSON", "GeoJSON"):
            doc = ctx.get(rel)
            m = doc.get("meta", {})
            c.ok(d["status"] == m.get("status") and d["mock"] == bool(m.get("mock", False)) and set(d["source"]) == set(m.get("source", [])), "%s: status/mock/source vs meta" % sl)
            for kk in ("asOf", "unit"):
                if kk in d:
                    c.ok(d[kk] == m.get(kk), "%s: %s %r vs meta %r" % (sl, kk, d[kk], m.get(kk)))
            mid = m.get("id", "").split("+")
            if all(DATA_ID.match(x) for x in mid):
                c.ok(set(d["contains"]) == set(mid), "%s: contains %s vs meta.id %s" % (sl, d["contains"], m.get("id")))
            else:                                                   # core / feed / search-index: no dataset of their own inside
                c.ok(d["contains"] == (["D18"] if d["id"] == "core" else []) and m.get("id") == d["slug"], "%s: contains %s vs meta.id %s" % (sl, d["contains"], m.get("id")))
            c.ok(set(d.get("pending", [])) == set(m.get("pending", [])), "%s: pending %s vs meta.pending %s" % (sl, d.get("pending"), m.get("pending")))
            c.ok(d.get("schema") == _schema(doc), "%s: schema differs from the top-level keys of the file" % sl)
        c.ok(d["eager"] == (d["id"] == "core"), "%s: only core.json is eager" % sl)
    on_disk = set(L.data_files())
    c.ok(on_disk == listed, "files on disk but not in the catalog: %s; in the catalog but not on disk: %s" % (sorted(on_disk - listed), sorted(listed - on_disk)))
    n = cat["counts"]
    c.ok(n == {"datasets": len(dss), "files": len(on_disk), "real": real, "mock": mock, "pending": pend, "primarySources": len(cat["files"])},
         "counts %s do not match the catalog %s" % (n, {"datasets": len(dss), "files": len(on_disk), "real": real, "mock": mock, "pending": pend, "primarySources": len(cat["files"])}))
    # --- traps and methodology
    c.ok(len(cat["traps"]) == 6 and len(cat["methodology"]) == 6, "traps %d / methodology %d, expected 6 / 6" % (len(cat["traps"]), len(cat["methodology"])))
    for kind in ("traps", "methodology"):
        rows = cat[kind]
        c.ok(len({x["id"] for x in rows}) == len(rows), "%s: ids" % kind)
        for x in rows:
            c.ok(all(isinstance(x.get(kk), str) and x[kk].strip() for kk in ("id", "title", "text")), "%s %s: title/text" % (kind, x.get("id")))
    c.ok("two-versions" in {x["id"] for x in cat["traps"]}, "the two-versions trap must be listed")
    # --- primary source files
    for f in cat["files"]:
        c.ok(all(x in f for x in ("name", "title", "sha256", "bytes", "source", "role", "usedBy")), "files %s: keys" % f.get("name"))
        c.ok(SHA.match(f["sha256"]) is not None and isinstance(f["bytes"], int) and f["bytes"] > 0, "files %s: sha256/bytes" % f["name"])
        c.ok(f["source"] and all(x in core["sources"] for x in f["source"]), "files %s: source keys" % f["name"])
        c.ok(f["usedBy"] and all(x in slugs for x in f["usedBy"]), "files %s: usedBy %s are not dataset slugs" % (f["name"], f["usedBy"]))
        c.ok(bool(f.get("url")) + bool(f.get("page")) + bool(f.get("note")) >= 1, "files %s: needs url, page or note" % f["name"])
        for kk in ("url", "page"):
            if f.get(kk):
                c.ok(f[kk].startswith("https://"), "files %s: %s %r" % (f["name"], kk, f[kk]))
        blob = " ".join(str(v) for v in f.values()).lower()
        c.ok("private channel" not in blob and not any(w in blob for w in INTERNAL), "files %s: internal or private wording" % f["name"])
    c.ok(len({f["name"] for f in cat["files"]}) == len(cat["files"]) and len({f["sha256"] for f in cat["files"]}) == len(cat["files"]), "files: names and checksums must be unique")
    kfp_files = {x["file"]: x["sha256"] for y in ctx.get("execution.json")["data"].values() for x in y["files"]}
    got = {f["name"]: f["sha256"] for f in cat["files"]}
    c.ok(all(got.get(k) == v for k, v in kfp_files.items()), "the 19 KFP reports of execution.json must be listed with the same checksums")
    # --- screens against the pages' `needs` (a warning: pages are written by other workers)
    needs = _page_needs()
    file_ds = {}
    for d in dss:
        if d.get("file"):
            file_ds[d["file"]] = d
        for pp in d.get("parts", []):
            file_ds[pp["file"]] = d
    warn = 0
    for rid, lst in sorted(needs.items()):
        for nm in lst:
            fn = "data/%s.json" % nm.rstrip("?")
            d = file_ds.get(fn)
            if d is None:
                if L.exists(fn[len("data/"):]) is False:
                    c.warn("%s needs '%s' but there is no such file in data/release" % (rid, nm))
                    warn += 1
                continue
            if rid not in d["screens"] and d["id"] != "core":
                c.warn("%s reads %s but the catalog lists screens %s for it" % (rid, d["slug"], ",".join(d["screens"])))
                warn += 1
    pages_with_needs = {rid for rid, lst in needs.items() if lst}
    for d in dss:
        if d["id"] == "core" or d["status"] == "pending":
            continue
        for rid in d["screens"]:
            if rid in pages_with_needs and not any(file_ds.get("data/%s.json" % nm.rstrip("?")) is d for nm in needs[rid]):
                c.warn("catalog lists %s for %s but that page's needs do not include it" % (rid, d["slug"]))
                warn += 1
    c.fact("%d datasets (%d real, %d mock, %d pending) describe %d files; %d primary source files; %d screen/needs differences (warnings)" % (
        len(dss), real, mock, pend, len(on_disk), len(cat["files"]), warn))
    return c
