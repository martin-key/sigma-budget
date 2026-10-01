#!/usr/bin/env python3
"""Извлича числата от приетите бюджетни закони за 2026 г. (текстовете в „Държавен вестник“).

Какво прави: разбира HTML-а на ДВ (Word-експорт с истински <table>), като пази празните клетки,
и за всяка таблица помни члена/алинеята, в който е. Извлича:
  - ЗДБ 2026 (ДВ бр. 69): чл. 1, ал. 1–3 — държавният бюджет и трансферите от него;
    чл. 51 — трансферите от централния бюджет за всяка от 265-те общини (с проверка на сборовете);
  - ЗБДОО 2026 (ДВ бр. 68): чл. 1 — консолидираният бюджет на ДОО; чл. 9 — осигурителен доход;
    чл. 14 и приложение № 2А — вноската за ТЗПБ по дейности; чл. 15 — фонд ГВРС;
  - ЗБНЗОК 2026 (ДВ бр. 68): чл. 1 — бюджетът на НЗОК; чл. 2 — здравноосигурителната вноска.
Пише prototype/data/raw/dv/dv_laws_2026.json (сурови таблици и цитати).

Входове: prototype/data/raw/dv/{zdb2026_dv69_idMat245041,zbdoo2026_dv68_idMat244982,zbnzok2026_dv68_idMat244981}.html
         (сваля ги fetch_sources.py)
Изход:   prototype/data/raw/dv/dv_laws_2026.json
Само stdlib.
"""
import html, json, re, sys
from html.parser import HTMLParser

RAW = str(__import__("pathlib").Path(__file__).resolve().parents[2]) + "/prototype/data/raw/dv"
DOCS = {
    "zdb": ("zdb2026_dv69_idMat245041.html", "Закон за държавния бюджет на Република България за 2026 г.", "ДВ, бр. 69 от 31.07.2026 г.",
            "https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=245041"),
    "zbdoo": ("zbdoo2026_dv68_idMat244982.html", "Закон за бюджета на държавното обществено осигуряване за 2026 г.", "ДВ, бр. 68 от 28.07.2026 г.",
              "https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=244982"),
    "zbnzok": ("zbnzok2026_dv68_idMat244981.html", "Закон за бюджета на Националната здравноосигурителна каса за 2026 г.", "ДВ, бр. 68 от 28.07.2026 г.",
               "https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=244981"),
}
NUM = re.compile(r"^-?\d{1,3}(?: \d{3})*(?:,\d+)?$")
# В текста на ДВ някои имена на общини започват с латинска буква, която изглежда като кирилска
# („Kресна“, „Pазлог“, „Cандански“…). За търсене ги превръщаме в кирилица; оригиналът се пази.
LAT2CYR = str.maketrans("ABCEHKMOPTXaceopxy", "АВСЕНКМОРТХасеорху")


def num(s):
    return float(s.replace(" ", "").replace(",", "."))


class Doc(HTMLParser):
    """Последователност от „абзаци“ (текст извън таблиците на закона) и таблици (редове от клетки).

    Страницата на ДВ е обвита в таблици за оформление, затова текстът на закона е на дълбочина
    base (брой отворени <table>), а таблиците на закона — на base + 1.
    """

    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.items, self.depth, self.cell, self.row, self.tbl, self.par = [], 0, None, None, None, []

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.depth += 1
            if self.depth == self.base + 1:
                self.flush(); self.tbl = []
        elif tag == "tr" and self.depth == self.base + 1:
            self.row = []
        elif tag in ("td", "th") and self.depth == self.base + 1:
            self.cell = []
        elif tag in ("p", "br", "div", "td", "tr") and self.depth == self.base:
            self.flush()

    def handle_endtag(self, tag):
        if tag == "table":
            if self.depth == self.base + 1 and self.tbl is not None:
                self.items.append(("table", self.tbl)); self.tbl = None
            self.depth = max(0, self.depth - 1)
        elif tag == "tr" and self.depth == self.base + 1 and self.row is not None:
            if any(c for c in self.row):
                self.tbl.append(self.row)
            self.row = None
        elif tag in ("td", "th") and self.depth == self.base + 1 and self.cell is not None:
            self.row.append(re.sub(r"\s+", " ", "".join(self.cell)).strip()); self.cell = None
        elif tag in ("p", "div", "td") and self.depth == self.base:
            self.flush()

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)
        elif self.depth == self.base:
            self.par.append(data)

    def flush(self):
        t = re.sub(r"\s+", " ", "".join(self.par)).strip()
        if t and not t.startswith(("800x600", "Normal", "/* Style")):
            self.items.append(("p", t))
        self.par = []


