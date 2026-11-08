"""Builder for measures.json (D12): budget measures of 2026 as stated in the motives to the bill.

Source: data/inputs/measures_2026.json (normalised from the .docx of the motives submitted on 01.07.2026):
the introduction (8 revenue + 9 expenditure measures with an estimate, 4 + 3 without), Табл. II-8 and II-9 (discretionary
measures on an accrual basis) and Част VIII (8 changes to other laws). Everything is copied or summed from that file;
the `related` links are hand-coded and asserted to carry equal numbers. The editorial labels (who is affected, who pays)
are mock M06, keyed by item id, and live in mock/measure-labels.json (DATA2).
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import re

from budget_pipeline.build.definitions import fmt_num
from budget_pipeline.build.data_io import isnum, meta, rnd

ASOF = "2026-07-01"
YEARS3 = [2026, 2027, 2028]

# value-equal pairs between the introduction lists (short tab) and the accrual tables (II-8 / II-9), by 2026 amount
RELATED_EQUAL = [("kr1", "d8-5"), ("kr2", "d8-6"), ("kr3", "d8-7"), ("kr7", "d8-3"), ("kx2", "d9-2"), ("kx3", "d9-6"), ("kx5", "d9-5")]
MONTHS = {"януари": 1, "февруари": 2, "март": 3, "април": 4, "май": 5, "юни": 6, "юли": 7, "август": 8, "септември": 9,
          "октомври": 10, "ноември": 11, "декември": 12}
_FROM_NUM = re.compile(r"считано от (\d{1,2})\.(\d{1,2})\.(\d{4})")
_FROM_WORDS = re.compile(r"считано от (\d{1,2}) (%s) (\d{4})" % "|".join(MONTHS))
_PERIOD_TOTAL = re.compile(r"(?:в размер на|с) (\d[\d\s ]*,\d) млн\. евро за периода")


def _ws(text):
    """Collapse runs of whitespace (the source text has double spaces and line breaks)."""
    return re.sub(r"\s+", " ", text).strip()


def _from_date(text):
    """ISO effective date from 'считано от …' (numeric or with a month name); None when the text has none."""
    m = _FROM_NUM.search(text)
    if m:
        d, mo, y = (int(x) for x in m.groups())
        return "%04d-%02d-%02d" % (y, mo, d)
    m = _FROM_WORDS.search(text)
    if m:
        return "%04d-%02d-%02d" % (int(m.group(3)), MONTHS[m.group(2)], int(m.group(1)))
    return None


def _page(p):
    """11 -> {'docx': 11};  '371–372' -> {'docx': 371, 'to': 372}  (page numbers of the .docx, see document.pagesNote)."""
    if isinstance(p, int):
        return {"docx": p}
    a, _, b = str(p).replace("-", "–").partition("–")
    out = {"docx": int(a)}
    if b:
        out["to"] = int(b)
    return out


def _effect(values):
    """{'2026': v, ...} from a 3-array that may contain None; at least one value is required."""
    eff = {str(y): v for y, v in zip(YEARS3, values) if v is not None}
    if not eff:
        raise ValueError("measure without any amount: %r" % (values,))
    if any(not isnum(v) for v in eff.values()):
        raise ValueError("non-numeric amount in %r" % (values,))
    return eff


def build_measures(ctx):
    m = ctx.src("measures_2026")
    intro, esa, part8 = m["intro"], m["esa"], m["part8"]
    items = []

    def add(it):
        if any(x["id"] == it["id"] for x in items):
            raise ValueError("duplicate measure id " + it["id"])
        items.append(it)
        return it

    # ---------------------------------------------------------------- short tab: introduction lists with an estimate
    for kind, key, prefix in (("revenue", "revenue", "kr"), ("expenditure", "expenditure", "kx")):
        for n, s in enumerate(intro[key], 1):
            if not isnum(s["signed_2026"]) or abs(abs(s["signed_2026"]) - s["stated"]) > 1e-9:
                raise ValueError("signed amount differs from the stated one: " + s["name"])
            if (s["signed_2026"] > 0) != (kind == "revenue"):
                raise ValueError("sign of %s contradicts its list" % s["name"])
            flag = s.get("flag")
            it = {"id": "%s%d" % (prefix, n), "tab": "short", "kind": kind, "name": _ws(s["name"]), "text": _ws(s["what"]),
                  "effectMln": {"2026": s["signed_2026"]}, "hasEstimate": True,
                  "estimateKind": {"indicative_avoided": "avoided", "indicative": "indicative"}.get(flag, "stated")}
            if flag and flag not in ("indicative_avoided", "indicative"):
                raise ValueError("unknown flag " + flag)
            d = _from_date(s["quote"])
            if d:
                it["from"] = d
            it.update({"quote": _ws(s["quote"]), "page": _page(s["page"]), "stage": "bill"})
            add(it)
    # the gambling item carries one more quote of the motives (the legal change behind the amount)
    gam = next(x for x in items if x["id"] == "kr7")
    if gam["name"] != "Хазарт":
        raise ValueError("kr7 is not the gambling measure any more")
    gam["context"] = {"quote": _ws(intro["gambling_context"]["quote"]), "page": _page(intro["gambling_context"]["page"])}

    # ---------------------------------------------------------------- short tab: without an estimate
    see = {}
    n = 0
    for kind, key in (("revenue", "revenue_no_estimate"), ("expenditure", "expenditure_no_estimate")):
        for s in intro[key]:
            n += 1
            if s["stated"] is not None:
                raise ValueError("measure %s has an amount; it is listed as without estimate" % s["name"])
            it = {"id": "kn%d" % n, "tab": "short", "kind": kind, "name": _ws(s["name"]), "text": _ws(s["what"]), "hasEstimate": False}
            d = _from_date(s["quote"])
            if d:
                it["from"] = d
            it.update({"quote": _ws(s["quote"]), "page": _page(s["page"]), "stage": "bill"})
            if s.get("see"):
                see[it["id"]] = s["see"]
            add(it)

    # ---------------------------------------------------------------- discretionary tab: II-8 and II-9
    check, row_sums, printed, period = {}, {}, {}, {}
    for tname, kind, prefix in (("II-8", "revenue", "d8"), ("II-9", "expenditure", "d9")):
        t = esa["tables"][tname]
        rows = [r for r in t["rows"] if not r["label"].startswith("Общо")]
        tot = next(r for r in t["rows"] if r["label"].startswith("Общо"))
        sums = []
        for k in range(3):
            sums.append(rnd(sum(r["values"][k] for r in rows if r["values"][k] is not None), 1))
        for k in range(3):
            if abs(sums[k] - tot["values"][k]) > 0.15:
                raise ValueError("%s: the rows add up to %r, the printed total is %r" % (tname, sums, tot["values"]))
        if sums != t["sum_check"]:
            raise ValueError("%s: source sum_check %r differs from my sums %r" % (tname, t["sum_check"], sums))
        row_sums[tname], printed[tname] = sums, tot["values"]
        check[tname] = tot["values"][0]
        text = " ".join(q["quote"] for q in t["text"])
        mp = _PERIOD_TOTAL.search(text)
        if not mp:
            raise ValueError("%s: no total for the period in the narrative" % tname)
        period[tname] = float(re.sub(r"[\s ]", "", mp.group(1)).replace(",", "."))
        if abs(period[tname] - sum(tot["values"])) > 0.15:
            raise ValueError("%s: narrative total %r differs from the printed total %r" % (tname, period[tname], tot["values"]))
        for n, r in enumerate(rows, 1):
            if not r.get("short") or not r.get("text_quote"):
                raise ValueError("%s row %d lacks short/text_quote" % (tname, n))
            add({"id": "%s-%d" % (prefix, n), "tab": "discretionary", "kind": kind, "table": tname, "name": _ws(r["short"]),
                 "text": _ws(r["what"]), "label": _ws(r["label"]), "effectMln": _effect(r["values"]), "hasEstimate": True,
                 "basis": "accrual", **({"from": _from_date(r["text_quote"])} if _from_date(r["text_quote"]) else {}),
                 "quote": _ws(r["text_quote"]), "page": _page(r["text_page"]), "tablePage": r["row_page"], "stage": "bill"})

    # ---------------------------------------------------------------- laws tab: Част VIII
    for n, s in enumerate(part8["items"], 1):
        add({"id": "p8-%d" % n, "tab": "laws", "kind": "law", "name": _ws(s["name"]), "text": _ws(s["what"]), "hasEstimate": False,
             "quote": _ws(s["quote"]), "page": _page(s["page"]), "stage": "bill"})

    # ---------------------------------------------------------------- balance effect (computed), links
    for it in items:
        if it.get("effectMln"):
            sign = 1 if it["kind"] == "revenue" else -1       # a revenue increase and a spending cut both improve the balance
            it["balanceEffectMln"] = {y: rnd(sign * v, 1) for y, v in it["effectMln"].items()}
    byid = {x["id"]: x for x in items}
    related = {x["id"]: [] for x in items}
    for a, b in RELATED_EQUAL:
        va, vb = byid[a]["effectMln"]["2026"], byid[b]["effectMln"]["2026"]
        if abs(abs(va) - abs(vb)) > 1e-9:
            raise ValueError("related %s and %s carry different 2026 amounts: %r vs %r" % (a, b, va, vb))
        related[a].append(b)
        related[b].append(a)
    for kid, ref in see.items():
        tname, _, num = ref.partition(":")
        target = "%s-%s" % ({"II-8": "d8", "II-9": "d9"}[tname], num)
        if target not in byid:
            raise ValueError("see-reference %s of %s points nowhere" % (ref, kid))
        related[kid].append(target)
        related[target].append(kid)
    for it in items:
        if related[it["id"]]:
            it["related"] = sorted(set(related[it["id"]]))

    # ---------------------------------------------------------------- totals
    short_rev = [x for x in items if x["tab"] == "short" and x["kind"] == "revenue" and x["hasEstimate"]]
    short_exp = [x for x in items if x["tab"] == "short" and x["kind"] == "expenditure" and x["hasEstimate"]]
    rev_total = rnd(sum(x["effectMln"]["2026"] for x in short_rev), 1)
    exp_total = rnd(sum(x["effectMln"]["2026"] for x in short_exp), 1)
    exp_wo = rnd(sum(x["effectMln"]["2026"] for x in short_exp if x["estimateKind"] == "stated"), 1)
    if (rev_total, exp_total) != (745.0, -1710.5) or exp_wo != -1060.8:
        raise ValueError("introduction totals changed: %r %r %r" % (rev_total, exp_total, exp_wo))
    ne = [x for x in items if x["tab"] == "short" and not x["hasEstimate"]]
    counts = {"short": {"revenue": len(short_rev), "expenditure": len(short_exp), "noEstimate": len(ne), "all": len(short_rev) + len(short_exp) + len(ne)},
              "discretionary": {"revenue": sum(1 for x in items if x["tab"] == "discretionary" and x["kind"] == "revenue"),
                                "expenditure": sum(1 for x in items if x["tab"] == "discretionary" and x["kind"] == "expenditure")},
              "laws": sum(1 for x in items if x["tab"] == "laws"), "all": len(items)}
    ind = [x for x in short_exp if x["estimateKind"] != "stated"]
    if len(ind) != 2:
        raise ValueError("expected two indicative expenditure measures, found %d" % len(ind))
    groups = [
        {"id": "short-revenue", "tab": "short", "kind": "revenue", "title": _ws(intro["revenue_heading"]),
         "page": intro["revenue_heading_page"], "items": [x["id"] for x in short_rev], "totalMln": rev_total},
        {"id": "short-expenditure", "tab": "short", "kind": "expenditure", "title": _ws(intro["expenditure_heading"]),
         "page": intro["expenditure_heading_page"], "items": [x["id"] for x in short_exp], "totalMln": exp_total,
         "totalMlnWithoutIndicative": exp_wo},
        {"id": "short-revenue-noestimate", "tab": "short", "kind": "revenue", "title": _ws(intro["tax_changes_heading"]),
         "page": intro["tax_changes_page"], "items": [x["id"] for x in ne if x["kind"] == "revenue"]},
        {"id": "short-expenditure-noestimate", "tab": "short", "kind": "expenditure", "title": "Разходни мерки без посочена сума",
         "page": ne[-1]["page"]["docx"], "items": [x["id"] for x in ne if x["kind"] == "expenditure"]},
    ]
    notes = [
        {"id": "stage", "text": "Мерките са по законопроекта, внесен на 01.07.2026 г. Законът е приет на 24.07.2026 г. и обнародван в ДВ, бр. 69 от 31.07.2026 г.; "
                               "приетият текст може да се различава и не е проверен мярка по мярка."},
        {"id": "sign", "text": "Сумите в текста на мотивите са без знак. Тук приходните мерки са със знак плюс, а намаленията на разходите (спестяванията) – със знак минус. "
                              "Ефектът върху бюджетното салдо е със знак плюс, когато го подобрява (повече приходи или по-малко разходи)."},
        {"id": "indicative", "text": "Две от разходните мерки в списъка са индикативни: %s. Без тях разходните мерки са %s млн. €, а заедно с тях са %s млн. €."
                                      % (" и ".join("„%s“" % x["name"] for x in ind), fmt_num(exp_wo, 1), fmt_num(exp_total, 1))},
        {"id": "basis", "text": "Табл. II-8 и II-9 са на начислена основа (ЕСС), сектор „Държавно управление“, като изменение спрямо предходната година; "
                               "затова сумите не съвпадат с краткия списък в увода, който е на други основания. Сборът на редовете от II-8 за 2028 г. е %s, а отпечатаният общ ред е %s (закръгляване)."
                               % (fmt_num(row_sums["II-8"][2], 1), fmt_num(printed["II-8"][2], 1))},
    ]
    obj = {
        "meta": meta("D12", "Мерки в бюджета за 2026 г.", source=["asbp", "bill"],
                     source_note="Мотиви към законопроекта (внесен на 01.07.2026 г.): въведение, Табл. II-8, Табл. II-9 и Част VIII; страниците са по номерацията на документа",
                     as_of=ASOF, unit="млн. €"),
        "document": {"title": m["document"], "url": m["url"], "billPage": m["bill_page"], "sha256": m["sha256"],
                     "pagesNote": "Номерата на страниците са тези на документа (.docx) с мотивите към законопроекта, както са отпечатани в долния колонтитул.",
                     "adopted": m["adopted"]},
        "tabs": ["short", "discretionary", "laws"],
        "tabLabels": {"short": "Краткосрочни мерки", "discretionary": "Дискреционни мерки", "laws": "Промени в други закони"},
        "tabNotes": {"short": intro["sign_note"],
                     "discretionary": "Табл. II-8 и II-9, " + esa["basis"] + ".",
                     "laws": part8["section"] + " (страници " + part8["pages"] + ")."},
        "stageLabels": {"bill": "В законопроекта; по приетия закон не е проверено"},
        "estimateKinds": {"stated": "Посочена сума", "indicative": "Индикативна сума", "avoided": "Индикативна сума на избегнат разход"},
        "totals": {"revenueMln": rev_total, "expenditureMln": exp_total, "expenditureMlnWithoutIndicative": exp_wo,
                   "discretionary2026": {"II-8": printed["II-8"][0], "II-9": printed["II-9"][0]},
                   "discretionary": {t: {str(y): v for y, v in zip(YEARS3, printed[t])} for t in ("II-8", "II-9")},
                   "discretionaryPeriod": period,
                   "gdpShare2026": {"revenue": esa["gdp_share_2026"]["revenue"], "expenditure": esa["gdp_share_2026"]["expenditure"]},
                   "basis": "начислена основа за II-8/II-9"},
        "counts": counts,
        "groups": groups,
        "items": items,
        "check": {"II-8": check["II-8"], "II-9": check["II-9"], "rowSums": row_sums},
        "notes": notes,
    }
    return ctx.put("measures.json", obj)
