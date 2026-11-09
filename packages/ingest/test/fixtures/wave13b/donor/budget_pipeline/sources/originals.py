#!/usr/bin/env python3
"""Суровите файлове на данните: какво има, какво липсва и внасяне на свалените на ръка.

Защо: сглобяването (python -m budget_pipeline.build.rebuild) чете само data/originals/ и data/cache/. Файловете на МФ (месечните
отчети по КФП в kfp_<ГГГГ>/ и PDF-ът с АСБП в asbp/) са в хранилището; останалите се свалят наново (docs/data-sources.md,
раздел 5). Списъкът на всички със sha256 е в data/originals.sha256. Командата казва
какво от списъка е налично и вярно, какво липсва и откъде се взима. Внася и ръчно свалените файлове на точното място
(docs/data-acquisition.md, раздели 5.2 и 5.3).

  status   сравнява data/originals/ с data/originals.sha256: налично и вярно, липсва, различно, не е очакваният
           вид (например страница с CAPTCHA, записана като PDF). Казва кой е следващият отчет по КФП и с какво се взима
           всеки липсващ файл. Изход 0, когато всичко е налице и вярно (живите източници може да са се променили), иначе 1.
  import   внася файлове или папки; без аргумент чете tmp/sources/inbox/.
           * Файл, чийто sha256 е в originals.sha256, отива на мястото си (така се възстановява архивът на работната група).
           * Нов месечен отчет по КФП се разпознава по съдържанието: лист „стартова“ 54×4, период от клетка A3, единица.
             Записва се като kfp_<ГГГГ>/<ГГГГ>-EU_funds_<ММГГ>_BG_WEB[_N].xls, а редът му се добавя в originals.sha256.
           * За всеки внесен файл се дописва запис за придобиване в tmp/sources/ACQUISITIONS.jsonl: адрес (на macOS
             от метаданните на файла), време на сваляне, sha256, проверки.
           Нищо не се изтрива: друг файл на същото място се мести в tmp/sources/replaced/, а друга версия на същия
           месец по КФП — само с --replace.

Употреба:
    python -m budget_pipeline.sources.originals status
    python -m budget_pipeline.sources.originals import ~/Downloads/2026-EU\\ funds_0926_BG_WEB.xls
    python -m budget_pipeline.sources.originals import /път/до/архива/          # възстановяване по sha256
    python -m budget_pipeline.sources.originals import ФАЙЛ --url АДРЕС --replace --dry-run

status е само стандартна библиотека (Python 3.12+); import на нов отчет по КФП иска xlrd (pipeline/requirements.txt).
Не сваля нищо и не пипа data/release/.
"""

import argparse
import calendar
import datetime
import hashlib
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "data" / "originals"
SUMS = ROOT / "data" / "originals.sha256"
PREFIX = "data/originals/"
# работните файлове на импорта са в tmp/sources/ (там са и другите ръчни входове, docs/data-sources.md, раздел 2), не в
# data/originals/: проверката INPUTS не допуска там файлове извън data/originals.sha256
WORK = ROOT / "tmp" / "sources"
INBOX = WORK / "inbox"
LOG = WORK / "ACQUISITIONS.jsonl"
REPLACED = WORK / "replaced"
NOT_SOURCES = {"MANIFEST.json"}                             # манифестът на download.py, не е източник

KFP_PAGE = "https://www.minfin.bg/bg/statistics/5"
KFP_SHEET = "стартова"
KFP_TITLE = re.compile(r"КЪМ\s+(\d{2})\.(\d{2})\.(\d{4})\s+ГОДИНА")
KFP_NAME = re.compile(r"EU[ _]funds_(\d{2})(\d{2})_")       # „EU funds“ с интервал от отчета за септември 2026
KFP_SUFFIX = re.compile(r"_BG_WEB(_\d+)?\.xls$", re.I)        # коригирана версия: _1, _2, _4

# производни файлове в raw/: правят ги екстракторите, не се свалят
DERIVED = {"asbp/asbp_tables.json": "python -m budget_pipeline.extract.asbp_tables",
           "dv/dv_laws_2026.json": "python -m budget_pipeline.extract.dv_laws"}
OPTIONAL = {"data_europa"}                                  # метаданни за справка (docs/data-sources.md, 3.7)
EXPECT = {".pdf": "pdf", ".xls": "xls", ".xlsx": "zip", ".docx": "zip", ".zip": "zip", ".7z": "7z",
          ".json": "json", ".jsonld": "json", ".xml": "xml", ".html": "html"}


