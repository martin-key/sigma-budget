#!/usr/bin/env python3
"""Проба за достъп до публичните източници: кое се сваля от мястото, където се пуска, и кое не.

Защо: част от източниците отказват автоматични заявки (minfin.bg), а други изглежда пускат само
адреси от България (nra.bg, data.egov.bg). Отговорът зависи от мрежата, затова пробата се пуска
там, където ще работи колекторът: в CI, на лаптопа на администратора в България, на сървър.
Резултатът показва за всеки източник кой режим на придобиване е възможен (docs/data-acquisition.md).

Какво прави: по една заявка към всеки адрес (пауза 0,5 s), чете най-много 256 KB от отговора,
проверява HTTP кода, вида на съдържанието по първите байтове (PDF, XLS, ZIP, JSON, XML, HTML)
и белезите на защита (Cloudflare „Just a moment“, 403 без проверка, прекъсната връзка).
Пробва и с urllib, и с curl (ако го има): част от сървърите отговарят различно на двата.
Не заобикаля защити: не пуска браузър, не решава проверки, не сменя IP адреса.

Употреба:
    python -m budget_pipeline.sources.access_probe                       # таблица в терминала
    python -m budget_pipeline.sources.access_probe --label "София, дом"  # бележка къде е пусната пробата
    python -m budget_pipeline.sources.access_probe --json probe.json     # и машинночетим отчет
    python -m budget_pipeline.sources.access_probe --only minfin nra     # само избрани източници (по префикс на id)

Само стандартна библиотека (Python 3.12+). Не пише нищо освен файла от --json.
Изход 0 винаги, когато пробата е изпълнена: недостъпният източник е резултат, не грешка.
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import argparse
import datetime
import json
import shutil
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request

UA = "sigma-budget-probe/1.0 (+https://github.com/martin-key/sigma-budget; public budget data)"
LIMIT = 256 * 1024
TIMEOUT = 30
ES = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"
NRA_PDF = ("https://nra.bg/wps/wcm/connect/nra.bg25863/6f117462-1836-48f8-9e27-a4b02a1e55fb/"
           "%D0%9F%D1%80%D0%B8%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B8%D0%B5_1_%D0%92%D0%9A-30-10237_12.08.2026.pdf?MOD=AJPERES")

# (id, адрес, очакван вид, допълнителни заглавки). Адресите са тези от docs/data-sources.md и core.json.
SOURCES = [
    ("dv.zdb2026", "https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=245041", "html", {}),
    ("parliament.bill-docx", "https://www.parliament.bg/bills/52/52-602-01-19.docx", "zip", {}),
    ("parliament.bill-zip", "https://www.parliament.bg/bills/52/52-602-01-19.zip", "zip", {}),
    ("parliament.api", "https://www.parliament.bg/api/v1/bill/167157", "json", {}),
    ("nra.contrib-pdf", NRA_PDF, "pdf", {}),
    ("nra.home", "https://nra.bg/", "html", {}),
    ("eurostat.api", ES + "/tps00001?geo=BG&sinceTimePeriod=2020", "json", {}),
    ("gisco.lau-csv", "https://gisco-services.ec.europa.eu/distribution/v2/lau/csv/LAU_RG_01M_2024_4326.csv", "text", {}),
    ("bnb.sdmx-ggd", "https://www.bnb.bg/bnbweb/groups/public/documents/bnb_sdmx/ggd.xml", "xml", {}),
    ("bnb.sdmx-cgd", "https://www.bnb.bg/bnbweb/groups/public/documents/bnb_sdmx/cgd.xml", "xml", {}),
    ("midt.sebra-page", "https://midt.gov.bg/bg/transparency/sebra/2026", "html", {}),
    ("midt.sebra-xlsx", "https://midt.gov.bg/upload/3788/31.08..2026.xlsx", "zip", {}),
    ("ec.dbp2027-pdf", "https://economy-finance.ec.europa.eu/document/download/efafab61-9647-40f6-8912-6cda9c96964b_bg"
                       "?filename=2027_dbp_bg_bg.pdf&prefLang=en", "pdf", {}),
    ("dataeuropa.search", "https://data.europa.eu/api/hub/search/datasets/4227", "json", {}),
    ("minfin.kfp-page", "https://www.minfin.bg/bg/statistics/5", "html", {}),
    ("minfin.budget-page", "https://www.minfin.bg/bg/legislation1/609", "html", {}),
    ("minfin.municipal-page", "https://www.minfin.bg/bg/810", "html", {}),
    ("minfin.transparency", "https://www.minfin.bg/bg/transparency", "html", {}),
    ("egov.portal", "https://data.egov.bg/", "html", {}),
    ("nsi.home", "https://www.nsi.bg/", "html", {}),
]


def kind_of(body):
    if body[:4] == b"%PDF":
        return "pdf"
    if body[:2] == b"PK":
        return "zip"                                   # xlsx и docx също са zip
    if body[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return "xls"                                   # OLE2: старите .xls и .doc
    head = body[:512].lstrip().lower()
    if head[:1] in (b"{", b"["):
        return "json"
    if head.startswith(b"<?xml"):
        return "html" if b"<html" in body[:2048].lower() else "xml"
    if b"<html" in head or b"<!doctype html" in head:
        return "html"
    return "text" if body else "empty"


def markers_of(status, headers, body):
    low = body[:40000].lower()
    server = (headers.get("server") or "").lower()
    out = []
    if b"just a moment" in low or b"cf-chl" in low or b"challenge-platform" in low:
        out.append("cloudflare-challenge")
    elif server == "cloudflare" and status in (403, 503):
        out.append("cloudflare-block")
    if b"f5_cspm" in low:
        out.append("f5-token")                         # F5 WAF вмъква случаен токен: байтовете се менят при всяко сваляне
    if status == 403 and not out:
        out.append("forbidden")
    return out


def via_urllib(url, headers):
    req = urllib.request.Request(url, headers=dict({"User-Agent": UA}, **headers))
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return {"status": r.status, "headers": {k.lower(): v for k, v in r.headers.items()}, "body": r.read(LIMIT),
                    "final_url": r.geturl(), "error": None, "seconds": round(time.time() - t0, 2)}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "headers": {k.lower(): v for k, v in e.headers.items()}, "body": e.read(LIMIT),
                "final_url": url, "error": None, "seconds": round(time.time() - t0, 2)}
    except (urllib.error.URLError, socket.timeout, ssl.SSLError, ConnectionError, OSError) as e:
        reason = getattr(e, "reason", e)
        return {"status": None, "headers": {}, "body": b"", "final_url": url,
                "error": "%s: %s" % (type(reason).__name__, reason), "seconds": round(time.time() - t0, 2)}


def via_curl(url, headers):
    curl = shutil.which("curl")
    if not curl:
        return None
    args = [curl, "-sS", "-L", "--max-redirs", "5", "-m", str(TIMEOUT), "-A", UA, "-D", "-", "-o", "-",
            "-w", "\n@@curl %{http_code} %{url_effective}"]
    for k, v in headers.items():
        args += ["-H", "%s: %s" % (k, v)]
    t0 = time.time()
    p = subprocess.Popen(args + [url], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out = b""
    while True:
        chunk = p.stdout.read(65536)
        if not chunk:
            break
        out += chunk
        if len(out) > LIMIT + 65536:                   # голям файл: стига ни началото
            p.kill()
            break
    err = p.stderr.read().decode("utf-8", "replace").strip()
    p.wait()
    status, final = None, url
    if b"\n@@curl " in out:
        out, _, tail = out.rpartition(b"\n@@curl ")
        code, _, final = tail.decode("utf-8", "replace").partition(" ")
        status = int(code) or None
    headers_out, body, header_status = {}, out, None
    while body.startswith(b"HTTP/"):                   # заглавките на всяко пренасочване, после тялото
        block, sep, rest = body.partition(b"\r\n\r\n")
        if not sep:
            break
        lines = block.decode("latin-1").split("\r\n")
        parts = lines[0].split()
        header_status = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
        headers_out = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers_out[k.strip().lower()] = v.strip()
        body = rest
    if status is None and header_status is not None and (header_status != 200 or body):
        status = header_status                         # прекъснахме голям файл: кодът е в заглавките
    if status is None and not err:
        err = "curl exit %s" % p.returncode
    return {"status": status, "headers": headers_out, "body": body[:LIMIT], "final_url": final,
            "error": err if status is None else None, "seconds": round(time.time() - t0, 2)}


def verdict(res, expected):
    if res is None:
        return "-"
    if res["status"] is None:
        return "network"                               # прекъсната връзка или изтекло време: често IP филтър
    kind = kind_of(res["body"])
    marks = markers_of(res["status"], res["headers"], res["body"])
    if "cloudflare-challenge" in marks or "cloudflare-block" in marks:
        return "challenge"
    if res["status"] == 403:
        return "forbidden"
    if res["status"] != 200:
        return "http-%d" % res["status"]
    if expected == "text":
        return "ok" if kind in ("text", "json") else "wrong-content"
    return "ok" if kind == expected else "wrong-content"


MEANING = {
    "ok": "сваля се автоматично от тази мрежа",
    "challenge": "проверка за бот (Cloudflare): само през браузър → ръчен импорт",
    "forbidden": "403 без проверка: вероятно филтър по IP/държава → опитай от България",
    "network": "връзката е прекъсната или изтече време: вероятно филтър по IP/държава или сървърът не работи",
    "wrong-content": "отговор 200, но не е очакваният файл (страница за грешка?) → не се записва като данни",
    "flaky": "първият опит е неуспешен, вторият минава: колекторът трябва да проверява съдържанието и да опитва пак",
}


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--label", default="", help="къде е пусната пробата (записва се в отчета)")
    ap.add_argument("--json", help="запиши машинночетим отчет в този файл")
    ap.add_argument("--only", nargs="*", default=[], help="само източниците с тези префикси на id")
    ap.add_argument("--no-curl", action="store_true", help="само urllib")
    args = ap.parse_args(argv)

    rows = []
    print("%-24s %-14s %-14s %s" % ("източник", "urllib", "curl", "бележки"))
    for sid, url, expected, headers in SOURCES:
        if args.only and not any(sid.startswith(p) for p in args.only):
            continue
        a = via_urllib(url, headers)
        b = None if args.no_curl else via_curl(url, headers)
        va, vb = verdict(a, expected), verdict(b, expected)
        retry = ("wrong-content", "network")         # втори опит: различава нестабилен сървър от постоянен отказ
        if va in retry or vb in retry:
            time.sleep(2)
            if va in retry:                            # само клиентът, който не е минал: успешният остава „ok“
                a2 = via_urllib(url, headers)
                if verdict(a2, expected) == "ok":
                    a, va = a2, "flaky"
            if vb in retry:
                b2 = via_curl(url, headers)
                if verdict(b2, expected) == "ok":
                    b, vb = b2, "flaky"
        marks = sorted(set(markers_of(a["status"] or 0, a["headers"], a["body"]) +
                           (markers_of(b["status"] or 0, b["headers"], b["body"]) if b else [])))
        note = ", ".join(marks)
        if a["error"] and va == "network":
            note = (note + "; " if note else "") + a["error"][:70]
        print("%-24s %-14s %-14s %s" % (sid, "%s %s" % (a["status"] or "-", va), "%s %s" % ((b or {}).get("status") or "-", vb), note))
        rows.append({"id": sid, "url": url, "expected": expected,
                     "urllib": {k: a[k] for k in ("status", "final_url", "error", "seconds")} | {"kind": kind_of(a["body"]), "verdict": va},
                     "curl": None if b is None else
                     ({k: b[k] for k in ("status", "final_url", "error", "seconds")} | {"kind": kind_of(b["body"]), "verdict": vb}),
                     "markers": marks})
        time.sleep(0.5)

    seen = sorted({r["urllib"]["verdict"] for r in rows} | {r["curl"]["verdict"] for r in rows if r["curl"]})
    print()
    for v in seen:
        if v in MEANING:
            print("  %-14s %s" % (v, MEANING[v]))
    if args.json:
        report = {"probe": "sigma-budget/pipeline/budget_pipeline/sources/access_probe.py", "label": args.label,
                  "ran": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "python": sys.version.split()[0], "user_agent": UA, "results": rows}
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=1)
        print("\nотчет: %s" % args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