class Depths(HTMLParser):
    """Първи проход: на каква дълбочина на <table> е абзацът „Чл. 1.“."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth, self.buf, self.found = 0, [], None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.depth += 1
        if tag == "p":
            self.buf = []

    def handle_endtag(self, tag):
        if tag == "table":
            self.depth -= 1
        if tag == "p" and self.found is None and re.match(r"^\s*Чл\.\s*1\.", "".join(self.buf)):
            self.found = self.depth

    def handle_data(self, data):
        self.buf.append(data)


def parse(name):
    src = open(f"{RAW}/{name}", encoding="utf-8", errors="replace").read()
    dp = Depths(); dp.feed(src)
    if dp.found is None:
        sys.exit(f"{name}: не намерих „Чл. 1.“")
    d = Doc(dp.found)
    d.feed(src)
    d.flush()
    # контекст: последният срещнат „Чл. N“ / „ал. N“ / „Приложение № …“
    out, art, para = [], None, None
    for kind, x in d.items:
        if kind == "p":
            m = re.match(r"^Чл\. (\d+[а-я]?)\.", x)
            if m:
                art, para = m.group(1), None
            m2 = re.search(r"^(?:Чл\. \d+[а-я]?\. )?\((\d+)\)", x)
            if m2:
                para = m2.group(1)
            if x.startswith("Приложение №"):
                art, para = x, None
            out.append({"kind": "p", "art": art, "para": para, "text": x})
        else:
            out.append({"kind": "table", "art": art, "para": para, "rows": x})
    return out


def kv_table(rows):
    """Таблица „№ | Показател | Сума“ → [{no, label, value}] (хил. €)."""
    res = []
    for r in rows:
        cells = [c for c in r]
        vals = [c for c in cells if NUM.match(c)]
        if not vals:
            continue
        label = next((c for c in cells if c and not NUM.match(c) and not re.match(r"^[IVXІ]+\.$|^\d+(\.\d+)*\.?$", c)), "")
        no = next((c for c in cells if re.match(r"^[IVXІ]+\.$|^\d+(\.\d+)*\.?$", c)), "")
        if not label:  # редът с номерата на колоните („1 | 2“)
            continue
        res.append({"no": no, "label": label, "value": num(vals[-1])})
    return res


def quote(items, art, startswith=None, contains=None):
    for it in items:
        if it["kind"] == "p" and it["art"] == art and (not startswith or it["text"].startswith(startswith)) and (not contains or contains in it["text"]):
            return it["text"]
    return None


def article_text(items, art):
    return " ".join(it["text"] for it in items if it["kind"] == "p" and it["art"] == art)


def main():
    res = {}
    for key, (name, title, dv, url) in DOCS.items():
        res[key] = {"title": title, "dv": dv, "url": url, "file": f"data/raw/dv/{name}", "unit_tables": "хил. €"}
    zdb, zbdoo, zbnzok = (parse(DOCS[k][0]) for k in ("zdb", "zbdoo", "zbnzok"))

    # ---- ЗДБ чл. 1 ----
    t1 = [it for it in zdb if it["kind"] == "table" and it["art"] == "1"]
    res["zdb"]["art1"] = {f"para{it['para']}": kv_table(it["rows"]) for it in t1}
    res["zdb"]["art1_quote"] = quote(zdb, "1", startswith="Чл. 1.")

    # ---- ЗДБ чл. 51: общините ----
    t51 = [it for it in zdb if it["kind"] == "table" and it["art"] == "51"]
    muns, region = [], None
    for it in t51:
        for r in it["rows"]:
            if len(r) == 1 or (r[0] and r[0].upper().startswith("ОБЛАСТ") and not any(NUM.match(c) for c in r[1:])):
                if r[0].upper().startswith("ОБЛАСТ"):
                    region = r[0].strip()
                continue
            if len(r) == 7 and r[0] and not NUM.match(r[0]) and any(NUM.match(c) for c in r[1:]):
                v = [num(c) if NUM.match(c) else None for c in r[1:]]
                nm = r[0].translate(LAT2CYR)
                reg = region
                if nm.isupper() and "ОБЩИНА" in nm and not nm.startswith("ВСИЧКО"):
                    # „СТОЛИЧНА ОБЩИНА“ стои в таблицата без собствен ред „ОБЛАСТ …“ — не я слагаме към предишната област
                    nm, reg = nm.capitalize(), None
                muns.append({"region": reg, "name": nm, "name_in_dv": r[0], "total": v[0], "delegated": v[1], "equalizing": v[2],
                             "winter_roads": v[3], "capital": v[4], "other_targeted": v[5]})
    totals = [m for m in muns if m["name"].upper().startswith(("ОБЩО", "ВСИЧКО"))]
    muns = [m for m in muns if m not in totals]
    s = lambda k: round(sum(m[k] or 0 for m in muns), 1)
    checks = {k: s(k) for k in ("total", "delegated", "equalizing", "winter_roads", "capital", "other_targeted")}
    bad_rows = [m["name"] for m in muns if abs((m["delegated"] or 0) + (m["equalizing"] or 0) + (m["winter_roads"] or 0) + (m["capital"] or 0) - (m["total"] or 0)) > 0.15]
    res["zdb"]["art51"] = {"quote": quote(zdb, "51", startswith="Чл. 51."),
                           "columns": {"total": "1. Основни бюджетни взаимоотношения (к. 2 = 3+4+5+6)", "delegated": "Обща субсидия за делегираните от държавата дейности (к. 3)",
                                       "equalizing": "Обща изравнителна субсидия (к. 4)", "winter_roads": "За зимно поддържане и снегопочистване на общински пътища (к. 5)",
                                       "capital": "Целева субсидия за капиталови разходи (к. 6)", "other_targeted": "2. Трансфери за други целеви разходи за местни дейности (к. 7)"},
                           "count": len(muns), "sums": checks, "total_rows_in_law": totals, "rows_failing_3+4+5+6=2": bad_rows,
                           "municipalities": muns}

    # ---- ЗБДОО ----
    t = [it for it in zbdoo if it["kind"] == "table" and it["art"] == "1"]
    res["zbdoo"]["art1"] = {f"para{it['para']}": kv_table(it["rows"]) for it in t}
    res["zbdoo"]["art1_quote"] = quote(zbdoo, "1", startswith="Чл. 1.")
    res["zbdoo"]["art9"] = article_text(zbdoo, "9")
    res["zbdoo"]["art14"] = article_text(zbdoo, "14")
    res["zbdoo"]["art15"] = article_text(zbdoo, "15")
    tz = [it for it in zbdoo if it["kind"] == "table" and it["art"] and str(it["art"]).startswith("Приложение № 2А")]
    rates = []
    for it in tz:
        for r in it["rows"]:
            if len(r) >= 3 and re.match(r"^\d{2}$", r[0]) and re.match(r"^\d+[.,]\d+$", r[-1]):
                rates.append({"kid2025": r[0], "activity": r[1], "rate_pct": float(r[-1].replace(",", "."))})
    res["zbdoo"]["annex2A_tzpb"] = {"title": "Приложение № 2А към чл. 14, т. 2 — диференцирани осигурителни вноски за фонд „Трудова злополука и професионална болест“ от 1 август до 31 декември 2026 г.",
                                    "count": len(rates), "min_pct": min(r["rate_pct"] for r in rates) if rates else None,
                                    "max_pct": max(r["rate_pct"] for r in rates) if rates else None, "rows": rates}

    # ---- ЗБНЗОК ----
    t = [it for it in zbnzok if it["kind"] == "table" and it["art"] == "1"]
    res["zbnzok"]["art1"] = {f"para{it['para']}": kv_table(it["rows"]) for it in t}
    res["zbnzok"]["art1_quote"] = quote(zbnzok, "1", startswith="Чл. 1.")
    res["zbnzok"]["art2"] = article_text(zbnzok, "2")

    json.dump(res, open(f"{RAW}/dv_laws_2026.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("ЗДБ чл. 1:", {k: len(v) for k, v in res["zdb"]["art1"].items()})
    print("ЗДБ чл. 51: общини", res["zdb"]["art51"]["count"], "сборове", checks, "редове в закона „общо“:", totals, "неравни редове:", bad_rows)
    print("ЗБДОО чл. 1:", {k: len(v) for k, v in res["zbdoo"]["art1"].items()}, "| ТЗПБ:", res["zbdoo"]["annex2A_tzpb"]["count"], res["zbdoo"]["annex2A_tzpb"]["min_pct"], res["zbdoo"]["annex2A_tzpb"]["max_pct"])
    print("ЗБНЗОК чл. 1:", {k: len(v) for k, v in res["zbnzok"]["art1"].items()}, "| чл. 2:", res["zbnzok"]["art2"])


if __name__ == "__main__":
    main()