def sha256_of(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def kind_of(head):
    if head[:4] == b"%PDF":
        return "pdf"
    if head[:2] == b"PK":
        return "zip"                                   # xlsx и docx също са zip
    if head[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return "xls"                                   # OLE2: старите .xls и .doc
    if head[:6] == b"7z\xbc\xaf\x27\x1c":
        return "7z"
    low = head[:2048].lower()
    text = low.lstrip(b"\xef\xbb\xbf \t\r\n")
    if text[:1] in (b"{", b"["):
        return "json"
    if text.startswith(b"<?xml"):
        return "html" if b"<html" in low else "xml"
    if b"<html" in text[:512] or b"<!doctype html" in text[:512]:
        return "html"
    return "text" if head else "empty"


def is_live(rel):
    """Източник, чието съдържание се мени при всяко сваляне: API, страници, тримесечни серии."""
    folder, _, name = rel.partition("/")
    return (folder in ("eurostat", "bnb_sdmx", "data_europa") or (folder == "parliament" and name.endswith(".json"))
            or (folder in ("dv", "sebra") and name.endswith(".html")))


def how_to_get(rel):
    """(режим, как) по docs/data-acquisition.md, 5.2."""
    folder = rel.split("/", 1)[0]
    if folder in OPTIONAL:
        return "справка", "не е вход на сглобяването (python -m budget_pipeline.sources.download %s)" % folder
    if rel in DERIVED:
        return "extract", DERIVED[rel]
    if folder == "program_budgets":
        return "extract", "python -m budget_pipeline.extract.program_budgets (от parliament/52-602-01-19.zip)"
    if folder.startswith("kfp_"):
        return "import", "ръчно през браузър от %s, после `import`" % KFP_PAGE
    if folder == "asbp":
        return "import", "ръчно през браузър от https://www.minfin.bg/bg/legislation1/609, после `import`"
    if folder == "budget_2027":
        return "import", "ръчно през браузър от https://www.minfin.bg/bg/1802, после `import`"
    if folder == "nap":
        return "auto-bg", "python -m budget_pipeline.sources.download %s, само от България; дойде ли страница вместо PDF: браузър, после `import`" % rel
    return "auto", "python -m budget_pipeline.sources.download %s" % rel


def read_sums():
    out = {}
    for ln in SUMS.read_text(encoding="utf-8").splitlines():
        h, _, rel = ln.partition("  ")
        if rel.startswith(PREFIX) and rel[len(PREFIX):] not in NOT_SOURCES:
            out[rel[len(PREFIX):]] = h
    return out


def files_on_disk():
    out = []
    if not RAW.is_dir():
        return out
    for dirpath, dirnames, filenames in os.walk(RAW):
        dirnames[:] = sorted(dirnames)
        for fn in sorted(filenames):
            rel = (Path(dirpath) / fn).relative_to(RAW).as_posix()
            if fn.startswith(".") or rel in NOT_SOURCES:
                continue
            out.append(rel)
    return out


def kfp_period(name):
    """(месец, ГГ) от името на отчет по КФП или None."""
    m = KFP_NAME.search(name)
    return (int(m.group(1)), int(m.group(2))) if m else None


def kfp_months(rels):
    """(година, месец) на отчетите по КФП в списъка."""
    got = set()
    for rel in rels:
        folder, _, name = rel.partition("/")
        m = KFP_NAME.search(name)
        if folder.startswith("kfp_") and m:
            got.add((2000 + int(m.group(2)), int(m.group(1))))
    return sorted(got)


def file_state(rel, want):
    path = RAW / rel
    if not path.is_file():
        return "липсва"
    if sha256_file(path) == want:
        return "наличен"
    with open(path, "rb") as fh:
        got = kind_of(fh.read(4096))
    exp = EXPECT.get(path.suffix.lower())
    if exp and got != exp:
        return "не е %s, а %s" % (exp, got)          # например страница с CAPTCHA, записана като PDF
    return "променен (жив източник)" if is_live(rel) else "различен sha256"


def cmd_status(_args):
    sums = read_sums()
    rows, problems, bad, live, to_fetch = {}, [], 0, 0, []
    for rel, want in sorted(sums.items()):
        state = file_state(rel, want)
        rows.setdefault(rel.split("/", 1)[0], []).append((rel, state))
        if state == "наличен":
            continue
        if state.startswith("променен"):
            live += 1
        elif how_to_get(rel)[0] != "справка":
            bad += 1
            if how_to_get(rel)[0] in ("auto", "auto-bg"):
                to_fetch.append(rel)
        problems.append((rel, state))

    print("%-18s %8s %8s %8s  %s" % ("папка", "налични", "липсват", "други", "режим"))
    for folder, items in sorted(rows.items()):
        n_ok = sum(1 for _r, s in items if s == "наличен")
        n_missing = sum(1 for _r, s in items if s == "липсва")
        modes = "/".join(sorted({how_to_get(r)[0] for r, _s in items}))
        print("%-18s %8d %8d %8d  %s" % (folder, n_ok, n_missing, len(items) - n_ok - n_missing, modes))
    if problems:
        print("\nКакво липсва или е различно и как се взима:")
        whole = {f for f, items in rows.items() if all(s == "липсва" for _r, s in items) and len(items) > 1}
        for f in sorted(whole):
            print("  %-58s %-26s %s" % (f + "/ (всичките %d)" % len(rows[f]), "липсват", how_to_get(rows[f][0][0])[1]))
        for rel, state in problems:
            if rel.split("/", 1)[0] not in whole:
                print("  %-58s %-26s %s" % (rel, state, how_to_get(rel)[1]))

    new = [r for r in files_on_disk() if r not in sums]
    if new:
        print("\nНа диска, но не в data/originals.sha256 (внеси ги с `import`, за да влязат в списъка):")
        for rel in new:
            print("  " + rel)

    have = kfp_months([r for r in sums if (RAW / r).is_file()] + new)
    if have:
        y, m = have[-1]
        ny, nm = (y, m + 1) if m < 12 else (y + 1, 1)
        due_y, due_m = (ny, nm + 1) if nm < 12 else (ny + 1, 1)
        due = datetime.date(due_y, due_m, calendar.monthrange(due_y, due_m)[1])
        note = "трябва вече да е публикуван" if datetime.date.today() > due else "излиза до %s" % due.strftime("%d.%m.%Y")
        print("\nКФП: последният отчет на диска е за %04d-%02d. Следващият е към %02d.%02d.%04d (%s): %s" % (
            y, m, calendar.monthrange(ny, nm)[1], nm, ny, note, KFP_PAGE))
    if to_fetch:
        print("\nЛипсващите автоматични файлове (от България за nap/):")
        print("  SSL_CERT_FILE=$(tmp/venv-data/bin/python -m certifi) python -m budget_pipeline.sources.download "
              + " ".join(to_fetch))
    if live:
        print("\n%d файла от живи източници са се променили. Сглобяването може да спре на тях: проверете ги, преди да опреснявате." % live)
    print("\n%s" % ("всичко е налице" if not bad else "%d файла липсват или са различни" % bad))
    return 0 if not bad else 1


def where_froms(path):
    """Адресите, които браузърът записва при сваляне (macOS, kMDItemWhereFroms): [файл, страница]."""
    try:
        out = subprocess.run(["xattr", "-px", "com.apple.metadata:kMDItemWhereFroms", str(path)],
                             capture_output=True, text=True)
    except OSError:
        return []
    if out.returncode:
        return []
    try:
        return [u for u in plistlib.loads(bytes.fromhex("".join(out.stdout.split()))) if isinstance(u, str)]
    except Exception:                                  # noqa: BLE001 - липсващ или чужд формат: адресът не е известен
        return []


def utc(ts):
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def thousands(n):
    return "{:,}".format(n).replace(",", " ")


def inputs(paths):
    for p in paths:
        p = Path(p).expanduser()
        if p.is_dir():
            for dirpath, dirnames, filenames in os.walk(p):
                dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
                for fn in sorted(filenames):
                    if not fn.startswith("."):
                        yield Path(dirpath) / fn
        else:
            yield p


def add_sum(rel, sha, dry):
    """Добавя реда на файла в originals.sha256, до файловете от същата папка."""
    full = PREFIX + rel
    lines = [ln for ln in SUMS.read_text(encoding="utf-8").splitlines() if ln.partition("  ")[2] != full]
    paths = [ln.partition("  ")[2] for ln in lines]
    folder = full.rsplit("/", 1)[0] + "/"
    near = [i for i, p in enumerate(paths) if p.startswith(folder)] or [i for i, p in enumerate(paths) if p.startswith(PREFIX)]
    before = [i for i in near if paths[i] < full]
    at = before[-1] + 1 if before else (near[0] if near else len(lines))
    lines.insert(at, "%s  %s" % (sha, full))
    if not dry:
        SUMS.write_text("\n".join(lines) + "\n", encoding="utf-8")


def drop_sum(rel, dry):
    lines = SUMS.read_text(encoding="utf-8").splitlines()
    keep = [ln for ln in lines if ln.partition("  ")[2] != PREFIX + rel]
    if not dry and len(keep) != len(lines):
        SUMS.write_text("\n".join(keep) + "\n", encoding="utf-8")


def move_aside(path, stamp, dry):
    dest = REPLACED / stamp / path.relative_to(RAW)
    if not dry:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), str(dest))
    return dest


