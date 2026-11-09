"""Independent reader of the program-budget PDFs (PyMuPDF text layer, word stream order).

Why it exists: the frozen input extraction (pipeline/budget_pipeline/extract/program_budgets.py, find_tables) takes the year of a table from
the text above it and stores the table under that year label, overwriting an earlier table with the same label. Where
a heading is split, mistyped or missing, whole tables end up under the wrong year (checked: 3000, 3900, 1600, 4000,
5300, 7100, 8600). A published number must be reproducible from the primary document, so this module re-reads every
coded row of the main table block of each PDF on its own and `program_budgets` publishes a cell only when it was read here.

What is read: a row = a programme code (`0200.01.00`, or `0200.` + `01.00` split over two words) or the line
"Общо разходи" followed by the numbers of the row. The year of a row = the last year heading ("Отчет 2023", "Закон за
2025 г.", "Проект 2026", "Прогноза 2027" ...) above the row on the same page, else the heading carried over from the
previous page (tables continue over pages). The year is taken from the number of the heading (2023..2028), because some
documents mistype the keyword ("Закон за 2023 г.").

Numbers: "157 517,1" (grouped, decimal comma) and "5018.5" (decimal point) both occur; blank cells are OMITTED from
the text layer (so a row can have fewer than nine numbers), "-", "0" and "0,0" are zeros.
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import re
from itertools import combinations

import fitz  # PyMuPDF (build-time only; not needed to serve the site)


PDF_DIR = ROOT / "data" / "originals" / "program_budgets"
YEAR_LABEL = {2023: "Отчет 2023", 2024: "Отчет 2024", 2025: "Закон 2025", 2026: "Проект 2026",
              2027: "Прогноза 2027", 2028: "Прогноза 2028"}
COLS = ["cons_total", "cons_prb", "cons_other", "dept_total", "dept_prb", "dept_other", "adm_total", "adm_prb", "adm_other"]
MIN_TABLE_TOKENS = 5          # a coded line with at least this many numbers anchors the table block (TOC / narrative lines have fewer)
MIN_ROW_TOKENS = 4            # a row of the block with a non-zero figure has at least four (total, PRB, dept. total, dept. PRB)
TOL = 0.15                    # identity tolerance: every figure is printed to 0.1

_KW = re.compile(r"^\(?(Отчет|Закон|Проект|Прогноза)а?$", re.I)       # also ПРОГНОЗА 2028 г.
_YR = re.compile(r"^\(?(20\d\d)")
_NUM = re.compile(r"^-?\d+(?:[.,]\d+)?$")
_G1 = re.compile(r"^-?\d{1,3}$")
_G3 = re.compile(r"^\d{3}(?:[.,]\d+)?$")
_CODE = re.compile(r"^(\d{4})\.(\d{2})\.(\d{2})\*?$")
_CODE_A = re.compile(r"^\d{4}\.$")
_CODE_B = re.compile(r"^(\d{2})\.(\d{2})\*?$")
_CODE_C = re.compile(r"^(\d{4})\.(\d{2})\.(\d)\*?$")          # last digit wrapped to the next line: "1800.01.0" + "0"
_DIGIT = re.compile(r"^\d\*?$")
_DASHES = {"-", "–", "—"}          # "−" (U+2212) is handled with them


_DOT_END = re.compile(r"^\d{1,3}[.,]$")


def _join_split_decimals(ws):
    """Some documents break a decimal after the separator: "1 163." + "0" (words 1 | 163. | 0) means 1 163.0."""
    out, i, n = [], 0, len(ws)
    while i < n:
        w = ws[i]
        if i + 1 < n and _DOT_END.match(w[4].strip()):
            nx = ws[i + 1]
            if re.match(r"^\d{1,2}$", nx[4].strip()) and abs(nx[1] - w[1]) < 3 and 0 <= nx[0] - w[2] < 4.0:
                out.append((w[0], w[1], nx[2], nx[3], w[4].strip() + nx[4].strip(), w[5], w[6], w[7]))
                i += 2
                continue
        out.append(w)
        i += 1
    return out


def _tokens(page):
    """Word stream of a page -> tuples (kind, value, x0, y0, x1, y1, block, line[, text]); kind code|num|w."""
    ws = _join_split_decimals(page.get_text("words"))
    toks, i, n = [], 0, len(ws)
    while i < n:
        x0, y0, x1, y1, t, b, ln, _wn = ws[i]
        t = t.strip()
        if not t:
            i += 1
            continue
        m = _CODE.match(t)
        if m:
            toks.append(("code", "%s.%s.%s" % m.groups(), x0, y0, x1, y1, b, ln))
            i += 1
            continue
        if _CODE_A.match(t) and i + 1 < n:
            m2 = _CODE_B.match(ws[i + 1][4].strip())
            if m2:
                toks.append(("code", "%s.%s.%s" % (t[:4], m2.group(1), m2.group(2)), x0, y0, ws[i + 1][2], y1, b, ln))
                i += 2
                continue
        m = _CODE_C.match(t)
        if m:
            nxt = ws[i + 1] if i + 1 < n else None
            if nxt is not None and _DIGIT.match(nxt[4].strip()) and 0 <= nxt[1] - y0 < 25 and abs(nxt[0] - x0) < 40:
                toks.append(("code", "%s.%s.%s%s" % (m.group(1), m.group(2), m.group(3), nxt[4].strip()[0]), x0, y0, nxt[2], nxt[3], b, ln))
                i += 2
                continue
            if m.group(2) == "00" and m.group(3) == "0":      # "3000.00.0": the total code with a dropped digit
                toks.append(("code", "%s.00.00" % m.group(1), x0, y0, x1, y1, b, ln))
                i += 1
                continue
        if _NUM.match(t):
            j, txt, xe = i, t, x1
            if _G1.match(t):
                while j + 1 < n:
                    w2 = ws[j + 1]
                    t2 = w2[4].strip()
                    if _G3.match(t2) and abs(w2[1] - ws[j][1]) < 3 and 0 <= w2[0] - xe < 4.6:
                        txt += " " + t2
                        xe = w2[2]
                        j += 1
                        if re.search(r"[.,]\d", t2):
                            break
                    else:
                        break
            try:
                v = float(txt.replace(" ", "").replace(",", "."))
            except ValueError:
                v = None
            toks.append(("num", v, x0, y0, xe, y1, b, ln, txt))
            i = j + 1
            continue
        if t in _DASHES or t == "−":
            nx = ws[i + 1] if i + 1 < n else None
            if nx is not None and _NUM.match(nx[4].strip()) and abs(nx[1] - y0) < 3 and 0 <= nx[0] - x1 < 3.5:
                # a minus sign printed as its own word: "- 5,7" is -5.7 (a lone dash in a cell means zero)
                txt = "-" + nx[4].strip()
                toks.append(("num", float(txt.replace(",", ".")), x0, y0, nx[2], nx[3], b, ln, txt))
                i += 2
                continue
            toks.append(("num", 0.0, x0, y0, x1, y1, b, ln, t))
            i += 1
            continue
        toks.append(("w", t, x0, y0, x1, y1, b, ln))
        i += 1
    return toks


def _heads(toks):
    """[(y, label)] of the year headings of a page. A heading is a keyword word + (optional "за") + a year word on a
    short line (<= 6 words, also counting the next line) or one that mentions the unit ("хил.")."""
    by_line = {}
    for t in toks:
        by_line.setdefault((t[6], t[7]), []).append(t)
    out = []
    for k, tk in enumerate(toks):
        if tk[0] != "w" or not _KW.match(tk[1]):
            continue
        j = k + 1
        if j < len(toks) and toks[j][0] == "w" and toks[j][1].lower() == "за":
            j += 1
        if j >= len(toks) or toks[j][0] not in ("w", "num"):
            continue
        s = str(toks[j][1]) if toks[j][0] == "w" else toks[j][8]
        ym = _YR.match(s)
        if not ym or int(ym.group(1)) not in YEAR_LABEL:
            continue
        line = by_line[(tk[6], tk[7])]
        cnt = len(line) + (len(by_line.get((tk[6], tk[7] + 1), [])) if toks[j][7] != tk[7] else 0)
        if cnt <= 6 or "хил" in " ".join(str(t[1]) for t in line):
            out.append((tk[3], YEAR_LABEL[int(ym.group(1))]))
    return sorted(out)


_GROUP_WORDS = ("Консолидирани", "Ведомствени", "Администрирани")


def _group_headers(toks):
    """[(y, (G0, G1, G2))] of a page: the horizontal centres of the three column-group headings "Консолидирани разходи",
    "Ведомствени разходи", "Администрирани разходи" of every table header on the page (each group has three columns:
    total / PRB budget / other budgets and accounts, the heading is centred over them)."""
    found = {0: [], 1: [], 2: []}
    for k, t in enumerate(toks):
        if t[0] == "w" and t[1] in _GROUP_WORDS:
            x0, x1, y = t[2], t[4], t[3]
            if k + 1 < len(toks) and toks[k + 1][0] == "w" and toks[k + 1][1].startswith("разходи") and abs(toks[k + 1][3] - y) < 3:
                x1 = toks[k + 1][4]
            found[_GROUP_WORDS.index(t[1])].append((y, (x0 + x1) / 2.0))
    out = []
    for i in range(min(len(found[0]), len(found[1]), len(found[2]))):
        ents = [found[g][i] for g in range(3)]
        if max(e[0] for e in ents) - min(e[0] for e in ents) < 12:
            out.append((min(e[0] for e in ents), tuple(e[1] for e in ents)))
    return sorted(out)


def _is_total_marker(toks, k):
    """"Общо разходи" + number, or the uncoded total line "Общо по бюджета на <орган>" (its label words come first, the
    numbers of the row follow in the next block of the stream)."""
    if not (toks[k][0] == "w" and toks[k][1] == "Общо" and k + 2 < len(toks) and toks[k + 1][0] == "w"):
        return False
    if toks[k + 1][1].startswith("разходи") and toks[k + 2][0] == "num":
        return True
    return toks[k + 1][1] == "по" and toks[k + 2][0] == "w" and toks[k + 2][1] == "бюджета"


_INT_GROUPS = re.compile(r"^-?\d{1,3}(?: \d{3})*$")           # "76", "4 268": a number cut off before its last group
_LAST_GROUP = re.compile(r"^\d{3}[.,]\d+$")                    # "619,3": the last group of a number, with its decimals


def _merge_wrapped(nums):
    """A number too wide for its narrow column wraps over two lines ("76" above "619,3", "4 268" above "834,7"): the
    two pieces share the right edge and sit one line apart. Joined here; any row that is still inconsistent afterwards
    is dropped by the identity checks."""
    out = []
    for t in nums:
        if out:
            a = out[-1]
            if (_INT_GROUPS.match(a[8]) and _LAST_GROUP.match(t[8]) and abs(a[4] - t[4]) <= 1.0 and 3.0 <= t[3] - a[3] <= 16.0):
                txt = a[8] + " " + t[8]
                out[-1] = ("num", float(txt.replace(" ", "").replace(",", ".")), min(a[2], t[2]), a[3], max(a[4], t[4]),
                           t[5], a[6], a[7], txt)
                continue
        out.append(t)
    return out


def _join_wrapped_first(nums, toks, j):
    """The first column is narrow: its number can wrap ("92" / "252,5") with the second piece one line below. When the
    label of the row also wraps, the stream puts that piece after the label words, i.e. after the end of the row; it is
    picked up here: the first number is an integer part and a token with the decimals shares its right edge one line
    below (at most eight tokens ahead, never across the next row)."""
    a = nums[0]
    if not _INT_GROUPS.match(a[8]):
        return nums
    n = len(toks)
    for t in toks[j:min(n, j + 8)]:
        if t[0] == "code":
            break
        if t[0] == "num" and _LAST_GROUP.match(t[8]) and abs(a[4] - t[4]) <= 1.0 and 3.0 <= t[3] - a[3] <= 16.0:
            txt = a[8] + " " + t[8]
            first = ("num", float(txt.replace(" ", "").replace(",", ".")), min(a[2], t[2]), a[3], max(a[4], t[4]), t[5], a[6], a[7], txt)
            return [first] + nums[1:]
    return nums


def _page_rows(toks):
    """[(code|'total', y, [numbers], y_of_first_number, [right edges], [left edges])] of one page, in stream order.

    A code followed by the words "Общо разходи" (before any number) is the total row, whatever its code says (1800
    prints the code of its first policy there)."""
    out, n = [], len(toks)
    for k, tk in enumerate(toks):
        is_code = tk[0] == "code"
        if not (is_code or _is_total_marker(toks, k)):
            continue
        j, nums, total = k + 1, [], not is_code
        while j < n and toks[j][0] != "code":
            t = toks[j]
            if t[0] == "num":
                if t[8] in _DASHES and j + 1 < n and toks[j + 1][0] == "w":
                    j += 1                              # a dash inside a programme name ("образование – наука"), not an empty cell
                    continue
                nums = _merge_wrapped(nums + [t])
                if len(nums) >= 9:
                    break
            elif t[0] == "w" and nums:
                break                                   # a word after the numbers: the row is over
            elif _is_total_marker(toks, j):
                if nums:
                    break
                total = True
            j += 1
        if nums:
            nums = _join_wrapped_first(nums, toks, j)
            out.append(("total" if total else tk[1], tk[3], [t[1] for t in nums], nums[0][3], [t[4] for t in nums], [t[2] for t in nums]))
    return out


def read_rows(filename):
    """Rows of the main table block of one PDF -> (rows, pages).

    rows = [{"label", "code" ('total' for the "Общо разходи" line), "page", "tokens"}]; pages = page numbers of the block.
    The main block = the first run of consecutive pages that carry at least one table row (a coded line with >= 5
    numbers); later program-description pages repeat codes and years and are not part of the table.

    A heading can sit at the very bottom of a page while its table starts at the top of the next one, so the label
    carried to the next page is the LAST heading of the page (not the label of the last row)."""
    doc = fitz.open(str(PDF_DIR / filename))
    rows, pages, carry, started = [], [], None, False
    hcarry = None                                   # last group-header centres seen (carried to the pages that have none)
    for pn, page in enumerate(doc, 1):
        text = page.get_text()
        has_code = bool(re.search(r"\d{4}\.(?:\s?\d{2}\.\d{2})", text)) or "Общо разходи" in text
        if not started and not has_code:
            # a page before the table: remember its last heading only for the page right after it
            heads = _heads(_tokens(page)) if re.search(r"(?:Отчет|Закон|Проект|Прогноза)", text) else []
            carry = heads[-1][1] if heads else None
            continue
        toks = _tokens(page)
        heads = _heads(toks)
        ghs = _group_headers(toks)
        allrows = _page_rows(toks)
        strong = [r for r in allrows if len(r[2]) >= MIN_TABLE_TOKENS]
        prow = [r for r in allrows if len(r[2]) >= MIN_ROW_TOKENS]
        if not strong and len(prow) >= 3 and ghs:
            strong = prow                  # a tiny budget: every row has just four figures, but the page has the column headings
        if not strong and not (started and len(prow) >= 2):
            if started:
                break
            carry = heads[-1][1] if heads else None
            continue
        started = True
        pages.append(pn)
        for code, y, vals, ny, x1s, x0s in prow:
            lab = None
            for hy, hl in heads:
                if hy <= min(y, ny) + 2:
                    lab = hl
            if lab is None:
                lab = carry
            carry = lab
            hdr, own = hcarry, False
            for hy, hc in ghs:
                if hy <= min(y, ny) + 2:
                    hdr, own = hc, True
            rows.append({"label": lab, "code": code, "page": pn, "tokens": vals, "x1": x1s, "x0": x0s, "hdr": hdr, "hdr_own": own})
        if heads:
            carry = heads[-1][1]
        if ghs:
            hcarry = ghs[-1][1]
    doc.close()
    return rows, pages


# ------------------------------------------------------------------------------------------------ cells
def nz(values):
    """Non-zero values in order, rounded to 0.1 - the signature of a row whose blank cells were omitted."""
    return tuple(round(x, 1) for x in values if abs(x) >= 0.05)


def identities_ok(v):
    """The four identities of the table for nine values (list in COLS order)."""
    return (abs(v[0] - v[1] - v[2]) <= TOL and abs(v[3] - v[4] - v[5]) <= TOL and abs(v[6] - v[7] - v[8]) <= TOL
            and abs(v[0] - v[3] - v[6]) <= TOL)


def spread(tokens):
    """All ways to place the omitted-blank tokens into the nine columns (blank = 0) that satisfy the identities."""
    k = len(tokens)
    sols, seen = [], set()
    for pos in combinations(range(9), k):
        v = [0.0] * 9
        for p, t in zip(pos, tokens):
            v[p] = t
        key = tuple(v)
        if key not in seen and identities_ok(v):          # zeros make different placements give the same row
            seen.add(key)
            sols.append(v)
    return sols


CLUSTER_GAP = 8.0             # right edges of one column differ by <= ~5 pt on a page; neighbouring columns are >= 40 pt apart
MIN_CALIB_SHARE = 0.75        # a page layout is accepted when it makes at least this share of the page's rows consistent


def _centroids(xs):
    vs = sorted(xs)
    groups, cur = [], [vs[0]]
    for v in vs[1:]:
        if v - cur[-1] > CLUSTER_GAP:
            groups.append(cur)
            cur = [v]
        else:
            cur.append(v)
    groups.append(cur)
    return [sum(g) / len(g) for g in groups]


def _cluster_ids(cents, x1s):
    return [min(range(len(cents)), key=lambda c: abs(cents[c] - x)) for x in x1s]


def page_layout(rows):
    """Which column each right-edge cluster of one page is, or None when that cannot be told uniquely.

    The numbers of a column are right-aligned, so their right edges form clusters (nine columns at most, fewer when a
    column is blank on the whole page). The clusters keep their left-to-right order, so the layout is one of the
    C(9, m) increasing maps clusters -> columns; the right one makes every row of the page satisfy the identities of
    the table. Accepted only when exactly one map is best and it fits >= 75 % of the page's rows."""
    usable = [r for r in rows if r.get("x1") and len(r["x1"]) == len(r["tokens"])]
    xs = [x for r in usable for x in r["x1"]]
    if not xs:
        return None
    cents = _centroids(xs)
    m = len(cents)
    if m > 9:
        return None
    ids = []
    for r in usable:
        ci = _cluster_ids(cents, r["x1"])
        if len(set(ci)) == len(ci) and ci == sorted(ci):
            ids.append((r["tokens"], ci))
    if len(ids) < 2:
        return None
    scored = []
    for cols in combinations(range(9), m):
        ok = 0
        for toks, ci in ids:
            v = [0.0] * 9
            for c, t in zip(ci, toks):
                v[cols[c]] = t
            if identities_ok(v):
                ok += 1
        scored.append((ok, cols))
    scored.sort(reverse=True)
    best = scored[0]
    if best[0] < MIN_CALIB_SHARE * len(ids) or (len(scored) > 1 and scored[1][0] >= best[0]):
        return None
    return {"cents": cents, "cols": best[1]}


