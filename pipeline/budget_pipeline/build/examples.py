"""Deterministic producers for the two published example datasets M06 and M07."""
import argparse
import collections
import datetime
import math
import os
import sys
from budget_pipeline.build import example_support as L


problems = []

notes = []

def problem(msg):
    problems.append(msg)

def need(path, what=None):
    """Load a JSON input; a missing input is a problem (with the command that creates it), not a crash."""
    if not os.path.exists(path):
        problem("missing input %s%s" % (os.path.relpath(path, L.ROOT), " (" + what + ")" if what else ""))
        return None
    return L.load_json(path)

def data(name):
    obj = need(os.path.join(L.DATA_DIR, name), "run pipeline/budget_pipeline/build/datasets.py first")
    if name == "execution.json" and obj is not None:
        import budget_pipeline.validate.execution_contract as execution_contract                                        # contract v2: money as decimal strings
        obj = execution_contract.numbers(obj)
    return obj

M07_WHY_MODEL = "Ориентировъчна стойност за примера, не официални данни."

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
    import budget_pipeline.build.measure_labels as ML
    ms = data("measures.json")
    if ms is None:
        return None
    byid = collections.OrderedDict((it["id"], it) for it in ms.get("items") or [])
    labels = collections.OrderedDict()
    for lab in ML.M06_LABELS:
        if lab["id"] in labels:
            problem("M06: duplicate label for %s in measure_labels.py" % lab["id"])
        labels[lab["id"]] = lab
    for mid in byid:
        if mid not in labels:
            problem("M06: measure %s has no label in measure_labels.py" % mid)
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

BUILDERS = collections.OrderedDict([("M06", build_m06), ("M07", build_m07)])

def main(argv=None):
    ap = argparse.ArgumentParser(description="Build the MOCK datasets M06/M07 (deterministic, stdlib only).")
    ap.add_argument("--check", action="store_true", help="build in memory, compare with disk, write nothing")
    ap.add_argument("--only", default="", help="comma-separated dataset ids, M06,M07")
    ap.add_argument("--build-date", help="ISO date for the file metadata")
    args = ap.parse_args(argv)
    if args.build_date:
        L.BUILD_DATE = args.build_date
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
        print("examples.py: %d problem(s):" % len(problems))
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
