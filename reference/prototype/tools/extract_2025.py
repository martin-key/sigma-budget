"""Извличане на месечните отчети на МФ за изпълнението на КФП, 2025 г.

Редовете се търсят по етикет в колона A (не по номер); колона B = „Консолидирана
фискална програма“ (к.2 = к.3 + к.4). Стойностите са в млн. лв. и се превръщат в
млн. € по фиксирания курс 1,95583.

Употреба: python3 tools/prototype/extract_2025.py prototype/data/raw/kfp_2025 <raw_2025.json>
(първият аргумент е папката с 12-те месечни .xls; суровите файлове не са в хранилището — виж docs/data-sources.md)
"""
import hashlib, json, os, re, sys, unicodedata
import xlrd

DL = sys.argv[1]
OUT = sys.argv[2]
RATE = 1.95583

FILES = {m: f"2025-EU_funds_{m:02d}25_BG_WEB.xls" for m in range(1, 13)}
FILES[12] = "2025-EU_funds_1225_BG_WEB_4.xls"
MONTH_END = {1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31}


def norm(s):
    s = unicodedata.normalize("NFC", str(s)).replace("І", "I").replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip()


# Етикет → ключ. Търси се ТОЧНО съвпадение на нормализирания текст в колона A.
WANT = {
    "rev": "I. Приходи, помощи и дарения",
    "exp16": "II. Разходи",
    "transfers": "III. Трансфери-нето /предоставени(-); получени(+)/",
    "eu": "IV. Вноска в общия бюджет на ЕС",
    "bal": 'V. Бюджетно салдо (дефицит "-" / излишък "+") = /I-II+III-IV/',
}


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


layouts = {}
rows_out = []
for m in range(1, 13):
    fn = FILES[m]
    p = os.path.join(DL, fn)
    wb = xlrd.open_workbook(p)
    assert wb.sheet_names() == ["стартова"], (fn, wb.sheet_names())
    sh = wb.sheet_by_name("стартова")
    # подпис на подредбата: всички текстови клетки + типовете на всички клетки (без ред 3 = датата)
    sig = []
    for r in range(sh.nrows):
        for c in range(sh.ncols):
            t = sh.cell_type(r, c)
            v = sh.cell_value(r, c)
            if r == 2:
                continue
            sig.append((r, c, t, v if t == xlrd.XL_CELL_TEXT else None))
    layouts[fn] = (sh.nrows, sh.ncols, tuple(sig))
    date_line = norm(sh.cell_value(2, 0))
    unit_label = norm(sh.cell_value(3, 3))
    col_head = norm(sh.cell_value(4, 1))
    col_code = norm(sh.cell_value(8, 1))
    exp_date = f"КЪМ {MONTH_END[m]:02d}.{m:02d}.2025 ГОДИНА"
    assert date_line == exp_date, (fn, date_line, exp_date)
    assert unit_label == "(млн.лв.)", (fn, unit_label)
    assert col_head == "Консолидирана фискална програма", (fn, col_head)
    assert col_code == "к.2=к.3+к.4", (fn, col_code)
    found = {}
    for r in range(sh.nrows):
        lab = norm(sh.cell_value(r, 0))
        for k, w in WANT.items():
            if lab == w:
                assert k not in found, (fn, k, "дублиран етикет")
                found[k] = r
    assert set(found) == set(WANT), (fn, found)
    vals = {}
    raw_labels = {}
    for k, r in found.items():
        assert sh.cell_type(r, 1) == xlrd.XL_CELL_NUMBER, (fn, k, sh.cell_type(r, 1))
        vals[k] = sh.cell_value(r, 1)
        raw_labels[k] = sh.cell_value(r, 0).strip()
        # к.2 = к.3 + к.4 за всеки използван ред
        c3, c4 = sh.cell_value(r, 2), sh.cell_value(r, 3)
        assert abs(vals[k] - (c3 + c4)) < 1e-6, (fn, k, vals[k], c3, c4)
    ident = vals["rev"] - vals["exp16"] + vals["transfers"] - vals["eu"] - vals["bal"]
    assert abs(ident) < 1e-6, (fn, ident)
    rows_out.append(dict(m=m, fn=fn, sha=sha(p), vals=vals, rows={k: r + 1 for k, r in found.items()},
                         labels=raw_labels, date_line=date_line, unit_label=unit_label, ident=ident))

# еднаква подредба във всички 12 файла?
base = layouts[FILES[1]]
diff_files = [fn for fn, lay in layouts.items() if lay != base]
print("файлове с различна подредба от януари:", diff_files)
for fn in diff_files:
    a, b = base[2], layouts[fn][2]
    print(" ", fn, "nrows/ncols", layouts[fn][:2], "vs", base[:2])
    sa, sb = set(a), set(b)
    print("   само в януари:", sorted(sa - sb)[:10])
    print("   само в", fn, ":", sorted(sb - sa)[:10])

# натрупване: растат ли приходите и разходите всеки месец?
for k in ("rev", "exp16", "eu"):
    seq = [r["vals"][k] for r in rows_out]
    print(k, "монотонно расте:", all(b > a for a, b in zip(seq, seq[1:])))

print("max |I-II+III-IV-V| (млн. лв.):", max(abs(r["ident"]) for r in rows_out))
print("max |трансфери-нето| (млн. лв.):", max(abs(r["vals"]["transfers"]) for r in rows_out))
for r in rows_out:
    v = r["vals"]
    print(r["m"], r["fn"], r["date_line"], r["unit_label"], r["rows"],
          "rev=%.3f exp16=%.3f eu=%.3f tr=%.6f bal=%.3f" % (v["rev"], v["exp16"], v["eu"], v["transfers"], v["bal"]))

json.dump(rows_out, open(OUT, "w"), ensure_ascii=False, indent=1)
