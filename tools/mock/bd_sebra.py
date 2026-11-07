"""sebra.json (D24): the daily SEBRA payment summaries that the МИДТ transparency page publishes (27, 28 and 31 August 2026).

Inputs (no network at build time):
  * prototype/data/raw/sebra/midt_sebra_31.08.2026.xlsx  - the day the spec is about (28 payments, 171 854,85 EUR)
  * tools/mock/cache/sebra_27.08.2026.xlsx, sebra_28.08.2026.xlsx - the two other files the page lists (fetch_sebra.py); optional
  * prototype/data/raw/sebra/midt_sebra_2026_page.html - the page itself: which files it lists, their listing date and size

The .xlsx files are read with the standard library only (zip + XML). Every file is checked: the categories add up to the printed total,
the organisations add up to the ministry, the period is the day in the file name, and the file size matches the size printed on the page.
The files hold counts and sums by category and by budget organisation. They carry no recipients and no single payments.
"""
import html as htmllib
import re
import zipfile
import xml.etree.ElementTree as ET

from dlib import CACHE, RAW, meta, rnd

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
PAGE_URL = "https://midt.gov.bg/bg/transparency/sebra/2026"
PAGE_HTML = RAW / "sebra" / "midt_sebra_2026_page.html"
LATEST = "2026-08-31"
FILES = {  # day -> path (the prototype archive first, then the cache written by fetch_sebra.py)
    "2026-08-27": CACHE / "sebra_27.08.2026.xlsx",
    "2026-08-28": CACHE / "sebra_28.08.2026.xlsx",
    "2026-08-31": RAW / "sebra" / "midt_sebra_31.08.2026.xlsx",
}
MONTHS = {"януари": 1, "февруари": 2, "март": 3, "април": 4, "май": 5, "юни": 6, "юли": 7, "август": 8, "септември": 9,
          "октомври": 10, "ноември": 11, "декември": 12}
LATIN_TO_CYR = str.maketrans("eaopcxykBHMTAEOPCXK", "еаорсхукВНМТАЕОРСХК")
CYR = re.compile("[А-Яа-я]")
LATIN = re.compile("[A-Za-z]")


def _cyr(s):
    """Fix Latin look-alike letters inside Cyrillic words ("управлeние" with a Latin e); words without Cyrillic stay as they are."""
    s = s.replace("\xa0", " ")
    return " ".join(w.translate(LATIN_TO_CYR) if CYR.search(w) else w for w in s.split())


def xlsx_rows(path):
    """[{cell reference: text}] for the first sheet; shared strings resolved, numbers kept as text."""
    z = zipfile.ZipFile(path)
    ss = [("".join(t.text or "" for t in si.iter(M + "t"))) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(M + "si")]
    rows = []
    for row in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).iter(M + "row"):
        cells = {}
        for c in row.findall(M + "c"):
            v = c.find(M + "v")
            if v is not None and v.text is not None:
                cells[re.match(r"[A-Z]+", c.get("r")).group(0)] = ss[int(v.text)] if c.get("t") == "s" else v.text
        if cells:
            rows.append(cells)
    return rows


def _date(dmy):
    d, m, y = dmy.split(".")
    return "%s-%s-%s" % (y, m, d)


