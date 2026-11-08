"""law.json (D10 + D11): the state budget bill as submitted (01.07.2026) against the adopted law (ДВ бр. 69 от 31.07.2026), plus the
legislative path of the three budget laws.

Inputs (no network at build time):
  * data/cache/law_bill.json (bill.py): art. 1-47 of the bill (docx) and of the law (Държавен вестник HTML) with the
    line-by-line diff of the five articles that differ (1, 2, 3, 16, 17).
  * data/originals/parliament/bill_16715{5,6,7}.json: dates of the reports, readings and proposals. The proposers' names in these
    files are never read; only document numbers, dates and file names.
  * data/originals/dv/*.html: gazette issue, decree and entry-into-force clauses of the three laws.
  * the Ministry of Finance motives (data/originals/asbp/UMTBF-2026-2028-motivi.pdf, pp. 5-7): the pre-history (decisions of the
    Council of Ministers, the extension law). Those facts are typed in below with the page they come from.

The build fails when: the two versions of art. 1 do not line up row by row; the changed rows are not exactly the rows of the diff; the
differences of the four changed budgets do not add up to the difference of art. 1 (revenue, expenditure, balance); the identity
revenue - expenditure - transfers - EU contribution = balance fails in either version; the 46 budgets do not add up to the totals the
extraction printed; a number in this file differs from ministries.json; the parliament files disagree with the dates typed here.
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import ast
import re
from collections import Counter

import budget_pipeline.extract.budget_law_parser as budget_law_parser
from budget_pipeline.build.definitions import ART_EBK, BUDGET_INFO, SOURCES, fmt_khil, nominative
from budget_pipeline.build.data_io import RAW, isnum, meta, rnd

TOL = 0.051                      # one printed decimal
ART_FIRST, ART_LAST = 2, 47      # ЗДБ чл. 2-47: 46 budgets
MONTHS = {"януари": 1, "февруари": 2, "март": 3, "април": 4, "май": 5, "юни": 6, "юли": 7, "август": 8, "септември": 9,
          "октомври": 10, "ноември": 11, "декември": 12}
MONTH_NAMES = {v: k for k, v in MONTHS.items()}
MOTIVES = "Мотиви към законопроекта (АСБП 2026–2028), стр. "

# law key -> (parliament bill id, DV file, short label, source key)
LAWS = {
    "zdb": (167157, "zdb2026_dv69_idMat245041.html", "ЗДБ", "zdb"),
    "zbdoo": (167156, "zbdoo2026_dv68_idMat244982.html", "ЗБДОО", "zbdoo"),
    "zbnzok": (167155, "zbnzok2026_dv68_idMat244981.html", "ЗБНЗОК", "zbnzok"),
}
BILL_PAGE = "https://www.parliament.bg/bg/bills/ID/%d"
# opinions the parliament lists twice (A_Cm_Stanid of the copy -> of the first entry): counted once. 24023 is the НСОРБ opinion of
# 08.07.2026 to the Комисия по регионална политика, благоустройство и местно самоуправление; it appeared between 23.10 and 04.11.2026
# next to 22976, with the same committee, date, stage and author. Two entries that only look alike (23150 and 23151 of the Комисия по
# бюджет и финанси, 21.07.2026) are not merged: they may be opinions on two proposals.
DUPLICATE_OPINIONS = {24023: 22976}
FILES_URL = "https://www.parliament.bg/bills/52/"
AREA_SUFFIX = re.compile(r"[,\s]*(?:в\s*)?т\.\s*ч\.:?\s*$")

KINDS = {   # timeline kind -> short Bulgarian label
    "procedure": "Бюджетна процедура", "bill": "Законопроект", "extension-law": "Удължителен закон", "politics": "Избори и правителство",
    "submitted": "Внасяне", "committees": "Комисии", "plenary-1": "Първо гласуване", "proposals": "Предложения",
    "committee-2": "Доклад за второ гласуване", "plenary-2": "Второ гласуване", "adopted": "Приемане", "gazette": "Държавен вестник",
    "execution": "Изпълнение",
}


# ----------------------------------------------------------------------------------------------------- small helpers
def _diff(b, l):
    return rnd(l - b, 1) if isnum(b) and isnum(l) else None


def _pair(b, l):
    return {"bill": b, "law": l, "diff": _diff(b, l)}


def _fold(s):
    """Text key that ignores spaces, dashes and punctuation (the law HTML runs some words together)."""
    return re.sub(r"[\W_]+", "", s.lower())


def _dash(s):
    return re.sub(r"(^|\s)-\s", lambda m: m.group(1) + "– ", s)


def _sgn(v):
    """A signed difference: the plus sign is explicit."""
    return ("+" if v > 0 else "") + fmt_khil(v)


def _more(v):
    return "повече" if v > 0 else "по-малко"


def _iso(d, m, y):
    mo = int(m) if str(m).isdigit() else MONTHS[m]
    return "%04d-%02d-%02d" % (int(y), mo, int(d))


def _and_list(items):
    """'a', 'a и b', 'a, b и c'."""
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " и " + items[-1]


def _dtext(date=None, to=None, month=None):
    """Bulgarian display text of a date, a range or a month."""
    if month:
        y, m = month.split("-")
        return "%s %s г." % (MONTH_NAMES[int(m)], y)
    y, m, d = (int(x) for x in date.split("-"))
    if not to:
        return "%d %s %d г." % (d, MONTH_NAMES[m], y)
    y2, m2, d2 = (int(x) for x in to.split("-"))
    if (y, m) == (y2, m2):
        return "%d–%d %s %d г." % (d, d2, MONTH_NAMES[m], y)
    return "%d %s – %d %s %d г." % (d, MONTH_NAMES[m], d2, MONTH_NAMES[m2], y2)


# ----------------------------------------------------------------------------------------------------- art. 1
def _rn(no):
    """The printed Roman numerals mix Latin and Cyrillic letters ('V' + Cyrillic 'І'); published as plain Latin so that a search or a sort finds them."""
    if re.fullmatch(r"[IVXІХ]+\.?", no.strip()):
        return no.replace("І", "I").replace("Х", "X")
    return no


def _level(sec, no, prev):
    if not no:
        return prev + 1
    return 0 if _fold(no) == _fold(sec) else len(no.split("."))


def _art1(L):
    bl, ll = L["bill"]["1"]["lines"], L["law"]["1"]["lines"]
    if len(bl) != len(ll):
        raise ValueError("art. 1 has %d lines in the bill and %d in the law" % (len(bl), len(ll)))
    lines, prev, changed = [], 0, []
    for i, (b, l) in enumerate(zip(bl, ll)):
        if (b[0], b[1]) != (l[0], l[1]) or _fold(b[2]) != _fold(l[2]):
            raise ValueError("art. 1 line %d differs in numbering or text: %r / %r" % (i + 1, b[:3], l[:3]))
        header = b[3] is None and l[3] is None
        lv = _level(b[0], b[1], prev)
        prev = lv
        d = _diff(b[3], l[3])
        row = {"id": "a1.%02d" % (i + 1), "sec": b[0], "no": _rn(b[1]), "level": lv, "text": _dash(b[2]).strip()}
        if header:
            row["header"] = True
        else:
            row.update({"bill": b[3], "law": l[3], "diff": d, "changed": d is not None and abs(d) > TOL})
        if row.get("changed"):
            changed.append((b[0], b[1]))
        lines.append(row)
    want = sorted((x["sec"], x["no"]) for x in L["diff"]["1"]["lines"])
    if sorted(changed) != want:
        raise ValueError("art. 1: the changed rows differ from the rows of the diff: %r vs %r" % (sorted(changed), want))
    head = {}
    for k in ("rev", "exp", "transfers", "eucontrib", "balance", "financing"):
        head[k] = _pair(L["bill"]["1"]["headline"][k], L["law"]["1"]["headline"][k])
    for v in ("bill", "law"):
        h = {k: head[k][v] for k in head}
        if abs(h["rev"] - h["exp"] - h["transfers"] - h["eucontrib"] - h["balance"]) > TOL or abs(h["financing"] + h["balance"]) > TOL:
            raise ValueError("art. 1 (%s): revenue - expenditure - transfers - EU contribution != balance" % v)
    return {"unit": "хил. €", "title": "Чл. 1: държавният бюджет", "headline": head, "lines": lines}


# ----------------------------------------------------------------------------------------------------- the 46 budgets
def _budget_rows(ctx, L):
    mins = {m["art"]: m for m in (ctx.get("ministries.json") or {}).get("items", [])}
    rows = []
    for art in range(ART_FIRST, ART_LAST + 1):
        eid = ART_EBK[art]
        b, l = L["bill"][str(art)], L["law"][str(art)]
        short, kind = BUDGET_INFO[eid]
        m = mins.get(art)
        name = m["name"] if m else nominative(l["name"])
        ops = Counter(x["op"] for x in L["diff"].get(str(art), {}).get("lines", []))
        pairs = {k: _pair(b["headline"].get(k), l["headline"].get(k)) for k in ("rev", "exp", "transfers")}
        row = {"art": art, "id": eid, "name": name, "short": short, "kind": kind,
               "bill": {k: pairs[k]["bill"] for k in pairs}, "law": {k: pairs[k]["law"] for k in pairs},
               "diff": {k: pairs[k]["diff"] for k in pairs},
               "changed": str(art) in L["diff"], "lines": {"chg": ops["chg"], "add": ops["add"], "del": ops["del"]}}
        if m:   # the same numbers live in ministries.json: they must agree
            bvl = m.get("billVsLaw") or {}
            for k, key in (("rev", "revKhil"), ("exp", "expKhil"), ("transfers", "transfersKhil")):
                got = bvl.get(key)
                if got and (got["bill"], got["law"]) != (pairs[k]["bill"], pairs[k]["law"]):
                    raise ValueError("art. %d %s differs from ministries.json: %r vs %r" % (art, k, got, pairs[k]))
                if not got and pairs[k]["diff"]:
                    raise ValueError("art. %d %s differs between bill and law but ministries.json shows no difference" % (art, k))
                if m.get(key) is not None and m[key] != pairs[k]["law"]:
                    raise ValueError("art. %d %s: law value %r differs from ministries.json %r" % (art, k, pairs[k]["law"], m[key]))
        rows.append(row)
    return rows


def _totals(rows, L):
    out = {"count": len(rows)}
    for v in ("bill", "law"):
        out[v] = {k: rnd(sum(r[v][k] for r in rows if isnum(r[v][k])), 1) for k in ("rev", "exp")}
    out["diff"] = {k: rnd(out["law"][k] - out["bill"][k], 1) for k in ("rev", "exp")}
    sums = L["sums"]
    if len(rows) != sums["budgets"] or abs(out["law"]["exp"] - sums["expKhil"]) > TOL or abs(out["law"]["rev"] - sums["revKhil"]) > TOL:
        raise ValueError("the 46 budgets do not add up to the extracted totals: %r vs %r" % (out["law"], sums))
    return out


# ----------------------------------------------------------------------------------------------------- the changed budgets
COMMIT_LABELS = {
    "entered": "Максимален размер на ангажиментите за разходи, които могат да бъдат поети през 2026 г.",
    "new": "Максимален размер на новите задължения за разходи, които могат да бъдат натрупани през 2026 г.",
}


def _areas(b, l):
    bm, lm = {p["n"]: p for p in b["policies"]}, {p["n"]: p for p in l["policies"]}
    if list(bm) != list(lm):
        raise ValueError("policy numbers differ: %r vs %r" % (list(bm), list(lm)))
    items = []
    for n, p in lm.items():
        name = AREA_SUFFIX.sub("", p["name"]).strip()
        if _fold(AREA_SUFFIX.sub("", bm[n]["name"])) != _fold(name):
            raise ValueError("policy %s is named differently: %r / %r" % (n, bm[n]["name"], p["name"]))
        items.append({"n": n, "name": name, **_pair(bm[n]["khil"], p["khil"])})
    return items


def _bodies(b, l):
    bm, lm = {x["name"]: x["khil"] for x in b["bodies"]}, {x["name"]: x["khil"] for x in l["bodies"]}
    if list(bm) != list(lm):
        raise ValueError("bodies differ: %r vs %r" % (list(bm), list(lm)))
    return [{"name": n, **_pair(bm[n], lm[n])} for n in lm]


def _line(L, art, sec, no, which="law"):
    for x in L[which][str(art)]["lines"]:
        if x[0] == sec and x[1] == no:
            return x[3]
    raise KeyError((art, sec, no))


def _change(L, art, name, eid, headline=None):
    d = L["diff"][str(art)]
    b, l = L["bill"][str(art)], L["law"][str(art)]
    out = {"art": art, "id": eid, "name": name}
    if headline is None:
        headline = {k: _pair(b["headline"].get(k), l["headline"].get(k)) for k in ("rev", "exp", "transfers", "balance", "financing")
                    if b["headline"].get(k) is not None or l["headline"].get(k) is not None}
    out["headline"] = headline
    out["lines"] = [{"op": x["op"], "sec": x["sec"], "no": _rn(x["no"]), "text": _dash(x["text"]).strip(), "bill": x.get("bill"),
                     "law": x.get("law"), "diff": _diff(x.get("bill"), x.get("law"))} for x in d["lines"]]
    if "policies" in d:
        out["areas"] = _areas(b, l)
        if any(p.get("parts") for p in b["policies"]) and not any(p.get("parts") for p in l["policies"]):
            out["areasNote"] = ("В законопроекта разпределението е по бюджетни програми във всяка област; в закона са посочени само "
                                "функционалните области.")
    if "bodies" in d:
        out["bodies"] = _bodies(b, l)
    if "commitments" in d:
        out["commitments"] = [{"key": k, "label": COMMIT_LABELS[k], **_pair(b["commitments"][k], l["commitments"][k])}
                              for k in ("entered", "new")]
    return out


def _changes(L, rows):
    names = {r["art"]: (r["name"], r["id"]) for r in rows}
    out, rec = [], []
    for art in (2, 3, 16, 17):
        ch = _change(L, art, *names[art])
        h = ch["headline"]
        rec.append({"art": art, "name": names[art][0], "rev": (h.get("rev") or {}).get("diff") or 0.0,
                    "exp": (h.get("exp") or {}).get("diff") or 0.0})
        out.append(ch)
    h1 = {k: _pair(L["bill"]["1"]["headline"][k], L["law"]["1"]["headline"][k]) for k in ("rev", "exp", "balance", "financing")}
    s = {k: rnd(sum(r[k] for r in rec), 1) for k in ("rev", "exp")}
    s["balance"] = rnd(s["rev"] - s["exp"], 1)
    a1 = {k: h1[k]["diff"] for k in ("rev", "exp", "balance")}
    if any(abs(s[k] - a1[k]) > TOL for k in s):
        raise ValueError("the changes of art. 2, 3, 16, 17 (%r) do not add up to the change of art. 1 (%r)" % (s, a1))
    out.insert(0, _change(L, 1, "Държавен бюджет", "state", headline=h1))
    return out, {"unit": "хил. €", "rows": [r for r in rec if r["rev"] or r["exp"]], "sum": s, "art1": a1, "ok": True}


def _cl(ch, sec, no):
    """The diff line (sec, no) of one change."""
    for x in ch["lines"]:
        if (x["sec"], x["no"]) == (sec, no):
            return x
    raise KeyError((ch["art"], sec, no))


def _notes(L, changes, rec, art1):
    """Plain-language notes built from the computed numbers (every figure comes from the data above; the asserts keep the wording true)."""
    by = {c["art"]: c for c in changes}
    h1 = by[1]["headline"]
    r, e, bal = h1["rev"]["diff"], h1["exp"]["diff"], h1["balance"]["diff"]
    rd = {x["art"]: x for x in rec["rows"]}
    a1 = {(x["sec"], x["no"]): x for x in art1["lines"] if not x.get("header")}
    kids = sum(a1[("II", n)]["diff"] for n in ("1.1", "1.2", "1.3", "1.4"))
    rest = rnd(a1[("II", "1")]["diff"] - kids, 1)
    inst = _cl(by[16], "II", "1.2.2.4")
    if (rd[3]["exp"] != -rd[17]["exp"] or a1[("II", "1.2.2")]["diff"] != inst["law"] or by[16]["headline"]["exp"]["diff"] != 0
            or rest >= 0 or rd[2]["rev"] <= 0 or rd[2]["exp"] >= 0):
        raise ValueError("a note below no longer matches the data: re-read the changes of art. 1, 2, 3, 16 and 17")
    by[1]["notes"] = [
        "Спрямо внесения законопроект приходите по закона са с %s %s, разходите са с %s %s, а бюджетното салдо е с %s по-добро. Разликите идват "
        "от чл. 2 (съдебна власт), чл. 3 (Народно събрание) и чл. 17 (Министерство на културата); чл. 16 не променя общата си сума."
        % (fmt_khil(abs(r)), _more(r), fmt_khil(abs(e)), _more(e), fmt_khil(abs(bal))),
        "Промените по чл. 3 (%s) и чл. 17 (%s) са равни по размер и с противоположен знак и в чл. 1 се компенсират."
        % (_sgn(rd[3]["exp"]), _sgn(rd[17]["exp"])),
        "Редовете след „в т.ч.“ в закона не са изчерпателни: промяната на текущите разходи (%s) е по-голяма от сбора на посочените под нея редове "
        "(%s); остатъкът (%s) е в компоненти, които законът не показва поотделно." % (fmt_khil(a1[("II", "1")]["diff"]), fmt_khil(kids), fmt_khil(rest)),
    ]
    c2 = by[2]
    t2, fin2 = c2["headline"]["transfers"], c2["headline"]["financing"]["law"]
    cur, cap = _cl(c2, "II", "1")["diff"], _cl(c2, "II", "2")["diff"]
    new = [x for x in c2["commitments"] if x["key"] == "new"][0]
    ent = [x for x in c2["commitments"] if x["key"] == "entered"][0]
    if abs(t2["diff"] - (rd[2]["exp"] - rd[2]["rev"] - fin2)) > TOL or c2["headline"]["balance"]["bill"] is not None or fin2 <= 0:
        raise ValueError("the transfers of art. 2 no longer reconcile with the new balance and financing rows")
    c2["notes"] = [
        "Приходите на съдебната власт са с %s %s, а разходите — с %s %s (текущи: %s, капиталови: %s)."
        % (fmt_khil(abs(rd[2]["rev"])), _more(rd[2]["rev"]), fmt_khil(abs(rd[2]["exp"])), _more(rd[2]["exp"]), fmt_khil(cur), fmt_khil(cap)),
        "В закона има два нови реда: бюджетно салдо −%s и операции по финансирането +%s (депозити и средства по сметки). В законопроекта такива "
        "редове няма. Затова бюджетното взаимоотношение с централния бюджет намалява с %s: %s от по-ниските разходи и по-високите приходи и %s от новото "
        "финансиране." % (fmt_khil(fin2), fmt_khil(fin2), fmt_khil(abs(t2["diff"])), fmt_khil(abs(rd[2]["exp"] - rd[2]["rev"])), fmt_khil(fin2)),
        "Максималният размер на новите задължения за разходи е намален от %s на %s; максималният размер на ангажиментите (%s) не се променя."
        % (fmt_khil(new["bill"]), fmt_khil(new["law"]), fmt_khil(ent["law"])),
    ]
    k3 = _cl(by[3], "II", "2")
    by[3]["notes"] = ["Капиталовите разходи на Народното събрание са намалени от %s на %s (%s)." % (fmt_khil(k3["bill"]), fmt_khil(k3["law"]), _sgn(k3["diff"]))]
    k17 = _cl(by[17], "II", "2")
    a17 = by[17]["areas"][0]
    by[17]["notes"] = ["Капиталовите разходи на Министерството на културата са увеличени от %s на %s (%s). Увеличението е в „%s“ (от %s на %s)."
                       % (fmt_khil(k17["bill"]), fmt_khil(k17["law"]), _sgn(k17["diff"]), a17["name"], fmt_khil(a17["bill"]), fmt_khil(a17["law"]))]
    if a17["diff"] != k17["diff"]:
        raise ValueError("the area change of art. 17 no longer equals the capital change")
    by[16]["notes"] = ["В закона към научните институти (Македонски, Добруджански, Тракийски) е добавен четвърти ред „Научен институт „Западни покрайнини“ "
                       "(%s). Общата сума на разходите не се променя; в приетата таблица не личи от кой ред са прехвърлени средствата." % fmt_khil(inst["law"])]


# ----------------------------------------------------------------------------------------------------- gazette and decrees
def _dv_facts(fname):
    blocks = budget_law_parser.dv_blocks(str(RAW / "dv" / fname))
    f = {"issue": None, "date": None, "decree": None, "issued": None, "adopted": None, "inForce": []}
    for k, x in blocks[:12]:
        if k == "t":
            for row in x:
                for cell in row:
                    m = re.search(r"брой:\s*(\d+),\s*от дата\s*(\d+)\.(\d+)\.(\d{4})", cell)
                    if m:
                        f["issue"], f["date"] = int(m.group(1)), _iso(m.group(2), m.group(3), m.group(4))
        else:
            m = re.match(r"УКАЗ № (\d+)", x)
            if m:
                f["decree"] = int(m.group(1))
            m = re.match(r"Издаден в София на (\d+) (\S+) (\d{4}) г\.", x)
            if m:
                f["issued"] = _iso(m.group(1), m.group(2), m.group(3))
            m = re.search(r"приет от 52-рото Народно събрание на (\d+) (\S+) (\d{4}) г\.", x)
            if m and not f["adopted"]:
                f["adopted"] = _iso(m.group(1), m.group(2), m.group(3))
    paras = [x for k, x in blocks if k == "p"]
    for i, x in enumerate(paras):
        m = re.match(r"§\s*\d+\.\s*Законът влиза в сила от (\d+) (\S+) (\d{4}) г\.\s*с изключение на", x)
        if not m:
            continue
        f["general"] = _iso(m.group(1), m.group(2), m.group(3))
        for y in paras[i + 1:]:
            if y.startswith("Законът е приет"):
                break
            mi = re.match(r"^\d+\.\s*(.+?),?\s+(?:които|която|който)\s+влизат?\s+в\s+сила\s+(.+?)[.;]?$", y)
            if not mi:
                continue
            scope, when = mi.group(1).strip(), re.sub(r"\s+г$", " г.", mi.group(2).strip())
            scope = scope[:1].upper() + scope[1:]
            md = re.match(r"от (\d+) (\S+) (\d{4}) г\.", when)
            frm = _iso(md.group(1), md.group(2), md.group(3)) if md else (f["date"] if when.startswith("от деня на обнародването") else None)
            f["inForce"].append({"from": frm, "when": when, "scope": scope})
        break
    if not (f["issue"] and f["date"] and f["decree"] and f["issued"] and f["adopted"] and f.get("general")):
        raise ValueError("gazette facts of %s are incomplete: %r" % (fname, f))
    return f


# ----------------------------------------------------------------------------------------------------- parliament files
def _parl(bill_id):
    """Dates and counts of one bill. Only dates, counts and document numbers are read (never the proposers)."""
    d = ctx_raw(bill_id)
    act = d["activity"]

    def dates(stage, status=None):
        return sorted({a["L_Act_St_date"] for a in act if a["L_Act_St2_name"] == stage and (status is None or a["L_Act_St_name"] == status)})

    first = dates("зала първо гласуване", "приет")
    second = dates("зала второ гласуване")
    adopted = dates("зала второ гласуване", "приет")
    if len(first) != 1 or len(adopted) != 1 or adopted[0] != d["L_Act_date2"][:10]:
        raise ValueError("bill %s: readings are not as expected: %r %r %r" % (bill_id, first, adopted, d["L_Act_date2"]))
    reports = Counter(x["A_Cm_Stan_date"][:10] for x in d["stan_list"])
    ids = {x["A_Cm_Stanid"] for x in d["standp_list"]}
    opinions = [x for x in d["standp_list"] if DUPLICATE_OPINIONS.get(x["A_Cm_Stanid"]) not in ids]
    props = []
    for p in d["proposal_12_list"]:
        files = p["act_files"]
        files = ast.literal_eval(files) if isinstance(files, str) else files
        if not files:
            raise ValueError("proposal %s has no file" % p["RN_DOC"])
        props.append({"no": p["RN_DOC"], "date": p["DAT_DOC"][:10], "file": files[0]["FILENAME"]})
    return {
        "sign": d["L_Act_sign"], "title": d["L_ActL_title"], "lawTitle": d["L_ActL_final"], "submitted": d["L_Act_date"][:10],
        "first": first[0], "second": second, "adopted": adopted[0], "issue": int(d["L_Act_dv_iss"]),
        "reportDates": dict(sorted(reports.items())), "reports": len(d["stan_list"]),
        "reportAuthors": len({x["A_ns_CL_value"] for x in d["stan_list"]}),
        "opinionDates": dict(sorted(Counter(x["A_Cm_Stan_date"][:10] for x in opinions).items())),
        "opinions": len(opinions), "proposals": sorted(props, key=lambda p: (p["date"], p["no"])),
        "report2": [x["A_Cm_Stan_date"][:10] for x in d["stan_list2_1"]],
        "committees": [{"name": x["A_ns_CL_value"], "role": x["L_Act_DTL_value"]} for x in d["dist_list"]],
        "archive": d.get("static_archive") or None, "pdf": [o["FILENAME"] for o in d["order"]], "docx": [o["FILENAME"] for o in d["file_list"]],
    }


_RAW = {}


def ctx_raw(bill_id):
    return _RAW[bill_id]


# ----------------------------------------------------------------------------------------------------- build
def build_law(ctx):
    L = ctx.law
    for key, (bid, _f, _s, _k) in LAWS.items():
        _RAW[bid] = ctx.raw("parliament/bill_%d.json" % bid)
    P = {key: _parl(v[0]) for key, v in LAWS.items()}
    DV = {key: _dv_facts(v[1]) for key, v in LAWS.items()}
    rows = _budget_rows(ctx, L)
    totals = _totals(rows, L)
    art1 = _art1(L)
    changes, rec = _changes(L, rows)
    _notes(L, changes, rec, art1)

    # ---- the three laws (one row each)
    bills = []
    for key, (bid, _f, short, srckey) in LAWS.items():
        p, dv = P[key], DV[key]
        if p["issue"] != dv["issue"] or p["adopted"] != dv["adopted"]:
            raise ValueError("%s: parliament file and gazette disagree: %r / %r" % (key, (p["issue"], p["adopted"]), (dv["issue"], dv["adopted"])))
        bills.append({
            "id": key, "short": short, "sign": p["sign"], "title": p["title"], "lawTitle": p["lawTitle"], "submitted": p["submitted"],
            "firstReading": p["first"], "secondReading": p["second"], "adopted": p["adopted"],
            "decree": {"no": dv["decree"], "issued": dv["issued"]}, "gazette": {"issue": dv["issue"], "date": dv["date"]},
            "inForce": {"from": dv["general"], "exceptions": dv["inForce"]},
            "counts": {"committeeReports": p["reports"], "opinions": p["opinions"], "proposals": len(p["proposals"])},
            "page": BILL_PAGE % bid, "law": SOURCES[srckey]["url"], "source": ["parliament", srckey]})

    z, bo, nz = P["zdb"], P["zbdoo"], P["zbnzok"]
    zd, dd, nd = DV["zdb"], DV["zbdoo"], DV["zbnzok"]
    fixed = [(z["submitted"], "2026-07-01"), (z["first"], "2026-07-15"), (z["second"], ["2026-07-23", "2026-07-24"]),
             (z["adopted"], "2026-07-24"), (z["report2"], ["2026-07-22"]), (bo["adopted"], "2026-07-22"), (nz["adopted"], "2026-07-22"),
             (bo["first"], "2026-07-10"), (nz["first"], "2026-07-10"), (zd["date"], "2026-07-31"), (dd["date"], "2026-07-28"),
             (nd["date"], "2026-07-28"), (min(z["reportDates"]), "2026-07-07"), (max(z["reportDates"]), "2026-07-10"),
             (min(p["date"] for p in z["proposals"]), "2026-07-16"), (max(p["date"] for p in z["proposals"]), "2026-07-20")]
    for got, want in fixed:
        if got != want:
            raise ValueError("the parliament or gazette files give %r where this module expects %r" % (got, want))
    # the parliament's data, checked 2026-11-04: 22 committee reports and 70 opinions. The report of the Комисия по регионална политика,
    # благоустройство и местно самоуправление is no longer in stan_list (until October 23: 23), and the same committee now lists the НСОРБ
    # opinion of 08.07.2026 twice (71 entries, one of them in DUPLICATE_OPINIONS). A further change stops the build again, to be reviewed the same way.
    if (z["reports"], z["opinions"], len(z["proposals"]), z["reportAuthors"], len(z["committees"])) != (22, 70, 69, 22, 24):
        raise ValueError("counts of the budget bill changed: %r" % ((z["reports"], z["opinions"], len(z["proposals"])),))
    by_date = dict(sorted(Counter(p["date"] for p in z["proposals"]).items()))
    leading = [c["name"] for c in z["committees"] if c["role"] == "водеща"]

    def ev(kind, title, date=None, to=None, month=None, detail=None, ref=None, source=None, href=None, phase="parliament"):
        e = {"kind": kind, "phase": phase}
        if date:
            e["date"] = date
        if to:
            e["dateTo"] = to
        if month:
            e["month"] = month
        e["dateText"] = _dtext(date, to, month)
        e["title"] = title
        for k, v in (("detail", detail), ("ref", ref), ("href", href)):
            if v:
                e[k] = v
        e["source"] = source or ["parliament"]
        return e

    pre = "prehistory"
    timeline = [
        ev("procedure", "Министерският съвет приема бюджетната процедура за 2026 г.", "2025-07-17", ref="Решение № 474 на Министерския съвет",
           source=["asbp"], phase=pre, detail=MOTIVES + "5."),
        ev("bill", "Първоначалните проекти на бюджетни закони за 2026 г. са внесени в Народното събрание", month="2025-11", source=["asbp"],
           phase=pre, detail="Одобрени от Министерския съвет. " + MOTIVES + "5."),
        ev("bill", "Проектите са оттеглени", "2025-12-02", ref="Решение № 839 на Министерския съвет", source=["asbp"], phase=pre,
           detail="Според мотивите на Министерството на финансите: поради липса на консенсус със социалните партньори относно някои от "
                  "предлаганите консолидационни мерки. " + MOTIVES + "5."),
        ev("bill", "Министерският съвет одобрява повторно законопроект за държавния бюджет за 2026 г. и АСБП 2026–2028", "2025-12-08",
           ref="Решение № 860 на Министерския съвет", source=["asbp"], phase=pre,
           detail="Законопроектът не е разгледан в Народното събрание поради последвалата оставка на правителството. " + MOTIVES + "5."),
        ev("extension-law", "Министерският съвет одобрява проект на удължителен закон", "2025-12-15", ref="Решение № 886 на Министерския съвет",
           source=["asbp"], phase=pre,
           detail="Закон за събирането на приходи и извършването на разходи през 2026 г. до приемането на Закона за държавния бюджет на "
                  "Република България за 2026 г., Закона за бюджета на държавното обществено осигуряване за 2026 г. и Закона за бюджета на "
                  "Националната здравноосигурителна каса за 2026 г. " + MOTIVES + "5."),
        ev("extension-law", "Народното събрание приема удължителния закон", "2025-12-17", ref="обн., ДВ бр. 113 от 23.12.2025 г.",
           source=["asbp"], phase=pre, detail=MOTIVES + "5."),
        ev("extension-law", "Народното събрание приема промени в удължителния закон", "2026-03-18", ref="обн., ДВ бр. 30 от 27.03.2026 г.",
           source=["asbp"], phase=pre,
           detail="Удължен е срокът на действие на закона до приемането на редовен бюджет. Предвидена е възможност Министерският съвет да "
                  "сключи с Европейската комисия споразумение за заем до 3 261,7 млн. € по инструмента SAFE, при условие за последваща "
                  "ратификация. " + MOTIVES + "6."),
        ev("politics", "Парламентарни избори", "2026-04-19", source=["asbp"], phase=pre, detail=MOTIVES + "6."),
        ev("politics", "Сформиран е редовен кабинет", "2026-05-08", source=["asbp"], phase=pre,
           detail="Една от първите задачи е да се изготвят законопроект за държавния бюджет за 2026 г. и АСБП 2026–2028. " + MOTIVES + "6–7."),
        ev("submitted", "Законопроектът за държавния бюджет е внесен в Народното събрание", z["submitted"], ref="№ " + z["sign"],
           href=BILL_PAGE % LAWS["zdb"][0],
           detail="Внесен е заедно със законопроектите за бюджета на ДОО (№ %s) и на НЗОК (№ %s)." % (bo["sign"], nz["sign"])),
        ev("committees", "Комисиите разглеждат законопроекта за първо гласуване", "2026-07-07", "2026-07-10",
           detail="Законопроектът е разпределен на %d комисии; водеща е %s. %d комисии внасят доклад за първо гласуване. В комисиите постъпват "
                  "още %d становища." % (len(z["committees"]), leading[0], z["reportAuthors"], z["opinions"])),
        ev("plenary-1", "Първо гласуване на законопроектите за бюджета на ДОО и на НЗОК", bo["first"], detail="И двата законопроекта са приети."),
        ev("plenary-1", "Първо гласуване на законопроекта за държавния бюджет в залата", z["first"], detail="Законопроектът е приет на първо гласуване."),
        ev("proposals", "Предложения между първо и второ гласуване", "2026-07-16", "2026-07-20",
           detail="%d предложения: %s %s" % (len(z["proposals"]), _and_list(["%d на %s" % (n, " ".join(_dtext(d).split()[:2])) for d, n in by_date.items()]),
                                             _dtext(next(iter(by_date)))[-7:])),     # "... и 34 на 20 юли" + "2026 г." (all in one year)
        ev("committee-2", "Комисията по бюджет и финанси приема доклад за второ гласуване", z["report2"][0]),
        ev("adopted", "Приети са законите за бюджета на ДОО и на НЗОК", bo["adopted"], detail="Второ гласуване в залата."),
        ev("plenary-2", "Второ гласуване на законопроекта за държавния бюджет", z["second"][0], z["second"][-1]),
        ev("adopted", "Законът за държавния бюджет е приет", z["adopted"], detail="Приет на второ гласуване."),
        ev("gazette", "ДВ бр. 68: Закон за бюджета на ДОО и Закон за бюджета на НЗОК", dd["date"], source=["zbdoo", "zbnzok"],
           href=SOURCES["zbdoo"]["url"], detail="Указ № %d и № %d, издадени на %s" % (dd["decree"], nd["decree"], _dtext(dd["issued"]))),     # _dtext ends with "г."
        ev("gazette", "ДВ бр. 69: Закон за държавния бюджет на Република България за 2026 г.", zd["date"], source=["zdb"],
           href=SOURCES["zdb"]["url"], detail="Указ № %d, издаден на %s Законът влиза в сила от 1 януари 2026 г., с изключения (§ 48)."
                                              % (zd["decree"], _dtext(zd["issued"]))),
        {"kind": "execution", "phase": "execution", "ongoing": True, "dateText": "Продължава",
         "title": "Изпълнение на бюджета: месечни отчети на консолидираната фискална програма", "href": "#/izpalnenie", "source": ["kfp"],
         "detail": "Министерството на финансите публикува отчет за изпълнението на КФП всеки месец."},
    ]
    keys = [e.get("date") or e["month"] + "-01" for e in timeline if not e.get("ongoing")]
    if keys != sorted(keys):
        raise ValueError("the timeline is not in chronological order: %r" % keys)

    gazette = [
        {"issue": 113, "year": 2025, "date": "2025-12-23", "laws": ["Закон за събирането на приходи и извършването на разходи през 2026 г. "
                                                                      "(удължителен закон)"], "source": ["asbp"]},
        {"issue": 30, "year": 2026, "date": "2026-03-27", "laws": ["Изменение и допълнение на удължителния закон"], "source": ["asbp"]},
        {"issue": dd["issue"], "year": 2026, "date": dd["date"], "laws": ["ЗБДОО", "ЗБНЗОК"], "source": ["zbdoo", "zbnzok"]},
        {"issue": zd["issue"], "year": 2026, "date": zd["date"], "laws": ["ЗДБ"], "source": ["zdb"]},
    ]

    archive = RAW / "parliament" / z["archive"]      # only its size is checked (the title says about 63 MB)
    if archive.exists() and round(archive.stat().st_size / 1e6) != 63:
        raise ValueError("the archive of the bill is no longer about 63 MB: update the title")
    documents = [
        {"kind": "bill", "title": "Законопроект № %s (документ .docx)" % z["sign"], "url": FILES_URL + z["docx"][0]},
        {"kind": "bill", "title": "Законопроект като внесен (PDF, № %s от 01.07.2026 г.)" % z["pdf"][0][:-4], "url": FILES_URL + z["pdf"][0]},
        {"kind": "archive", "title": "Архив с приложенията към законопроекта (ZIP, около 63 MB)", "url": FILES_URL + z["archive"]},
        {"kind": "page", "title": "Законопроектът в Народното събрание: движение, доклади, становища", "url": BILL_PAGE % LAWS["zdb"][0]},
        {"kind": "law", "title": "Закон за държавния бюджет на Република България за 2026 г. (ДВ бр. 69 от 31.07.2026 г.)", "url": SOURCES["zdb"]["url"]},
        {"kind": "law", "title": "Закон за бюджета на държавното обществено осигуряване за 2026 г. (ДВ бр. 68 от 28.07.2026 г.)",
         "url": SOURCES["zbdoo"]["url"]},
        {"kind": "law", "title": "Закон за бюджета на Националната здравноосигурителна каса за 2026 г. (ДВ бр. 68 от 28.07.2026 г.)",
         "url": SOURCES["zbnzok"]["url"]},
    ]
    proposals = {
        "count": len(z["proposals"]), "byDate": by_date, "urlPattern": FILES_URL + "{file}",
        "note": "Връзки към документите на Народното събрание. Съдържанието и ефектът на предложенията още не са обработени (P07).",
        "items": [{"no": p["no"], "date": p["date"], "file": p["file"]} for p in z["proposals"]],
    }
    counts = {
        "committeeReports": z["reports"], "opinions": z["opinions"], "proposals": len(z["proposals"]),
        "reportDates": z["reportDates"], "opinionDates": z["opinionDates"], "proposalDates": by_date,
        "committees": {"total": len(z["committees"]), "leading": leading[0], "reported": z["reportAuthors"]},
        "opinionsNote": "Становищата са постъпили в комисиите от организации и институции; докладите са на комисиите.",
    }
    # the wording data/release has carried since d1f0f6c (the plan for 2027 is on the screen S34; the bill comes when it is submitted)
    nxt = {"title": "Бюджет 2027", "status": "pending",
           "note": "Бюджетният план за 2027 г. (изпратен на 15.10.2026 г.) е на екрана „Бюджет 2027 (проект)“. Законопроектът за държавния "
                   "бюджет за 2027 г. ще бъде добавен, когато бъде внесен в Народното събрание.",
           "expected": "минфин.бг, parliament.bg"}

    dba = sum(1 for r in rows if r["changed"])
    note = ("„Законопроект“ е текстът, внесен на 01.07.2026 г. (№ %s); „закон“ е приетият на 24.07.2026 г. текст (ДВ бр. 69 от 31.07.2026 г.). "
            "От 46-те бюджета по чл. 2–47 различават се %d (чл. 2, 3, 16 и 17); чл. 1 (държавният бюджет) се променя от тях. "
            "Програмните бюджети към законопроекта са друг документ: те са сравнени със закона във файловете на ведомствата."
            % (z["sign"], dba))
    if dba != 4:
        raise ValueError("expected 4 differing budgets among the 46, got %d" % dba)

    return ctx.put("law.json", {
        "meta": meta("D10+D11", "Как се прие бюджетът: законопроект срещу закон и законодателният път", source=["bill", "zdb", "parliament", "asbp"],
                     source_note="Законопроектът (внесен на 01.07.2026 г.) е сравнен ред по ред с приетия закон (ДВ бр. 69 от 31.07.2026 г.). Датите на "
                                 "докладите, четенията и предложенията са от Народното събрание; предисторията до внасянето е по мотивите на "
                                 "Министерството на финансите (стр. 5–7).",
                     as_of="2026-07-31", unit="хил. €", pending=["P07"]),
        "note": note,
        "versions": {"bill": {"label": "Законопроект", "date": z["submitted"], "ref": z["sign"], "url": FILES_URL + z["docx"][0]},
                     "law": {"label": "Закон", "date": z["adopted"], "ref": "ДВ бр. 69 от 31.07.2026 г.", "url": SOURCES["zdb"]["url"]}},
        "art1": art1,
        "budgets": rows,
        "totals": totals,
        "changes": changes,
        "reconciliation": rec,
        "bills": bills,
        "timeline": timeline,
        "kinds": KINDS,
        "counts": counts,
        "gazette": gazette,
        "documents": documents,
        "proposals": proposals,
        "next": nxt,
        "pending": ["P07"],
    })
