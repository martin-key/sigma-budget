"""Offline legacy intermediate producers. --check never writes; pins are mandatory."""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
import xlrd
ROOT = Path(__file__).resolve().parents[3]
RAW, SRC = ROOT / "data/originals", ROOT / "data/inputs"
TODAY = "2026-10-01"
ASBP_PDF = "АСБП 2026–2028 (мотиви към законопроекта за държавния бюджет 2026), PDF на МФ UMTBF-2026-2028-motivi.pdf"
DOCX_URL = "https://www.parliament.bg/bills/52/52-602-01-19.docx"


def jload(p):
    return json.load(open(p, encoding="utf-8"))


def save(name, obj):
    json.dump(obj, open(f"{SRC}/{name}", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("записан", name)


def need(cond, msg):
    if not cond:
        sys.exit("ПРОВЕРКАТА НЕ МИНА: " + msg)


def row(table, label, exact=True):
    for r in table["rows"]:
        if (r["label"] == label) if exact else r["label"].startswith(label):
            return r["values"]
    sys.exit(f"няма ред {label!r} в {table['title'][:60]}")


A = None
T = None
DV = None


def eurostat_series(path):
    d = jload(path)
    ids, size = d["id"], d["size"]
    cats = [{v: k for k, v in d["dimension"][i]["category"]["index"].items()} for i in ids]
    out = []
    for k, v in d["value"].items():
        k = int(k); pos = []
        for s in reversed(size):
            pos.append(k % s); k //= s
        pos = list(reversed(pos))
        lab = {ids[i]: cats[i][pos[i]] for i in range(len(ids))}
        lab["value"] = v
        lab["status"] = d.get("status", {}).get(str(sum(p * int(__import__("math").prod(size[i + 1:])) for i, p in enumerate(pos))), "")
        out.append(lab)
    return d, out


def debt():
    vi = T["VI_1"]
    sd = row(vi, "Държавен дълг, млн. евро"); sdp = row(vi, "Държавен дълг/БВП (%)*")
    ext = row(vi, "Външен дълг, млн. евро"); dom = row(vi, "Вътрешен дълг, млн. евро")
    for i in range(5):
        need(abs(ext[i] + dom[i] - sd[i]) <= 0.2, f"Табл. VI-1: външен + вътрешен ≠ общо за колона {i}")
    da, ann = eurostat_series(f"{RAW}/eurostat/gov_10dd_edpt1_BG_EU.json")
    dq, qtr = eurostat_series(f"{RAW}/eurostat/gov_10q_ggdebt_BG.json")
    a = {(x["geo"], x["unit"], x["time"]): x for x in ann}
    q = {(x["unit"], x["time"]): x for x in qtr}
    lastq = max(t for (u, t) in q if u == "MIO_EUR")
    save("debt_stock.json", {
        "title": "Размер на дълга в евро: държавен дълг по ЗДД и консолидиран дълг на сектор „Държавно управление“",
        "retrieved": TODAY,
        "state_debt": {
            "what": "Държавен дълг по Закона за държавния дълг (номинална стойност, централно управление)",
            "source": f"{ASBP_PDF}, Табл. VI-1 „Държавен дълг – вътрешен и външен и съотношение спрямо БВП“, с. 142 "
                      f"(в {DOCX_URL} — с. 348). Източник в таблицата: МФ.",
            "columns": vi["columns"], "mln_eur": sd, "pct_gdp": sdp, "external_mln_eur": ext, "domestic_mln_eur": dom},
        "gg_debt_annual": {
            "what": "Консолидиран брутен дълг на сектор „Държавно управление“ (по Маастрихт)",
            "source": f"Eurostat, gov_10dd_edpt1 (обновено {da['updated'][:10]}), na_item=GD, sector=S13",
            "years": [str(y) for y in range(2020, 2026)],
            "mln_eur": [a[("BG", "MIO_EUR", str(y))]["value"] for y in range(2020, 2026)],
            "pct_gdp": [a[("BG", "PC_GDP", str(y))]["value"] for y in range(2020, 2026)]},
        "gg_debt_quarterly_latest": {
            "source": f"Eurostat, gov_10q_ggdebt (обновено {dq['updated'][:10]})", "quarter": lastq,
            "mln_eur": q[("MIO_EUR", lastq)]["value"], "pct_gdp": q[("PC_GDP", lastq)]["value"],
            "status": q[("MIO_EUR", lastq)]["status"] or "окончателни", "status_note": "p = предварителни данни"},
        "not_available": "Месечният бюлетин и регистърът на държавния дълг на МФ (minfin.bg) — сайтът отказва автоматичния достъп (HTTP 403). "
                         "Последното число по ЗДД тук е към 31.12.2025 г.",
        "scope_question": "Кой обхват е основен — държавният дълг по ЗДД или консолидираният дълг по Маастрихт — остава решение на групата."})



def population():
    d, s = eurostat_series(f"{RAW}/eurostat/tps00001_BG.json")
    ser = sorted((x["time"], x["value"]) for x in s if x["geo"] == "BG")
    save("population.json", {
        "title": "Население на България към 1 януари", "source": f"Eurostat, tps00001 (обновено {d['updated'][:10]}); данните са на НСИ",
        "nsi_direct": "nsi.bg отказва автоматичния достъп (HTTP 403)", "retrieved": TODAY,
        "years": [t for t, _ in ser], "persons": [v for _, v in ser], "latest": {"date": f"{ser[-1][0]}-01-01", "persons": ser[-1][1]}})


# ---------------- 5. Съставни бюджети ----------------
def kv(rows, label, no=None):
    for r in rows:
        if r["label"].replace(" ", "") == label.replace(" ", "") and (no is None or r["no"] == no):
            return r["value"]
    sys.exit(f"няма ред {label!r}")


def components():
    zdb1, zdb2 = DV["zdb"]["art1"]["para1"], DV["zdb"]["art1"]["para2"]
    doo1, doo2 = DV["zbdoo"]["art1"]["para1"], DV["zbdoo"]["art1"]["para2"]
    nz1, nz2 = DV["zbnzok"]["art1"]["para1"], DV["zbnzok"]["art1"]["para2"]
    rev_sb = kv(zdb1, "ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ"); exp_sb = kv(zdb2, "РАЗХОДИ"); eu_sb = kv(zdb2, "ВНОСКА В ОБЩИЯ БЮДЖЕТ НА ЕВРОПЕЙСКИЯ СЪЮЗ")
    tr_net = kv(zdb2, "БЮДЖЕТНИ ВЗАИМООТНОШЕНИЯ (ТРАНСФЕРИ) – НЕТО")
    to = {k: kv(zdb2, lab) for k, lab in (("municipalities", "Общините"), ("doo", "Държавното обществено осигуряване"),
                                          ("nzok", "Националната здравноосигурителна каса"), ("eu_nf", "Сметката за средствата от Европейския съюз на Националния фонд"),
                                          ("eu_dfz", "Сметката за средствата от Европейския съюз на Държавния фонд „Земеделие“"))}
    # ДОО: собствени приходи = всичко − трансферите от централния бюджет
    doo_tot = kv(doo1, "ПРИХОДИ И ТРАНСФЕРИ – ВСИЧКО")
    doo_tr = kv(doo1, "Получени трансфери от централния бюджет за държавното обществено осигуряване") + \
        kv(doo1, "Получени допълнителни трансфери от централния/държавния бюджет за покриване на недостига от средства")
    need(abs(doo_tr - to["doo"]) < 0.15, f"трансферът за ДОО: ЗБДОО {doo_tr} ≠ ЗДБ {to['doo']}")
    nz_tot = kv(nz1, "ПРИХОДИ И ТРАНСФЕРИ – ВСИЧКО")
    nz_tr = kv(nz1, "Трансфери за здравно осигуряване") + kv(nz1, "Получени трансфери от Министерството на здравеопазването за:")
    need(abs(nz_tr - to["nzok"]) < 0.15, f"трансферът за НЗОК: ЗБНЗОК {nz_tr} ≠ ЗДБ {to['nzok']}")
    iv = T["IV_text"]
    mun_exp = float(re.search(r"в размер на ([\d ,]+) млн\. евро", iv["quote"]).group(1).replace(" ", "").replace(",", "."))
    a9 = T["annex9"]; mun_tr = row(a9, "Основни бюджетни взаимоотношения - всичко")[0]
    ii3, ii4 = T["II_3"], T["II_4"]
    a6 = T["annex6"]
    # изпълнение към 31.07.2026: национален бюджет / европейски средства (к.3 / к.4)
    b = xlrd.open_workbook(f"{RAW}/kfp_2026/2026-EU_funds_0726_BG_WEB_2.xls"); s = b.sheet_by_index(0)
    lab = lambda r: re.sub(r"\s+", " ", str(s.cell_value(r, 0)).replace("І", "I")).strip()
    rowi = {lab(r): r for r in range(s.nrows)}
    def cell(prefix, col):
        r = next(r for k, r in rowi.items() if k.startswith(prefix))
        return float(s.cell_value(r, col))
    need("31.07.2026" in str(s.cell_value(2, 0)), "месечният отчет не е към 31.07.2026")
    ex = {}
    for key, col in (("national", 2), ("eu", 3), ("kfp", 1)):
        rev = cell("I. Приходи", col); exp = cell("II. Разходи", col) + cell("IV. Вноска", col); bal = cell("V. Бюджетно салдо", col)
        ex[key] = {"rev": round(rev, 1), "exp_incl_eu_contribution": round(exp, 1), "balance": round(bal, 1)}
    plan = {"national": {"rev": row(ii3, "ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ")[2], "exp_incl_eu_contribution": row(ii3, "ОБЩО РАЗХОДИ И ВНОСКА В БЮДЖЕТА НА ЕС")[2],
                         "balance": row(ii3, "БЮДЖЕТНО САЛДО (+/-)")[2], "transfer_to_eu_accounts_net": row(ii3, "ТРАНСФЕР ЗА СМЕТКИ ЗА СРЕДСТВА ОТ ЕС (НЕТО)")[2]},
            "eu": {"rev": row(ii4, "ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ")[2], "exp_incl_eu_contribution": row(ii4, "ОБЩО РАЗХОДИ")[2],
                   "balance": row(ii4, "БЮДЖЕТНО САЛДО (+/-)")[2], "transfer_from_state_budget_net": row(ii4, "ТРАНСФЕР ОТ/ЗА ДЪРЖАВНИЯ БЮДЖЕТ (НЕТО)")[2]}}
    need(abs(plan["national"]["balance"] + plan["eu"]["balance"] - row(T["annex3_mln"], "Бюджетно салдо (+/-)")[2]) < 0.15, "II-3 + II-4 ≠ салдото по КФП")
    a6v = {r["label"]: r["values"][0] for r in a6["rows"] if r["values"][0] is not None}
    pick6 = lambda start: next(v for k, v in a6v.items() if k.startswith(start))
    save("kfp_components_2026.json", {
        "title": "Кой какво събира и харчи: съставните бюджети в КФП за 2026 г. и трансферите от държавния бюджет",
        "retrieved": TODAY, "unit": "хил. € (законите) / млн. € (АСБП и месечния отчет)",
        "budgets_2026_law": {
            "state_budget": {"source": f"ЗДБ 2026, чл. 1, ал. 1–3 ({DV['zdb']['dv']})", "url": DV["zdb"]["url"], "unit": "хил. €",
                             "rev": rev_sb, "exp": exp_sb, "transfers_net": tr_net, "eu_contribution": eu_sb, "transfers_to": to},
            "doo": {"source": f"ЗБДОО 2026, чл. 1 ({DV['zbdoo']['dv']})", "url": DV["zbdoo"]["url"], "unit": "хил. €",
                    "rev_and_transfers": doo_tot, "own_rev": round(doo_tot - doo_tr, 1), "transfers_from_central_budget": round(doo_tr, 1),
                    "exp_and_transfers": kv(doo2, "РАЗХОДИ И ТРАНСФЕРИ – ВСИЧКО"), "contributions": kv(doo1, "Осигурителни вноски")},
            "nzok": {"source": f"ЗБНЗОК 2026, чл. 1 ({DV['zbnzok']['dv']})", "url": DV["zbnzok"]["url"], "unit": "хил. €",
                     "rev_and_transfers": nz_tot, "own_rev": round(nz_tot - nz_tr, 1), "transfers_from_state_budget": round(nz_tr, 1),
                     "exp_and_transfers": kv(nz2, "РАЗХОДИ И ТРАНСФЕРИ – ВСИЧКО"), "contributions": kv(nz1, "Здравноосигурителни вноски")},
            "municipalities": {"source": f"{ASBP_PDF}, с. 128 (текстът над Табл. IV-1) и Приложение № 9, с. 200", "unit": "хил. €",
                               "exp_mln": mun_exp, "quote": iv["quote"], "main_transfers": mun_tr,
                               "transfers_zdb_art1": to["municipalities"], "note": "ЗДБ, чл. 1 дава 4 927 964,0 хил. € трансфери за общините: основните 4 887 464,0 (Прил. 9) плюс 40 500,0 за други целеви разходи (ЗДБ, чл. 51, т. 2)."},
            "eu_accounts": {"source": f"{ASBP_PDF}, Табл. II-4, с. 32", "unit": "млн. €", **plan["eu"]},
            "other_transfers": {"source": f"{ASBP_PDF}, Приложение № 6, с. 197", "unit": "хил. €",
                                "bnt": pick6("1 Предоставени"), "bnr": pick6("2 Предоставени"), "bta": pick6("3 Предоставени"),
                                "ban_and_universities": pick6("4 Предоставени"), "ban": pick6("- за бюджета на Българската академия"),
                                "universities": pick6("- за бюджетите на държавните висши училища"), "military_universities": pick6("6 Предоставени")}},
        "national_vs_eu_2026": {"plan_source": f"{ASBP_PDF}, Табл. II-3 и II-4, с. 31–32 (млн. €, проект за 2026 г.)",
                                "exec_source": "МФ, месечен отчет за изпълнението на КФП към 31.07.2026 (2026-EU_funds_0726_BG_WEB_2.xls), лист „стартова“, "
                                               "к.3 „Национален бюджет“ и к.4 „Европейски средства“; разходите са ред 16 + ред 32",
                                "plan": plan, "exec_2026_07_31": ex},
        "not_available": "Месечното изпълнение по отделните бюджети (държавен, ДОО, НЗОК, общини) — таблиците на МФ са на minfin.bg, който отказва автоматичния достъп (HTTP 403)."})


# ---------------- 6. Общините ----------------
def municipal():
    a = DV["zdb"]["art51"]
    from decimal import Decimal
    municipalities = a["municipalities"]
    count = len(municipalities)
    need(count == 265 and count == a["count"], f"очаквах 265 общини, редове {count}, записани {a['count']}")
    need(len({(m["region"], m["name"]) for m in municipalities}) == count, "повторена община")
    columns = ("total", "delegated", "equalizing", "winter_roads", "capital", "other_targeted")
    sums = {key: Decimal(0) for key in columns}
    tolerance = Decimal("0.15")
    for municipality in municipalities:
        values = {key: Decimal(str(municipality[key])) if municipality[key] is not None else Decimal(0)
                  for key in columns}
        need(all(value.is_finite() for value in values.values()), "нечислова стойност в община")
        # Column 7 (other_targeted) is separate from the main transfers (columns 3–6).
        parts = sum(values[key] for key in ("delegated", "equalizing", "winter_roads", "capital"))
        need(abs(values["total"] - parts) < tolerance, "редът на община не се равнява: " + municipality["name"])
        for key in columns:
            sums[key] += values[key]
    need(len(a["total_rows_in_law"]) == 1, "очаквах един общ ред в закона")
    law = a["total_rows_in_law"][0]
    for key in columns:
        need(abs(sums[key] - Decimal(str(law[key]))) < tolerance, f"пресметнатият сбор по {key} ≠ реда „ВСИЧКО“ в закона")
        need(abs(sums[key] - Decimal(str(a["sums"][key]))) < tolerance, f"пресметнатият сбор по {key} ≠ записания сбор")
    need(abs(sums["total"] - Decimal(str(row(T["annex9"], "Основни бюджетни взаимоотношения - всичко")[0]))) < tolerance,
         "пресметнатият сбор ≠ АСБП, Прил. 9")
    calculated_sums = {key: float(value.quantize(Decimal("0.1"))) for key, value in sums.items()}
    save("municipal_transfers_2026.json", {
        "title": "Трансфери от централния бюджет за общините, 2026 г.",
        "source": f"ЗДБ 2026, чл. 51, т. 1 и 2 ({DV['zdb']['dv']})", "url": DV["zdb"]["url"], "retrieved": TODAY, "unit": "хил. €",
        "columns": a["columns"], "sums": calculated_sums,
        "checks": "Сборовете по колони съвпадат с реда „ВСИЧКО:“ в закона и с АСБП, Прил. 9; във всеки ред к.3+к.4+к.5+к.6 = к.2.",
        "names_note": "В текста на ДВ 140 имена на общини съдържат латински букви, които изглеждат като кирилски (напр. „Kресна“); тук са превърнати в кирилица, оригиналът е в name_in_dv.",
        "municipalities": a["municipalities"]})



METADATA = {'source': 'АСБП 2026–2028, Табл. III-1 „Разходи по функции по КФП за периода 2026-2028 г. с разпределен резерв по функции (без вноска в общия бюджет на ЕС)“; мотиви към законопроекта за държавния бюджет за 2026 г., № 52-602-01-19, внесен от МС на 01.07.2026', 'url': 'https://www.parliament.bg/bills/52/52-602-01-19.docx', 'bill_page': 'https://www.parliament.bg/bg/bills/ID/167157', 'unit': 'млн. евро; % от БВП', 'columns': ['2025 Програма', '2026 Проект', '2027 Прогноза', '2028 Прогноза']}

def functions():
    """Read the nested Word table III-1 (python-docx top-level tables omit it)."""
    import zipfile
    import xml.etree.ElementTree as ET
    path = RAW / "parliament/52-602-01-19.docx"
    pins = dict(line.split("  ", 1)[::-1] for line in (ROOT / "data/originals.sha256").read_text().splitlines() if "  " in line)
    if hashlib.sha256(path.read_bytes()).hexdigest() != pins.get(path.relative_to(ROOT).as_posix()):
        raise ValueError("bill pin mismatch")
    with zipfile.ZipFile(path) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))
    w = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    matches = []
    for table in document.iter(w + "tbl"):
        rows = [["".join(t.text or "" for t in cell.iter(w + "t")) for cell in row.findall(w + "tc")]
                for row in table.findall(w + "tr")]
        if rows and rows[0] == ["ПОКАЗАТЕЛИ", "млн. евро", "% от БВП"]:
            matches.append(rows)
    if len(matches) != 1:
        raise ValueError("expected exactly one III-1 nested table")
    out = METADATA.copy()
    result = []
    for cells in matches[0][3:]:
        if not cells[0].strip():
            continue
        if len(cells) != 9:
            raise ValueError("III-1: expected 9 cells")
        values = [float(re.sub(r"[\s%]", "", v).replace(",", ".")) for v in cells[1:]]
        label = cells[0].strip()
        part = label.startswith("-")
        item = {"name": label.removeprefix("-").strip(), "mln": values[:4], "pc_gdp": values[4:]}
        if part:
            result[-1]["parts"].append(item)
        else:
            item["parts"] = []
            result.append(item)
    if len(result) != 9 or sum(len(f["parts"]) for f in result) != 23:
        raise ValueError("III-1: unexpected classification")
    # Independent accounting check on the extracted children, one printed decimal.
    for parent in result:
        if parent["parts"]:
            for i in range(4):
                if abs(sum(p["mln"][i] for p in parent["parts"]) - parent["mln"][i]) > 0.15:
                    raise ValueError("III-1: parts do not reconcile: " + parent["name"])
    out["functions"] = result
    out["retrieved"] = "2026-09-30"
    save("kfp_functions_2026.json", out)