def place(row, layout):
    """The nine values of a row placed by the page layout (None when a figure falls on no known column)."""
    if layout is None or not row.get("x1") or len(row["x1"]) != len(row["tokens"]):
        return None
    ci = _cluster_ids(layout["cents"], row["x1"])
    if len(set(ci)) != len(ci):
        return None
    v = [0.0] * 9
    for c, t in zip(ci, row["tokens"]):
        v[layout["cols"][c]] = t
    return v


def resolve_row(row, layout):
    """(method, vector | candidates | None) of one row.

    full        nine numbers that satisfy the identities
    unique      fewer numbers; exactly one placement of the blanks satisfies the identities
    calibrated  several placements fit; the page layout (right-edge clusters) picks one of them
    ambiguous   several placements fit and the layout does not decide (candidates returned; cells_of then tries the
                column-group headings, method "header")
    bad         no placement satisfies the identities (a garbled or inconsistent row)"""
    toks = row["tokens"]
    if len(toks) == 9:
        return ("full", list(toks)) if identities_ok(toks) else ("bad", None)
    sols = spread(toks)
    if not sols:
        return "bad", None
    if len(sols) == 1:
        return "unique", sols[0]
    v = place(row, layout)
    if v is not None and identities_ok(v) and tuple(v) in {tuple(s) for s in sols}:
        return "calibrated", v
    return "ambiguous", sols


