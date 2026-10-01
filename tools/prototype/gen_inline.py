#!/usr/bin/env python3
"""Вгражда извлечените набори в site/index.html като компактни JS константи.

Какво прави: чете prototype/src/{revenue_structure_2026,debt_stock,rates_2026,population,
kfp_components_2026,municipal_transfers_2026,program_budgets_2026,home_kpis_2026,glossary}.json и заменя блока между
маркерите „// === ИЗВЛЕЧЕНИ НАБОРИ (tools/gen_inline.py) ===“ и „// === КРАЙ НА ИЗВЛЕЧЕНИТЕ НАБОРИ ===“
в site/index.html. Ако маркерите липсват, вмъква блока след реда с „const DEBT =“.
Числата не се преизчисляват: копират се от JSON-ите (сумите в хил. € остават в хил. €).

Входове: prototype/src/*.json (build_src.py, extract_program_budgets.py, extract_home_kpis.py, extract_glossary.py)
Изход:   prototype/site/index.html (само блокът между маркерите)
Само stdlib.
"""
import json, re, sys

P = str(__import__("pathlib").Path(__file__).resolve().parents[2]) + "/prototype"
HTML = f"{P}/site/index.html"
BEGIN = "// === ИЗВЛЕЧЕНИ НАБОРИ (tools/gen_inline.py) ==="
END = "// === КРАЙ НА ИЗВЛЕЧЕНИТЕ НАБОРИ ==="


def j(name):
    return json.load(open(f"{P}/src/{name}", encoding="utf-8"))