def place(src, rel, dry):
    dest = RAW / rel
    if not dry:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(src), str(dest))
    return dest


def read_kfp(data):
    """Проверките на импорта за месечен отчет по КФП. Връща (година, месец, ден, единица) или хвърля ValueError."""
    try:
        import xlrd
    except ImportError:
        raise ValueError("за отчетите по КФП трябва xlrd: пусни с tmp/venv-data/bin/python (pipeline/requirements.txt)")
    try:
        wb = xlrd.open_workbook(file_contents=data)
    except Exception as exc:                           # noqa: BLE001 - a damaged file: xlrd raises CompDocError, XLRDError, struct.error and others
        raise ValueError("файлът не се чете като .xls (%s: %s)" % (type(exc).__name__, exc))
    if KFP_SHEET not in wb.sheet_names():
        raise ValueError("няма лист „%s“ (листове: %s)" % (KFP_SHEET, ", ".join(wb.sheet_names())))
    sh = wb.sheet_by_name(KFP_SHEET)
    if (sh.nrows, sh.ncols) != (54, 4):
        raise ValueError("листът е %d×%d, а отчетите са 54×4" % (sh.nrows, sh.ncols))
    m = KFP_TITLE.search(str(sh.cell_value(2, 0)))
    if not m:
        raise ValueError("клетка A3 не е „КЪМ дд.мм.гггг ГОДИНА“: %r" % sh.cell_value(2, 0))
    day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if day != calendar.monthrange(year, month)[1]:
        raise ValueError("периодът %02d.%02d.%04d не е последният ден на месеца" % (day, month, year))
    unit_text = re.sub(r"\s+", "", str(sh.cell_value(3, 3))).lower()
    unit = "BGN" if "млн.лв" in unit_text else ("EUR" if "млн.евро" in unit_text else None)
    if unit != ("BGN" if year <= 2025 else "EUR"):
        raise ValueError("единица %r за %04d г." % (sh.cell_value(3, 3), year))
    return year, month, day, unit