HDR_WINDOWS = ((-100.0, -20.0), (-3.0, 21.0), (40.0, 100.0))    # (x1 - 12 - centre of the group heading) of the left / middle / right column
                                                                 # of a group; measured on ~9000 identity-resolved figures, gaps keep them apart


def place_by_header(row):
    """The nine values of a row placed by the column-group headings above it (None when a figure is not clearly in one
    column). A figure belongs to the group whose heading centre is nearest; inside the group the column follows from how
    far its right edge lies from that centre."""
    g3 = row.get("hdr")
    if not g3 or not row.get("x1") or len(row["x1"]) != len(row["tokens"]):
        return None
    v, used = [0.0] * 9, set()
    for x, t in zip(row["x1"], row["tokens"]):
        g = min(range(3), key=lambda i: abs(g3[i] - (x - 12.0)))
        d = (x - 12.0) - g3[g]
        c = next((i for i, (lo, hi) in enumerate(HDR_WINDOWS) if lo <= d <= hi), None)
        if c is None or 3 * g + c in used:
            return None
        used.add(3 * g + c)
        v[3 * g + c] = t
    return v


def _header_pages(rows, results):
    """Pages on which header placement is trusted: it must reproduce every row that the identities resolved on their own
    (full / unique / calibrated), and a header carried over from the previous page needs at least two such rows."""
    stats = {}
    for r, (m, res) in zip(rows, results):
        if m not in ("full", "unique", "calibrated") or not r.get("hdr"):
            continue
        v = place_by_header(r)
        if v is None:
            continue
        st = stats.setdefault(r["page"], {"agree": 0, "disagree": 0, "own": False})
        st["own"] = st["own"] or r.get("hdr_own", False)
        if tuple(round(a, 1) for a in v) == tuple(round(a, 1) for a in res):
            st["agree"] += 1
        else:
            st["disagree"] += 1
    ok = set()
    pages = {r["page"]: r for r in rows if r.get("hdr")}
    for pn, r in pages.items():
        st = stats.get(pn, {"agree": 0, "disagree": 0})
        own = any(rr.get("hdr_own") for rr in rows if rr["page"] == pn)
        if st["disagree"] == 0 and (own or st["agree"] >= 2):
            ok.add(pn)
    return ok


