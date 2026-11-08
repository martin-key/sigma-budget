"""Generate the FUNC_KFP and COFOG JS literals from the src/ extracts (no hand-typed numbers)."""
import json

SRC = str(__import__("pathlib").Path(__file__).resolve().parents[2]) + "/prototype/src/"
k = json.load(open(SRC + "kfp_functions_2026.json", encoding="utf-8"))
c = json.load(open(SRC + "cofog_bg.json", encoding="utf-8"))

# Table name -> (display name, short name, COFOG codes for "По години"). Order = 2026 amount, descending.
FUNC = {
    "Социално осигуряване, подпомагане и грижи": (None, "Социално осигуряване и помощи", ["GF10"]),
    "Икономически дейности и услуги": (None, "Икономика, транспорт, енергетика", ["GF04"]),
    "Здравеопазване": (None, "Здравеопазване", ["GF07"]),
    "Отбрана и сигурност": (None, "Отбрана и сигурност", ["GF02", "GF03"]),
    "Образование": (None, "Образование", ["GF09"]),
    "Общи държавни служби": (None, "Администрация", ["GF01", "-GF0107"]),
    "Жилищно строителство, благоустройство, комунално стопанство и опазване на околната среда":
        (None, "Жилищно, ВиК, околна среда", ["GF05", "GF06"]),
    "Р-ди некласифицирани в другите функции":
        ("Разходи, некласифицирани в другите функции (основно лихви)", "Лихви по дълга", ["GF0107"]),
    "Култура, спорт, почивни дейности и религиозно дело": (None, "Култура и спорт", ["GF08"]),
}
PART_SHORT = {
    "защита на населението, управление и дейности при стихийни бедствия и аварии": "Защита при бедствия и аварии",
    "програми, дейности и служби по социалното осигуряване, подпомагане и заетостта": "Програми за заетост и социални услуги",
    "жилищно строителство, благоустройство, комунално стопанство": "Жилищно и комунално стопанство",
    "селско стопанство, горско стопанство, лов и риболов": "Селско и горско стопанство, риболов",
}
cap = lambda s: s[:1].upper() + s[1:]

by_name = {f["name"]: f for f in k["functions"]}
assert set(by_name) == set(FUNC), set(by_name) ^ set(FUNC)
order = sorted(FUNC, key=lambda n: -by_name[n]["mln"][1])
rows = []
for n in order:
    f = by_name[n]
    disp, short, codes = FUNC[n]
    parts = [[cap(p["name"]), PART_SHORT.get(p["name"], cap(p["name"])), p["mln"][0], p["mln"][1]] for p in f["parts"]]
    rows.append([disp or n, short, f["mln"][0], f["mln"][1], codes, parts])
func_js = "[\n" + ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in rows) + "\n]"

cofog = {"years": [int(y) for y in c["years"]], "MIO_EUR": c["MIO_EUR"], "PC_GDP": c["PC_GDP"]}
cofog_js = json.dumps(cofog, ensure_ascii=False, separators=(",", ":"))

html_path = str(__import__("pathlib").Path(__file__).resolve().parents[2]) + "/prototype/site/index.html"
s = open(html_path, encoding="utf-8").read()
assert s.count("__FUNC_KFP__") == 1 and s.count("__COFOG__") == 1
s = s.replace("__FUNC_KFP__", func_js).replace("__COFOG__", cofog_js)
open(html_path, "w", encoding="utf-8").write(s)
print(func_js)
print(cofog_js[:200], "...")
