#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_mock.py - builds the MOCK datasets M01-M07 of the „Бюджет на светло“ prototype.

    python3 tools/build_mock.py                  # build all seven files into site/data/mock/
    python3 tools/build_mock.py --only M03,M04   # build some of them
    python3 tools/build_mock.py --check          # build in memory, compare with disk, write nothing (exit 1 on a difference)

Pure Python 3 standard library; fixed seed 20261002; the same input gives byte-identical files (no clock, no network).
Run it AFTER DATA's builders (tools/build_data.py): it reads, read-only,
    site/data/{ministries,programs,measures,execution,expenditure,core,municipalities}.json   (DATA's real files)
    tools/mock/cache/{law_bill,gisco_lau_bg}.json, ../prototype/src/municipal_transfers_2026.json   (caches on disk)
and writes
    site/data/mock/{activities,indicators,municipal-finance,payments,projects,measure-labels,tax-assumptions}.json

Every mock set is tied to real numbers it breaks down (see each builder and validate_mock.py, which re-derives all of them
from disk). Every record carries "mock": true and a Bulgarian "why"; the file meta has status "mock", the seed and
"constrainedBy". Nothing here pretends to be an account of what an institution, a municipality or a firm really did.
"""
import argparse
import collections
import datetime
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mock_lib as L  # noqa: E402

problems = []
notes = []                                           # informational lines printed after the build (not problems)


def problem(msg):
    problems.append(msg)


def need(path, what=None):
    """Load a JSON input; a missing input is a problem (with the command that creates it), not a crash."""
    if not os.path.exists(path):
        problem("missing input %s%s" % (os.path.relpath(path, L.ROOT), " (" + what + ")" if what else ""))
        return None
    return L.load_json(path)


def data(name):
    obj = need(os.path.join(L.DATA_DIR, name), "run tools/build_data.py first")
    if name == "execution.json" and obj is not None:
        import exec_contract                                        # contract v2: money as decimal strings
        obj = exec_contract.numbers(obj)
    return obj


def k1(t):
    """integer tenths of a thousand euro -> float with one decimal (exact)."""
    return t / 10.0


# =============================================================================================================== M03
# Municipal finance. Real: names, codes, population (GISCO LAU 2024; taken from DATA's site/data/municipalities.json so that
# the mock and the real set always agree, GISCO cache as fallback), transfers (ЗДБ 2026 чл. 51), the total expenditure.
# Model: own revenue (per-capita, rises with city size), the small balance, debt, the quarterly path.

M03_WHY = "Примерни числа, не отчет на общината."
M03_NOTICE = ("ПРИМЕРНИ ДАННИ. Числата по общини в този файл са измислени за целите на прототипа и НЕ са отчет на нито една "
              "община: не показват какво общината е похарчила, събрала или дължи. Само събрани, те съвпадат с реалните общи "
              "числа (разходите на общините за 2026 г. и трансферите от държавния бюджет по чл. 51 от закона); "
              "разпределението по общини, собствените приходи, салдата, дългът и тримесечията са по модел.")
# names in the transfers table (ДВ) that differ from the GISCO spelling
M03_NAME_FIX = {"Добричка": "Добрич-селска", "Бобовдол": "Бобов дол", "„Марица“": "Марица", "„Родопи“": "Родопи",
                "„Тунджа“": "Тунджа", "Столична община": "Столична"}


def region_title(raw):
    if raw is None:
        return "София (столица)"
    s = raw.replace("ОБЛАСТ ", "", 1)
    return s.title()


def municipalities_matched():
    """The 265 municipalities: GISCO identity and population + the real transfers of ЗДБ чл. 51 (хил. €, in tenths)."""
    g = need(L.GISCO_JSON)
    t = need(L.TRANSFERS_JSON)
    if g is None or t is None:
        return None
    lau = g["items"]
    by_name = collections.defaultdict(list)
    for it in lau:
        by_name[it["name"]].append(it)
    rows = t["municipalities"]
    prefix_of_region = {}
    matched = {}
    pending = []
    for m in rows:
        nm = M03_NAME_FIX.get(m["name"], m["name"])
        c = by_name.get(nm, [])
        if len(c) == 1:
            matched[(m["region"], m["name"])] = c[0]
            prefix_of_region.setdefault(m["region"], set()).add(c[0]["id"][:3])
        elif len(c) == 0:
            problem("M03: no GISCO municipality for transfers row %r (%r)" % (m["name"], m["region"]))
        else:
            pending.append(m)
    for m in pending:                                    # the two 'Бяла': choose the one in the same oblast
        nm = M03_NAME_FIX.get(m["name"], m["name"])
        pre = prefix_of_region.get(m["region"], set())
        c = [x for x in by_name[nm] if x["id"][:3] in pre]
        if len(c) != 1:
            problem("M03: cannot resolve %r in %r" % (m["name"], m["region"]))
            continue
        matched[(m["region"], m["name"])] = c[0]
    pop19 = {}                                           # population as DATA publishes it (single source of truth)
    d19 = os.path.join(L.DATA_DIR, "municipalities.json")
    if os.path.exists(d19):
        for x in (L.load_json(d19).get("items") or []):
            if isinstance(x.get("population"), int) and x.get("id"):
                pop19[x["id"]] = x["population"]
    differs = []
    out = []
    seen = set()
    for m in rows:
        it = matched.get((m["region"], m["name"]))
        if it is None:
            continue
        if it["id"] in seen:
            problem("M03: municipality %s matched twice" % it["id"])
        seen.add(it["id"])
        tr = L.tenths(m.get("total") or 0.0) + L.tenths(m.get("other_targeted") or 0.0)
        pop = pop19.get(it["id"], int(it["pop"]))
        if pop != int(it["pop"]):
            differs.append("%s %s: municipalities.json %d, GISCO cache %d" % (it["id"], it["name"], pop, int(it["pop"])))
        out.append({"id": it["id"], "name": it["name"], "pop": pop, "regionId": it["id"][:3],
                    "region": region_title(m["region"]), "transfers": tr})
    if len(out) != 265 or len(seen) != 265:
        problem("M03: expected 265 municipalities, got %d" % len(out))
    if differs:
        notes.append("M03: population follows municipalities.json; it differs from the GISCO cache for %d municipalities (%s)"
                     % (len(differs), "; ".join(differs[:4]) + ("; ..." if len(differs) > 4 else "")))
    if not pop19:
        notes.append("M03: site/data/municipalities.json is not on disk, population taken from the GISCO cache")
    out.sort(key=lambda x: x["id"])
    return out


def build_m03():
    mun = municipalities_matched()
    if mun is None:
        return None
    r = L.rng("M03")
    exp_t = L.tenths(L.MUNICIPAL_EXP_MLN * 1000.0)                 # 6 881 900,0 хил. € in tenths
    tr_t = sum(m["transfers"] for m in mun)
    own_total = exp_t - tr_t                                        # implied own revenue (1 953 936,0 хил. €)
    if own_total <= 0:
        problem("M03: transfers exceed the total expenditure")
        return None
    # own revenue per resident rises with the size of the municipality (elasticity 0.25) plus lognormal noise
    w = [m["pop"] * (m["pop"] / 50000.0) ** 0.25 * math.exp(r.gauss(0.0, 0.20)) for m in mun]
    own = L.apportion(w, own_total)
    # small balance: up to +-2.7% of (transfers + own revenue), then forced to add up to exactly zero
    bal = []
    for m, o in zip(mun, own):
        f = max(-0.027, min(0.027, r.gauss(0.0, 0.012)))
        bal.append(int(round((m["transfers"] + o) * f)))
    s = sum(bal)
    if s:
        adj = L.apportion([m["transfers"] + o for m, o in zip(mun, own)], abs(s))
        bal = [b - (a if s > 0 else -a) for b, a in zip(bal, adj)]
    assert sum(bal) == 0
    items = []
    reg = collections.OrderedDict()
    for m, o, b in zip(mun, own, bal):
        e = m["transfers"] + o + b
        u = r.random()
        z = r.gauss(0.0, 0.8)
        ratio = 0.0 if u < 0.20 else min(0.30, 0.06 * math.exp(z) * (m["pop"] / 50000.0) ** 0.10)
        debt = int(round(ratio * e))
        rev = e - b                                                 # all revenue = own revenue + transfers
        f1 = r.uniform(0.19, 0.24)
        f2 = f1 + r.uniform(0.21, 0.27)
        g1 = min(0.27, max(0.17, f1 + r.gauss(0.0, 0.012)))
        g2 = max(g1 + 0.15, f2 + r.gauss(0.0, 0.018))
        quarterly = [
            {"q": 1, "revenue": k1(int(round(rev * g1))), "expenditure": k1(int(round(e * f1)))},
            {"q": 2, "revenue": k1(int(round(rev * g2))), "expenditure": k1(int(round(e * f2)))},
        ]
        items.append({"id": m["id"], "name": m["name"], "region": m["region"], "regionId": m["regionId"],
                      "population": m["pop"], "expenditure": k1(e), "ownRevenue": k1(o), "transfers": k1(m["transfers"]),
                      "balance": k1(b), "debt": k1(debt), "quarterly": quarterly, "mock": True, "why": M03_WHY})
        a = reg.setdefault(m["regionId"], {"id": m["regionId"], "name": m["region"], "population": 0, "e": 0, "o": 0,
                                           "t": 0, "d": 0})
        a["population"] += m["pop"]
        a["e"] += e
        a["o"] += o
        a["t"] += m["transfers"]
        a["d"] += debt
    regions = [{"id": a["id"], "name": a["name"], "population": a["population"], "expenditure": k1(a["e"]),
                "ownRevenue": k1(a["o"]), "transfers": k1(a["t"]), "debt": k1(a["d"]), "mock": True, "why": M03_WHY}
               for a in sorted(reg.values(), key=lambda a: a["id"])]
    tot_e = sum(i["expenditure"] for i in items)
    totals = {"population": sum(m["pop"] for m in mun), "expenditure": k1(exp_t), "ownRevenue": k1(own_total),
              "transfers": k1(tr_t), "balance": 0.0, "debt": round(sum(i["debt"] for i in items), 1)}
    if abs(tot_e - totals["expenditure"]) > 0.05:
        problem("M03: expenditure does not add up (%s vs %s)" % (tot_e, totals["expenditure"]))
    mt = L.meta("M03", "Примерни финанси на общините", ["mockgen", "asbp", "zdb", "gisco"],
                "Примерен набор: разходите на общините се събират в 6 881,9 млн. € (АСБП); трансферите са реалните по чл. 51 "
                "от ЗДБ 2026; населението е по GISCO LAU 2024, същото като в реалния набор за общините; собствените приходи, "
                "салдата, дългът и тримесечията са по модел (фиксирано семе).",
                unit="хил. €", label="ПРИМЕРНИ ДАННИ", notice=M03_NOTICE, populationYear=2024,
                realFields=["items[].id", "items[].name", "items[].region", "items[].regionId", "items[].population",
                            "items[].transfers", "regions[].id", "regions[].name", "regions[].population",
                            "regions[].transfers", "totals.population", "totals.expenditure", "totals.transfers"],
                modelFields=["items[].expenditure", "items[].ownRevenue", "items[].balance", "items[].debt",
                             "items[].quarterly", "regions[].expenditure", "regions[].ownRevenue", "regions[].debt",
                             "totals.ownRevenue", "totals.balance", "totals.debt"],
                quarterlyNote="Тримесечията са натрупани от 1 януари; за 2026 г. са налични първо и второ тримесечие; приходите "
                              "са всички приходи (собствени + трансфери).",
                constrainedBy=[
                    "Сборът на разходите на 265-те общини е 6 881,9 млн. € (АСБП: общо разходи на общините 2026 г.).",
                    "Трансферите по общини са реалните по чл. 51, т. 1 и 2 от ЗДБ 2026 (основни бюджетни взаимоотношения и други целеви).",
                    "Собствени приходи = разходи − трансфери ± салдо; салдото е под 3% от разходите на общината, сборът му е 0.",
                    "По-големите общини имат по-високи собствени приходи на жител."])
    return {"meta": mt, "totals": totals, "regions": regions, "items": items}


# =============================================================================================================== M07
# Everyday-tax assumptions for the calculator (S18). Real rates only where the motives to the bill state them; the rest is
# an "ориентировъчно" model.

M07_WHY_MODEL = "Ориентировъчна стойност за примера, не официални данни."
# v5 (10.10.2026) calls real data „официални“; the published file was edited by hand then, the builder follows it since 05.11.2026
M07_WHY_REAL = "Ставката е официална (по допусканията в мотивите към бюджета); наборът като цяло е примерен."


def build_m07():
    m7 = L.meta("M07", "Допускания за косвените данъци в калкулатора", ["mockgen", "asbp"],
                "Ставките на ДДС и акциза са от Приложение 2 „Основни допускания“ към мотивите на законопроекта; цената на "
                "горивото и на цигарите и делът на покупките със стандартна ставка са ориентировъчни, по модел.",
                unit="€", label="ориентировъчно",
                why="Калкулаторът пресмята косвените данъци в разходите на семейството приблизително: ставките са официални, "
                    "цените и дялът на покупките със стандартна ставка са примерни. Резултатът е „ориентировъчно“.",
                realFields=["vatRatePct", "fuelExcisePerLitreEur", "tobaccoExcisePerPackEur"],
                modelFields=["vatShareOfPurchases", "fuelPricePerLitreEur", "tobaccoPricePerPackEur"],
                constrainedBy=[
                    "ДДС: стандартна ставка 20% (2025–2028); 9% за настаняването в хотели и подобни, книгите и периодичния печат, "
                    "храните за бебета и малки деца и пелените и подобните хигиенни изделия.",
                    "Акциз на горивата, евро на 1000 литра: бензин 363,02, дизел 330,29, газ за двигатели 173,84.",
                    "Акциз на цигарите (общ, не по-малък от), евро на 1000 къса: 113,51 от 1.1.2026, 120 от 1.8.2026, 126 от "
                    "1.3.2027, 132 от 1.1.2028."])

    def rec(id_, group, name, value, unit, kind, basis, since=None, note=None):
        d = {"id": id_, "group": group, "name": name, "value": value, "unit": unit,
             "kind": "официална ставка" if kind == "real" else "ориентировъчно"}
        if since:
            d["since"] = since
        if note:
            d["note"] = note
        d["basis"] = basis
        d["mock"] = True
        d["why"] = M07_WHY_REAL if kind == "real" else M07_WHY_MODEL
        return d

    ann2 = "Приложение 2 „Основни допускания“ към мотивите на законопроекта"
    items = [
        rec("vat-standard", "vat", "Стандартна ставка на ДДС", 20, "%", "real", ann2 + ": ДДС 20% (2025–2028)."),
        rec("vat-reduced-accommodation", "vat", "Намалена ставка на ДДС: настаняване в хотели и подобни", 9, "%", "real",
            ann2 + ": 9% за услугите по настаняване в хотели и подобни места."),
        rec("vat-reduced-books", "vat", "Намалена ставка на ДДС: книги и периодичен печат", 9, "%", "real",
            ann2 + ": 9% за книги на хартиен или електронен носител и за периодичния печат (вестници, списания)."),
        rec("vat-reduced-baby-food", "vat", "Намалена ставка на ДДС: храни за бебета и малки деца", 9, "%", "real",
            ann2 + ": 9% за храните за бебета и малки деца (Приложение 4 към ЗДДС)."),
        rec("vat-reduced-baby-hygiene", "vat", "Намалена ставка на ДДС: пелени и подобни хигиенни изделия", 9, "%", "real",
            ann2 + ": 9% за пелените и подобните хигиенни изделия за бебета."),
        rec("vat-share-of-purchases", "vat", "Дял от покупките със стандартна ставка на ДДС", 0.8, "дял 0..1", "model",
            "Допускане за примера: останалите покупки са с намалена ставка или без ДДС (наем, здраве, образование).",
            note="ДДС е вече в цената; калкулаторът го смята като цена × ставка ÷ (100 + ставка)."),
        rec("fuel-excise-petrol", "fuel", "Акциз върху бензина, евро на литър", 0.36302, "€/л", "real",
            ann2 + ": 363,02 евро на 1000 литра."),
        rec("fuel-excise-diesel", "fuel", "Акциз върху дизела, евро на литър", 0.33029, "€/л", "real",
            ann2 + ": 330,29 евро на 1000 литра."),
        rec("fuel-excise-lpg", "fuel", "Акциз върху газта за двигатели, евро на литър", 0.17384, "€/л", "real",
            ann2 + ": 173,84 евро на 1000 литра."),
        rec("fuel-price", "fuel", "Цена на горивото, евро на литър (с ДДС и акциз)", 1.4, "€/л", "model",
            "Допускане за примера, не пазарна цена към днешна дата."),
        rec("tobacco-excise-pack-2026-01", "tobacco", "Акциз върху цигарите, евро на кутия от 20 къса, от 1.1.2026", 2.27,
            "€/кутия", "real", ann2 + ": общ акциз не по-малък от 113,51 евро на 1000 къса.", since="2026-01-01"),
        rec("tobacco-excise-pack-2026-08", "tobacco", "Акциз върху цигарите, евро на кутия от 20 къса, от 1.8.2026", 2.4,
            "€/кутия", "real", ann2 + ": общ акциз не по-малък от 120 евро на 1000 къса.", since="2026-08-01",
            note="Това е и стойността в калкулатора; акцизът е „не по-малък от“, затова пресметнатото е долна граница."),
        rec("tobacco-excise-pack-2027-03", "tobacco", "Акциз върху цигарите, евро на кутия от 20 къса, от 1.3.2027", 2.52,
            "€/кутия", "real", ann2 + ": общ акциз не по-малък от 126 евро на 1000 къса.", since="2027-03-01"),
        rec("tobacco-price-pack", "tobacco", "Цена на кутия цигарети, евро (с ДДС и акциз)", 5.6, "€/кутия", "model",
            "Допускане за примера, не пазарна цена към днешна дата."),
    ]
    out = collections.OrderedDict()
    out["meta"] = m7
    out["vatRatePct"] = 20
    out["vatShareOfPurchases"] = 0.8
    out["fuelPricePerLitreEur"] = 1.4
    out["fuelExcisePerLitreEur"] = 0.36302
    out["tobaccoPricePerPackEur"] = 5.6
    out["tobaccoExcisePerPackEur"] = 2.4
    out["flatKeysNote"] = ("Плоските числа по-горе са тези, които чете калкулаторът (js/calc.js, indirectTaxes); подробните "
                           "записи са в items. Акцизът на горивото е за бензина.")
    out["items"] = items
    return out


# =============================================================================================================== M04
# Payments of the 46 central budget holders, January-August 2026, in the spirit of SEBRA. Real anchors: each institution's
# share follows its real expenditure in the law (art. 2-47); its split by economic type follows the lines of its own budget
# in the law; the monthly path follows the 2025 pace of the real execution; every month stays below the real expenditure of
# the national budget. Model: the rest, and all recipients (invented firms with ЕИК numbers whose check digit is wrong).

M04_WHY = "Примерни данни."
M04_WHY_INST = "Примерни плащания; не са отчет на институцията."
M04_WHY_TYPE = "Примерни плащания по вид разход."
M04_WHY_REC = "Измислена фирма: такъв изпълнител няма, а сумите са примерни."
M04_TYPES = ["exp.personnel", "exp.maint", "exp.subsidies", "exp.social", "exp.capex", "other"]
M04_TYPE_NAME = {"exp.personnel": "Персонал", "exp.maint": "Издръжка", "exp.subsidies": "Субсидии",
                 "exp.social": "Социални разходи и стипендии", "exp.capex": "Капиталови разходи", "other": "Други разходи"}
M04_AVG_ORDER = {"exp.personnel": 220000.0, "exp.maint": 9000.0, "exp.subsidies": 120000.0, "exp.social": 18000.0,
                 "exp.capex": 70000.0, "other": 40000.0}                       # model: average size of one payment order
M04_NOTICE = ("ПРИМЕРНИ ДАННИ. Плащанията в този файл са пресметнати по модел в духа на СЕБРА и НЕ са отчет на нито една "
              "институция, а изпълнителите са измислени. Реалното е само рамката: делът на всяка институция следва реалните ѝ "
              "разходи по закона, видовете разход — редовете на нейния бюджет, а месечните суми остават под реалните разходи на "
              "държавния бюджет за съответния месец.")
M04_RECIPIENTS_NOTE = ("Изпълнителите са измислени: името започва с „Примерен/Примерна/Примерно“, а ЕИК започва с 999 и има нарочно "
                       "грешна контролна цифра, затова не може да съвпадне с действително вписана фирма. Изпълнителите в списъка "
                       "получават само малка част от плащанията.")
M04_NOTE = ("Примерен набор в духа на СЕБРА: суми по институции, видове разход и дни. Делът на институциите следва реалните им "
            "разходи по ЗДБ 2026, видовете разход — редовете на бюджетите им, месечният ход — изпълнението на КФП за 2025 г., а "
            "всеки месец остава под реалните разходи на държавния бюджет; изпълнителите са измислени.")
M04_CONSTRAINED = [
    "Делът на всяка от 46-те институции в плащанията следва реалните ѝ разходи по ЗДБ 2026 (чл. 2–47), с отклонение до около 10%.",
    "Разпределението по вид разход на всяка институция следва редовете на бюджета ѝ в закона (персонал, субсидии, социални, "
    "капиталови разходи; издръжката е остатъкът от текущите разходи).",
    "Месечният ход следва изпълнението на КФП за 2025 г. по вид разход; сборът до август е близо до дела на годишните разходи, "
    "отчетен към август 2025 г.",
    "Всеки месец е под реалните разходи на държавния бюджет; за август месечният отчет още не е публикуван и границата е по модел.",
    "Изпълнителите са измислени (ЕИК 999…, нарочно грешна контролна цифра); сумите към тях са част от плащанията по издръжка, "
    "капиталови разходи и субсидии."]

# invented recipients: (label, name template, subjects, institution ids it may be paid by, [(type, weight)], how many)
M04_KINDS = [
    ("Строителство", "Примерна строителна фирма {n} ЕООД",
     ["Примерен договор за ремонт на сгради и съоръжения", "Примерен договор за строителство и надзор",
      "Примерен договор за поддръжка на инфраструктура"],
     ["2100", "2300", "1200", "1600", "1700", "1300", "1400", "2200", "0600"], [("exp.capex", 0.7), ("exp.maint", 0.3)], 10),
    ("Информационни услуги", "Примерна софтуерна компания {n} ООД",
     ["Примерен договор за разработка и поддръжка на софтуер", "Примерна доставка на компютърна техника",
      "Примерен договор за облачни услуги и сигурност"],
     ["7400", "1000", "1300", "1700", "1600", "4100", "1500", "2100", "0600"], [("exp.maint", 0.7), ("exp.capex", 0.3)], 7),
    ("Консултантски услуги", "Примерна консултантска къща {n} ЕООД",
     ["Примерен договор за анализ и оценка на програма", "Примерно проучване и препоръки", "Примерно обучение на служители"],
     ["1000", "1500", "1900", "2400", "2000", "2500", "1800", "0300"], [("exp.maint", 1.0)], 5),
    ("Медицински изделия", "Примерен доставчик на медицински изделия {n} ЕООД",
     ["Примерна доставка на медицински изделия", "Примерна доставка на лекарствени продукти и консумативи",
      "Примерна доставка на лабораторна апаратура"],
     ["1600", "1200", "1300", "1400"], [("exp.maint", 0.6), ("exp.capex", 0.4)], 5),
    ("Транспорт и логистика", "Примерно транспортно дружество {n} АД",
     ["Примерен договор за превоз и логистика", "Примерна наемна услуга за автопарк", "Примерен договор за складова логистика"],
     ["1200", "1300", "2300", "5300", "1700"], [("exp.maint", 0.8), ("exp.capex", 0.2)], 4),
    ("Услуги", "Примерен изпълнител {n} ЕООД",
     ["Примерен договор за почистване и поддръжка", "Примерен договор за охрана", "Примерна услуга по хранене и кетъринг"],
     ["1300", "1200", "1700", "1600", "1400", "0600", "1000", "7400"], [("exp.maint", 1.0)], 7),
    ("Доставки", "Примерен доставчик {n} ЕООД",
     ["Примерна доставка на офис консумативи и оборудване", "Примерна доставка на автомобили и техника",
      "Примерна доставка на униформено облекло"],
     ["1300", "1200", "1400", "0600", "1700", "1000", "5300"], [("exp.maint", 0.7), ("exp.capex", 0.3)], 5),
    ("Организации с нестопанска цел", "Примерно сдружение {n}",
     ["Примерна субсидия за дейност в обществена полза", "Примерна субсидия за културен проект",
      "Примерна субсидия за спортна дейност"],
     ["1500", "1800", "2500", "1700"], [("exp.subsidies", 1.0)], 3),
    ("Енергия", "Примерно енергийно дружество {n} ЕАД",
     ["Примерен договор за доставка на електроенергия и топлоснабдяване"],
     ["1200", "1300", "1700", "1600"], [("exp.maint", 1.0)], 1),
    ("Издателска дейност", "Примерно издателство {n} ЕООД",
     ["Примерен договор за печат и разпространение на учебни и информационни материали"],
     ["1700", "1800"], [("exp.maint", 1.0)], 1),
]


def law_type_weights(lines):
    """Weights [personnel, maintenance, subsidies, social, capital, other] from the expenditure lines (section II) of a budget
    in the law. Maintenance is the rest of the current expenditure; the 3 budgets without a personnel line (Народно събрание,
    Съдебна власт, ДА „Разузнаване“) take half of their current expenditure as personnel."""
    cur = pers = subs = soc = cap = oth = 0.0
    has_pers = False
    for sec, n, label, val in lines:
        if sec != "II" or n == "II" or n == "":
            continue
        v = float(val) if val is not None else 0.0
        if n == "1":
            cur = v
        elif n == "1.1":
            pers = v
            has_pers = True
        elif n in ("1.2", "1.3", "1.4"):
            if label.startswith("Субсидии"):
                subs += v
            elif label.startswith("Текущи трансфери, обезщетения"):
                soc += v
        elif n == "2":
            cap = v
        elif n == "3":
            oth = v
    if not has_pers:
        pers = 0.5 * cur
    return [pers, max(0.0, cur - pers - subs - soc), subs, soc, cap, oth]


def m04_inputs():
    mins = data("ministries.json")
    exe = data("execution.json")
    law = need(L.LAW_JSON)
    if mins is None or exe is None or law is None:
        return None
    inst = []
    for it in sorted(mins["items"], key=lambda x: x["id"]):
        entry = law["law"].get(str(it["art"]))
        if entry is None:
            problem("M04: no law budget for art. %s" % it["art"])
            continue
        if abs(float(entry["headline"]["exp"]) - float(it["expKhil"])) > 0.05:
            problem("M04: %s expenditure differs between ministries.json and the law cache" % it["id"])
        inst.append({"id": it["id"], "art": it["art"], "name": it["name"], "short": it.get("short") or it["name"],
                     "kind": it["kind"], "expKhil": float(it["expKhil"]), "w": law_type_weights(entry["lines"])})
    if len(inst) != 46:
        problem("M04: expected 46 institutions, got %d" % len(inst))
    return inst, exe


def national_caps(exe):
    """Real national-budget expenditure per month of 2026 (млн. €); a month still missing is a model: the last known month
    times the 2025 ratio of the two months."""
    nat26 = exe["monthly"]["2026"]["nat"]["exp.total"]
    nat25 = exe["monthly"]["2025"]["nat"]["exp.total"]
    caps, kinds = [], []
    for m in range(8):
        if m < len(nat26):
            caps.append(float(nat26[m]))
            kinds.append("real")
        else:
            caps.append(caps[-1] * float(nat25[m]) / float(nat25[m - 1]))
            kinds.append("model")
    return caps, kinds


def wchoice(r, pairs):
    """Weighted choice from [(item, weight)]; one random draw."""
    tot = sum(w for _, w in pairs)
    x = r.random() * tot
    acc = 0.0
    for it, w in pairs:
        acc += w
        if x < acc:
            return it
    return pairs[-1][0]


def build_m04():
    got = m04_inputs()
    if got is None:
        return None
    inst, exe = got
    if problems:
        return None
    caps, cap_kinds = national_caps(exe)
    types = {}
    for row in exe["rows"]:
        if row["id"] in M04_TYPE_NAME and row["id"] != "other":
            types[row["id"]] = row.get("short") or row["label"]
    tname = {t: types.get(t, M04_TYPE_NAME[t]) for t in M04_TYPES}
    pace = exe["pace"]["2025"]
    prof = {}
    for t in M04_TYPES:
        cum = pace["exp.total" if t == "other" else t]
        prof[t] = [cum[m] - (cum[m - 1] if m else 0.0) for m in range(8)]
    r = L.rng("M04")
    nI = len(inst)
    total = int(round(sum(i["expKhil"] for i in inst) * 1000.0 * pace["exp.total"][7] / 100.0))
    noise = [min(1.10, max(0.90, math.exp(r.gauss(0.0, 0.05)))) for _ in inst]
    tot_i = L.apportion([i["expKhil"] * n for i, n in zip(inst, noise)], total)
    cell = []      # cell[i][t][m]  whole euros
    cnt = []       # cnt[i][t][m]   payment orders
    for i, ti in zip(inst, tot_i):
        yt = L.apportion(i["w"], ti)
        ci, ni = [], []
        for t, y in zip(M04_TYPES, yt):
            wm = [p * math.exp(r.gauss(0.0, 0.10)) for p in prof[t]]
            row = L.apportion(wm, y)
            nrow = []
            for v in row:
                z = r.gauss(0.0, 0.20)
                nrow.append(0 if v == 0 else max(1, int(round(v / (M04_AVG_ORDER[t] * math.exp(z))))))
            ci.append(row)
            ni.append(nrow)
        cell.append(ci)
        cnt.append(ni)
    mon_eur = [sum(cell[i][t][m] for i in range(nI) for t in range(6)) for m in range(8)]
    mon_cnt = [sum(cnt[i][t][m] for i in range(nI) for t in range(6)) for m in range(8)]
    # days: only working days, more at the end and in the middle of the month
    daily = []
    for m in range(8):
        days = L.working_days(L.MONTHS[m])
        k = len(days)
        wd = []
        for j, d in enumerate(days):
            w = math.exp(r.gauss(0.0, 0.35))
            if j >= k - 2:
                w *= 1.8
            if 14 <= int(d[8:10]) <= 16:
                w *= 1.2
            wd.append(w)
        eur_d = L.apportion(wd, mon_eur[m])
        cnt_d = L.apportion([w * math.exp(r.gauss(0.0, 0.08)) for w in wd], mon_cnt[m] - k)
        for d, e, c in zip(days, eur_d, cnt_d):
            daily.append({"date": d, "count": 1 + c, "eur": e, "mock": True, "why": M04_WHY})
    months = []
    for m in range(8):
        months.append({"month": L.MONTHS[m], "eur": mon_eur[m], "count": mon_cnt[m], "natExpMln": round(caps[m], 1),
                       "natExpKind": cap_kinds[m], "shareOfNatExpPct": round(mon_eur[m] / (caps[m] * 1e6) * 100.0, 1),
                       "mock": True, "why": M04_WHY})
        if mon_eur[m] > caps[m] * 1e6:
            problem("M04: month %s exceeds the national expenditure" % L.MONTHS[m])
    by_type = []
    for t in range(6):
        me = [sum(cell[i][t][m] for i in range(nI)) for m in range(8)]
        by_type.append({"code": M04_TYPES[t], "name": tname[M04_TYPES[t]],
                        "count": sum(cnt[i][t][m] for i in range(nI) for m in range(8)), "eur": sum(me), "monthlyEur": me,
                        "mock": True, "why": M04_WHY_TYPE})
    law_total = sum(i["expKhil"] for i in inst)
    by_inst = []
    for ii, i in enumerate(inst):
        e = sum(cell[ii][t][m] for t in range(6) for m in range(8))
        by_inst.append({"id": i["id"], "name": i["name"], "short": i["short"], "kind": i["kind"],
                        "count": sum(cnt[ii][t][m] for t in range(6) for m in range(8)), "eur": e,
                        "lawExpKhil": i["expKhil"], "shareOfLawExpPct": round(i["expKhil"] / law_total * 100.0, 2),
                        "shareOfPaymentsPct": round(e / total * 100.0, 2),
                        "monthlyEur": [sum(cell[ii][t][m] for t in range(6)) for m in range(8)],
                        "byTypeEur": [sum(cell[ii][t]) for t in range(6)], "mock": True, "why": M04_WHY_INST})
    recipients = m04_recipients(inst, cell, cnt, tname)
    rec_eur = sum(x["eur"] for x in recipients)
    working = [d["date"] for d in daily]
    mt = L.meta("M04", "Примерни плащания на бюджетните организации", ["mockgen", "bill", "zdb", "kfp", "sebra"], M04_NOTE,
                unit="€", period={"from": L.PERIOD_FROM, "to": L.PERIOD_TO}, label="ПРИМЕРНИ ДАННИ", notice=M04_NOTICE,
                realFields=["byInstitution[].id", "byInstitution[].name", "byInstitution[].short", "byInstitution[].kind",
                            "byInstitution[].lawExpKhil", "byInstitution[].shareOfLawExpPct", "byType[].code", "byType[].name",
                            "months[].natExpMln", "months[].natExpKind"],
                modelFields=["totals", "months[].eur", "months[].count", "months[].shareOfNatExpPct", "byType[].eur",
                             "byType[].count", "byType[].monthlyEur", "byInstitution[].eur", "byInstitution[].count",
                             "byInstitution[].shareOfPaymentsPct", "byInstitution[].monthlyEur",
                             "byInstitution[].byTypeEur", "daily", "recipients"],
                recipientsNote=M04_RECIPIENTS_NOTE, typeOrder=M04_TYPES, monthOrder=L.MONTHS,
                holidays=sorted(L.HOLIDAYS_2026),
                amountsNote="Всички суми са в цели евро; броят е на платежните нареждания.",
                augustNote=("Разходите на държавния бюджет за август са по месечния отчет на КФП към 31.08.2026 г."
                            if cap_kinds[7] == "real" else
                            "Реалните разходи на държавния бюджет за август още не са публикувани; границата за август е по модел "
                            "(юли 2026 по отношението август към юли 2025 г.)."),
                constrainedBy=(M04_CONSTRAINED[:3] + ["Всеки месец е под реалните разходи на държавния бюджет по месечните отчети на КФП."]
                               + M04_CONSTRAINED[4:]) if cap_kinds[7] == "real" else M04_CONSTRAINED)
    totals = {"eur": total, "count": sum(mon_cnt), "institutions": nI, "recipients": len(recipients),
              "recipientsEur": rec_eur, "workingDays": len(working)}
    return {"meta": mt, "totals": totals, "months": months, "byType": by_type, "byInstitution": by_inst, "daily": daily,
            "recipients": recipients}


def m04_recipients(inst, cell, cnt, tname):
    """About 48 invented recipients paid from the maintenance, capital and subsidy cells of the aggregate. Every recipient
    takes only a part of a cell, so the sample never exceeds the aggregate it is taken from."""
    rr = L.rng("M04:recipients")
    idx = {i["id"]: n for n, i in enumerate(inst)}
    tix = {t: n for n, t in enumerate(M04_TYPES)}
    room, croom = {}, {}
    for n in range(len(inst)):
        for t in ("exp.maint", "exp.capex", "exp.subsidies"):
            room[(n, t)] = int(0.35 * sum(cell[n][tix[t]]))
            croom[(n, t)] = int(0.35 * sum(cnt[n][tix[t]]))
    days = [d for m in range(8) for d in L.working_days(L.MONTHS[m])]
    last_days = days[-45:]
    raw = []
    for label, tpl, subjects, inst_ids, type_w, how_many in M04_KINDS:
        pref = [idx[x] for x in inst_ids if x in idx]
        for _ in range(how_many):
            target = min(8e7, max(1.5e5, L.lognormal(rr, 3.5e6, 1.0)))
            n_legs = rr.choice([1, 1, 2, 2, 3])
            legs = collections.OrderedDict()
            left = target
            for k in range(n_legs):
                t = wchoice(rr, type_w)
                cands = [(n, room[(n, t)]) for n in pref if room[(n, t)] >= 30000 and croom[(n, t)] >= 2]
                if not cands:
                    continue
                n = wchoice(rr, cands)
                want = left / (n_legs - k) * rr.uniform(0.6, 1.4)
                eur = int(min(want, room[(n, t)] * 0.5))
                if eur < 20000:
                    continue
                c = max(1, int(round(eur / (M04_AVG_ORDER[t] * math.exp(rr.gauss(0.0, 0.25))))))
                c = min(c, max(1, croom[(n, t)] // 2))
                room[(n, t)] -= eur
                croom[(n, t)] -= c
                prev = legs.get((n, t), [0, 0])
                legs[(n, t)] = [prev[0] + eur, prev[1] + c]
                left -= eur
            if not legs:
                problem("M04: a recipient got no payments (rooms exhausted)")
                continue
            eur_total = sum(v[0] for v in legs.values())
            raw.append({"label": label, "tpl": tpl, "subject": rr.choice(subjects), "legs": legs, "eur": eur_total,
                        "count": sum(v[1] for v in legs.values()), "u1": rr.uniform(1.0, 2.2), "u2": rr.uniform(1.05, 2.5),
                        "recent": sorted(rr.sample(last_days, 4), reverse=True)})
    raw.sort(key=lambda x: (-x["eur"], x["tpl"]))
    out = []
    for c, x in enumerate(raw, 1):
        eik8 = "999%05d" % c
        eik = eik8 + str((L.eik9_check_digit(eik8) + 5) % 10)             # a check digit that is deliberately wrong
        by_inst = collections.OrderedDict()
        by_type = collections.OrderedDict()
        for (n, t), (e, _c) in x["legs"].items():
            by_inst[n] = by_inst.get(n, 0) + e
            by_type[t] = by_type.get(t, 0) + e
        bi = [{"name": inst[n]["name"], "eur": e} for n, e in sorted(by_inst.items(), key=lambda kv: (-kv[1], kv[0]))]
        bt = [{"name": tname[t], "eur": e} for t, e in sorted(by_type.items(), key=lambda kv: (-kv[1], kv[0]))]
        leg_list = list(x["legs"].items())
        recent = []
        budget = int(x["eur"] * 0.6)
        for d in x["recent"]:
            n, t = wchoice(rr, [(lg, v[0]) for lg, v in leg_list])
            e = x["legs"][(n, t)][0]
            amount = max(1000, int(e * rr.uniform(0.05, 0.22)))
            amount = min(amount, budget)
            if amount < 1000:
                continue
            budget -= amount
            recent.append({"date": d, "institution": inst[n]["name"], "type": tname[t], "eur": amount})
        paid = int(round(x["eur"] * x["u1"]))
        out.append({"eik": eik, "name": x["tpl"].format(n="%03d" % c), "kind": x["label"], "subject": x["subject"],
                    "count": x["count"], "eur": x["eur"], "contractedEur": int(round(paid * x["u2"])), "paidEur": paid,
                    "byInstitution": bi, "byType": bt, "recent": recent, "mock": True, "why": M04_WHY_REC})
    return out


# =============================================================================================================== M01
# Activities of Здравеопазване and Образование. Real: the function items of Табл. III-1 (both years) and their growth.
# Model: the breakdown into activities and groups (descriptive names without ЕБК codes, Dirichlet shares, fixed seed).

M01_WHY_FN = ("Сумата за функцията е реалната (Табл. III-1). Разбивката по дейности е примерна: разбивката до дейности "
              "се публикува само от МФ (ЗДОИ).")
M01_WHY_GROUP = "Групата е примерно обединение на дейности; в бюджета няма такова ниво."
M01_WHY_ITEM = "Примерна дейност и сума. Само сборът по функцията е реален."
M01_NOTICE = ("ПРИМЕРНИ ДАННИ. Разбивката на разходите до дейности се публикува само от Министерството на финансите (ЗДОИ). "
              "Дейностите, групите и сумите по тях в този файл са измислени за целите на прототипа и НЕ са отчет на "
              "министерство. Реален е само сборът за всяка от двете функции (Табл. III-1 на мотивите към законопроекта).")
M01_GROUPS_NOTE = ("Групите са примерно обединение на дейностите, за да се чете дървото „функция › група › дейност“; в "
                   "бюджета няма такова ниво.")


def bgn(x, d=1):
    """1234567.8 -> '1 234 567,8' (regular spaces, comma decimal) for the prose in the meta blocks."""
    return ("{:,.%df}" % d).format(x).replace(",", " ").replace(".", ",")


def build_m01():
    ex = data("expenditure.json")
    if ex is None:
        return None
    import mock_content as C
    fx = ex["functions"]
    real = {it["id"]: it for it in fx["items"]}
    r = L.rng("M01")
    functions, items = [], []
    for fid, groups, acts in C.M01_FUNCTIONS:
        it = real.get(fid)
        if it is None:
            problem("M01: function %r is missing in expenditure.json" % fid)
            continue
        m25, m26 = L.tenths(it["mln"][0]), L.tenths(it["mln"][1])         # the real items, integer tenths of млн. €
        g = m26 / float(m25)                                              # the real growth of the item, 2025 -> 2026
        tot = float(sum(a[3] for a in acts))
        gam = [r.gammavariate(C.M01_CONCENTRATION * a[3] / tot, 1.0) for a in acts]
        a26 = L.apportion(gam, m26)
        a25 = None
        for _try in range(500):                                           # 2025 = 2026 / growth, +-2% noise, repaired to stay in +-2.8%
            t = [a26[i] / g * (1.0 + r.uniform(-0.02, 0.02)) for i in range(len(acts))]
            cand = L.apportion(t, m25)
            if all(abs(cand[i] - a26[i] / g) <= 0.028 * a26[i] / g for i in range(len(acts))):
                a25 = cand
                break
        if a25 is None:
            problem("M01: no 2025 split within +-3%% for %s" % fid)
            continue
        if sum(a26) != m26 or sum(a25) != m25:
            problem("M01: %s does not add up" % fid)
        gorder = [gid for gid, _n in groups]
        rows = [{"id": a[0], "group": a[1], "name": a[2], "t": (a25[i], a26[i])} for i, a in enumerate(acts)]
        rows.sort(key=lambda x: (gorder.index(x["group"]), -x["t"][1], x["id"]))
        gsum = dict((gid, [0, 0, 0]) for gid in gorder)
        for x in rows:
            s = gsum[x["group"]]
            s[0] += x["t"][0]
            s[1] += x["t"][1]
            s[2] += 1
        functions.append({"id": fid, "name": it["name"], "totalMln": [k1(m25), k1(m26)],
                          "growthPct": round((g - 1.0) * 100.0, 2), "activities": len(rows), "mock": True, "why": M01_WHY_FN,
                          "groups": [{"id": gid, "name": gname, "mln": [k1(gsum[gid][0]), k1(gsum[gid][1])],
                                      "activities": gsum[gid][2], "mock": True, "why": M01_WHY_GROUP}
                                     for gid, gname in groups]})
        for x in rows:
            items.append({"id": x["id"], "function": fid, "group": x["group"], "name": x["name"],
                          "mln": [k1(x["t"][0]), k1(x["t"][1])],
                          "growthPct": round((x["t"][1] / float(x["t"][0]) - 1.0) * 100.0, 1),
                          "mock": True, "why": M01_WHY_ITEM})
    if len(functions) != 2:
        return None
    parts = ["%s %s млн. €" % (f["name"], bgn(f["totalMln"][1])) for f in functions]
    mt = L.meta("M01", "Примерни дейности: Здравеопазване и Образование", ["asbp", "mockgen"],
                "Функциите и сумите по функции са от Табл. III-1 на мотивите към законопроекта (внесен на 01.07.2026 г.); "
                "разбивката по дейности е примерна (фиксирано семе).",
                unit="млн. €", years=fx["years"][:2], vintage=fx["vintage"][:2], yearLabels=fx["yearLabels"][:2],
                label="ПРИМЕРНИ ДАННИ", notice=M01_NOTICE, groupsNote=M01_GROUPS_NOTE,
                realFields=["functions[].id", "functions[].name", "functions[].totalMln", "functions[].growthPct"],
                modelFields=["functions[].groups", "items"],
                constrainedBy=[
                    "За всяка от двете функции сборът на дейностите е точно реалното перо от Табл. III-1 за 2026 г. (%s)." %
                    "; ".join(parts),
                    "2025 = 2026 ÷ реалния ръст на перото (%s) ±3%% за всяка дейност; сборът за 2025 г. също е реалното перо." %
                    "; ".join("%s %s%%" % (f["name"], bgn(f["growthPct"], 2)) for f in functions),
                    "12–20 дейности на функция, с описателни имена и без кодове по ЕБК; дяловете са по Дирихле с фиксирано семе."])
    return {"meta": mt, "functions": functions, "items": items}


# =============================================================================================================== M02
# Result indicators of the real programs of МФ, МТСП and МОН. Real: the ministries and the 29 programs (D09, names and
# codes). Model: the indicators, their targets and the 2024 values (target +-9%, never above 100 for a percentage).

M02_MINISTRIES = ("1000", "1500", "1700")
M02_WHY_MIN = "Ведомството и програмите му са реални; показателите към тях са примерни."
M02_WHY_PROG = "Програмата е реална; показателите към нея са примерни."
M02_WHY_IND = "Примерен показател с примерни стойности, не отчет на министерството."
M02_NOTICE = ("ПРИМЕРНИ ДАННИ. Програмите са реални (програмните бюджети на Министерството на финансите, на труда и "
              "социалната политика и на образованието и науката към законопроекта), но показателите за резултат, целите "
              "и постигнатите стойности по тях са измислени за целите на прототипа и НЕ са отчет на министерство. "
              "Постигнати стойности има само за 2024 г.; за 2026 г. има само цел.")
M02_MAX_DEV = 0.09          # the draw stays within +-9%; rounding is repaired so that the shown value stays within +-10%
M02_LIMIT = 0.10


def m02_scaled(x, d):
    return int(round(x * (10 ** d)))


def build_m02():
    prg = data("programs.json")
    mins = data("ministries.json")
    if prg is None or mins is None:
        return None
    import mock_content as C
    f = prg["fields"]
    ix = dict((k, f.index(k)) for k in ("ministry", "code", "name", "level", "y2026"))
    nodata = (prg.get("sentinels") or {}).get("noData", -1)
    real = collections.OrderedDict()
    for row in prg["items"]:
        if row[ix["level"]] == "program" and row[ix["ministry"]] in M02_MINISTRIES:
            if row[ix["y2026"]] == nodata:                     # a program WITHOUT a 2026 amount (named or not) is only a placeholder
                continue
            if not row[ix["name"]]:
                problem("M02: program %s has no name in programs.json" % row[ix["code"]])
                continue
            real[row[ix["code"]]] = (row[ix["ministry"]], row[ix["name"]])
    table = collections.OrderedDict(C.M02_INDICATORS)
    for code in real:
        if code not in table:
            problem("M02: program %s has no indicators in mock_content.py" % code)
    for code in table:
        if code not in real:
            problem("M02: indicator table has %s, which is not a program of МФ/МТСП/МОН in programs.json" % code)
    mrow = dict((m["id"], m) for m in mins["items"])
    r = L.rng("M02")
    items = []
    count = dict((m, [0, 0]) for m in M02_MINISTRIES)                       # ministry -> [programs, indicators]
    for code, (mid, pname) in real.items():
        spec = table.get(code)
        if not spec:
            continue
        inds = []
        for n, (name, unit, better, t24, t26, d) in enumerate(spec, 1):
            dev = max(-M02_MAX_DEV, min(M02_MAX_DEV, r.gauss(0.0, 0.045)))
            tS = m02_scaled(t24, d)
            lo = int(math.ceil((1.0 - M02_LIMIT) * tS - 1e-9))
            hi = int(math.floor((1.0 + M02_LIMIT) * tS + 1e-9))
            if unit == "%":
                hi = min(hi, 100 * (10 ** d))
            aS = min(max(int(round(tS * (1.0 + dev))), lo), hi)
            if lo > hi:
                problem("M02: %s indicator %d leaves no value within +-10%%" % (code, n))
            a24 = aS if d == 0 else aS / float(10 ** d)
            inds.append({"id": "%s-i%d" % (code, n), "name": name, "unit": unit, "better": better, "decimals": d,
                         "target2024": t24, "achieved2024": a24,
                         "deviationPct": round((aS / float(tS) - 1.0) * 100.0, 1) if tS else 0.0,
                         "met": (aS >= tS) if better == "up" else (aS <= tS),
                         "target2026": t26, "mock": True, "why": M02_WHY_IND})
        count[mid][0] += 1
        count[mid][1] += len(inds)
        items.append({"id": code, "ministry": mid, "code": code, "name": pname, "indicators": inds,
                      "mock": True, "why": M02_WHY_PROG})
    mlist = []
    for mid in M02_MINISTRIES:
        m = mrow.get(mid)
        if m is None:
            problem("M02: ministry %s is missing in ministries.json" % mid)
            continue
        mlist.append({"id": mid, "name": m["name"], "short": m.get("short", ""), "programs": count[mid][0],
                      "indicators": count[mid][1], "mock": True, "why": M02_WHY_MIN})
    nprog = sum(c[0] for c in count.values())
    nind = sum(c[1] for c in count.values())
    mt = L.meta("M02", "Примерни показатели за резултат на програмите", ["prb", "mockgen"],
                "Ведомствата и програмите са реални (програмните бюджети към законопроект 52-602-01-19); показателите, "
                "целите и стойностите са примерни (фиксирано семе).",
                unit=None, label="ПРИМЕРНИ ДАННИ", notice=M02_NOTICE, achievedYear=2024, targetYears=[2024, 2026],
                realFields=["ministries[].id", "ministries[].name", "ministries[].short", "items[].id", "items[].code",
                            "items[].ministry", "items[].name"],
                modelFields=["items[].indicators"],
                note="deviationPct = (achieved2024 / target2024 - 1) x 100; met = целта за 2024 г. е изпълнена в посоката "
                     "на подобрение (better: up = повече е по-добре, down = по-малко е по-добре).",
                constrainedBy=[
                    "Покрити са всички %d програми на МФ (%d), МТСП (%d) и МОН (%d) от програмните бюджети, с по 2–3 "
                    "показателя на програма (общо %d)." % (nprog, count["1000"][0], count["1500"][0], count["1700"][0], nind),
                    "Постигнатата стойност за 2024 г. е целта за 2024 г. ±10%; процентните показатели не надвишават 100.",
                    "За 2026 г. има само цел; постигнати стойности за 2026 г. няма."])
    return {"meta": mt, "ministries": mlist, "items": items}


# =============================================================================================================== M05
# Invented capital projects. Real: only the national capital-expenditure plan (core.kpis.capex.planMln, КФП 2026) and the
# oblast ids/names (the same as M03). Model: everything else. Status and progress are derived from the stages.

M05_WHY = "Измислен проект: такъв обект няма. Името, мястото, сроковете и сумите са примерни."
M05_NOTICE = ("ПРИМЕРНИ ДАННИ. Проектите в този файл са измислени за целите на прототипа: такива обекти няма, а имената, "
              "областите, сроковете и сумите са примерни. Реален е само общият капиталов план на държавата за 2026 г. "
              "(9 360,6 млн. €), спрямо който се показва делът на примерните проекти.")
M05_STATUS_LABELS = [("planned", "Предстои"), ("building", "В изпълнение"), ("late", "С изоставане"), ("done", "Завършен")]
M05_STAGE_STATUS_LABELS = [("done", "Завършен"), ("doing", "В ход"), ("todo", "Предстои")]


def m05_progress(now, frac, weights):
    """Progress in whole percent: the weights of the finished stages plus the share of the stage under way."""
    if now is None:
        return 100
    return int(math.floor(sum(weights[:now]) + weights[now] * frac + 0.5))


def m05_expected(start, cend, asof, weights):
    """Progress a linear construction would have reached by `asof` (stages before construction are finished)."""
    span = max(1, (cend - start).days)
    share = min(1.0, max(0.0, (asof - start).days / float(span)))
    return sum(weights[:2]) + weights[2] * share


def m05_status(now, start, cend, deadline, asof, progress, weights):
    if now is None:
        return "done"
    if start > asof:
        return "planned"
    if deadline < asof or progress + 10 < m05_expected(start, cend, asof, weights):
        return "late"
    return "building"


def build_m05():
    import mock_content as C
    core = data("core.json")
    mun = municipalities_matched()
    if core is None or mun is None:
        return None
    capex = core["kpis"]["capex"]["planMln"]
    if abs(capex - L.CAPEX_PLAN_MLN) > 0.05:
        problem("M05: core.kpis.capex.planMln is %s, expected %s" % (capex, L.CAPEX_PLAN_MLN))
    region_name = {}
    for m in mun:
        region_name[m["regionId"]] = m["region"]
    r = L.rng("M05")
    asof = datetime.date.fromisoformat(C.M05_ASOF)
    weights = [w for _, w in C.M05_STAGES]
    items = []
    tot_t = year_t = paid_t = 0
    by_status = collections.OrderedDict((k, 0) for k, _ in M05_STATUS_LABELS)
    for n, row in enumerate(C.M05_PROJECTS, 1):
        name, rid, start_s, cend_s, dead_s, total, year, now, frac, fin_w, result = row
        pid = "pr-%02d" % n
        start, cend, dead = (datetime.date.fromisoformat(x) for x in (start_s, cend_s, dead_s))
        if rid not in region_name:
            problem("M05 %s: unknown oblast id %s" % (pid, rid))
            continue
        if not (start < cend < dead):
            problem("M05 %s: dates must satisfy start < construction end < deadline" % pid)
        if now is not None and start <= asof and now < 2:
            problem("M05 %s: construction has started but the stage under way is %d" % (pid, now))
        u = r.random()                                         # one draw per project keeps the stream stable
        progress = m05_progress(now, frac, weights)
        status = m05_status(now, start, cend, dead, asof, progress, weights)
        lo, hi = {"done": (0.97, 1.0), "planned": (0.4, 0.7)}.get(status, (0.80, 0.98))
        paid = round(total * progress / 100.0 * (lo + (hi - lo) * u), 1)
        dates = [start - datetime.timedelta(days=150), start - datetime.timedelta(days=20), cend, dead]
        stages = []
        for i, (sname, _) in enumerate(C.M05_STAGES):
            st = "done" if now is None or i < now else ("doing" if i == now else "todo")
            stages.append({"name": sname, "status": st, "date": dates[i].isoformat()})
        keep = [i for i, w in enumerate(fin_w) if w > 0]
        parts = L.apportion([fin_w[i] for i in keep], L.tenths(total))
        financing = [{"source": C.M05_SOURCES[i], "mln": p / 10.0} for i, p in zip(keep, parts)]
        by_status[status] += 1
        tot_t += L.tenths(total)
        year_t += L.tenths(year)
        paid_t += L.tenths(paid)
        items.append({"id": pid, "name": name, "regionId": rid, "region": region_name[rid], "status": status,
                      "start": start_s, "deadline": dead_s, "progressPct": progress, "totalMln": total,
                      "yearMln": year, "paidMln": paid, "stages": stages, "financing": financing,
                      "expectedResult": result, "mock": True, "why": M05_WHY})
    share = round(100.0 * (year_t / 10.0) / capex, 2)
    totals = collections.OrderedDict([("projects", len(items)), ("totalMln", tot_t / 10.0), ("yearMln", year_t / 10.0),
                                      ("paidMln", paid_t / 10.0), ("capexPlanMln", capex), ("yearSharePct", share),
                                      ("byStatus", by_status)])
    note = ("status: done = всички етапи са завършени; planned = строителството започва след %s; late = крайният срок е "
            "минал или напредъкът изостава с над 10 пункта от линейния за времето; иначе building. progressPct е сборът "
            "от теглата на завършените етапи (%s) плюс дела на етапа в ход. start = начало на строителството, "
            "deadline = краен срок за въвеждане в експлоатация, а датата на всеки етап е краят му. totalMln = пълна "
            "стойност, yearMln = планирано за 2026 г., paidMln = платено досега (кумулативно) към %s."
            % (C.M05_ASOF, "/".join(str(w) for w in weights), C.M05_ASOF))
    mt = L.meta("M05", "Примерни капиталови проекти", ["kfp", "mockgen"],
                "Реален е само общият план за капиталови разходи (КФП 2026); проектите са измислени (фиксирано семе).",
                unit="млн. €", label="ПРИМЕРНИ ДАННИ", notice=M05_NOTICE, progressAsOf=C.M05_ASOF,
                statusLabels=[{"id": k, "label": t} for k, t in M05_STATUS_LABELS],
                stageStatusLabels=[{"id": k, "label": t} for k, t in M05_STAGE_STATUS_LABELS],
                stageWeights=weights, financingSources=list(C.M05_SOURCES),
                realFields=["totals.capexPlanMln", "items[].regionId", "items[].region"],
                modelFields=["items"], note=note,
                constrainedBy=[
                    "%d измислени проекта (pr-01 … pr-%02d); имената започват с „Примерен/Примерна/Примерно“ и не "
                    "сочат реален обект, ведомство или изпълнител." % (len(items), len(items)),
                    "Сборът на планираното за 2026 г. е %s млн. € – %s%% от реалния план за капиталови разходи "
                    "(%s млн. €)." % (("%.1f" % (year_t / 10.0)).replace(".", ","), ("%.1f" % share).replace(".", ","),
                                       "{:,.1f}".format(capex).replace(",", " ").replace(".", ",")),
                    "Финансирането по източници на всеки проект е точно равно на пълната му стойност; етапите, "
                    "напредъкът и статусът са съгласувани помежду си."])
    return {"meta": mt, "totals": totals, "items": items}


# =============================================================================================================== M06
# Editorial labels of the 52 measures. Real: the measure ids and the excerpts (`evidence`, `riskEvidence`, `legal`,
# `sinceText`), which are checked to be verbatim parts of the measure's own text. Editorial: who is touched (`affects`),
# who pays and who wins (`payer`, `winner`) and the one-line `risk` note. Texts live in mock_labels.py.

M06_WHY = "Примерен редакционен етикет по текста на мярката; не е официална класификация и не е проверен."
M06_NOTICE = ("РЕДАКЦИОННИ ЕТИКЕТИ, НЕ ОФИЦИАЛНА КЛАСИФИКАЦИЯ. Кого засяга мярката, кой плаща и кой печели са преценки на "
              "редактора, изведени само от текста на самата мярка в мотивите към бюджета. Никой не ги е проверил; на "
              "екрана се показват като „примерни (редакционни) до проверка“.")
M06_NOTE = ("affects: [] значи, че никоя от шестте групи не е засегната пряко според текста. Където текстът не казва кой "
            "плаща или кой печели, пише „Не е посочено в текста“. risk е кратка бележка за вида на оценката и за "
            "изричната уговорка на текста; riskKind следва статуса на оценката на мярката (stated/indicative/avoided/"
            "none). since е ISO дата, записана само когато е в данните на мярката или в самия ѝ текст; sinceText е "
            "дословната фраза, когато текстът дава само месец или година.")


def m06_sources(it):
    """The measure's own words: the texts an excerpt may be taken from."""
    out = []
    for key in ("quote", "text"):
        if isinstance(it.get(key), str):
            out.append(it[key])
    ctx = it.get("context")
    if isinstance(ctx, dict) and isinstance(ctx.get("quote"), str):
        out.append(ctx["quote"])
    return out


def m06_risk_kind(it):
    """The estimate status of the measure (D12): its own estimateKind, else 'stated' when a sum is given, else 'none'."""
    if it.get("estimateKind"):
        return it["estimateKind"]
    return "stated" if it.get("hasEstimate") else "none"


def build_m06():
    import mock_labels as ML
    ms = data("measures.json")
    if ms is None:
        return None
    byid = collections.OrderedDict((it["id"], it) for it in ms.get("items") or [])
    labels = collections.OrderedDict()
    for lab in ML.M06_LABELS:
        if lab["id"] in labels:
            problem("M06: duplicate label for %s in mock_labels.py" % lab["id"])
        labels[lab["id"]] = lab
    for mid in byid:
        if mid not in labels:
            problem("M06: measure %s has no label in mock_labels.py" % mid)
    for lid in labels:
        if lid not in byid:
            problem("M06: label %s matches no measure in measures.json" % lid)
    persona_names = [p[0] for p in ML.M06_PERSONAS]
    kind_ids = [k[0] for k in ML.M06_RISK_KINDS]
    by_persona = collections.OrderedDict((p, 0) for p in persona_names)
    items = []
    n_since = n_legal = n_none = 0
    for mid, it in byid.items():
        lab = labels.get(mid)
        if lab is None:
            continue
        src = m06_sources(it)

        def inside(field):
            frag = lab.get(field)
            if not isinstance(frag, str) or not frag.strip():
                problem("M06 %s: %s must be a non-empty string" % (mid, field))
            elif not any(frag in s for s in src):
                problem("M06 %s: %s is not a verbatim part of the measure's text: %r" % (mid, field, frag[:70]))
            return frag
        evidence = inside("evidence")
        extra = collections.OrderedDict()
        for field in ("riskEvidence", "sinceText", "legal"):
            if field in lab:
                extra[field] = inside(field)
        for field in ("payer", "winner", "risk"):
            if not isinstance(lab.get(field), str) or not lab[field].strip():
                problem("M06 %s: %s must be a non-empty string" % (mid, field))
        aff = lab.get("affects")
        if not isinstance(aff, list) or any(a not in persona_names for a in aff) or len(set(aff)) != len(aff):
            problem("M06 %s: affects must be a list of distinct names from %s" % (mid, persona_names))
            aff = []
        aff = [p for p in persona_names if p in aff]            # fixed order = the order of the six groups
        for p in aff:
            by_persona[p] += 1
        n_none += 0 if aff else 1
        since = lab.get("since")
        given = it.get("from")
        if given and since != given:
            problem("M06 %s: since must equal the date in the measure data (%s), got %r" % (mid, given, since))
        if since:
            if not given and since not in L.dates_in(evidence):
                problem("M06 %s: since %s is not a date stated in the evidence excerpt" % (mid, since))
            if "sinceText" in lab:
                problem("M06 %s: give either since or sinceText, not both" % mid)
            n_since += 1
        rec = collections.OrderedDict()
        rec["id"] = mid
        rec["affects"] = aff
        rec["payer"] = lab.get("payer", "")
        rec["winner"] = lab.get("winner", "")
        rec["risk"] = lab.get("risk", "")
        rec["riskKind"] = m06_risk_kind(it)
        if rec["riskKind"] not in kind_ids:
            problem("M06 %s: unknown riskKind %r" % (mid, rec["riskKind"]))
        rec["evidence"] = evidence
        if "riskEvidence" in extra:
            rec["riskEvidence"] = extra["riskEvidence"]
        if since:
            rec["since"] = since
        if "sinceText" in extra:
            rec["sinceText"] = extra["sinceText"]
            n_since += 1
        if "legal" in extra:
            rec["legal"] = extra["legal"]
            n_legal += 1
        rec["mock"] = True
        rec["why"] = M06_WHY
        items.append(rec)
    mt = L.meta("M06", "Редакционни етикети на мерките", ["bill", "mockgen"],
                "Мерките и откъсите са официални (мотивите към законопроект 52-602-01-19 и приложените закони); етикетите "
                "„кого засяга“, „кой плаща“, „кой печели“ и „риск“ са редакционни, изведени само от текста на мярката.",
                unit=None, label="РЕДАКЦИОННИ ЕТИКЕТИ", notice=M06_NOTICE,
                personas=[{"label": p, "hint": h} for p, h in ML.M06_PERSONAS],
                riskKinds=[{"id": k, "label": t} for k, t in ML.M06_RISK_KINDS],
                counts={"measures": len(items), "noGroup": n_none, "withDate": n_since, "withLegalBasis": n_legal,
                        "byGroup": by_persona},
                realFields=["items[].id", "items[].evidence", "items[].riskEvidence", "items[].legal",
                            "items[].sinceText", "items[].riskKind", "items[].since"],
                modelFields=["items[].affects", "items[].payer", "items[].winner", "items[].risk"],
                note=M06_NOTE,
                constrainedBy=[
                    "Има етикет за всяка една от %d мерки в measures.json; етикетът се чете само от текста на самата "
                    "мярка (цитат, кратко описание, контекст)." % len(items),
                    "evidence, riskEvidence, legal и sinceText са дословни откъси от текста на мярката; since се "
                    "записва само когато датата е в данните на мярката или в откъса.",
                    "Където текстът мълчи, пише „Не е посочено в текста“, а не догадка; affects: [] значи, че никоя от "
                    "шестте групи не е засегната пряко."])
    return {"meta": mt, "items": items}


# =============================================================================================================== driver
BUILDERS = collections.OrderedDict([("M01", build_m01), ("M02", build_m02), ("M03", build_m03), ("M04", build_m04),
                                    ("M05", build_m05), ("M06", build_m06), ("M07", build_m07)])


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build the MOCK datasets M01-M07 (deterministic, stdlib only).")
    ap.add_argument("--check", action="store_true", help="build in memory, compare with disk, write nothing")
    ap.add_argument("--only", default="", help="comma-separated dataset ids, e.g. M03,M04")
    args = ap.parse_args(argv)
    wanted = [x.strip().upper() for x in args.only.split(",") if x.strip()] or list(BUILDERS)
    unknown = [x for x in wanted if x not in BUILDERS]
    if unknown:
        print("unknown dataset id(s): %s (known: %s)" % (", ".join(unknown), ", ".join(BUILDERS)))
        return 2
    built = collections.OrderedDict()
    for ds in wanted:
        try:
            obj = BUILDERS[ds]()
        except Exception as e:  # keep going so that every problem is reported at once
            problem("%s: %s: %s" % (ds, type(e).__name__, e))
            continue
        if obj is not None:
            built[ds] = L.jdumps(obj) + "\n"
    if problems:
        print("build_mock.py: %d problem(s):" % len(problems))
        for p in problems:
            print("  - " + p)
        return 1
    for n in notes:
        print("note: " + n)
    differs = 0
    for ds, text in built.items():
        path = os.path.join(L.OUT_DIR, L.FILES[ds])
        size = len(text.encode("utf-8"))
        if args.check:
            same = os.path.exists(path) and open(path, "rb").read() == text.encode("utf-8")
            differs += 0 if same else 1
            print("%s %-24s %7d B  %s" % (ds, L.FILES[ds], size, "identical to disk" if same else "DIFFERS from disk"))
        else:
            changed = L.write_text(path, text)
            print("%s %-24s %7d B  %s" % (ds, L.FILES[ds], size, "written" if changed else "unchanged"))
    return 1 if differs else 0


if __name__ == "__main__":
    sys.exit(main())
