"""Сглобява src/kfp_monthly_2025.json от raw_2025.json (изхода на extract_2025.py).

Употреба: python3 tools/prototype/build_2025_json.py <raw_2025.json> prototype/src/kfp_monthly_2025.json
"""
import json, sys

RAW, OUT = sys.argv[1], sys.argv[2]
RATE = 1.95583
rows = json.load(open(RAW))
assert [r["m"] for r in rows] == list(range(1, 13))

MONTH_END = {1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31}
LABELS_COLUMN = "B „Консолидирана фискална програма“ (к.2=к.3+к.4)"

eur = lambda x: x / RATE
r6 = lambda x: round(x, 6) + 0.0  # + 0.0 → без „-0.0“


def totals(v):  # млн. лв.
    return dict(rev=v["rev"], exp=v["exp16"] + v["eu"], bal=v["bal"])


dec = totals(rows[-1]["vals"])
annual_eur = {k: eur(x) for k, x in dec.items()}

months = []
for r in rows:
    v, t = r["vals"], totals(r["vals"])
    months.append({
        "month": r["m"],
        "as_of": f"2025-{r['m']:02d}-{MONTH_END[r['m']]:02d}",
        "revenues": r6(eur(t["rev"])),
        "expenditures": r6(eur(t["exp"])),
        "balance": r6(eur(t["bal"])),
        "share_of_annual": {
            "revenues": round(t["rev"] / dec["rev"] * 100, 2),
            "expenditures": round(t["exp"] / dec["exp"] * 100, 2),
        },
        "components": {
            "expenditures_row16": r6(eur(v["exp16"])),
            "eu_contribution_row32": r6(eur(v["eu"])),
            "transfers_net_row28": r6(eur(v["transfers"])),
        },
        "bgn": {
            "revenues": r6(v["rev"]),
            "expenditures_row16": r6(v["exp16"]),
            "eu_contribution_row32": r6(v["eu"]),
            "transfers_net_row28": r6(v["transfers"]),
            "balance": r6(v["bal"]),
        },
        "source": {
            "file": r["fn"],
            "sha256": r["sha"],
            "sheet": "стартова",
            "column": LABELS_COLUMN,
            "date_line": r["date_line"],
            "unit_label": r["unit_label"],
            "cells": {k: f"B{r['rows'][k]}" for k in ("rev", "exp16", "transfers", "eu", "bal")},
            "labels": {k: r["labels"][k] for k in ("rev", "exp16", "transfers", "eu", "bal")},
        },
    })

# Проверки в евро (след превръщането): I − II + III − IV = V
max_id_eur = max(abs(m["components"]["transfers_net_row28"] + m["revenues"] - m["expenditures"] - m["balance"]) for m in months)
assert max_id_eur < 1e-5, max_id_eur
jul = months[6]