def cells_of(rows):
    """Group rows by (label, code) -> cell and a list of conflicts.

    cell = {"values": [nine floats] | None, "method": full|unique|calibrated|header|ambiguous|bad, "cands": [[...]] (when
    ambiguous), "tokens": [...], "pages": [...]}. Rows of the same (label, code) must carry the same figures; the
    total of a document appears both as a coded ".00.00" row and as "Общо разходи" - both are keyed 'total'. A row
    split by a page break repeats partly: the complete variant wins."""
    by_page = {}
    for r in rows:
        by_page.setdefault(r["page"], []).append(r)
    layouts = {pn: page_layout(rs) for pn, rs in by_page.items()}
    results = [resolve_row(r, layouts.get(r["page"])) for r in rows]
    hdr_ok = _header_pages(rows, results)
    for i, r in enumerate(rows):
        m, res = results[i]
        if m == "ambiguous" and r["page"] in hdr_ok:
            v = place_by_header(r)
            if v is not None and identities_ok(v) and tuple(v) in {tuple(sol) for sol in res}:
                results[i] = ("header", v)
    groups, conflicts = {}, []
    for r, (method, res) in zip(rows, results):
        if r["label"] is None:
            continue
        key = (r["label"], "total" if (r["code"] == "total" or r["code"].endswith(".00.00")) else r["code"])
        g = groups.setdefault(key, {"res": [], "pages": [], "tokens": []})
        g["res"].append((method, res))
        g["pages"].append(r["page"])
        g["tokens"].append(r["tokens"])
    order = {"full": 0, "unique": 1, "calibrated": 2, "header": 3}
    out = {}
    for key, g in groups.items():
        solved = [(m, tuple(v)) for m, v in g["res"] if m in order]
        distinct = {v for _, v in solved}
        cell = {"values": None, "method": None, "cands": None, "tokens": g["tokens"][0], "pages": sorted(set(g["pages"]))}
        if len(distinct) == 1:
            cell["values"] = list(next(iter(distinct)))
            cell["method"] = min((m for m, _ in solved), key=lambda m: order[m])
        elif len(distinct) > 1:
            full = {v for m, v in solved if m == "full"}
            if len(full) == 1:
                cell["values"] = list(next(iter(full)))
                cell["method"] = "full"
            else:
                conflicts.append(key)
                continue
        else:
            amb = [v for m, v in g["res"] if m == "ambiguous"]
            if amb:
                common = {tuple(s) for s in amb[0]}
                for a in amb[1:]:
                    common &= {tuple(s) for s in a}
                if len(common) == 1:
                    cell["values"] = list(next(iter(common)))
                    cell["method"] = "unique"
                else:
                    cell["method"] = "ambiguous"
                    cell["cands"] = [list(c) for c in sorted(common or {tuple(s) for s in amb[0]})]
            else:
                cell["method"] = "bad"
        if cell["values"] is not None and any(m == "ambiguous" for m, _ in g["res"]):
            # a partial repeat of the row must agree with the resolved vector
            for m, v in g["res"]:
                if m == "ambiguous" and tuple(cell["values"]) not in {tuple(s) for s in v}:
                    conflicts.append(key)
                    cell["values"] = None
                    cell["method"] = "bad"
                    break
        out[key] = cell
    return out, conflicts


