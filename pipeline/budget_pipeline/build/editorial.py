#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""editorial.py - glossary.json (DATA_SPEC 3.16) and guide.json (3.17) for the example site.

Both files are EDITORIAL TEXT, not data: every word of the glossary terms and of the guide is copied programmatically

from the original sources and is never retyped here:

  glossary  <-  data/inputs/glossary.json            (64 terms, 5 categories, 7 related-term rows, 7 sources)
  guide     <-  data/cache/research/guide/guide_raw.txt   (introduction, 8 steps, "Preди да използваш или споделиш число")

Only the SHAPE changes (slug/categories/aliases/related/see as in DATA_SPEC 3.16, steps/blocks/next/checks as in 3.17).
The "Виж в бюджета" links of the old single-file frozen input are mapped to the route keys of the new router and every
href is checked against apps/web/client/routes.js (pattern match + route-param registry). A link that cannot be resolved
stops the build; nothing is guessed.

Deterministic (no clock, no randomness): two runs give byte-identical files. Pure Python 3 standard library.

Usage:  python -m budget_pipeline.build.editorial [--check]       (--check = build in memory, compare with disk, write nothing)
Output: data/release/glossary.json, data/release/guide.json     (exit code != 0 on any problem)
Input not in the repository: data/cache/research/guide/guide_raw.txt (the guide text as supplied; the result is already in data/release/guide.json).
"""
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))     # .../pipeline/budget_pipeline
ROOT = str(__import__("pathlib").Path(__file__).resolve().parents[3])         # repository root
SITE = os.path.join(ROOT, "apps", "web", "public")                     # the site
DATA_DIR = os.path.join(ROOT, "data", "release")
GLOSSARY_SRC = os.path.join(ROOT, "data", "inputs", "glossary.json")
GUIDE_SRC = os.path.join(ROOT, "data", "cache", "research", "guide", "guide_raw.txt")   # not in the repository
ROUTES_JS = os.path.join(ROOT, "apps", "web", "client", "routes.js")

BUILD_DATE = os.environ.get("BUILD_DATE", "2026-11-05")   # same default as pipeline/budget_pipeline/build/data_io.py; a constant => byte-identical rebuilds
TEXT_AS_OF = "2026-10-01"                                  # date of the source documents

# route params that have a closed registry (DATA_SPEC 2.3)
REVENUE_GROUPS = ["dds", "osiguritelni", "nedanachni", "pomoshti", "ddfl", "akcizi", "korporativen", "drugi"]

SEE_LABEL = "Виж в бюджета"

# "Виж в бюджета": slug -> new href.  Old target (GL_SEE of frozen input v3.6 / apps/web/public/index.html) in the comment.
# Sub-block anchors of the old single page (ix-komp, ix-mesec, ix-res, dl-*, tx-dop, jul) do not exist in the new router,
# so those links point to the screen that now holds the block ("approximate").
SEE = {
    "darzhaven-byudzhet": "#/izpalnenie/byudzheti",                     # izpalnenie/ix-komp
    "kfp": "#/izpalnenie/byudzheti",                                    # izpalnenie/ix-komp
    "konsolidirane": "#/izpalnenie/byudzheti",                          # izpalnenie/ix-komp
    "byudzheten-transfer": "#/izpalnenie/byudzheti",                    # izpalnenie/ix-komp
    "obshtinski-byudzhet": "#/obshtini",                                # obshtini
    "subsidiya": "#/obshtini",                                          # obshtini
    "sektor-darzhavno-upravlenie": "#/dalg",                            # dalg/dl-maastricht
    "priet-byudzhet": "#/vedomstva",                                    # vedomstva
    "byudzhetna-programa": "#/vedomstva",                               # vedomstva
    "parvostepenen-razporeditel-s-byudzhet": "#/vedomstva",             # vedomstva
    "proektobyudzhet": "#/merki",                                       # merki
    "prihodna-myarka": "#/merki",                                       # merki
    "razhodna-myarka": "#/merki",                                       # merki
    "fiskalen-efekt": "#/merki",                                        # merki
    "byudzhetna-prognoza": "#/prognoza",                                # dalg/dl-saldo  (new screen S13 is the forecast)
    "byudzhetno-saldo": "#/dalg",                                       # dalg/dl-saldo
    "byudzheten-defitsit": "#/dalg",                                    # dalg/dl-saldo
    "darzhaven-dalg": "#/dalg",                                         # dalg/dl-zdd
    "lihva": "#/dalg",                                                  # dalg/dl-lihvi
    "dyal-ot-bvp": "#/dalg",                                            # dalg/dl-chart
    "izpalnenie-na-byudzheta": "#/izpalnenie",                          # izpalnenie
    "otchet-za-byudzheta": "#/izpalnenie",                              # izpalnenie/ix-mesec
    "sezonnost": "#/izpalnenie",                                        # izpalnenie/ix-mesec
    "fiskalen-rezerv": "#/izpalnenie",                                  # izpalnenie/ix-res
    "byudzhetni-prihodi": "#/prihodi",                                  # prihodi
    "danachni-prihodi": "#/prihodi",                                    # prihodi/jul
    "nedanachni-prihodi": "#/prihodi/nedanachni",                       # prihodi/<Неданъчни приходи>
    "bezvazmezdno-finansirane": "#/prihodi/pomoshti",                   # prihodi/<Помощи, основно от ЕС>
    "dds": "#/prihodi/dds",                                             # prihodi/<ДДС>
    "aktsiz": "#/prihodi/akcizi",                                       # prihodi/<Акцизи>
    "danak-varhu-dohodite": "#/prihodi/ddfl",                           # prihodi/<Данък върху доходите>
    "korporativen-danak": "#/prihodi/korporativen",                     # prihodi/<Корпоративен данък>
    "osiguritelni-vnoski": "#/prihodi/osiguritelni",                    # prihodi/<Социални и здравни осигуровки>
    "osiguritelen-dohod": "#/danaci",                                   # danaci/tx-dop
    "danachna-stavka": "#/danaci",                                      # danaci/tx-dop
    "brutna-zaplata": "#/danaci",                                       # danaci
    "netna-zaplata": "#/danaci",                                        # danaci
    "obsht-razhod-na-rabotodatelya-za-zaplata": "#/danaci",             # danaci
    "byudzhetni-razhodi": "#/razhodi",                                  # razhodi
    "byudzhetna-funktsiya": "#/razhodi",                                # razhodi
    "razhod-na-chovek": "#/razhodi",                                    # razhodi
    "kapitalovi-razhodi": "#/",                                         # "" (home)
    "bvp": "#/",                                                        # "" (home)
}

problems = []


def problem(msg):
    problems.append(msg)


# --------------------------------------------------------------------------------------------------------- io helpers
def load_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def clean(obj, where="$"):
    """Normalise -0.0 and refuse NaN/Infinity (not valid JSON)."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            raise ValueError("non-finite number at " + where)
        return 0.0 if obj == 0 else obj
    if isinstance(obj, dict):
        return {k: clean(v, where + "." + str(k)) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v, where + "[%d]" % i) for i, v in enumerate(obj)]
    return obj


