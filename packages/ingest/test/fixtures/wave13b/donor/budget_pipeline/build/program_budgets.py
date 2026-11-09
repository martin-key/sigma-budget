"""Program budgets normalised for ministries.json, ministries/<code>.json and programs.json.

Every published figure is READ FROM THE PDF of the program budget by `program_budget_pdf` (an independent word-stream reader);
the frozen input extraction (data/inputs/program_budgets_2026.json) is used only for the names of the rows and as a
tie-break between equally consistent placements of blank cells. It is not trusted for numbers: it filed whole tables
under the wrong year for several budgets (see program_budget_pdf). What may be PUBLISHED is decided here:

  * a cell is accepted when its nine figures satisfy the four identities of the table (consolidated = departmental +
    administered, and each of the three "total = PRB + other") and its blank cells could be placed without doubt
    (program_budget_pdf.resolve_row, else the frozen input cell with the same non-zero figures);
  * a budget gets published programs ("real") only when, for 2026, the PRB total (column "consolidated, PRB budget")
    is present, the policies add up to it and every policy's programs add up to the policy, tolerance 0.06 per
    printed decimal; and it either equals the law's expenditure (tier "validated") or differs from it while being
    internally consistent (tier "program-budget-differs", shown with the difference);
  * everything else is "pending" (P03) with a reason built from the facts, and NO numbers.

Per-year completeness (`yearsComplete`) is computed here. Names are cleaned of the wrappers and stray table text of
the PDF extraction; garbled names (stray single letters) are repaired from the law's policy names or fixed by hand in
NAME_FIXES (each fix checked against the source text).
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import re

import budget_pipeline.build.program_budget_pdf as pdf
from budget_pipeline.build.definitions import EBK_ART
from budget_pipeline.build.data_io import isnum, rnd

SRC_YEARS = ["Отчет 2023", "Отчет 2024", "Закон 2025", "Проект 2026", "Прогноза 2027", "Прогноза 2028"]
YEARS = [2023, 2024, 2025, 2026, 2027, 2028]
VINTAGE = ["actual", "actual", "plan", "plan", "forecast", "forecast"]
COLS = ["cons_total", "cons_prb", "cons_other", "dept_total", "dept_prb", "dept_other", "adm_total", "adm_prb",
        "adm_other"]
COLS_OUT = ["consTotal", "consPrb", "consOther", "deptTotal", "deptPrb", "deptOther", "admTotal", "admPrb", "admOther"]
Y26, Y25 = "Проект 2026", "Закон 2025"
TOL_PER_ROW = 0.06            # one printed decimal is rounded to +-0.05
TOL_CELL = 0.15
TOL_POLICY = 0.15            # a policy's printed total vs the sum of its rounded rows in the law

# hand fixes of garbled names (code -> clean name); filled after inspecting the scan in tmp/ (see _suspects()).
NAME_FIXES = {}

_QUOTES_OPEN = "„"
_QUOTES_ANY = "\"'„“”‘’«»`"


def classify(code, key, name):
    """total | policy | program for a key of `programs` in the frozen input file."""
    if key == "total" or key.endswith(".00.00"):
        return "total"
    if key.endswith(".00"):
        return "program" if re.match(r"(?i)бюджетна програма", name.strip()) else "policy"
    return "program"


def _normalise_quotes(s):
    """Quote characters of every kind -> „…“ pairs; stray unbalanced ones are dropped/closed."""
    out, depth = [], 0
    for ch in s:
        if ch == "„":
            out.append("„")
            depth += 1
        elif ch in "\"“”«»":
            if depth > 0:
                out.append("“")
                depth -= 1
            elif ch in "\"“«":
                out.append("„")
                depth += 1
            # a closing quote with nothing open: dropped
        elif ch in "'`‘’":
            continue
        else:
            out.append(ch)
    if depth > 0:
        out.append("“")
    return "".join(out)


_CUT_RE = re.compile(
    r"\s(?:\d{4}\.\d{2}\.\d{2}\b|Код\s*\*|Консолидирани разходи|ОБЛАСТИ НА\b|\d{1,3}(?: \d{3})*,\d(?:\s|$)|0, 0\b)")
_NEXT_RE = re.compile(r"\s(?=(?:Бюджетна програма|Политика в областта|Област на политика|Функционална област)\b)")
_PREFIX_RE = re.compile(
    r"^(?:Код\s*\*?\s*\d{4}\.\d{2}\.\d{2}\W*)?"
    r"(?:Бюджетна програма|Област на политика\s*/\s*функционална област|Функционална област|Област на политика|Област)\s*",
    re.I)


_TRAIL_NUM_RE = re.compile(r"\s+\d{1,3}(?:[ ,]\d{1,3})*$")
_DUP_RE = re.compile(r"^(.{6,}?)\s+\1$", re.I)


def _strip_outer_quotes(s):
    if len(s) > 2 and s[0] == "„" and s[-1] == "“" and "„" not in s[1:-1] and "“" not in s[1:-1]:
        return s[1:-1]
    return s


def clean_name(raw):
    s = re.sub(r"\s+", " ", raw or "").strip()
    m = _CUT_RE.search(s)
    if m:
        s = s[:m.start()]
    # an absorbed following title ("... Бюджетна програма ...") after at least a few words
    m = _NEXT_RE.search(s, 12)
    if m:
        s = s[:m.start()]
    s = _PREFIX_RE.sub("", s, count=1).strip()
    s = _normalise_quotes(s)
    s = re.sub(r"„\s*“", "", s)                  # an empty quote pair left by a reversed pair in the source ("Държавна охрана„“")
    s = re.sub(r"[\s.,;:–-]+$", "", s)
    s = re.sub(r"^[\s.,;:–-]+", "", s)
    s = _TRAIL_NUM_RE.sub("", s)               # money columns absorbed at the end ("... 0", "... 12 3")
    m = _DUP_RE.match(s)                       # "Други бюджетни програми Други бюджетни програми"
    if m:
        s = m.group(1)
    s = _strip_outer_quotes(s)
    s = re.sub(r"[\s.,;:–-]+$", "", s)
    s = re.sub(r"^[\s.,;:–-]+", "", s)          # a leading space can be left behind by the quote handling
    letters = [c for c in s if c.isalpha()]
    long_caps = [t for t in re.findall(r"[^\W\d_]+", s) if len(t) >= 7 and t.isupper()]
    if letters and long_caps and sum(c.isupper() for c in letters) / len(letters) > 0.85 and len(letters) > 8:
        s = s.lower()
    if s:
        s = s[0].upper() + s[1:]
    return s


def law_policy_name(raw):
    """A policy name as printed in the ЗДБ distribution table, without the wrapper words and the table suffix."""
    s = re.sub(r"\s+", " ", raw or "").strip()
    s = re.sub(r"\s*\(общо\),?\s*в т\.ч\.:?$", "", s)
    s = re.sub(r"^(?:Функционална област|Област на политика|Област|Бюджетна програма)\s+", "", s)
    s = _normalise_quotes(s)
    s = _strip_outer_quotes(s)
    return s.strip(" .,;:")


_LONE_OK = set("вскиоаууяеж")      # real one-letter Bulgarian words (в, с, и, к ...)


def suspect(name):
    """True when a cleaned name still looks garbled (stray single letters, digits, Latin/Cyrillic mix, too long)."""
    toks = re.findall(r"[^\W\d_]+", name)
    for t in toks:
        if len(t) == 1 and t.lower() not in "вси":
            return True
    if re.search(r"\d", name):
        return True
    if re.search(r"[A-Za-z]", name) and re.search(r"[а-яА-Я]", name):
        return True
    return len(name) > 230 or len(name) < 6


# ------------------------------------------------------------------------------------------------ loader
TOL_LAW = 0.11                 # a PRB total and the law's figure are both printed to 0.1 -> at most 0.1 apart

REASONS = {
    "format": "Таблиците на документа са в нестандартен формат (липсват кодове на програмите или кодовете и числата са пренесени на нов "
              "ред) и още не са разчетени.",
    "year": "Таблицата с програмите в документа няма разпознаваема година и затова не можа да се разчете.",
    "sums": "Числата в таблиците на документа не дават очакваните сборове при разчитането им и затова не се показват.",
    "source-sums": "Сборовете в таблицата на самия документ не излизат (вероятна грешка в документа) и затова програмите не се "
                   "показват, докато не бъдат проверени.",
    "no-total": "Разчитането на таблицата за бюджетната година не даде общ ред, който да се сверти със закона.",
    "missing-policies": "Таблицата за бюджетната година е разчетена непълно: част от политиките липсват и сборът им не дава общата сума на бюджета.",
    "missing-programs": "Таблицата за бюджетната година е разчетена непълно: част от програмите липсват и сборът им не дава сумата на политиката.",
    "no-rows": "В документа не бяха намерени политики и програми за бюджетната година.",
}


def _tol(n):
    return TOL_PER_ROW * (n + 1)


def _cell(row, ylabel):
    """The nine values of a row for one year as a dict, or None when absent, incomplete or breaking an identity."""
    c = ((row or {}).get("by_year") or {}).get(ylabel)
    if not c or not all(isnum(c.get(k)) for k in COLS):
        return None
    if (abs(c["cons_total"] - c["cons_prb"] - c["cons_other"]) > TOL_CELL
            or abs(c["dept_total"] - c["dept_prb"] - c["dept_other"]) > TOL_CELL
            or abs(c["adm_total"] - c["adm_prb"] - c["adm_other"]) > TOL_CELL
            or abs(c["cons_total"] - c["dept_total"] - c["adm_total"]) > TOL_CELL):
        return None
    return c


def _structure(code, progs):
    """Rows of one budget -> (total_row, top_rows, kids_by_policy_number, foreign_keys, orphan_numbers).

    top_rows = [(key, kind, row)] with kind policy|program (standalone program), in code order."""
    total = progs.get(code + ".00.00") or progs.get("total")
    top, kids, foreign = [], {}, []
    for key in sorted(k for k in progs if k != "total"):
        if not key.startswith(code + "."):
            foreign.append(key)
            continue
        row = progs[key]
        kind = classify(code, key, row.get("name", ""))
        if kind == "total":
            continue
        nn = key.split(".")[1]
        if key.endswith(".00"):
            top.append((key, kind, row))
        else:
            kids.setdefault(nn, []).append((key, row))
    have = {key.split(".")[1] for key, _, _ in top}
    orphans = sorted(set(kids) - have)
    return total, top, kids, foreign, orphans


def _sums_ok(parent, children, ylabel, cols):
    """children's cells add up to the parent's cell in every column of `cols`; None when a cell is missing."""
    p = _cell(parent, ylabel)
    if p is None:
        return None
    acc = {k: 0.0 for k in cols}
    for ch in children:
        c = _cell(ch, ylabel)
        if c is None:
            return None
        for k in cols:
            acc[k] += c[k]
    return all(abs(acc[k] - p[k]) <= _tol(len(children)) for k in cols)


def _present(row, ylabel):
    return bool(((row or {}).get("by_year") or {}).get(ylabel))


def year_struct(struct, ylabel):
    """The rows of one year: (total, top, kids_by_policy_number, orphan_numbers) keeping only the rows that have a cell
    in that year. A policy or programme can legitimately exist in some years only (a discontinued or new policy);
    a row that was not read is also absent here, but then the sums of its parent do not add up."""
    total, top, kids, _foreign, _orphans = struct
    top_y = [(k, kind, r) for k, kind, r in top if _present(r, ylabel)]
    kids_y = {nn: [(k, r) for k, r in ch if _present(r, ylabel)] for nn, ch in kids.items()}
    kids_y = {nn: ch for nn, ch in kids_y.items() if ch}
    have = {k.split(".")[1] for k, _, _ in top_y}
    return total, top_y, kids_y, sorted(set(kids_y) - have)


def _all_zero(c):
    return c is not None and all(abs(c[k]) < 0.05 for k in COLS)


def year_complete(struct, ylabel, cols=COLS):
    """True when, for this year, the total, every policy and every program of the budget are present, consistent with
    the identities and add up: policies -> total and programs -> policy (all columns of `cols`)."""
    total, top, kids, orphans = year_struct(struct, ylabel)
    if total is None or not top or orphans:
        return False
    if _sums_ok(total, [row for _, _, row in top], ylabel, cols) is not True:
        return False
    union_kids = struct[2]
    for key, kind, row in top:
        nn = key.split(".")[1]
        ch = kids.get(nn, [])
        if kind == "policy" and ch and _sums_ok(row, [r for _, r in ch], ylabel, cols) is not True:
            return False
        if kind == "policy" and not ch and union_kids.get(nn) and not _all_zero(_cell(row, ylabel)):
            return False                                   # the policy has programmes in other years but none were read now
        if kind == "program" and ch:
            return False                                   # a standalone program must not have children
    return True


def _diagnose(struct):
    """Reason key of a budget whose 2026 table cannot be published."""
    if struct is None:
        return "no-rows"
    total, top, kids, orphans = year_struct(struct, Y26)
    if _cell(total, Y26) is None:
        return "no-total"
    if not top or orphans or _sums_ok(total, [r for _, _, r in top], Y26, ["cons_prb"]) is not True:
        return "missing-policies"
    return "missing-programs"


def _not_parsed_kind(msg):
    """Reason key of a document the frozen input extraction could not read at all (0100 and 2300 have a text layer, but their
    tables carry no programme codes / wrap codes and numbers; checked page by page)."""
    if msg.startswith("няма таблици"):
        return "format"
    if "без разпозната година" in msg:
        return "year"
    return "sums"


def _values(row, years_ok_labels=None):
    out = {}
    for ylabel, y in zip(SRC_YEARS, YEARS):
        c = _cell(row, ylabel)
        if c is not None:
            out[str(y)] = [rnd(c[k], 1) for k in COLS]
    return out


def _law_names(law_rec):
    """({policy number: cleaned law name}, {policy number: True when the law calls it a budget programme},
    {(policy number, programme number): (cleaned name, khil)}, {policy number: khil}) from the ЗДБ distribution
    table of one budget."""
    names, is_prog, parts, khils = {}, {}, {}, {}
    for q in law_rec.get("policies") or []:
        if not str(q["n"]).isdigit():
            continue
        n = int(q["n"])
        names[n] = law_policy_name(q["name"])
        is_prog[n] = bool(re.match(r"(?i)бюджетна програма", q["name"].strip()))
        if isnum(q.get("khil")):
            khils[n] = q["khil"]
        for pt in q.get("parts") or []:
            m = re.match(r"^(\d+)\.(\d+)$", str(pt.get("n", "")))
            if m and int(m.group(1)) == n and isnum(pt.get("khil")):
                parts[(n, int(m.group(2)))] = (law_policy_name(pt["name"]), pt["khil"])
    return names, is_prog, parts, khils


def _json_pick(code, jprogs, key, cell):
    """Tie-break for a row whose blank cells could be placed in several consistent ways: the frozen input's cell of the
    same row (any year label) when it is one of the candidates and the only one."""
    row = jprogs.get(key)
    if key == "total":
        row = jprogs.get("total") or jprogs.get(code + ".00.00")
    if not row:
        return None
    cands = {tuple(round(x, 1) for x in c) for c in cell["cands"]}
    hits = set()
    for c in (row.get("by_year") or {}).values():
        if c and all(isnum(c.get(k)) for k in COLS):
            v = tuple(round(c[k], 1) for k in COLS)
            if v in cands:
                hits.add(v)
    return list(next(iter(hits))) if len(hits) == 1 else None


def _verified_view(code, b, filename):
    """The program budget of one document as read from its PDF.

    -> {"programs": {key: {"name", "by_year": {label: {col: value}}}}, "pagesByYear": {year: [pages]},
        "unresolved": [(label, key)], "methods": {method: count}, "badLabels": {year labels with a cell that breaks the
        identities in every placement}}
    `programs` has the shape of the frozen input file, so the structure checks below work on either."""
    rows, _pages = pdf.read_rows(filename)
    cells, conflicts = pdf.cells_of(rows)
    pdf.resolve_by_structure(cells)
    jprogs = (b or {}).get("programs") or {}
    pdf_names = pdf.program_names(filename)
    progs, by_label, unresolved, methods, bad_labels = {}, {}, [], {}, set()
    name_fills = []
    for (label, key), cell in sorted(cells.items(), key=lambda kv: (SRC_YEARS.index(kv[0][0]) if kv[0][0] in SRC_YEARS else 99, kv[0][1])):
        vec, method = cell["values"], cell["method"]
        if vec is None and method == "ambiguous":
            vec = _json_pick(code, jprogs, key, cell)
            method = "prototype" if vec is not None else method
        methods[method] = methods.get(method, 0) + 1
        if vec is None:
            unresolved.append((label, key))
            if method == "bad":
                bad_labels.add(label)                # no placement of the figures satisfies the identities: the source is inconsistent
            continue
        jr = jprogs.get(key) if key != "total" else (jprogs.get("total") or jprogs.get(code + ".00.00"))
        raw_name = (jr or {}).get("name") or ""
        if key != "total" and not key.endswith(".00"):
            cn = clean_name(raw_name)
            if not cn or suspect(cn):
                # the frozen input file has no usable name (empty, or the column header "Код"): read it from the PDF headings
                alt = next((c for c in pdf_names.get(key, []) if clean_name(c) and not suspect(clean_name(c))), "")
                if alt:
                    raw_name = alt
                    name_fills.append(key)
        row = progs.setdefault(key, {"name": raw_name or ("Общо разходи" if key == "total" else ""), "by_year": {}})
        row["by_year"][label] = {k: round(v, 1) for k, v in zip(COLS, vec)}
        by_label.setdefault(label, set()).update(cell["pages"])
    for key in conflicts:
        unresolved.append(key)
    pages_by_year = {str(y): sorted(by_label[lbl]) for lbl, y in zip(SRC_YEARS, YEARS) if by_label.get(lbl)}
    return {"programs": progs, "pagesByYear": pages_by_year, "unresolved": unresolved, "methods": methods, "badLabels": bad_labels,
            "nameFills": sorted(set(name_fills))}


def load(ctx):
    """All 46 budgets -> {code: record}; see the module docstring for the publication rules.

    record keys: code, art, lawExpKhil, tier (validated|program-budget-differs|pending), reasonKey/reason (pending),
    file, pagesByYear, pages, yearsComplete (list of years), exp2025Khil (when 2025 is consistent), skipped,
    and for published budgets: total{years->[9]}, policies[{code,name,kind,values,programs[{code,name,values}]}],
    policyCount, programCount, check{...}, programBudgetVsLaw (tier differs)."""
    src = ctx.src("program_budgets_2026")
    law = ctx.law["law"]
    budgets, not_parsed = src["budgets"], src["not_parsed"]
    np_by_code = {fn[:4]: (fn, msg) for fn, msg in not_parsed.items()}
    recs = {}
    for code in sorted(EBK_ART):
        art = EBK_ART[code]
        L = law[str(art)]
        law_exp = L["headline"].get("exp")
        rec = {"code": code, "art": art, "lawExpKhil": law_exp, "yearsComplete": [], "skipped": []}
        b = budgets.get(code)
        fn, msg = (b["file"], None) if b is not None else np_by_code[code]
        view = _verified_view(code, b, fn)
        rec["file"] = fn
        fills = [k for k in view["nameFills"] if k.startswith(code + ".")]       # not the foreign-coded rows that are skipped
        if fills:
            ctx.notes.append("program names read from the PDF headings (the prototype file had none): %s" % ", ".join(fills))
        if not view["programs"]:
            rk = _not_parsed_kind(msg) if msg else "no-rows"
            rec.update(tier="pending", reasonKey=rk, reason=REASONS[rk])
            recs[code] = rec
            continue
        rec["pagesByYear"] = view["pagesByYear"]
        rec["pages"] = sorted({p for v in rec["pagesByYear"].values() for p in v})
        rec["readMethods"] = view["methods"]
        rec["skipped"] = ["Ред „%s“ за %s не можа да се разчете със сигурност и не се показва." % (
            "общо" if k == "total" else k, lbl.split()[-1]) for lbl, k in view["unresolved"]]
        struct = _structure(code, view["programs"])
        total, top, kids, foreign, orphans = struct
        if foreign:
            rec["skipped"].append("Редове с чужди кодове в таблицата (%s) са пропуснати." % ", ".join(foreign))
        rec["yearsComplete"] = [y for lbl, y in zip(SRC_YEARS, YEARS) if year_complete(struct, lbl)]
        # last year's total is usable on its own when that year is consistent
        if 2025 in rec["yearsComplete"]:
            rec["exp2025Khil"] = rnd(_cell(total, Y25)["cons_prb"], 1)
        if 2026 not in rec["yearsComplete"]:
            if Y26 in view["badLabels"]:
                rk = "source-sums"                         # a printed row of the budget year breaks the identities in every placement
            elif msg:
                rk = _not_parsed_kind(msg)                 # the frozen input found no table either: the layout is the cause
            else:
                rk = _diagnose(struct)
            rec.update(tier="pending", reasonKey=rk, reason=REASONS[rk])
            rec["skipped"] = []
            recs[code] = rec
            continue

        t26 = _cell(total, Y26)
        diff = rnd(law_exp - t26["cons_prb"], 1) if law_exp is not None else None
        matches = diff is not None and abs(diff) <= TOL_LAW
        rec["tier"] = "validated" if matches else "program-budget-differs"
        rec["check"] = {"prbTotal2026": rnd(t26["cons_prb"], 1), "lawExp": law_exp, "matchesLaw": bool(matches),
                        "policiesSumToTotal": True, "programsSumToPolicies": True}
        if not matches:
            bill_exp = (((ctx.law.get("bill") or {}).get(str(art)) or {}).get("headline") or {}).get("exp")
            rec["programBudgetVsLaw"] = {"prbKhil": rnd(t26["cons_prb"], 1), "lawKhil": law_exp, "diffKhil": diff}
            if isnum(bill_exp):
                rec["programBudgetVsLaw"]["billKhil"] = bill_exp
                rec["programBudgetVsLaw"]["matchesBill"] = abs(bill_exp - t26["cons_prb"]) <= TOL_LAW
        lnames, lprog, lparts, lkhil = _law_names(L)
        rec["total"] = _values(total)

        def prog_name(k, r):
            """The programme's name: the law's wording when the law lists it with the same 2026 amount (the PDF
            tables abbreviate some), else the cleaned name from the PDF."""
            pn, mn = (int(x) for x in k.split(".")[1:])
            lp = lparts.get((pn, mn))
            c26 = _cell(r, Y26)
            if lp and c26 and abs(lp[1] - c26["cons_prb"]) <= TOL_PER_ROW:
                return lp[0]
            return clean_name(r["name"])

        amounts = {}
        for k, _kind, r in top:
            c = _cell(r, Y26)
            if c:
                amounts[k] = c["cons_prb"]

        def policy_name(key, r):
            """The name of a top-level row. The law's wording when the law's row of the same number carries the same
            2026 amount; else the cleaned name from the PDF; else the law's row of that number, unless that row is
            demonstrably another PRB row (same amount: in the Ministry of Finance the law's 5th row is the PDF's
            6th, "Администрация") - then the label printed in the PDF table row."""
            n = int(key.split(".")[1])
            own = clean_name(r["name"])
            c26 = _cell(r, Y26)
            ln, lk = lnames.get(n), lkhil.get(n)
            if ln and c26 and isnum(lk) and abs(lk - c26["cons_prb"]) <= TOL_POLICY:
                return ln
            if own and not suspect(own):
                return own
            if ln and isnum(lk) and any(k != key and abs(lk - a) <= TOL_POLICY for k, a in amounts.items()):
                for cand in pdf.row_labels(fn).get(key, []):
                    cand = clean_name(cand)
                    if cand and not suspect(cand):
                        return cand
            return ln or own

        pols = []
        for key, kind, row in top:
            nn = key.split(".")[1]
            if kind == "policy" and not kids.get(nn) and lprog.get(int(nn)):
                kind = "program"                          # the law prints it as "Бюджетна програма", the PDF did not
            name = NAME_FIXES.get(key) or policy_name(key, row)
            pol = {"code": key, "name": name, "kind": kind, "values": _values(row)}
            if kind == "policy" and kids.get(nn):
                pol["programs"] = [{"code": k, "name": NAME_FIXES.get(k) or prog_name(k, r), "values": _values(r)}
                                   for k, r in kids[nn]]
            pols.append(pol)
        rec["policies"] = pols
        rec["policyCount"] = sum(1 for p in pols if p["kind"] == "policy")
        rec["programCount"] = sum(len(p.get("programs", [])) for p in pols) + sum(1 for p in pols if p["kind"] == "program")
        recs[code] = rec
    return recs


def summary(recs):
    """Counts by tier (for build notes and tests)."""
    out = {}
    for r in recs.values():
        out.setdefault(r["tier"], []).append(r["code"])
    return out