# ------------------------------------------------------------------------------------------------ structure
STRUCT_TOL = 0.06             # per printed decimal: a parent equals the sum of its children within this * (n + 1)
MAX_COMBOS = 50000            # cap of the candidate product enumerated for one parent


def _is_policy_key(k):
    return k != "total" and len(k) == 10 and k.endswith(".00") and k[5:7] != "00"


def _children(parent, keys):
    """Keys (of one year) that are the direct children of `parent` in the code hierarchy: the policies of the total, the
    programmes of a policy (same policy number)."""
    if parent == "total":
        return [k for k in keys if _is_policy_key(k)]
    if _is_policy_key(parent):
        pre = parent[:8]
        return [k for k in keys if k != "total" and k.startswith(pre) and not k.endswith(".00")]
    return []


def _options(cell):
    """The readings of a cell: one vector when resolved, the candidate vectors when ambiguous, else None."""
    if cell["values"] is not None:
        return [tuple(cell["values"])]
    if cell["method"] == "ambiguous" and cell.get("cands"):
        return [tuple(c) for c in cell["cands"]]
    return None


def _enumerate(opts, amb, base, tol, keep, chosen, depth):
    """Depth-first product over the ambiguous members of a group (index 0 = parent, the rest = children). Records, per
    ambiguous member, the readings that occur in at least one combination with parent = sum(children)."""
    if depth == len(amb):
        par = chosen[0]
        for c in range(9):
            tot = base[c] + sum(chosen[i][c] for i in amb if i != 0)
            if abs(par[c] - tot) > tol:
                return
        for i in amb:
            keep[i].add(chosen[i])
        return
    i = amb[depth]
    for v in opts[i]:
        chosen[i] = v
        _enumerate(opts, amb, base, tol, keep, chosen, depth + 1)


