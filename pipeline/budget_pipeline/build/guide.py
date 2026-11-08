#!/usr/bin/env python3
"""Align and validate the editorial guide against the current screen titles and links."""

from pathlib import Path as _Path
import json, os, re, sys

ROOT = str(_Path(__file__).resolve().parents[3])   # repository root
SITE = os.path.join(ROOT, "apps", "web", "public")                  # the site (current site)
GUIDE = os.path.join(ROOT, "data", "release", "guide.json")
ROUTES = os.path.join(ROOT, "apps", "web", "client", "routes.js")

# step n -> (new quoted screen name, new intro or None to keep, new «Следва» text of the step BEFORE it or None to keep)
RENAMED = {
    1: ("Държавният бюджет на достъпен език",
        "Виж колко приходи са събрани и колко средства са изразходвани до последния месечен отчет, и как това се сравнява със същия период на миналата година. Когато разходите надвишават приходите, разликата е дефицит.",
        None),
    6: ("Месечни отчети",
        "Виж към коя дата са данните, колко приходи са събрани и колко средства са изразходвани. Сравни две години един до друг за един и същ период.",
        "Следва: провери колко от годината е събрано и изразходвано."),
    8: ("Моите данъци", None, None),
}
NOTE = ('Текстът на пътеводителя на работна група „Бюджет на светло“ е дословно от оригинала: въведение, осем стъпки и „Преди да използваш или споделиш число“. Препратките към екраните на сайта са добавени. В тази версия имената на екраните в стъпки 1, 6 и 8 следват преименуваните екрани („Държавният бюджет на достъпен език“, „Месечни отчети“, „Моите данъци“), а уводът на стъпки 1 и 6 е съобразен с тях. Пътеводителят вече не е отделен екран: бележките „На какво да внимаваш“ и петте проверки се показват в „Бюджетът за 5 минути“.')
TITLE_RE = re.compile(r"^(.*?)\s*„(.+)“\s*$")


def routes():
    src = open(ROUTES, encoding="utf-8").read()
    out = []
    for m in re.finditer(r"R\('(S\d+)',\s*'([^']*)',\s*(null|'[^']*'),\s*'([^']*)',\s*'([^']*)',\s*'[^']*',\s*'[^']*',\s*(\{.*?\})\s*\)", src):
        o = m.group(6)
        st = re.search(r"\bstep:\s*(\d+)", o)
        out.append({"id": m.group(1), "pattern": None if m.group(3) == "null" else m.group(3).strip("'"), "title": m.group(5), "step": int(st.group(1)) if st else None})
    return out


def sample(pattern):
    return "#/" + "/".join(x for x in pattern.split("/") if x and not x.startswith(":"))


def apply(g):
    steps = {s["n"]: s for s in g["steps"]}
    for n, (label, intro, prev_next) in RENAMED.items():
        s = steps[n]
        s["title"] = s["title"][:s["title"].index("„")] + "„%s“" % label
        s["screen"]["label"] = label
        if intro:
            s["intro"] = intro
        if n > 1:
            p = steps[n - 1]
            p["next"]["title"] = s["title"]
            if prev_next:
                p["next"]["text"] = prev_next
    g["meta"]["sourceNote"] = NOTE
    return g


def check(g):
    probs = []
    rs = routes()
    if len(g["steps"]) != 8:
        probs.append("guide: %d steps, expected 8" % len(g["steps"]))
    for i, s in enumerate(g["steps"]):
        m = TITLE_RE.match(s["title"])
        if not m:
            probs.append("guide step %d: title has no quoted screen name: %r" % (s["n"], s["title"])); continue
        label = m.group(2)
        r = next((x for x in rs if x["title"] == label and x["step"] == s["n"] and x["pattern"]), None)
        if r is None:
            probs.append("guide step %d: no route with title %r and step %d in routes.js" % (s["n"], label, s["n"])); continue
        if s["screen"]["id"] != r["id"] or s["screen"]["label"] != label or s["screen"]["href"] != sample(r["pattern"]):
            probs.append("guide step %d: screen %r does not match route %s (%s)" % (s["n"], s["screen"], r["id"], sample(r["pattern"])))
        nxt = s.get("next")
        if i < len(g["steps"]) - 1:
            n2 = g["steps"][i + 1]
            if not nxt or nxt["n"] != n2["n"] or nxt["title"] != n2["title"] or nxt["href"] != n2["screen"]["href"]:
                probs.append("guide step %d: the «Следва» link does not name step %d: %r" % (s["n"], n2["n"], nxt))
        elif nxt:
            probs.append("guide step %d: unexpected «Следва»" % s["n"])
    return probs


def main():
    only = "--check" in sys.argv
    g = json.load(open(GUIDE, encoding="utf-8"))
    if not only:
        g = apply(g)
    probs = check(g)
    if not only and not probs:
        with open(GUIDE, "w", encoding="utf-8") as f:
            json.dump(g, f, ensure_ascii=False, separators=(",", ":"))
    print("guide: %s, %d problem(s)" % ("checked" if only else "applied", len(probs)))
    for p in probs:
        print("  PROBLEM", p)
    sys.exit(1 if probs else 0)


if __name__ == "__main__":
    main()