def parse_day(path):
    """-> {"day", "ministry", "total": {count, eur}, "byCode": [...], "organisations": [{name, code, count, eur, byCode}]}"""
    rows = xlsx_rows(path)
    sections, cur = [], None
    for r in rows:
        a, c = r.get("A", ""), r.get("C", "")
        if c.startswith("Период:"):                      # a section header: "<name> ( <code> )" and the period
            mm = re.fullmatch(r"Период: (\d\d\.\d\d\.\d{4}) - (\d\d\.\d\d\.\d{4})", c)
            if not mm or mm.group(1) != mm.group(2):
                raise ValueError("%s: unexpected period %r" % (path.name, c))
            cur = {"title": _cyr(a), "day": _date(mm.group(1)), "codes": [], "total": None}
            sections.append(cur)
        elif cur is not None and a.startswith("Общо:"):
            cur["total"] = {"count": int(r["C"]), "eur": rnd(float(r["D"]), 2)}
            cur = None
        elif cur is not None and a not in ("Код",) and "D" in r and "B" in r:
            cur["codes"].append({"code": a, "name": _cyr(r["B"]), "count": int(r["C"]), "eur": rnd(float(r["D"]), 2)})
    if len(sections) < 2 or any(s["total"] is None for s in sections):
        raise ValueError("%s: unexpected layout (%d sections)" % (path.name, len(sections)))
    days = {s["day"] for s in sections}
    if len(days) != 1:
        raise ValueError("%s: more than one day %r" % (path.name, sorted(days)))
    for s in sections:                                    # categories add up to the printed total
        if sum(x["count"] for x in s["codes"]) != s["total"]["count"] or abs(sum(x["eur"] for x in s["codes"]) - s["total"]["eur"]) > 0.005:
            raise ValueError("%s: %s does not add up" % (path.name, s["title"]))
    top, orgs = sections[0], sections[1:]
    if sum(o["total"]["count"] for o in orgs) != top["total"]["count"] or abs(sum(o["total"]["eur"] for o in orgs) - top["total"]["eur"]) > 0.005:
        raise ValueError("%s: organisations do not add up to the total" % path.name)
    for code in top["codes"]:                             # and category by category
        part = [x for o in orgs for x in o["codes"] if x["code"] == code["code"]]
        if sum(x["count"] for x in part) != code["count"] or abs(sum(x["eur"] for x in part) - code["eur"]) > 0.005:
            raise ValueError("%s: category %s differs between the total and the organisations" % (path.name, code["code"]))
    mm = re.fullmatch(r"(.+?) \( (\d{3}\*+) \)", top["title"])
    if not mm:
        raise ValueError("%s: ministry header %r" % (path.name, top["title"]))
    out_orgs = []
    for o in orgs:
        m2 = re.fullmatch(r"(.+?) \( (\d{10}) \)", o["title"])
        if not m2:
            raise ValueError("%s: organisation header %r" % (path.name, o["title"]))
        out_orgs.append({"name": m2.group(1), "code": m2.group(2), "count": o["total"]["count"], "eur": o["total"]["eur"],
                         "byCode": sorted(o["codes"], key=lambda x: (-x["eur"], x["code"]))})
    out_orgs.sort(key=lambda o: (-o["eur"], o["code"]))
    for txt in [mm.group(1)] + [o["name"] for o in out_orgs] + [x["name"] for x in top["codes"]]:
        if LATIN.search(txt):
            raise ValueError("%s: Latin letters left in %r" % (path.name, txt))
    return {"day": top["day"], "ministry": mm.group(1), "ministryCode": mm.group(2), "count": top["total"]["count"],
            "eur": top["total"]["eur"], "byCode": sorted(top["codes"], key=lambda x: (-x["eur"], x["code"])), "byOrganisation": out_orgs}


def parse_listing():
    """The files the page lists: [{label, day, listedOn, sizeKb}] and the section heading."""
    txt = re.sub(r"<script.*?</script>|<style.*?</style>", " ", PAGE_HTML.read_text(encoding="utf-8"), flags=re.S)
    txt = htmllib.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", txt)))
    # since October 2026 the page lists the newer months above August: read the section of the month of LATEST, not the first one
    want = "%s %s" % (next(k for k, v in MONTHS.items() if v == int(LATEST[5:7])), LATEST[:4])
    heads = list(re.finditer(r"Документи за (\S+ \d{4}) г\. Публикувани на (\d\d\.\d\d\.\d{4}) Файлове \((\d+)\)", txt))
    at = next((k for k, h in enumerate(heads) if h.group(1) == want), None)
    head = heads[at] if at is not None else None
    section = txt[head.end():heads[at + 1].start() if at + 1 < len(heads) else len(txt)] if head else ""
    files = []
    for mm in re.finditer(r"Име на файла (\d+) (\S+) (\d{4}) г\. Дата (\d\d\.\d\d\.\d{4}) Размер ([\d.]+) KB Формат (\w+)", section):
        day = "%s-%02d-%02d" % (mm.group(3), MONTHS[mm.group(2)], int(mm.group(1)))
        files.append({"label": "%s %s %s г." % (mm.group(1), mm.group(2), mm.group(3)), "day": day,
                      "listedOn": _date(mm.group(4)), "sizeKb": float(mm.group(5)), "format": mm.group(6)})
    if not head or int(head.group(3)) != len(files) or len(files) != 3:
        raise ValueError("the SEBRA page listing changed: %r, %d files" % (head and head.groups(), len(files)))
    return {"section": "Документи за %s г." % head.group(1), "sectionPublished": _date(head.group(2)),
            "page": PAGE_URL, "retrieved": "2026-10-01", "files": sorted(files, key=lambda f: f["day"])}