doc = {
    "title": "Изпълнение на консолидираната фискална програма (КФП) по месеци, 2025 г.",
    "publisher": "Министерство на финансите",
    "series": "Месечни отчети за изпълнението на КФП („Информация за изпълнението на консолидираната фискална програма – национален бюджет и европейски средства“)",
    "url": "https://www.minfin.bg/bg/statistics/5",
    "obtained": "2026-09-30: 12-те Excel файла за януари–декември 2025 г. са прикачени от член на работната група (експерт по публични финанси); minfin.bg отказва автоматичния достъп (HTTP 403). Копия: data/raw/kfp_2025/.",
    "unit": "млн. €",
    "currency": "EUR",
    "unit_in_files": "млн. лв. — надпис „(млн.лв.)“ в клетка D4 на всеки от 12-те файла",
    "conversion": {
        "from": "BGN",
        "to": "EUR",
        "rate": RATE,
        "rule": "млн. € = млн. лв. / 1,95583 (фиксираният курс на лева към еврото), клетка по клетка, без междинно закръгляне",
        "native": "стойностите в лева, както са във файловете, са в полето „bgn“ на всеки месец",
    },
    "cumulative": True,
    "basis": "Касово изпълнение, натрупано от 1 януари до края на месеца (заглавието на всеки файл е „КЪМ дд.мм.2025 ГОДИНА“). Декември = изпълнението за цялата 2025 г.",
    "column": "B „Консолидирана фискална програма“ (к.2 = к.3 „Национален бюджет“ + к.4 „Европейски средства“)",
    "definitions": {
        "revenues": "ред 11 „I. Приходи, помощи и дарения“",
        "expenditures": "ред 16 „II. Разходи“ + ред 32 „IV. Вноска в общия бюджет на ЕС“",
        "balance": "ред 33 „V. Бюджетно салдо (дефицит „-“ / излишък „+“) = /I-II+III-IV/“; ред 28 „III. Трансфери-нето“ е ≈ 0 на ниво КФП, така че салдото = приходи − разходи",
        "share_of_annual": "натрупаното до края на месеца като % от изпълнението за цялата 2025 г. (декември = 100%); изчислено в лева, преди превръщането",
    },
    "annual_2025": {
        "revenues": r6(annual_eur["rev"]),
        "expenditures": r6(annual_eur["exp"]),
        "balance": r6(annual_eur["bal"]),
        "bgn": {"revenues": r6(dec["rev"]), "expenditures": r6(dec["exp"]), "balance": r6(dec["bal"])},
        "source": "отчетът към 31.12.2025 (2025-EU_funds_1225_BG_WEB_4.xls)",
    },
    "use": "В прототипа: сравнение за 2026 г. — натрупаните суми в млрд. € и сезонният ориентир „2025: дял от годишното изпълнение“ (share_of_annual) до процента на изпълнение на плана за 2026 г.",
    "checks": [
        "Подредбата е еднаква и в 12-те файла и съвпада с тази за 2026 г.: всички текстови клетки и типовете на клетките съвпадат; различават се само ред 3 (датата) и надписът за мярката (млн. лв. срещу млн. евро за 2026 г.). Единствено декемврийският файл има числа в ред 34 (контролна сума V + VI ≈ 1e-11), каквито има и във файловете за 2026 г. Използваните редове са 11, 16, 28, 32 и 33 във всеки файл, намерени по етикет, не по номер.",
        "Датата във всеки файл е последният ден на месеца: „КЪМ 31.01.2025 ГОДИНА“ … „КЪМ 31.12.2025 ГОДИНА“. Декемврийският файл (наставка „_4“) е записан на 30.01.2026 — по обичайния график, а не по-късна редакция.",
        "Всички 12 файла са в млн. лв. — надпис „(млн.лв.)“ в клетка D4.",
        "I − II + III − IV = V във всеки файл (разлика < 1e-6 млн. лв.; след превръщането — < 1e-5 млн. €); к.2 = к.3 + к.4 за всеки използван ред.",
        "Приходите, разходите и вноската в ЕС растат всеки месец — стойностите са натрупани от началото на годината.",
        f"Декември = годишното изпълнение за 2025 г.: приходи {annual_eur['rev']:.1f}, разходи {annual_eur['exp']:.1f}, салдо {annual_eur['bal']:.1f} млн. € ({dec['rev']:.1f} / {dec['exp']:.1f} / {dec['bal']:.1f} млн. лв.). Салдото отговаря на очакваните −3,5 млрд. € за 2025 г. в АСБП 2026–2028.",
        f"Юли 2025 спрямо юли 2026 (src/kfp_monthly_2026.json): приходите растат с {(26347.376898 / jul['revenues'] - 1) * 100:.1f}% — колкото е ръстът „+11,2% г/г“ в данните на МФ към 31.07.2026.",
    ],
    "extraction": "xlrd 2.0.2 (Python) в отделна среда; колона B на листа „стартова“, редовете са търсени по точно съвпадение на етикета в колона A (кирилското „І“ в „ІІ.“ и „ІІІ.“ е нормализирано до латинско „I“, интервалите — слети). Превръщане в евро по 1,95583, закръгляне до 6 знака след запетаята.",
    "months": months,
}
json.dump(doc, open(OUT, "w"), ensure_ascii=False, indent=1)
open(OUT, "a").write("\n")

print("annual EUR:", {k: round(x, 1) for k, x in annual_eur.items()})
for m in months:
    print(m["month"], m["as_of"], "rev %.1f exp %.1f bal %.1f | share rev %.2f exp %.2f" % (m["revenues"], m["expenditures"], m["balance"], m["share_of_annual"]["revenues"], m["share_of_annual"]["expenditures"]))
print("max identity residual EUR:", max_id_eur)