def import_one(src, args, by_hash, stamp, log):
    data = src.read_bytes()
    sha = sha256_of(data)
    froms = where_froms(src)
    url = args.url or (froms[0] if froms else None)
    rec = {"mode": "import", "original": src.name, "url": url, "page": froms[1] if len(froms) > 1 else None,
           "retrieved": utc(src.stat().st_mtime),
           "imported": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "bytes": len(data), "sha256": sha}

    if sha in by_hash:                                 # известен файл от архива на работната група
        rel = by_hash[sha]
        dest = RAW / rel
        if dest.is_file() and sha256_file(dest) == sha:
            print("  вече е на мястото си: %s" % rel)
            return True
        if dest.is_file():
            print("  на мястото му има друг файл: преместен в %s" % move_aside(dest, stamp, args.dry_run).relative_to(ROOT))
        place(src, rel, args.dry_run)
        rec.update({"source": rel.split("/", 1)[0], "file": rel, "match": "sha256 от data/originals.sha256"})
        log.append(rec)
        print("  внесен по sha256: %s" % rel)
        return True

    kind = kind_of(data[:4096])
    if kind != "xls":
        print("  ГРЕШКА: sha256 не е в data/originals.sha256 и файлът не е отчет по КФП (вид: %s)" % kind)
        return False
    try:
        year, month, day, unit = read_kfp(data)
    except ValueError as exc:
        print("  ГРЕШКА: не е отчет по КФП: %s" % exc)
        return False
    m = KFP_SUFFIX.search(src.name)
    name = "%04d-EU_funds_%02d%02d_BG_WEB%s.xls" % (year, month, year % 100, (m.group(1) or "") if m else "")
    rel = "kfp_%04d/%s" % (year, name)
    period = (month, year % 100)
    same = [p for p in sorted((RAW / ("kfp_%04d" % year)).glob("*.xls")) if kfp_period(p.name) == period]   # на диска
    sums = read_sums()                                 # версия от списъка, която я няма на диска: само с --replace новият файл я заменя
    listed = [r for r in sorted(sums) if r.startswith("kfp_%04d/" % year) and kfp_period(r) == period and not (RAW / r).is_file()]
    if any(sha256_file(p) == sha for p in same):
        rel_have = next(p for p in same if sha256_file(p) == sha).relative_to(RAW).as_posix()
        for r in listed:
            drop_sum(r, args.dry_run)
        add_sum(rel_have, sha, args.dry_run)          # на мястото си е, но може още да не е в originals.sha256
        print("  вече е внесен: %s (редът му в data/originals.sha256 е налице)" % rel_have)
        return True
    if (same or listed) and not args.replace:          # закованата версия е друга, дори файлът ѝ да не е на диска
        print("  ГРЕШКА: за %04d-%02d вече има %s. Ако това е коригирана версия, пусни с --replace." % (
            year, month, ", ".join([p.name for p in same] + ["%s (ред в data/originals.sha256, sha256 %s…)" % (r, sums[r][:12]) for r in listed])))
        return False
    for p in same:
        drop_sum(p.relative_to(RAW).as_posix(), args.dry_run)
        print("  старата версия е преместена в %s" % move_aside(p, stamp, args.dry_run).relative_to(ROOT))
    for r in listed:
        drop_sum(r, args.dry_run)
        print("  заменя %s (sha256 %s…) в data/originals.sha256" % (r, sums[r][:12]))
    place(src, rel, args.dry_run)
    add_sum(rel, sha, args.dry_run)
    if listed:
        rec["replaces"] = [{"file": r, "sha256": sums[r]} for r in listed]
    rec.update({"source": "kfp-monthly", "period": "%04d-%02d" % (year, month), "file": rel,
                "page": rec["page"] or KFP_PAGE,
                "checks": {"magic": "xls", "sheet": KFP_SHEET, "size": [54, 4],
                           "asOf": "%04d-%02d-%02d" % (year, month, day), "unit": unit}})
    log.append(rec)
    print("  внесен отчет по КФП към %02d.%02d.%04d: %s (%s)" % (day, month, year, rel, unit))
    print("  ред за docs/data-sources.md, раздел 4.1:  | `%s` | %s | `%s` |" % (name, thousands(len(data)), sha))
    return True