def build_sebra(ctx):
    listing = parse_listing()
    days, sizes = [], {}
    for f in listing["files"]:
        p = FILES[f["day"]]
        if not p.exists():
            if f["day"] == LATEST:
                raise FileNotFoundError(p)
            ctx.notes.append("sebra: %s missing from the cache (run fetch_sebra.py); that day is left out" % p.name)
            continue
        size = p.stat().st_size
        if rnd(size / 1024.0, 2) != f["sizeKb"]:
            raise ValueError("%s: %d bytes is not the %s KB the page lists" % (p.name, size, f["sizeKb"]))
        d = parse_day(p)
        if d["day"] != f["day"]:
            raise ValueError("%s: the file holds %s, the page lists %s" % (p.name, d["day"], f["day"]))
        sizes[f["day"]] = size
        days.append(d)
    latest = next(d for d in days if d["day"] == LATEST)
    if (latest["count"], latest["eur"]) != (28, 171854.85):
        raise ValueError("the 31.08.2026 summary is no longer 28 payments / 171 854,85 EUR: %r" % ((latest["count"], latest["eur"]),))
    if len({d["ministry"] for d in days}) != 1:
        raise ValueError("the ministry name differs between the days")

    codes = {}                                            # the published days together, by category
    for d in days:
        for x in d["byCode"]:
            c = codes.setdefault(x["code"], {"code": x["code"], "name": x["name"], "count": 0, "eur": 0.0})
            if c["name"] != x["name"]:
                raise ValueError("category %s has two descriptions" % x["code"])
            c["count"] += x["count"]
            c["eur"] += x["eur"]
    overall = {"count": sum(d["count"] for d in days), "eur": rnd(sum(d["eur"] for d in days), 2),
               "byCode": sorted(({**c, "eur": rnd(c["eur"], 2)} for c in codes.values()), key=lambda c: (-c["eur"], c["code"]))}
    if abs(sum(c["eur"] for c in overall["byCode"]) - overall["eur"]) > 0.005:
        raise ValueError("the categories of all days do not add up")

    out_days = [{"date": d["day"], "label": next(f["label"] for f in listing["files"] if f["day"] == d["day"]), "count": d["count"],
                 "eur": d["eur"], "byCode": d["byCode"], "byOrganisation": d["byOrganisation"]} for d in days]
    for f in listing["files"]:
        f["bytes"] = sizes.get(f["day"])
        f["parsed"] = f["day"] in sizes
    ministry = latest["ministry"]
    ministry_full = ministry.replace("М-во ", "Министерство ", 1) if ministry.startswith("М-во ") else ministry
    obj = {
        "meta": meta("D24", "Плащания по СЕБРА: дневни обобщения на МИДТ", source=["sebra"],
                     source_note="Министерство на иновациите и дигиталната трансформация, страница „СЕБРА 2026“: дневни обобщения на плащанията "
                                 "(xlsx) за 27, 28 и 31 август 2026 г.",
                     as_of=LATEST, unit="€"),
        "period": {"from": LATEST, "to": LATEST},
        "ministry": ministry_full,
        "ministryPrinted": ministry,
        "ministryCode": latest["ministryCode"],
        "publisher": "Министерство на иновациите и дигиталната трансформация",
        "total": {"count": latest["count"], "eur": latest["eur"]},
        "byCode": latest["byCode"],
        "byOrganisation": latest["byOrganisation"],
        "days": out_days,
        "overall": overall,
        "overallLabel": "Сборът на публикуваните дни (%s), не на целия месец" % ", ".join(
            d["label"].replace(" 2026 г.", "") for d in out_days),
        "publication": listing,
        "notes": [
            "Файловете са дневни обобщения по категория плащане и по бюджетна организация. Получатели и отделни плащания в тях няма.",
            "В заглавието на файловете институцията е записана като „%s“ (код %s); обобщенията са публикувани на страницата на Министерство на "
            "иновациите и дигиталната трансформация." % (ministry, latest["ministryCode"]),
            "Кодът на категорията е както е във файла: първите две цифри са категорията, „xxxx“ е частта от кода, която файлът не показва.",
            "На 1 октомври 2026 г. страницата показва само документите за август 2026 г. и само три дни от тях (27, 28 и 31 август): "
            "това не е пълният месец и не са пълните разходи на министерството. Сумите са в евро.",
        ],
        "check": {"daysParsed": len(days), "daysListed": len(listing["files"]), "categoriesAddUp": True, "organisationsAddUp": True,
                  "fileSizesMatchListing": True},
    }
    ctx.put("sebra.json", obj)
    ctx.notes.append("sebra: %d days, %d payments, %.2f EUR (31.08: %d / %.2f)" % (len(days), overall["count"], overall["eur"],
                                                                                    latest["count"], latest["eur"]))
    return obj
