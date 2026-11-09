#!/usr/bin/env python3
"""D20 + D21 inputs: municipal population and borders (Eurostat GISCO LAU) and oblast population (Eurostat).

Writes two small cache files (the raw 100+ MB GISCO GeoJSON is STREAMED and never stored):

  data/cache/gisco_lau_bg.json            Bulgaria's 265 LAUs: id, name, population, area, border rings (5 decimals)
  data/cache/eurostat_pop_nuts3_bg.json   Eurostat demo_r_pjanaggr3 (all sexes, all ages), the 28 Bulgarian NUTS3 regions

The build (datasets.py) reads only these caches, so it runs offline once they exist.
`--refresh` forces a new download; without it an existing cache is reused (idempotent, no network).

Choice (deviation from PLAN §5.2 D20, recorded in docs/data-spec.md): LAU **2024** instead of LAU 2021.
The 2021 release carries the pre-census population estimate (6 916 548 for Bulgaria), which is 7 % above the
census-based figures Eurostat publishes today (6 445 481 on 01.01.2024); the 2024 release has the same 265
municipality codes and names, and its POP_2024 sums exactly to Eurostat's national figure.

If the network is unavailable and there is no cache the script exits 0 with a warning; the build then publishes the
municipality list without population/borders and marks D20/D21 as pending (never with invented numbers).
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import codecs
import csv
import io
import json
import sys
import time
import urllib.request

from budget_pipeline.build.data_io import CACHE, jdumps, say, write_text

UA = "budget-na-svetlo-data-pipeline/1.0 (+public data; contact: working group)"
LAU_RELEASE = "2024"
LAU_BASE = "https://gisco-services.ec.europa.eu/distribution/v2/lau/"
LAU_CSV = LAU_BASE + "csv/LAU_RG_01M_%s_4326.csv" % LAU_RELEASE
LAU_GEOJSON = LAU_BASE + "geojson/LAU_RG_01M_%s_4326.geojson" % LAU_RELEASE
EUROSTAT_POP = ("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/demo_r_pjanaggr3"
                "?format=JSON&lang=EN&sex=T&age=TOTAL&unit=NR&")
NUTS3_BG = ["BG311", "BG312", "BG313", "BG314", "BG315", "BG321", "BG322", "BG323", "BG324", "BG325", "BG331",
            "BG332", "BG333", "BG334", "BG341", "BG342", "BG343", "BG344", "BG411", "BG412", "BG413", "BG414",
            "BG415", "BG421", "BG422", "BG423", "BG424", "BG425"]

GISCO_CACHE = CACHE / "gisco_lau_bg.json"
EUROSTAT_CACHE = CACHE / "eurostat_pop_nuts3_bg.json"


def _open(url, timeout=90, headers=None):
    h = {"User-Agent": UA}
    h.update(headers or {})
    return urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout)


def fetch_csv():
    """Bulgaria's rows of the LAU CSV: [{id, name, pop, areaKm2}] (GISCO_ID is 'BG_<NSI code>')."""
    raw = _open(LAU_CSV).read().decode("utf-8")
    rows = []
    for r in csv.DictReader(io.StringIO(raw)):
        if r["CNTR_CODE"] != "BG":
            continue
        rows.append({"id": r["GISCO_ID"].split("_", 1)[1], "name": r["LAU_NAME"],
                     "pop": int(float(r["POP_%s" % LAU_RELEASE])), "areaKm2": round(float(r["AREA_KM2"]), 3)})
    rows.sort(key=lambda r: r["id"])
    return rows


def iter_features(resp, chunk=1 << 20):
    """Stream the features of a (single-line, 100+ MB) GeoJSON without holding the file in memory."""
    dec = json.JSONDecoder()
    udec = codecs.getincrementaldecoder("utf-8")()
    buf = ""
    marker = '"features"'
    pos = -1
    eof = False

    def more():
        nonlocal buf, eof
        block = resp.read(chunk)
        if not block:
            eof = True
            buf += udec.decode(b"", final=True)
            return False
        buf += udec.decode(block)
        return True

    while pos < 0:
        if not more():
            raise ValueError("no features array in the GeoJSON")
        i = buf.find(marker)
        if i >= 0:
            j = buf.find("[", i)
            if j >= 0:
                pos = j + 1
    while True:
        while pos < len(buf) and buf[pos] in " \r\n\t,":
            pos += 1
        if pos >= len(buf):
            if not more():
                return
            continue
        if buf[pos] == "]":
            return
        try:
            obj, end = dec.raw_decode(buf, pos)
        except json.JSONDecodeError:
            if not more():
                raise
            continue
        yield obj
        pos = end
        if pos > (6 << 20):                 # drop what was consumed
            buf = buf[pos:]
            pos = 0