def js(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def nice_name(s):
    s = re.sub(r'"([^"]+)"', r"„\1“", s.strip().rstrip("*").strip())
    s = re.sub(r"(\s+\d[\d\s,]*)+$", "", s)            # числа от съседна клетка, залепени в края на името
    s = re.sub(r"програма\s*[“”]", "програма „", s)       # „програма“Име…” → „програма „Име…”
    s = s.replace("„ ", "„").replace(" “", "“").replace("  ", " ").strip()
    if "„" not in s and s.endswith(("“", "”")):              # затваряща кавичка без отваряща
        s = s[:-1]
    letters = [c for c in s if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.8:  # ИМЕ С ГЛАВНИ БУКВИ
        s = s[:1] + s[1:].lower()
    return s


def garbled(s):
    """Името е развалено при извличането (буквите на някои думи са разместени): „р п п Политика …“."""
    return bool(re.match(r"^(\S\s){2,}", s) or re.match(r"^\S\s[„“]\S\s", s))


def main():
    rev = j("revenue_structure_2026.json")
    debt = j("debt_stock.json")
    rates = j("rates_2026.json")
    pop = j("population.json")
    comp = j("kfp_components_2026.json")
    mun = j("municipal_transfers_2026.json")
    prog = j("program_budgets_2026.json")
    kpi = j("home_kpis_2026.json")

    REV = {"tot": [rev["total"]["mln_2025"], rev["total"]["mln_2026"]],
           "g": [[g["name"], g["mln_2025"], g["mln_2026"]] for g in rev["groups"]]}
    sd = debt["state_debt"]; gg = debt["gg_debt_annual"]; gq = debt["gg_debt_quarterly_latest"]
    DEBT_STOCK = {"cols": sd["columns"], "sd": sd["mln_eur"], "sdPct": sd["pct_gdp"], "ext": sd["external_mln_eur"], "dom": sd["domestic_mln_eur"],
                  "gg": {"y": gg["years"][-1], "mln": gg["mln_eur"][-1], "pct": gg["pct_gdp"][-1]},
                  "ggq": {"q": gq["quarter"], "mln": gq["mln_eur"], "pct": gq["pct_gdp"], "p": gq["status"] == "p"}}
    RATES = {"emp": rates["employee_pct"], "er": rates["employer_pct"], "erNoT": rates["employer_pct_without_tzpb"],
             "tz": [rates["tzpb_pct"]["min"], rates["tzpb_pct"]["max"]], "pit": rates["income_tax_pct"],
             "mod": [m["eur"] for m in rates["max_insurable_income_eur"]], "split": rates["split"]}
    b = comp["budgets_2026_law"]; nv = comp["national_vs_eu_2026"]
    COMP = {"sb": {"rev": b["state_budget"]["rev"], "exp": b["state_budget"]["exp"], "eu": b["state_budget"]["eu_contribution"],
                   "tr": b["state_budget"]["transfers_net"], "to": b["state_budget"]["transfers_to"]},
            "doo": {"own": b["doo"]["own_rev"], "tr": b["doo"]["transfers_from_central_budget"], "exp": b["doo"]["exp_and_transfers"]},
            "nzok": {"own": b["nzok"]["own_rev"], "tr": b["nzok"]["transfers_from_state_budget"], "exp": b["nzok"]["exp_and_transfers"]},
            "mun": {"expMln": b["municipalities"]["exp_mln"], "tr": b["municipalities"]["transfers_zdb_art1"]},
            "eu": {"rev": b["eu_accounts"]["rev"], "exp": b["eu_accounts"]["exp_incl_eu_contribution"], "tr": b["eu_accounts"]["transfer_from_state_budget_net"]},
            "ban": b["other_transfers"]["ban_and_universities"],
            "nve": {"plan": nv["plan"], "jul": nv["exec_2026_07_31"]}}
    region = lambda r: re.sub(r"(?<=-)Г", "г", r.replace("ОБЛАСТ ", "").title()) if r else ""
    MUN = [[m["name"], region(m["region"]), m["total"], m["delegated"], m["equalizing"], m["winter_roads"], m["capital"], m["other_targeted"]]
           for m in mun["municipalities"]]
    PROG = {}
    for code, bud in prog["budgets"].items():
        if code not in prog["validated"] or "Проект 2026" not in bud["years_complete"] or not bud["zdb_art"]:
            continue
        years = bud["years_complete"]
        rows = []
        for c, p in sorted(bud["programs"].items(), key=lambda kv: (kv[0] != "total", kv[0])):
            if c in ("total", f"{code}.00.00"):
                continue
            rows.append([c, nice_name(p["name"]), [p["by_year"][y]["cons_prb"] for y in years]])
        bad = [r[1] for r in rows if garbled(r[1])]
        if bad:
            print(f"  пропускам {code} ({bud['file']}): развалени имена, напр. {bad[0][:50]!r}")
            continue
        PROG[bud["zdb_art"]] = {"f": bud["file"], "y": years, "pg": {y: bud["pages"].get(y, []) for y in years}, "r": rows}

    # Речникът (v3.6): текстовете са дословно от PDF-а; тук само се съкращават ключовете и синонимите стават низове.
    gl = j("glossary.json")
    if gl["checks"]["problems"] or len(gl["terms"]) != 64:
        sys.exit(f"glossary.json не е минал проверките на extract_glossary.py: {gl['checks']}")
    GLOSSARY = {"title": gl["title"], "sub": gl["subtitle"], "date": gl["date"], "intro": gl["intro"],
                "cats": [{k: c[k] for k in ("id", "title", "short", "from", "to")} for c in gl["categories"]],
                "terms": [{"n": t["n"], "slug": t["slug"], "title": t["title"], "name": t["name"], "abbr": t["abbr"], "cat": t["cat"],
                           "def": t["def"], "ex": t["example"], "alias": [a["text"] for a in t["aliases"]]} for t in gl["terms"]],
                "rel": [{k: r[k] for k in ("text", "from", "to", "note", "terms")} for r in gl["related"]["items"]],
                "src": {"intro": gl["sources"]["intro"], "items": gl["sources"]["items"]}}

    cx = kpi["capex_2026"]
    KPI = {"gdp": kpi["gdp_2026"]["mln_eur"], "gdpExact": kpi["gdp_2026"]["unrounded_mln_eur"],
           "capex": {"plan": cx["plan"]["mln_eur"], "planPctGdp": cx["plan"]["pct_gdp"], "asOf": ".".join(cx["latest"]["as_of"].split("-")[:0:-1]),
                     "exec": round(cx["latest"]["mln_eur"], 1), "file": cx["exec"][-1]["file"]}}

    block = "\n".join([
        BEGIN,
        "// Всички числа са от prototype/src/*.json; там са и източниците (документ, таблица, страница).",
        "// АСБП 2026–2028, Прил. 3 (с. 191 в PDF на МФ): приходи по КФП, млн. €; [име, 2025 предв. отчет, 2026 проект].",
        f"const REV = {js(REV)};",
        "// Дълг: по ЗДД — АСБП, Табл. VI-1 (с. 142), млн. €, 2024–2028; по Маастрихт — Eurostat gov_10dd_edpt1 и gov_10q_ggdebt.",
        f"const DEBT_STOCK = {js(DEBT_STOCK)};",
        "// Осигуровки и данък 2026: НАП (таблица към становище ВК-30-10237/12.08.2026), ЗБДОО 2026 (чл. 9, 14, 15), ЗБНЗОК 2026 (чл. 2), АСБП Прил. 2.",
        f"const RATES = {js(RATES)};",
        f"// Население към {pop['latest']['date']}: {pop['latest']['persons']} души (Eurostat tps00001, данни на НСИ).",
        f"const POP = {round(pop['latest']['persons'] / 1e6, 6)}; // млн. души",
        "// Съставни бюджети 2026: ЗДБ/ЗБДОО/ЗБНЗОК 2026 (хил. €), АСБП Табл. II-3, II-4, Прил. 6 и с. 128 (млн. €); изпълнение към 31.07 — МФ (млн. €).",
        f"const COMP = {js(COMP)};",
        "// ЗДБ 2026, чл. 51: [община, област, общо, делегирани, изравнителна, зимно поддържане, капиталови, други целеви], хил. €.",
        f"const MUN = {js(MUN)};",
        "// Програмни бюджети (архивът към законопроекта № 52-602-01-19): по член на ЗДБ — години и [код, име, [по бюджета на ПРБ, хил. €]].",
        f"const PROG = {js(PROG)};",
        "// „Бюджет 2026 в шест числа“ (src/home_kpis_2026.json, tools/extract_home_kpis.py), млн. €: БВП 2026 — АСБП, Табл. I-2 (с. 23 в PDF на МФ,",
        "// с. 226 в docx); капиталови разходи — план по Прил. 3 (с. 192) и изпълнение по месечния отчет на МФ (ред „Капиталови разходи“, колона КФП).",
        f"const KPI = {js(KPI)};",
        "// Речник (src/glossary.json, tools/extract_glossary.py): 64-те термина от PDF-а „Речник: бюджетът на разбираем език“ (01.10.2026),",
        "// дословно — пет раздела, определение и пример, „Свързани понятия“ (с номерата на термините) и източниците. Изведени са само",
        "// slug (адресът #/rechnik/<slug>), name/abbr (от „Име - СЪКР“) и alias — търсещите синоними, всички от самия PDF.",
        f"const GLOSSARY = {js(GLOSSARY)};",
        END])
    html = open(HTML, encoding="utf-8").read()
    if BEGIN in html:
        html = re.sub(re.escape(BEGIN) + r".*?" + re.escape(END), lambda m: block, html, flags=re.S)
    else:
        i = html.index("const DEBT = ")
        i = html.index("\n", i) + 1
        html = html[:i] + block + "\n" + html[i:]
    open(HTML, "w", encoding="utf-8").write(html)
    print("вградени:", {k: len(v) if hasattr(v, "__len__") else v for k, v in (("REV", REV["g"]), ("MUN", MUN), ("PROG", PROG), ("GLOSSARY", GLOSSARY["terms"]))}, "| размер на блока:", len(block))


if __name__ == "__main__":
    main()