def cmd_import(args):
    paths = args.paths or [str(INBOX)]
    by_hash = {h: rel for rel, h in read_sums().items()}
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    log, ok = [], True
    for src in inputs(paths):
        if not src.is_file():
            print("%s: няма такъв файл" % src)
            ok = False
            continue
        print(src)
        ok = import_one(src, args, by_hash, stamp, log) and ok
    if log and not args.dry_run:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as fh:
            for rec in log:
                fh.write(json.dumps(rec, ensure_ascii=False, sort_keys=True) + "\n")
        print("\n%d записа за придобиване в %s" % (len(log), LOG.relative_to(ROOT)))
    if args.dry_run:
        print("\n--dry-run: нищо не е записано")
    return 0 if ok else 1


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="какво има, какво липсва и откъде се взима")
    imp = sub.add_parser("import", help="внася ръчно свалени файлове или архива на работната група")
    imp.add_argument("paths", nargs="*", help="файлове или папки (по подразбиране tmp/sources/inbox/)")
    imp.add_argument("--url", help="адресът, от който е свален файлът (иначе от метаданните на macOS, ако ги има)")
    imp.add_argument("--replace", action="store_true", help="друга версия на същия месец по КФП: старата отива в tmp/sources/replaced/")
    imp.add_argument("--dry-run", action="store_true", help="само покажи какво ще стане")
    args = ap.parse_args(argv)
    return cmd_status(args) if args.cmd == "status" else cmd_import(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