def jdumps(obj):
    """Minified UTF-8 JSON, keys in insertion order (same style as pipeline/budget_pipeline/build/data_io.py)."""
    return json.dumps(clean(obj), ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = text.encode("utf-8")
    if os.path.exists(path):
        with open(path, "rb") as fh:
            if fh.read() == data:
                return False
    with open(path, "wb") as fh:
        fh.write(data)
    return True


def meta(id_, title, source_note, as_of):
    return {"id": id_, "title": title, "status": "real", "source": ["wg"], "sourceNote": source_note,
            "asOf": as_of, "retrieved": BUILD_DATE, "mock": False}


# --------------------------------------------------------------------------------------------------------- routes.js
ROUTE_RE = re.compile(r"^R\('(S\d+)', '([^']+)', (null|'[^']*'), '([^']+)', '([^']+)', '([^']+)', '([^']+)'(?:, \{(.*)\})?\),?$")


def parse_routes(path=ROUTES_JS):
    """Read the route table of the SHELL (read-only). Returns [{id,key,pattern,title,step,segs}] in file order."""
    routes = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            m = ROUTE_RE.match(line.strip())
            if not m:
                continue
            rid, key, pat, _file, title, _group, _icon, opts = m.groups()
            pat = None if pat == "null" else pat[1:-1]
            step = None
            if opts:
                sm = re.search(r"\bstep:\s*(\d+)", opts)
                step = int(sm.group(1)) if sm else None
            segs = []
            if pat is not None:
                for s in [x for x in pat.split("/") if x]:
                    sm = re.match(r"^:(\w+)(?:\(([^)]+)\))?(\?)?$", s)
                    if sm:
                        segs.append({"name": sm.group(1), "re": re.compile("^(?:" + sm.group(2) + ")$") if sm.group(2) else None,
                                     "opt": bool(sm.group(3))})
                    else:
                        segs.append({"lit": s})
            routes.append({"id": rid, "key": key, "pattern": pat, "title": title, "step": step, "segs": segs})
    return routes


def match_href(routes, href):
    """Resolve '#/prihodi/dds?x=1' like js/routes.js match(): returns (route, params) or None."""
    if not href.startswith("#/"):
        return None
    path = href[1:].split("?", 1)[0]
    segs = [x for x in path.split("/") if x]
    ordered = sorted([r for r in routes if r["pattern"]], key=lambda r: -len(r["segs"]))   # longer patterns first (stable)
    for r in ordered:
        ps = r["segs"]
        required = len([p for p in ps if "lit" not in p and not p["opt"]]) + len([p for p in ps if "lit" in p])
        if len(segs) < required or len(segs) > len(ps):
            continue
        params, ok = {}, True
        for i, p in enumerate(ps):
            v = segs[i] if i < len(segs) else None
            if v is None:
                if not p.get("opt"):
                    ok = False
                continue
            if "lit" in p:
                if p["lit"] != v.lower():
                    ok = False
            elif p["re"] is not None:
                if p["re"].match(v):
                    params[p["name"]] = v
                elif p["re"].match(v.lower()):
                    params[p["name"]] = v.lower()
                else:
                    ok = False
            else:
                params[p["name"]] = v
            if not ok:
                break
        if ok:
            return r, params
    return None


# --------------------------------------------------------------------------------------------------------- glossary
def build_glossary(routes):
    src = load_json(GLOSSARY_SRC)
    terms_src = src["terms"]
    cats_src = src["categories"]
    rel_src = src["related"]["items"]

    if len(terms_src) != 64:
        problem("glossary source has %d terms, expected 64" % len(terms_src))
    by_n = {t["n"]: t for t in terms_src}
    by_slug = {t["slug"]: t for t in terms_src}
    if sorted(by_n) != list(range(1, 65)):
        problem("term numbers are not 1..64")
    if len(by_slug) != len(terms_src):
        problem("duplicate slugs in the glossary source")

    # categories (id/title as in the source; short/from/to kept for the filter chips and the section ranges)
    categories = [{"id": c["id"], "title": c["title"], "short": c["short"], "from": c["from"], "to": c["to"]} for c in cats_src]
    for c in cats_src:
        for t in terms_src:
            if c["from"] <= t["n"] <= c["to"] and t["cat"] != c["id"]:
                problem("term %s (n=%d) is in category %s but lies in the range of %s" % (t["slug"], t["n"], t["cat"], c["id"]))
    cat_ids = {c["id"] for c in cats_src}
    for t in terms_src:
        if t["cat"] not in cat_ids:
            problem("term %s has unknown category %s" % (t["slug"], t["cat"]))

    # related: every OTHER term of every "Свързани понятия" row that contains the term, with the row's note (as in the old UI)
    related = {}
    for row in rel_src:
        for n in row["terms"]:
            if n not in by_n:
                problem("related row %r points to unknown term number %s" % (row["text"], n))
    for t in terms_src:
        lst = []
        for row in rel_src:
            if t["n"] in row["terms"]:
                for m in row["terms"]:
                    if m != t["n"] and m in by_n:
                        if any(x["slug"] == by_n[m]["slug"] for x in lst):
                            problem("term %s: %s is related twice" % (t["slug"], by_n[m]["slug"]))
                            continue
                        lst.append({"slug": by_n[m]["slug"], "note": row["note"]})
        related[t["slug"]] = lst

    # "Виж в бюджета": resolve every href against routes.js
    for slug, href in SEE.items():
        if slug not in by_slug:
            problem("SEE: unknown slug %s" % slug)
            continue
        hit = match_href(routes, href)
        if hit is None:
            problem("SEE: %s -> %s does not match any route of apps/web/client/routes.js" % (slug, href))
            continue
        route, params = hit
        if route["key"] == "prihodi" and params.get("source") not in (None,) + tuple(REVENUE_GROUPS):
            problem("SEE: %s -> %s: unknown revenue group %r" % (slug, href, params.get("source")))

    terms = []
    for t in terms_src:
        o = {"n": t["n"], "slug": t["slug"], "title": t["title"], "name": t["name"]}
        if t.get("abbr"):
            o["abbr"] = t["abbr"]
        o["cat"] = t["cat"]
        o["def"] = t["def"]
        o["example"] = t["example"]
        o["aliases"] = [a["text"] for a in t["aliases"]]
        o["related"] = related[t["slug"]]
        o["see"] = [{"label": SEE_LABEL, "href": SEE[t["slug"]]}] if t["slug"] in SEE else []
        terms.append(o)

    relations = []
    for row in rel_src:
        relations.append({"text": row["text"], "from": row["from"], "to": list(row["to"]), "note": row["note"],
                          "terms": [by_n[n]["slug"] for n in row["terms"]]})

    intro = src["intro"]
    out = {
        "meta": meta("D22", src["title"],
                     "Речник с 64 термина на работна група „Бюджет на светло“: определенията, примерите и свързаните понятия са дословно "
                     "от документа; връзките „Виж в бюджета“ са към екраните на този сайт. Числата в примерите са условни.",
                     TEXT_AS_OF),
        "title": src["title"],
        "subtitle": src["subtitle"],
        "intro": {"lead": intro["lead"], "text": intro["text"],
                  "disclaimer": {"bold": intro["disclaimer"]["bold"], "text": intro["disclaimer"]["text"]}},
        "categories": categories,
        "terms": terms,
        "relationsTitle": src["related"]["title"],
        "relations": relations,
        "sourcesTitle": src["sources"]["title"],
        "sourcesIntro": src["sources"]["intro"],
        "sources": [{"name": s["name"], "url": s["url"]} for s in src["sources"]["items"]],
    }
    return out


def verify_glossary(out):
    """Independent re-read of the source: every text field must equal the original word for word."""
    src = load_json(GLOSSARY_SRC)
    st = {t["slug"]: t for t in src["terms"]}
    n_checked = 0
    if len(out["terms"]) != len(src["terms"]):
        problem("verify: term count differs")
    for t in out["terms"]:
        s = st.get(t["slug"])
        if s is None:
            problem("verify: slug %s not in source" % t["slug"])
            continue
        for k_out, k_src in (("n", "n"), ("title", "title"), ("name", "name"), ("cat", "cat"), ("def", "def"), ("example", "example")):
            if t[k_out] != s[k_src]:
                problem("verify: %s.%s differs from source" % (t["slug"], k_out))
            n_checked += 1
        if t.get("abbr") != (s.get("abbr") or None):
            problem("verify: %s.abbr differs from source" % t["slug"])
        if t["aliases"] != [a["text"] for a in s["aliases"]]:
            problem("verify: %s.aliases differ from source" % t["slug"])
    return n_checked


# --------------------------------------------------------------------------------------------------------- guide
PART_RE = re.compile(r"^===== ЧАСТ (\d) · (\d+) =====$")
STEP_RE = re.compile(r"^([1-8])\. (.+)$")
TITLE_RE = re.compile(r"^(.*?)\s*„([^“]+)“\s*$")
CHECKS_HEADING = "Преди да използваш или споделиш число"
NEXT_PREFIX = "Следва: "
CHECK_RE = re.compile(r"^(Провери пет неща:) (.+?)\. (Използвай .+)$")
CHECK_SHORT = ["Период", "Обхват", "Единица", "Статус", "Източник"]       # editorial short labels (also in the old frozen input v3.4)
CREDIT = "Работна група „Бюджет на светло“"


def read_guide_blocks():
    """Body of the raw file as paragraphs (the '#'-lines are the download header: author, channel, ids; never copied)."""
    if not os.path.exists(GUIDE_SRC):
        sys.stderr.write("editorial: input missing: %s (the guide text as supplied; it is not in the repository, "
                         "the result is already in data/release/guide.json)\n" % os.path.relpath(GUIDE_SRC, ROOT))
        sys.exit(2)
    with open(GUIDE_SRC, "r", encoding="utf-8") as fh:
        raw = fh.read().split("\n")
    body = [ln for ln in raw if not ln.startswith("#")]
    blocks, cur = [], []
    for ln in body + [""]:
        if ln.strip() == "":
            if cur:
                blocks.append(" ".join(x.strip() for x in cur))
                cur = []
        else:
            cur.append(ln)
    return blocks


def build_guide(routes):
    blocks = read_guide_blocks()
    parts, title, lead = [], None, None
    steps, cur, checks_text = [], None, None
    seen_check_heading = False
    expect_title = False
    for b in blocks:
        pm = PART_RE.match(b)
        if pm:
            parts.append(int(pm.group(1)))
            expect_title = (pm.group(1) == "1")
            continue
        if expect_title:
            title, expect_title = b, False
            continue
        if title is not None and lead is None:
            lead = b
            continue
        sm = STEP_RE.match(b)
        if sm:
            cur = {"n": int(sm.group(1)), "title": sm.group(2), "paras": [], "next": None}
            steps.append(cur)
            continue
        if b == CHECKS_HEADING:
            seen_check_heading = True
            cur = None
            continue
        if seen_check_heading:
            if checks_text is not None:
                problem("guide: more than one paragraph after the checks heading")
            checks_text = b
            continue
        if cur is None:
            problem("guide: paragraph outside a step: %r" % b[:60])
            continue
        if b.startswith(NEXT_PREFIX):
            cur["next"] = b
        else:
            cur["paras"].append(b)

    if parts != [1, 2]:
        problem("guide: expected parts [1, 2], got %r" % parts)
    if [s["n"] for s in steps] != list(range(1, 9)):
        problem("guide: steps are %r, expected 1..8" % [s["n"] for s in steps])
    if title is None or lead is None or checks_text is None:
        problem("guide: title/lead/checks paragraph missing")
        return None

    # screen of every step = route whose title equals the quoted screen name AND whose step number equals n (never guessed)
    out_steps = []
    for i, s in enumerate(steps):
        tm = TITLE_RE.match(s["title"])
        if not tm:
            problem("guide step %d: title has no quoted screen name: %r" % (s["n"], s["title"]))
            continue
        verb, label = tm.group(1), tm.group(2)
        route = next((r for r in routes if r["title"] == label and r["step"] == s["n"] and r["pattern"]), None)
        if route is None:
            problem("guide step %d: no route with title %r and step %d in routes.js" % (s["n"], label, s["n"]))
            continue
        sample = "#/" + "/".join(x for x in route["pattern"].split("/") if x and not x.startswith(":"))
        if match_href(routes, sample) is None or match_href(routes, sample)[0]["id"] != route["id"]:
            problem("guide step %d: href %s does not resolve to %s" % (s["n"], sample, route["id"]))
        if len(s["paras"]) != 2:
            problem("guide step %d: expected 2 paragraphs, got %d" % (s["n"], len(s["paras"])))
            continue
        o = {"n": s["n"], "title": s["title"], "verb": verb,
             "screen": {"id": route["id"], "label": label, "href": sample},
             "intro": s["paras"][0],
             "blocks": [{"type": "p", "role": "note", "text": s["paras"][1]}]}
        out_steps.append(o)
        o["_next_text"] = s["next"]
        o["_screen_href"] = sample
    # next links
    for i, o in enumerate(out_steps):
        nt = o.pop("_next_text")
        o.pop("_screen_href")
        if i < len(out_steps) - 1:
            if not nt:
                problem("guide step %d: missing the 'Следва:' line" % o["n"])
                continue
            nxt = out_steps[i + 1]
            o["next"] = {"n": nxt["n"], "title": nxt["title"], "href": nxt["screen"]["href"], "text": nt}
        elif nt:
            problem("guide step %d: unexpected 'Следва:' line" % o["n"])

    # the five checks: the enumeration inside ONE sentence of the source, cut at its own commas and the last " и "
    cm = CHECK_RE.match(checks_text)
    checks = None
    if not cm:
        problem("guide: the checks paragraph does not have the expected shape")
    else:
        lead_c, listing, end_c = cm.groups()
        parts_c = listing.split(", ")
        last = parts_c.pop()
        a, b2 = last.split(" и ", 1)
        items_text = parts_c + [a, b2]
        if len(items_text) != 5:
            problem("guide: expected 5 checks, got %d" % len(items_text))
        rebuilt = lead_c + " " + ", ".join(items_text[:-1]) + " и " + items_text[-1] + ". " + end_c
        if rebuilt != checks_text:
            problem("guide: the five checks do not reassemble into the source paragraph")
        checks = {"title": "Петте проверки", "heading": CHECKS_HEADING, "lead": lead_c,
                  "items": [{"n": k + 1, "short": CHECK_SHORT[k], "text": t} for k, t in enumerate(items_text)],
                  "end": end_c, "text": checks_text}

    return {
        "meta": meta("D23", "Пътеводител: разбери бюджета стъпка по стъпка",
                     "Текстът на пътеводителя на работна група „Бюджет на светло“ е дословно от оригинала: въведение, осем стъпки и "
                     "„Преди да използваш или споделиш число“. Препратките към екраните на сайта са добавени.",
                     TEXT_AS_OF),
        "title": title,
        "lead": lead,
        "steps": out_steps,
        "checks": checks,
        "credit": CREDIT,
    }


def verify_guide(out):
    """Every text of guide.json must be a verbatim piece of the source, and every source paragraph must be used once."""
    with open(GUIDE_SRC, "r", encoding="utf-8") as fh:
        raw = fh.read()
    body = "\n".join(ln for ln in raw.split("\n") if not ln.startswith("#"))
    texts = [out["title"], out["lead"]]
    for s in out["steps"]:
        texts.append(s["intro"])
        texts += [b["text"] for b in s["blocks"]]
        if "next" in s:
            texts.append(s["next"]["text"])
    texts.append(out["checks"]["text"])
    for t in texts:
        if body.count(t) != 1:
            problem("verify guide: text occurs %d times in the source (want 1): %r" % (body.count(t), t[:70]))
    for s in out["steps"]:
        if ("%d. %s" % (s["n"], s["title"])) not in body:
            problem("verify guide: heading of step %d not found verbatim" % s["n"])
    if (CHECKS_HEADING + "\n") not in body:
        problem("verify guide: checks heading not found")
    for it in out["checks"]["items"]:
        if it["text"] not in out["checks"]["text"]:
            problem("verify guide: check item %r is not inside the paragraph" % it["text"])
    # nothing of the source body is lost: remove all used texts + headings + part markers, only whitespace may remain
    rest = body
    for t in texts:
        rest = rest.replace(t, "", 1)
    for s in out["steps"]:
        rest = rest.replace("%d. %s" % (s["n"], s["title"]), "", 1)
    rest = rest.replace(CHECKS_HEADING, "", 1)
    rest = PART_RE.sub("", "\n".join(ln for ln in rest.split("\n")))
    rest = re.sub(r"={5} ЧАСТ \d · \d+ ={5}", "", rest)
    if rest.strip():
        problem("verify guide: unused source text left over: %r" % rest.strip()[:120])
    return len(texts)


# --------------------------------------------------------------------------------------------------------- main
def main(argv):
    import argparse
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    check_only = args.check
    routes = parse_routes()
    if len(routes) < 20:
        problem("routes.js: only %d routes parsed (expected 30)" % len(routes))
    glossary = build_glossary(routes)
    n_gl = verify_glossary(glossary)
    guide = build_guide(routes)
    n_gd = verify_guide(guide) if guide else 0
    if problems:
        sys.stderr.write("editorial.py: %d PROBLEM(S)\n" % len(problems))
        for p in problems:
            sys.stderr.write("  - " + p + "\n")
        return 1
    outputs = [("glossary.json", glossary), ("guide.json", guide)]
    for name, obj in outputs:
        text = jdumps(obj) + "\n"
        path = os.path.join(DATA_DIR, name)
        if check_only:
            same = os.path.exists(path) and open(path, "rb").read() == text.encode("utf-8")
            print("%-14s %7d bytes  %s" % (name, len(text.encode("utf-8")), "identical to disk" if same else "DIFFERS from disk"))
            if not same:
                return 1
        else:
            changed = write_text(path, text)
            print("%-14s %7d bytes  %s" % (name, len(text.encode("utf-8")), "written" if changed else "unchanged"))
    print("glossary: %d terms, %d with 'Виж в бюджета', %d relations, %d text fields verified against the source" % (
        len(glossary["terms"]), sum(1 for t in glossary["terms"] if t["see"]), len(glossary["relations"]), n_gl))
    print("guide: %d steps, %d checks, %d text blocks verified verbatim against the source" % (
        len(guide["steps"]), len(guide["checks"]["items"]), n_gd))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