def _round_rings(geom, nd=5):
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    out = []
    for poly in polys:
        out.append([[[round(x, nd), round(y, nd)] for x, y in ring] for ring in poly])
    return out


def fetch_geometry(wanted):
    """Stream the GeoJSON; keep the features of `wanted` ids (polygons as lists of rings)."""
    found = {}
    t0 = time.time()
    seen = 0
    with _open(LAU_GEOJSON, timeout=120) as resp:
        for feat in iter_features(resp):
            seen += 1
            pr = feat["properties"]
            if pr.get("CNTR_CODE") != "BG":
                continue
            lid = pr["GISCO_ID"].split("_", 1)[1]
            if lid in wanted:
                found[lid] = _round_rings(feat["geometry"])
                if len(found) == len(wanted):
                    break
    say("  streamed %d features in %.0fs, kept %d" % (seen, time.time() - t0, len(found)))
    return found


def boundaries(refresh):
    if GISCO_CACHE.exists() and not refresh:
        say("gisco: cache present (%s), skipping network" % GISCO_CACHE.name)
        return True
    say("gisco: LAU %s CSV ..." % LAU_RELEASE)
    rows = fetch_csv()
    if len(rows) != 265:
        raise ValueError("expected 265 Bulgarian LAUs, got %d" % len(rows))
    say("gisco: LAU %s GeoJSON (streamed, ~100 MB) ..." % LAU_RELEASE)
    geoms = fetch_geometry({r["id"] for r in rows})
    missing = [r["id"] for r in rows if r["id"] not in geoms]
    if missing:
        raise ValueError("no geometry for %s" % missing)
    for r in rows:
        r["rings"] = geoms[r["id"]]
    obj = {"source": "Eurostat GISCO, LAU %s (LAU_RG_01M_%s_4326), Bulgaria" % (LAU_RELEASE, LAU_RELEASE),
           "urlCsv": LAU_CSV, "urlGeojson": LAU_GEOJSON, "release": LAU_RELEASE, "populationDate": LAU_RELEASE + "-01-01",
           "populationSum": sum(r["pop"] for r in rows), "items": rows}
    write_text(GISCO_CACHE, jdumps(obj) + "\n")
    say("gisco: cached %d LAUs, population sum %d, %d bytes" % (len(rows), obj["populationSum"],
                                                                   GISCO_CACHE.stat().st_size))
    return True


def fetch_eurostat(refresh):
    if EUROSTAT_CACHE.exists() and not refresh:
        say("eurostat: cache present (%s), skipping network" % EUROSTAT_CACHE.name)
        return True
    url = EUROSTAT_POP + "&".join("geo=" + g for g in NUTS3_BG)
    say("eurostat: demo_r_pjanaggr3 for 28 NUTS3 regions ...")
    js = json.loads(_open(url, timeout=60).read())
    obj = {"url": url, "updated": js.get("updated"), "jsonstat": js}
    write_text(EUROSTAT_CACHE, jdumps(obj) + "\n")
    say("eurostat: cached %d bytes (updated %s)" % (EUROSTAT_CACHE.stat().st_size, js.get("updated")))
    return True


def main(argv):
    refresh = "--refresh" in argv
    ok = True
    for fn in (boundaries, fetch_eurostat):
        try:
            fn(refresh)
        except Exception as exc:                    # network down, format change, ...
            ok = False
            print("WARN   [boundaries] %s failed: %s: %s" % (fn.__name__, type(exc).__name__, exc), file=sys.stderr)
    if not ok:
        say("boundaries: finished WITH WARNINGS (no cache => D20/D21 will be published as pending)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