def resolve_by_structure(cells):
    """Resolve ambiguous cells with the accounting identity of the table itself: a policy is the sum of its programmes
    and the total is the sum of the policies, in every column (printed to 0.1).

    Every reading of an ambiguous cell is a placement of figures that WERE printed in the row, so this only chooses among
    readings of the document; it never creates a figure. A cell is resolved when exactly one of its readings takes part
    in a combination that satisfies the identity; when several remain, the candidate list is narrowed. Repeats until
    nothing changes. Resolved cells get method "structure". Returns the number of cells resolved."""
    by_label = {}
    for (label, key) in cells:
        by_label.setdefault(label, []).append(key)
    resolved = 0
    for _ in range(8):
        changed = False
        for label, keys in by_label.items():
            for parent in ["total"] + [k for k in keys if _is_policy_key(k)]:
                if (label, parent) not in cells:
                    continue
                kids = _children(parent, keys)
                if not kids:
                    continue
                members = [parent] + kids
                opts = [_options(cells[(label, m)]) for m in members]
                if any(o is None for o in opts):
                    continue                              # a garbled or unread cell in the group: nothing to verify
                amb = [i for i, o in enumerate(opts) if len(o) > 1]
                if not amb:
                    continue
                size = 1
                for i in amb:
                    size *= len(opts[i])
                if size > MAX_COMBOS:
                    continue
                base = [sum(opts[i][0][c] for i in range(1, len(members)) if i not in amb) for c in range(9)]
                keep = {i: set() for i in amb}
                chosen = [o[0] if len(o) == 1 else None for o in opts]
                _enumerate(opts, amb, base, STRUCT_TOL * (len(kids) + 1), keep, chosen, 0)
                for i in amb:
                    narrowed = [v for v in opts[i] if v in keep[i]]
                    if not narrowed:
                        continue                          # the group never adds up: leave the cell alone
                    cell = cells[(label, members[i])]
                    if len(narrowed) == 1:
                        cell["values"] = list(narrowed[0])
                        cell["method"] = "structure"
                        cell["cands"] = None
                        resolved += 1
                        changed = True
                    elif len(narrowed) < len(opts[i]):
                        cell["cands"] = [list(v) for v in narrowed]
                        changed = True
        if not changed:
            break
    return resolved


