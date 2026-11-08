#!/usr/bin/env python3
"""Извлича речника „Речник: бюджетът на разбираем език“ (64 термина) от PDF-а на UX члена на работната група.

Какво прави: чете tmp/guide/Budget-na-svetlo-rechnik-64-termina.pdf (14 страници) с PyMuPDF и разпознава
всеки ред по шрифта, както е набран в PDF-а:
  27 pt удебелен  — заглавие на страница („Речник: бюджетът…“, „Как да работи речникът“, „Свързани понятия“, …);
  18 pt удебелен  — подзаглавие / раздел („Основи: как е устроен бюджетът“ и останалите четири категории);
  11,5 pt удебелен — заглавие на елемент: термин „N. Име“, функция на речника, двойка свързани понятия, източник;
  10 pt           — основен текст (определението на термина);
  9,5 pt, сиво-син — „Пример:“ (удебелен етикет + текст) или бележката към двойка свързани понятия;
  9 pt            — надзаглавие, дата, бележка, адрес на източник; 8 pt — колонтитул (само се сверява).
Редовете на един абзац се сливат с един интервал (в PDF-а няма пренесени думи и всички интервали са обикновени).
Текстът се копира дословно — без преразказ. Изведени (не дословни) са само: slug за адреса (#/rechnik/<slug>),
краткото име и съкращението (от „Име - СЪКР“), търсещите синоними (виж ALIASES по-долу — всички са от самия PDF)
и номерата на термините в „Свързани понятия“ (кратките имена там са сверени с термините; двусмислените са в MANUAL).

Проверки (изходът е 1, ако някоя не мине): 64 термина, номерирани 1–64 подред, всеки с определение и пример;
обхватите „термини 1-13“ … от съдържанието на с. 1 съвпадат с термините под всеки раздел; пет раздела и пет кратки
имена на категориите (с. 2); всеки ред от PDF-а (без колонтитула) е използван точно веднъж; колонтитулът е еднакъв
и номерата на страниците са подред; всяко име в „Свързани понятия“ е намерено; адресите на източниците съвпадат
с връзките в PDF-а; slug-овете са уникални.

Вход:    tmp/guide/Budget-na-svetlo-rechnik-64-termina.pdf  (PDF-ът НЕ е в хранилището — поставете го там; папката tmp/ е в .gitignore)
Изход:   data/inputs/glossary.json (gen_inline.py го вгражда в apps/web/public/index.html като const GLOSSARY)
Изисква: pymupdf (pip install pymupdf) — в отделен venv, не в репото на бота.
Употреба: python3 glossary.py [--png DIR]   (--png: снимки на с. 1–3 и 13, за да се види оформлението)
"""

import datetime, hashlib, json, re, sys

import pymupdf

ROOT = str(__import__("pathlib").Path(__file__).resolve().parents[3])
PDF = f"{ROOT}/tmp/guide/Budget-na-svetlo-rechnik-64-termina.pdf"
OUT = f"{ROOT}/data/inputs/glossary.json"
FOOTER = "Бюджет на светло | Речник с 64 термина"
EXAMPLE = "Пример:"

# Транслитерация по Закона за транслитерацията (същата като в адресите на сайта: #/patevoditel, #/rechnik).
LAT = {"а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l",
       "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch",
       "ш": "sh", "щ": "sht", "ъ": "a", "ь": "y", "ю": "yu", "я": "ya"}

# „Свързани понятия“ (с. 13) ползва кратки имена. Повечето съвпадат с име, съкращение или част от име на термин
# (resolve() ги намира сама); тези са двусмислени или с друга дума и са сверени на ръка:
MANUAL = {
    "дълг": 47,        # „Дефицит → Салдо, дълг, ново заемане“: „дълг“ е в №47 „Държавен дълг“ и в №48 „Нов дълг / ново заемане“;
                       # №48 е отделно в същия ред („ново заемане“), значи „дълг“ е №47 (бележката: „дългът е към дата“).
    "осигуровки": 25,  # „Брутна заплата → Нетна заплата, осигуровки, …“: №25 „Осигурителни вноски“ (в PDF-а няма термин „Осигуровки“).
}


