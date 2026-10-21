#!/usr/bin/env python3
"""gva_sectors_v5.py - builds site/data/gva-sectors.json (version v5: run at the tag mock-v5) from two saved Eurostat answers (plain stdlib, no network).

  python3 tools/mock/gva_sectors_v5.py NAMA.json GDP.json            # writes the data file
  python3 tools/mock/gva_sectors_v5.py NAMA.json GDP.json --check    # only verifies, writes nothing

The inputs are the JSON answers of the open Eurostat API (national accounts of Bulgaria, compiled from the data of the NSI):
  NAMA.json  https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nama_10_a10?format=JSON&lang=EN&geo=BG&unit=CP_MEUR&na_item=B1G&sinceTimePeriod=2019
  GDP.json   https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nama_10_gdp?format=JSON&lang=EN&geo=BG&unit=CP_MEUR&na_item=B1GQ&na_item=D21X31&sinceTimePeriod=2019
(the NSI site itself answers 403 to automatic requests, so the figures are taken from the Eurostat copy of the NSI series).
What is checked before anything is written: ten branches add up to the total of the economy; gross value added + taxes less subsidies on products
= GDP; GDP equals the actual GDP of outlook.json for the years the two files share (2024, 2025).
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]            # repository root
OUT = ROOT / "site" / "data" / "gva-sectors.json"
OUTLOOK = ROOT / "site" / "data" / "outlook.json"

# the ten branches of the NACE A*10 grouping, in the order of the classification; C (manufacturing) is a part of B-E
BRANCHES = [
    ("A", "Селско, горско и рибно стопанство", "Земеделие, горско стопанство, риболов."),
    ("B-E", "Промишленост", "Добив, производство, ток, вода и отпадъци (без строителството)."),
    ("F", "Строителство", "Сгради, пътища и друго строителство."),
    ("G-I", "Търговия, транспорт, хотели и ресторанти", "Магазини и търговия на едро, превози, настаняване и хранене."),
    ("J", "Информация и комуникации", "Софтуер, далекосъобщения, медии, издателска дейност."),
    ("K", "Финанси и застраховане", "Банки, застрахователи, финансови услуги."),
    ("L", "Операции с недвижими имоти", "Наем и търговия с имоти; в дела влиза и условният наем на собствените жилища."),
    ("M_N", "Професионални и административни дейности", "Право, счетоводство, инженеринг, наука, наемане на работници, охрана."),
    ("O-Q", "Държавно управление, образование и здраве", "Държавната администрация, отбраната, училищата, болниците и социалните грижи."),
    ("R-U", "Култура, спорт и други услуги", "Изкуство, спорт, развлечения, лични услуги."),
]
PART = ("C", "Преработваща промишленост", "Заводите: храни, машини, метали, химия, текстил и т.н.", "B-E")


def series(doc, dim, key, extra=None):
    """values of one slice as {year: (value, flag)}; every other dimension has size 1 (the file was requested that way)"""
    ids = doc["id"]; size = doc["size"]
    cat = {d: doc["dimension"][d]["category"]["index"] for d in ids}
    times = doc["dimension"]["time"]["category"]["index"]
    flags = doc.get("status", {})
    if isinstance(cat[dim], list):
        cat[dim] = {k: i for i, k in enumerate(cat[dim])}
    out = {}
    for y, ti in times.items():
        pos = 0
        stride = 1
        idx = {}
        for d in reversed(ids):
            idx[d] = stride
            stride *= size[ids.index(d)]
        pos = ti * idx["time"] + cat[dim][key] * idx[dim]
        if extra:
            for d, k in extra.items():
                pos += cat[d][k] * idx[d]
        v = doc["value"].get(str(pos))
        if v is not None:
            out[int(y)] = (v, flags.get(str(pos)))
    return out


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    check_only = "--check" in argv
    if len(args) != 2:
        print(__doc__); return 2
    nama = json.load(open(args[0], encoding="utf-8"))
    gdpd = json.load(open(args[1], encoding="utf-8"))
    upd_a = next(a["date"] for a in nama["extension"]["annotation"] if a["type"] == "UPDATE_DATA")
    upd_g = next(a["date"] for a in gdpd["extension"]["annotation"] if a["type"] == "UPDATE_DATA")
    as_of = min(upd_a, upd_g)[:10]
    # the years both files share (the GDP file starts in 2019; the national-accounts file may reach further back)
    years = sorted(set(int(y) for y in nama["dimension"]["time"]["category"]["index"]) & set(int(y) for y in gdpd["dimension"]["time"]["category"]["index"]))
    tot = series(nama, "nace_r2", "TOTAL")
    secs = {c: series(nama, "nace_r2", c) for c, _, _ in BRANCHES}
    part = series(nama, "nace_r2", PART[0])
    gdp = series(gdpd, "na_item", "B1GQ")
    tax = series(gdpd, "na_item", "D21X31")
    fails = []
    for y in years:
        s = round(sum(secs[c][y][0] for c, _, _ in BRANCHES), 1)
        if abs(s - tot[y][0]) > 0.3:
            fails.append(f"{y}: branches {s} vs total {tot[y][0]}")
        if abs(round(tot[y][0] + tax[y][0], 1) - gdp[y][0]) > 0.3:
            fails.append(f"{y}: GVA {tot[y][0]} + taxes {tax[y][0]} != GDP {gdp[y][0]}")
    o = json.load(open(OUTLOOK, encoding="utf-8"))
    for i, y in enumerate(o["years"]):
        if y in gdp:
            if abs(o["gdp"]["mlnPrecise"][i] - gdp[y][0]) > 0.15:
                fails.append(f"{y}: GDP {gdp[y][0]} differs from outlook.json {o['gdp']['mlnPrecise'][i]}")
    if fails:
        print("FAIL\n  " + "\n  ".join(fails)); return 1
    prov = sorted(y for y in years if any(secs[c][y][1] == "p" for c, _, _ in BRANCHES))
    r1 = lambda v: round(v, 1)
    doc = {
        "meta": {
            "id": "D31", "title": "Икономиката по отрасли: добавена стойност и БВП 2019–2025", "status": "real", "source": ["eurostat"],
            "sourceNote": "Евростат, национални сметки (набори nama_10_a10 и nama_10_gdp), България, текущи цени, млн. €. Евростат публикува данните на НСИ; сайтът на НСИ не се отваря за автоматични заявки.",
            "asOf": as_of, "retrieved": "2026-10-09", "unit": "млн. €", "mock": False,
            "provisionalYears": prov,
            "links": {"nama_10_a10": "https://ec.europa.eu/eurostat/databrowser/view/nama_10_a10/default/table?lang=en&geo=BG",
                      "nama_10_gdp": "https://ec.europa.eu/eurostat/databrowser/view/nama_10_gdp/default/table?lang=en&geo=BG"}
        },
        "years": years,
        "gva": [r1(tot[y][0]) for y in years],
        "taxesNet": [r1(tax[y][0]) for y in years],
        "gdp": [r1(gdp[y][0]) for y in years],
        "branches": [{"id": c, "name": n, "desc": d, "mln": [r1(secs[c][y][0]) for y in years]} for c, n, d in BRANCHES],
        "parts": [{"id": PART[0], "name": PART[1], "desc": PART[2], "of": PART[3], "mln": [r1(part[y][0]) for y in years]}],
    }
    print(f"OK: {len(years)} years {years[0]}-{years[-1]}, as of {as_of}, provisional {prov}; branches add up, GVA + taxes = GDP, GDP = outlook.json")
    if not check_only:
        OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        print("written", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