# ------------------------------------------------------------------------------------------------ headings (names)
_QCH = "„“”\"«»"
_HEAD_WORD = re.compile(r"^(Бюджетна|БЮДЖЕТНА)$")
_PROG_WORD = re.compile(r"^(програма|ПРОГРАМА)[„“”\"«»]?$")
_ENUM = re.compile(r"^\d{1,2}\.$")
_ONLY_DOTS = re.compile(r"^[.…]{3,}$")
MAX_NAME_TOKENS = 60


def _heading_after(toks, k):
    """The programme heading that follows the code token `k`: "Бюджетна програма „Име“" (also with ASCII quotes, with
    reversed quotes, with an enumerator "3. Име" and without quotes) -> the words of the name, or None.

    The name ends at the closing quote, at the first figure (the table row), at dot leaders (contents page) or at the next code."""
    n = len(toks)
    if k + 2 >= n or toks[k + 1][0] != "w" or toks[k + 2][0] != "w":
        return None
    if not (_HEAD_WORD.match(toks[k + 1][1]) and _PROG_WORD.match(toks[k + 2][1])):
        return None
    words, opened = [], toks[k + 2][1][-1] in _QCH       # a quote glued to "програма“" is a reversed pair, not an opening
    reversed_pair = opened
    opened = False
    for u in toks[k + 3:k + 3 + MAX_NAME_TOKENS]:
        if u[0] != "w":
            break
        w = u[1]
        if _ONLY_DOTS.match(w):
            break
        if w[:1] in _QCH:
            opened = True
        words.append(w)
        if opened and not reversed_pair and w[-1:] in _QCH and len(w) > 1 + (w[:1] in _QCH):
            break
        if opened and not reversed_pair and w in ("“", "”", "\""):
            break
    while words and _ENUM.match(words[0]):
        words = words[1:]
    return words or None