def main(argv=None):
    global A, T, DV
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("item", choices=["population", "debt", "components", "municipal", "functions"])
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    pins = dict(line.split("  ", 1)[::-1] for line in (ROOT / "data/originals.sha256").read_text().splitlines() if "  " in line)
    def read_pinned(path):
        path = Path(path)
        rel = path.relative_to(ROOT).as_posix()
        blob = path.read_bytes()
        if hashlib.sha256(blob).hexdigest() != pins.get(rel):
            raise ValueError("missing pin or hash mismatch: " + rel)
        return json.loads(blob)
    globals()["jload"] = read_pinned
    if args.item not in ("population", "functions"):
        A = read_pinned(RAW / "asbp/asbp_tables.json")
        T = A["tables"]
    if args.item in ("municipal", "components"):
        DV = read_pinned(RAW / "dv/dv_laws_2026.json")
    if args.item == "components":
        path = RAW / "kfp_2026/2026-EU_funds_0726_BG_WEB_2.xls"
        if hashlib.sha256(path.read_bytes()).hexdigest() != pins.get(path.relative_to(ROOT).as_posix()):
            raise ValueError("missing pin or hash mismatch: " + path.name)
    def save_checked(name, obj):
        blob = json.dumps(obj, ensure_ascii=False, indent=1).encode()
        target = SRC / name
        # Never silently replace a published historical input with revised observations.
        if hashlib.sha256(blob).hexdigest() != pins.get(target.relative_to(ROOT).as_posix()):
            import difflib
            print("".join(difflib.unified_diff((target.read_text() if target.exists() else "").splitlines(True), blob.decode().splitlines(True), fromfile=name, tofile="rebuilt")))
            raise ValueError("byte mismatch: " + name)
        if args.check and target.read_bytes() != blob:
            raise ValueError("checked file differs: " + name)
        if not args.check:
            target.write_bytes(blob)
        print("identical: " + name)
    globals()["save"] = save_checked
    globals()[args.item]()
    return 0

if __name__ == "__main__":
    sys.exit(main())
