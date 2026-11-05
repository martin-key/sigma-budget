#!/usr/bin/env python3
"""Сваля публичните източници за наборите „за извличане / проверка“ на прототипа „Бюджет на светло“.

Какво прави: тегли всеки файл от списъка SOURCES в prototype/data/raw/<папка>/ и пише
prototype/data/raw/MANIFEST.json (адрес, файл, размер, sha256, HTTP код, дата на сваляне).
Повторното пускане презаписва файловете и манифеста. Неуспешните заявки (403 и т.н.) също
се записват в манифеста — така причината „няма данни“ е проверима.

Входове: няма (само мрежа). Изходи: prototype/data/raw/** и MANIFEST.json.
Мрежа: Bash с изключен sandbox. Само stdlib.

Източници, които НЕ са тук:
- PDF-ът на МФ UMTBF-2026-2028-motivi.pdf — предоставен от работната група (виж docs/data-sources.md);
- месечните отчети на МФ по КФП (data/raw/kfp_2025, kfp_2026) — прикачени от работната група.
"""
import datetime, hashlib, json, os, sys, time, urllib.error, urllib.request

ROOT = str(__import__("pathlib").Path(__file__).resolve().parents[2]) + "/prototype/data/raw"
# the access probes are no data: their pages go to tmp/sources/probes/ (prototype/data/raw holds only the pinned files of
# tools/mock/prototype.sha256, which the PROTO check enforces); their status stays in MANIFEST.json
PROBES = str(__import__("pathlib").Path(__file__).resolve().parents[2]) + "/tmp/sources/probes"
UA = "budget-na-svetlo-data-pipeline/1.0 (+public data; contact: working group)"   # същият като fetch_gisco.py; не се представяме за браузър
# първите байтове, които файлът трябва да има (страница за грешка или проверка с код 200 не се записва като данни)
MAGIC = {".pdf": b"%PDF", ".zip": b"PK", ".docx": b"PK", ".xlsx": b"PK", ".xls": b"\xd0\xcf\x11\xe0"}
ES = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"