def _name_key(s):
    return re.sub(r"[\s" + _QCH + r"]+", " ", s).strip().lower()


def program_names(filename):
    """{code: [name, ...]}: the names printed next to each programme code of one PDF, one entry per distinct reading
    (the table, the contents page and the programme descriptions repeat the heading), most frequent first.

    The words are joined and every quote character is dropped (the documents mix „…“, "…" and reversed pairs)."""
    doc = fitz.open(str(PDF_DIR / filename))
    seen = {}
    for page in doc:
        toks = _tokens(page)
        for k, t in enumerate(toks):
            if t[0] != "code" or t[1].endswith(".00.00"):
                continue
            words = _heading_after(toks, k)
            if not words:
                continue
            name = re.sub(r"\s+", " ", " ".join(w.strip(_QCH) if w.strip(_QCH) else "" for w in words)).strip()
            name = re.sub(r"\s+([,.;:])", r"\1", name)
            if len(name) < 3 or name.isdigit():
                continue
            seen.setdefault(t[1], {}).setdefault(_name_key(name), [0, name])[0] += 1
    doc.close()
    out = {}
    for code, d in seen.items():
        # most frequent reading; among equals prefer the one that is not all upper case, then the longer one
        ranked = sorted(d.values(), key=lambda cn: (-cn[0], cn[1].isupper(), -len(cn[1])))
        out[code] = [cn[1] for cn in ranked]
    return out


def row_labels(filename):
    """{policy code: [label, ...]}: the words printed right after a policy-level code ("1000.05.00 Други бюджетни
    програми 0,0 ...") in the table rows of one PDF, most frequent reading first.

    A fallback for a row whose name the frozen input file does not carry. The label ends at the first figure or the next
    code; quote characters are dropped. Wrapped second lines of long labels are not followed, so the caller must treat
    the result as a candidate to be checked, not as a full name."""
    doc = fitz.open(str(PDF_DIR / filename))
    seen = {}
    for page in doc:
        toks = _tokens(page)
        for k, t in enumerate(toks):
            if t[0] != "code" or t[1].endswith(".00.00") or not t[1].endswith(".00"):
                continue
            words = []
            for u in toks[k + 1:k + 1 + MAX_NAME_TOKENS]:
                if u[0] != "w" or _ONLY_DOTS.match(u[1]):
                    break
                words.append(u[1].strip(_QCH))
            name = re.sub(r"\s+", " ", " ".join(w for w in words if w)).strip()
            name = re.sub(r"\s+([,.;:])", r"\1", name)
            if len(name) < 3 or name.isdigit():
                continue
            seen.setdefault(t[1], {}).setdefault(_name_key(name), [0, name])[0] += 1
    doc.close()
    return {code: [cn[1] for cn in sorted(d.values(), key=lambda cn: (-cn[0], cn[1].isupper(), -len(cn[1])))]
            for code, d in seen.items()}