def sha256(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def slugify(s):
    s = s.lower()
    s = "".join(LAT.get(c, c) for c in s)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def style(span):
    """Клас на реда по шрифта: title, h1, h2, body, small9, ex (9,5 pt), footer."""
    sz = round(span["size"], 1)
    bold = "Bold" in span["font"]
    if sz == 27.0 and bold:
        return "title"
    if sz == 18.0 and bold:
        return "h1"
    if sz == 11.5 and bold:
        return "h2"
    if sz == 10.0:
        return "body"
    if sz == 9.5:
        return "ex"
    if sz == 9.0:
        return "small"
    if sz == 8.0:
        return "footer"
    raise ValueError(f"непознат шрифт: {span['font']} {sz} pt: {span['text']!r}")


def read_lines(doc):
    """Всички редове: (страница, y, клас, текст, [(текст, удебелен)]) в реда на четене; колонтитулите отделно."""
    lines, footers = [], []
    for pno, page in enumerate(doc, 1):
        for b in page.get_text("dict")["blocks"]:
            if b.get("type") != 0:
                continue
            for ln in b["lines"]:
                spans = [s for s in ln["spans"] if s["text"]]
                if not spans:
                    continue
                classes = {style(s) for s in spans}
                if len(classes) != 1:
                    raise ValueError(f"с. {pno}: ред със смесен шрифт {classes}: {''.join(s['text'] for s in spans)!r}")
                cls = classes.pop()
                rec = {"page": pno, "y": round(spans[0]["bbox"][1], 1), "x": round(spans[0]["bbox"][0], 1), "cls": cls,
                       "size": round(spans[0]["size"], 1), "text": "".join(s["text"] for s in spans),
                       "spans": [(s["text"], "Bold" in s["font"]) for s in spans]}
                (footers if cls == "footer" else lines).append(rec)
    lines.sort(key=lambda r: (r["page"], r["y"], r["x"]))
    return lines, footers


def paragraphs(lines):
    """Слива последователните редове от един клас в абзац, ако отстоянието е като между редовете на абзац
    (до 1,75 × размера на шрифта; между абзаците е повече). Пази удебелените части (етикета „Пример:“ и т.н.)."""
    out = []
    for r in lines:
        p = out[-1] if out else None
        if p and p["cls"] == r["cls"] and p["page"] == r["page"] and r["y"] - p["last_y"] <= r["size"] * 1.75:
            p["text"] += " " + r["text"]
            p["spans"] += [(" ", False)] + r["spans"]
            p["last_y"] = r["y"]
            p["n_lines"] += 1
        else:
            out.append({**r, "last_y": r["y"], "n_lines": 1, "spans": list(r["spans"])})
    for p in out:
        p["text"] = re.sub(r" {2,}", " ", p["text"]).strip()
    return out


def bold_head(p):
    """(удебеленото начало, останалото) на абзац с удебелен етикет — „Пример:“ или „Числата в примерите са условни.“"""
    head = ""
    for t, b in p["spans"]:
        if not b:
            break
        head += t
    return head.strip(), p["text"][len(head):].strip() if p["text"].startswith(head) else None


def main():
    doc = pymupdf.open(PDF)
    lines, footers = read_lines(doc)
    paras = paragraphs(lines)
    problems = []

    # колонтитул: еднакъв текст и номер на страницата подред
    for pno in range(1, doc.page_count + 1):
        f = sorted((r for r in footers if r["page"] == pno), key=lambda r: r["x"])
        if [r["text"] for r in f] != [FOOTER, str(pno)]:
            problems.append(f"колонтитул на с. {pno}: {[r['text'] for r in f]}")

    used = [0] * len(paras)
    def take(i):
        used[i] += 1
        return paras[i]

    # раздели на документа по заглавията от 27 pt (корицата е до първото такова след нея)
    titles = [i for i, p in enumerate(paras) if p["cls"] == "title"]
    by_title = {}
    for k, i in enumerate(titles):
        end = titles[k + 1] if k + 1 < len(titles) else len(paras)
        by_title.setdefault(paras[i]["text"], []).append((i, end))
    cover_title_i = titles[0]
    if paras[cover_title_i]["page"] != 1:
        problems.append("първото заглавие не е на корицата")

    # --- корица (с. 1)
    i0, i1 = by_title[paras[cover_title_i]["text"]][0]
    cover = [k for k in range(i1) if paras[k]["page"] == 1]
    kicker = take(cover[0]); title = take(cover_title_i)
    sub = take(cover[2]); meta = take(cover[3])
    assert kicker["cls"] == "small" and sub["cls"] == "h1" and meta["cls"] == "small", "корицата не е в очаквания ред"
    intro_paras, contents, k = [], [], 4
    while paras[cover[k]]["cls"] == "body":
        intro_paras.append(take(cover[k])); k += 1
    contents_h = take(cover[k]); k += 1
    assert contents_h["cls"] == "h1", contents_h
    for j in cover[k:]:
        p = take(j)
        if not p["text"].startswith("• "):
            problems.append(f"съдържание: ред без „• “: {p['text']!r}")
        contents.append(p["text"][2:])
    lead, text, disc = intro_paras[0]["text"], intro_paras[1]["text"], intro_paras[2]
    disc_bold, disc_rest = bold_head(disc)
    m = re.search(r"(\d{1,2}) (\w+) (\d{4}) г\.$", meta["text"])
    months = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"]
    date = datetime.date(int(m[3]), months.index(m[2]) + 1, int(m[1])).isoformat() if m else None

    # --- „Как да работи речникът“ (с. 2): функция (11,5 pt) + текст (10 pt); бележка (9 pt) накрая
    (a, b), = by_title["Как да работи речникът"]
    take(a)
    func, func_note = [], []
    j = a + 1
    while j < b and paras[j]["page"] == paras[a]["page"]:  # само с. 2; разделите с термините са с 18 pt, не с 27 pt
        p = take(j)
        if p["cls"] == "h2":
            t = take(j + 1)
            assert t["cls"] == "body", t
            func.append({"name": p["text"], "text": t["text"]}); j += 2
        elif p["cls"] == "small":
            func_note.append(p["text"]); j += 1
        else:
            raise ValueError(f"с. 2: неочакван абзац {p['text']!r}")
    cat_func = next(f for f in func if f["name"] == "Категории")
    short_names = re.findall(r"„([^“]+)“", cat_func["text"])
    search_func = next(f for f in func if f["name"].startswith("Търсачка"))
    m_alias = re.search(r"Например „([^“]+)“ намира „([^“]+)“", search_func["text"])

    # --- разделите с термините (с. 3–12): раздел (18 pt), термин „N. Име“ (11,5 pt), определение (10 pt), пример (9,5 pt)
    first_section = next(k for k in range(len(paras)) if paras[k]["page"] >= 3 and paras[k]["cls"] == "h1")
    end_terms = by_title["Свързани понятия"][0][0]
    categories, terms = [], []
    j = first_section
    while j < end_terms:
        p = take(j)
        if p["cls"] == "h1":
            categories.append({"title": p["text"], "page": p["page"], "terms": []}); j += 1
            continue
        mh = re.fullmatch(r"(\d+)\. (.+)", p["text"])
        if p["cls"] != "h2" or not mh:
            raise ValueError(f"с. {p['page']}: очакван термин, а е {p['cls']} {p['text']!r}")
        d, e = take(j + 1), take(j + 2)
        lab, ex = bold_head(e)
        if d["cls"] != "body" or e["cls"] != "ex" or lab != EXAMPLE or not ex:
            raise ValueError(f"термин {mh[1]}: определение/пример не са на мястото си ({d['cls']}, {e['cls']}, {lab!r})")
        full = mh[2]
        ma = re.fullmatch(r"(.+) - ([А-Я]{2,})", full)
        terms.append({"n": int(mh[1]), "title": full, "name": ma[1] if ma else full, "abbr": ma[2] if ma else None,
                      "def": d["text"], "example": ex, "page": p["page"], "lines": [p["n_lines"], d["n_lines"], e["n_lines"]]})
        categories[-1]["terms"].append(int(mh[1]))
        j += 3

    # --- „Свързани понятия“ (с. 13): „Ляво → дясно, дясно“ (11,5 pt) + бележка (9,5 pt)
    (a, b), = by_title["Свързани понятия"]
    take(a)
    related = []
    for j in range(a + 1, b, 2):
        h, note = take(j), take(j + 1)
        if h["cls"] != "h2" or note["cls"] != "ex" or " → " not in h["text"]:
            raise ValueError(f"с. 13: неочакван ред {h['text']!r}")
        left, right = h["text"].split(" → ")
        related.append({"text": h["text"], "from": left, "to": [x.strip() for x in right.split(", ")], "note": note["text"]})

    # --- „Източници и поддръжка“ (с. 14): увод (10 pt), източник (11,5 pt) + адрес (9 pt), „Поддръжка в платформата“ (18 pt) + текст
    (a, b), = by_title["Източници и поддръжка"]
    take(a)
    src_intro = take(a + 1)["text"]
    sources, maint = [], None
    j = a + 2
    while j < b:
        p = take(j)
        if p["cls"] == "h2":
            u = take(j + 1)
            assert u["cls"] == "small" and u["text"].startswith("https://"), u
            sources.append({"name": p["text"], "url": u["text"]}); j += 2
        elif p["cls"] == "h1":
            maint = {"title": p["text"], "text": take(j + 1)["text"]}; j += 2
        else:
            raise ValueError(f"с. 14: неочакван абзац {p['text']!r}")
    links = [ln["uri"] for ln in doc[13].get_links() if ln.get("uri")]
    if links != [s["url"] for s in sources]:
        problems.append(f"адресите на източниците не съвпадат с връзките в PDF-а: {links}")

    # --- проверки на термините и разделите
    if [t["n"] for t in terms] != list(range(1, 65)):
        problems.append(f"номерата на термините не са 1–64: {[t['n'] for t in terms]}")
    ranges = [tuple(map(int, m.groups())) for m in (re.search(r"термини (\d+)-(\d+)$", c) for c in contents) if m]
    if len(categories) != 5 or len(ranges) != 5 or len(short_names) != 5:
        problems.append(f"раздели: {len(categories)}, обхвати в съдържанието: {len(ranges)}, кратки имена: {short_names}")
    for c, (lo, hi), short, line in zip(categories, ranges, short_names, (x for x in contents if "термини" in x)):
        if c["terms"] != list(range(lo, hi + 1)):
            problems.append(f"„{c['title']}“: термините са {c['terms'][:1]}…{c['terms'][-1:]}, а в съдържанието {lo}-{hi}")
        if not line.startswith(c["title"].split(":")[0]):
            problems.append(f"редът в съдържанието {line!r} не отговаря на раздела „{c['title']}“")
        c.update({"id": slugify(short), "short": short, "from": lo, "to": hi})
    if any(u != 1 for u in used):
        problems.append(f"неизползвани или двойно използвани абзаци: {[(paras[k]['page'], paras[k]['text'][:40], u) for k, u in enumerate(used) if u != 1]}")

    # --- slug-ове и търсещи синоними (всички са от PDF-а; при всеки е откъде е)
    for t in terms:
        t["slug"] = slugify(t["abbr"]) if t["abbr"] else slugify(t["name"])
        t["cat"] = next(c["id"] for c in categories if c["from"] <= t["n"] <= c["to"])
        t["aliases"] = []
    slugs = [t["slug"] for t in terms]
    if len(set(slugs)) != len(slugs):
        problems.append(f"повтарящи се slug-ове: {sorted(s for s in slugs if slugs.count(s) > 1)}")
    by_n = {t["n"]: t for t in terms}

    def alias(n, text, src):
        t = by_n[n]
        if text.lower() not in {t["title"].lower(), t["name"].lower()} and text.lower() not in (a["text"].lower() for a in t["aliases"]):
            t["aliases"].append({"text": text, "src": src})

    for t in terms:
        if t["abbr"]:
            alias(t["n"], t["abbr"], "съкращението в заглавието")
        if " / " in t["name"]:
            for part in t["name"].split(" / "):
                alias(t["n"], part, "част от заглавието")
        for q in re.findall(r"наричана „([^“]+)“", t["def"]):
            alias(t["n"], q, "определението („често наричана …“)")
    if m_alias:
        hit = [t for t in terms if t["title"] == m_alias[2]]
        if len(hit) != 1:
            problems.append(f"примерът от „Търсачка“ сочи към „{m_alias[2]}“, а такъв термин няма")
        else:
            alias(hit[0]["n"], m_alias[1], "с. 2, „Търсачка“ (пример за разговорен израз)")
    else:
        problems.append("няма пример в „Търсачка“ на с. 2")

    def resolve(name):
        """Номерът на термина за кратко име от „Свързани понятия“."""
        if name in MANUAL:
            return MANUAL[name], "сверено на ръка"
        low = name.lower()
        exact = [t for t in terms if low in {t["title"].lower(), t["name"].lower(), (t["abbr"] or "").lower()}
                 or low in (x.lower() for x in t["name"].split(" / "))]
        if len(exact) == 1:
            return exact[0]["n"], "име или съкращение"
        word = [t for t in terms if re.search(rf"(^|[^\w]){re.escape(low)}([^\w]|$)", t["title"].lower())]
        if len(word) == 1:
            return word[0]["n"], "дума от заглавието"
        return None, f"не е намерен ({len(exact)} точни, {len(word)} по дума)"

    for r in related:
        ns = []
        for name in [r["from"], *r["to"]]:
            n, how = resolve(name)
            if n is None:
                problems.append(f"„Свързани понятия“: „{name}“ {how}")
                continue
            ns.append(n)
            alias(n, name, "с. 13, „Свързани понятия“")
        r["terms"] = ns

    out = {
        "title": title["text"],
        "subtitle": sub["text"],
        "kicker": kicker["text"],
        "meta": meta["text"],
        "date": date,
        "source": {"file": "research/guide/Budget-na-svetlo-rechnik-64-termina.pdf", "sha256": sha256(PDF), "pages": doc.page_count,
                   "from": "UX членът на работната група, 01.10.2026: „Искам да направиш речник с думите и да бъде по този начин като "
                           "във файла. Да стои отляво на десктоп версия в лентата с инструменти.“",
                   "footer": FOOTER},
        "extracted": datetime.date.today().isoformat(),
        "note": "Текстовете са дословно от PDF-а (редовете на абзаца са слети с интервал). Изведени са само slug, name/abbr, "
                "aliases (всеки с източника си в PDF-а) и terms в related (номерата на термините за кратките имена).",
        "intro": {"lead": lead, "text": text, "disclaimer": {"bold": disc_bold, "text": disc_rest}},
        "contents": {"title": contents_h["text"], "items": contents},
        "functionality": {"title": "Как да работи речникът", "items": func, "note": " ".join(func_note)},
        "categories": [{k: c[k] for k in ("id", "title", "short", "from", "to", "page")} for c in categories],
        "terms": [{k: t[k] for k in ("n", "slug", "title", "name", "abbr", "cat", "def", "example", "aliases", "page")} for t in terms],
        "related": {"title": "Свързани понятия", "items": related},
        "sources": {"title": "Източници и поддръжка", "intro": src_intro, "items": sources},
        "maintenance": maint,
        "checks": {"terms": len(terms), "categories": len(categories), "related": len(related), "sources": len(sources),
                   "paragraphs_used_once": all(u == 1 for u in used), "pdf_lines": len(lines), "problems": problems},
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(terms)} термина в {len(categories)} раздела ({', '.join(c['short'] for c in categories)}); "
          f"{len(related)} свързани; {len(sources)} източника; {sum(len(t['aliases']) for t in terms)} синонима → {OUT}")
    if "--png" in sys.argv:
        d = sys.argv[sys.argv.index("--png") + 1]
        for k in (0, 1, 2, 12):
            doc[k].get_pixmap(dpi=90).save(f"{d}/rechnik-p{k + 1:02d}.png")
        print(f"снимки на с. 1, 2, 3 и 13 → {d}")
    for p in problems:
        print("ПРОБЛЕМ:", p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