# (папка, файл, адрес, бележка, допълнителни заглавки)
SOURCES = [
    # Държавен вестник — приетите бюджетни закони за 2026 г.
    ("dv", "zdb2026_dv69_idMat245041.html", "https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=245041",
     "Закон за държавния бюджет на РБ за 2026 г., ДВ бр. 69 от 31.07.2026", {}),
    ("dv", "zbdoo2026_dv68_idMat244982.html", "https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=244982",
     "Закон за бюджета на ДОО за 2026 г., ДВ бр. 68 от 28.07.2026", {}),
    ("dv", "zbnzok2026_dv68_idMat244981.html", "https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=244981",
     "Закон за бюджета на НЗОК за 2026 г., ДВ бр. 68 от 28.07.2026", {}),
    # Народно събрание — законопроектът за бюджета: мотиви (docx) и пакетът с програмните бюджети (zip)
    ("parliament", "52-602-01-19.docx", "https://www.parliament.bg/bills/52/52-602-01-19.docx",
     "Законопроект за държавния бюджет 2026 + мотиви (АСБП 2026–2028), внесен 01.07.2026", {}),
    ("parliament", "52-602-01-19.zip", "https://www.parliament.bg/bills/52/52-602-01-19.zip",
     "Архивът към законопроекта: програмните бюджети на ПРБ (папка 7), становища, протоколи", {}),
    ("parliament", "bill_167157.json", "https://www.parliament.bg/api/v1/bill/167157", "ЗДБ 2026 — данни за законопроекта", {}),
    ("parliament", "bill_167156.json", "https://www.parliament.bg/api/v1/bill/167156", "ЗБДОО 2026 — данни за законопроекта", {}),
    ("parliament", "bill_167155.json", "https://www.parliament.bg/api/v1/bill/167155", "ЗБНЗОК 2026 — данни за законопроекта", {}),
    # НАП — таблицата с вноските за 2026 г. (приложение към становище ВК-30-10237 от 12.08.2026); nap.bg пренасочва към nra.bg,
    # а nra.bg отговаря само от България (docs/data-acquisition.md, раздел 2.1)
    ("nap", "nap_prilozhenie_1_VK-30-10237_12.08.2026.pdf",
     "https://nra.bg/wps/wcm/connect/nra.bg25863/6f117462-1836-48f8-9e27-a4b02a1e55fb/"
     "%D0%9F%D1%80%D0%B8%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B8%D0%B5_1_%D0%92%D0%9A-30-10237_12.08.2026.pdf?MOD=AJPERES",
     "НАП: размери на осигурителните вноски за 2026 г. и разпределението им", {}),
    # Eurostat
    ("eurostat", "tps00001_BG.json", f"{ES}/tps00001?geo=BG&sinceTimePeriod=2020", "Население към 1 януари (данни на НСИ)", {}),
    ("eurostat", "demo_gind_BG_JAN.json", f"{ES}/demo_gind?geo=BG&indic_de=JAN&sinceTimePeriod=2020", "Население към 1 януари, demo_gind", {}),
    ("eurostat", "gov_10dd_edpt1_BG_EU.json",
     f"{ES}/gov_10dd_edpt1?geo=BG&geo=EU27_2020&na_item=GD&sector=S13&unit=MIO_EUR&unit=PC_GDP&sinceTimePeriod=2015",
     "Консолидиран брутен дълг на сектор „Държавно управление“, млн. € и % от БВП", {}),
    ("eurostat", "gov_10q_ggdebt_BG.json",
     f"{ES}/gov_10q_ggdebt?geo=BG&na_item=GD&sector=S13&unit=MIO_EUR&unit=PC_GDP&sinceTimePeriod=2024-Q1",
     "Тримесечен дълг на сектор „Държавно управление“", {}),
    # БНБ — SDMX на МФ по SDDS Plus
    ("bnb_sdmx", "ggd.xml", "https://www.bnb.bg/bnbweb/groups/public/documents/bnb_sdmx/ggd.xml", "Дълг на сектор „Държавно управление“, тримесечно", {}),
    ("bnb_sdmx", "cgd.xml", "https://www.bnb.bg/bnbweb/groups/public/documents/bnb_sdmx/cgd.xml", "Дълг на централното управление, тримесечно", {}),
    # data.europa.eu — метаданни за наборите в data.egov.bg (самият data.egov.bg връща 403)
    ("data_europa", "dataset_20439.jsonld", "https://data.europa.eu/api/hub/repo/datasets/20439?useNormalizedId=true",
     "СЕБРА: индивидуални плащания ≥ 5 000 лв. (МЕУ)", {"Accept": "application/ld+json"}),
    ("data_europa", "dataset_7806.jsonld", "https://data.europa.eu/api/hub/repo/datasets/7806?useNormalizedId=true",
     "МФ: плащания в СЕБРА и други плащания в БНБ (дневно)", {"Accept": "application/ld+json"}),
    ("data_europa", "dataset_19246.jsonld", "https://data.europa.eu/api/hub/repo/datasets/19246?useNormalizedId=true",
     "СЕБРА: исторически плащания от 05.06.2006", {"Accept": "application/ld+json"}),
    ("data_europa", "dataset_4227.jsonld", "https://data.europa.eu/api/hub/repo/datasets/4227?useNormalizedId=true",
     "МФ: КФП — месечна информация", {"Accept": "application/ld+json"}),
    # МИДТ — „Документи за плащания по СЕБРА за 2026 г.“ (само плащанията на самото министерство)
    ("sebra", "midt_sebra_2026_page.html", "https://midt.gov.bg/bg/transparency/sebra/2026", "МИДТ: страницата „СЕБРА 2026“", {}),
    ("sebra", "midt_sebra_31.08.2026.xlsx", "https://midt.gov.bg/upload/3788/31.08..2026.xlsx", "МИДТ: дневно обобщение за 31.08.2026", {}),
    # Проби за достъп: страниците, от които наборите биха дошли, връщат 403 — пазим кода в манифеста
    ("probes", "minfin_legislation1_609.html", "https://www.minfin.bg/bg/legislation1/609", "МФ: бюджет 2026 (проба за достъп)", {}),
    ("probes", "minfin_810.html", "https://www.minfin.bg/bg/810", "МФ: данни за общините (проба за достъп)", {}),
    ("probes", "minfin_statistics_5.html", "https://www.minfin.bg/bg/statistics/5", "МФ: месечни отчети по КФП (проба за достъп)", {}),
    ("probes", "data_egov_bg.html", "https://data.egov.bg/", "Портал за отворени данни (проба за достъп)", {}),
    ("probes", "nsi_bg.html", "https://www.nsi.bg/", "НСИ (проба за достъп)", {}),
]


def fetch(url, headers):
    h = {"User-Agent": UA}
    h.update(headers)
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # мрежова грешка — nap.bg затваря връзката към urllib, но отговаря на curl
        import subprocess, tempfile
        with tempfile.NamedTemporaryFile() as tmp:
            args = ["curl", "-s", "-L", "-m", "180", "-A", UA, "-o", tmp.name, "-w", "%{http_code}"]
            for k, v in headers.items():
                args += ["-H", f"{k}: {v}"]
            p = subprocess.run(args + [url], capture_output=True, text=True)
            code = int(p.stdout or 0) or None
            return code, open(tmp.name, "rb").read() if code else str(e).encode()


def main():
    only = set(sys.argv[1:])
    man_path = os.path.join(ROOT, "MANIFEST.json")
    manifest = json.load(open(man_path, encoding="utf-8")) if os.path.exists(man_path) else {}
    for folder, name, url, note, headers in SOURCES:
        key = f"{folder}/{name}"
        if only and key not in only and folder not in only:
            continue
        status, data = fetch(url, headers)
        magic = MAGIC.get(os.path.splitext(name)[1].lower())
        if status == 200 and magic and not data.startswith(magic):
            print(f"{status}  {len(data):>10}  {key}  НЕ Е ЗАПИСАН: не е {os.path.splitext(name)[1]} (страница за грешка или проверка?)")
            continue                                   # старият файл и записът му в манифеста остават
        entry = {"url": url, "note": note, "http_status": status,
                 "retrieved": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
        if status == 200:
            target = PROBES if folder == "probes" else os.path.join(ROOT, folder)
            os.makedirs(target, exist_ok=True)
            open(os.path.join(target, name), "wb").write(data)
            entry.update({"file": key, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        manifest[key] = entry
        print(f"{status}  {len(data) if data else 0:>10}  {key}")
        time.sleep(0.5)
    json.dump(manifest, open(man_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
