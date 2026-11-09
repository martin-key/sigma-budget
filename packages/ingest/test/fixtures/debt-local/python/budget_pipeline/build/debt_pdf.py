"""Табл. VI-2 and the debt prose of the motives (PDF pp.138-145), read from the cleaned page text.

Every pattern must match exactly once or the build fails: a changed wording must never become a silently wrong number.
Labels (Bulgarian) are the user-facing names; ids are English keys.
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import re

YEARS = [2024, 2025, 2026, 2027, 2028]
PAGE_STRUCT = 144
PAGE_GUARANTEED = 145

# (group id, group label, [(row id, label as printed in the table, label shown to the user)])
GROUPS = [
    ("maturity", "Матуритетна структура (по остатъчен матуритет)", [
        ("m1", "Дълг с матуритет до 1 г.", "До 1 година"),
        ("m1_5", "Дълг с матуритет от 1 до 5 г.", "От 1 до 5 години"),
        ("m5_10", "Дълг с матуритет от 5 до 10 г.", "От 5 до 10 години"),
        ("m10p", "Дълг с матуритет над 10 г.", "Над 10 години")]),
    ("instrument", "Видове инструменти", [
        ("eurobonds", "Облигации, емитирани на МКП", "Облигации на международните капиталови пазари"),
        ("dck", "ДЦК, емитирани на вътр. пазар", "Държавни ценни книжа (ДЦК) на вътрешния пазар"),
        ("loans", "Държавни заеми", "Държавни заеми"),
        ("invLoans", "Държавни инвестиционни заеми", "Държавни инвестиционни заеми")]),
    ("rate", "Лихвена структура", [
        ("fixed", "Заеми с фиксирани лихви", "Фиксирана лихва"),
        ("floating", "Заеми с плаващи лихви", "Плаваща лихва")]),
    ("currency", "Валутна структура", [
        ("bgn", "Дълг в лева", "Левове"),
        ("usd", "Дълг в щатски долари", "Щатски долари"),
        ("eur", "Дълг в евро", "Евро"),
        ("jpy", "Дълг в други валути (яп. йени)", "Други валути (японски йени)")]),
    ("creditor", "Държавните заеми по кредитори", [
        ("eu", "Заеми от ЕС /в т.ч. ЕИБ и ЕК/", "Европейски съюз (вкл. Европейска инвестиционна банка и Европейска комисия)"),
        ("ibrd", "Заеми от МБВР", "Международна банка за възстановяване и развитие (МБВР)"),
        ("ceb", "Заеми от БРСЕ", "Банка за развитие на Съвета на Европа (БРСЕ)"),
        ("other", "Заеми от други кредитори", "Други кредитори")]),
]
SECTORS = [("energy", "Енергетика"), ("eu", "Инструменти на ЕС"), ("financial", "Финансов"), ("education", "Образование"),
           ("transport", "Транспорт"), ("other", "Други")]
SECTOR_LABELS = {"energy": "Енергетика", "eu": "Инструменти на ЕС", "financial": "Финансов сектор", "education": "Образование",
                 "transport": "Транспорт", "other": "Други"}


def _page(ctx, n):
    for p in ctx.pdf_pages:
        if p["page"] == n:
            return p["body"]
    raise ValueError("PDF page %d is missing from pdf_pages_clean.json" % n)


def _flat(text):
    return re.sub(r"\s+", " ", text)


def _num(s):
    return float(s.replace(" ", "").replace(",", "."))


def _search(pattern, text):
    m = re.findall(pattern, text)
    if len(m) != 1:
        raise ValueError("pattern %r matched %d times (expected 1)" % (pattern[:70], len(m)))
    return m[0]


def _pct(s):
    if s == "-":
        return None
    if not s.endswith("%"):
        raise ValueError("unexpected percent cell %r" % s)
    return float(s[:-1].replace(",", "."))


# =================================================================================================== Табл. VI-2
def parse_structure(ctx):
    """Табл. VI-2 (structure of the state debt, % of the debt) -> {groups, avgMaturity, check}."""
    lines = [ln.strip() for ln in _page(ctx, PAGE_STRUCT).split("\n")]
    i0 = lines.index("Показатели")
    if lines[i0 + 1:i0 + 6] != [str(y) for y in YEARS] or lines[i0 + 6:i0 + 11] != ["Отчет", "Отчет", "Проект", "Прогноза", "Прогноза"]:
        raise ValueError("Табл. VI-2: the header changed")

    def values(label):
        idx = [k for k, ln in enumerate(lines) if ln == label]
        if len(idx) != 1:
            raise ValueError("Табл. VI-2: label %r found %d times" % (label, len(idx)))
        return lines[idx[0] + 1: idx[0] + 6]

    groups, dev = [], {}
    for gid, glabel, rows in GROUPS:
        out, sums = [], [0.0] * 5
        for rid, src_label, label in rows:
            vals = [_pct(v) for v in values(src_label)]
            out.append({"id": rid, "label": label, "years": [y for y, v in zip(YEARS, vals) if v is not None],
                        "values": [v for v in vals if v is not None]})
            for i, v in enumerate(vals):
                sums[i] += v or 0.0
        groups.append({"id": gid, "label": glabel, "rows": out})
        dev[gid] = round(max(abs(s - 100.0) for s in sums), 2)
    printed = values("дълга в обращение /в години/")
    months = []
    for s in printed:
        y, m = _search(r"^(\d+) г\. и (\d+) м\.$", s)
        months.append(12 * int(y) + int(m))
    # the prose of p.143 repeats the 2025 maturity shares: they must equal the table
    prose = _flat(_page(ctx, PAGE_STRUCT - 1))
    for needle in ("39,4%", "30,4%", "26,1%", "4,1%", "91,7%", "95,9%", "81,6%"):
        if needle not in prose:
            raise ValueError("p.143 no longer repeats %s" % needle)
    return {"groups": groups,
            "avgMaturity": {"label": "Средна продължителност на дълга в обращение", "years": YEARS, "months": months,
                            "printed": printed},
            "maxDeviationFrom100": dev}


# =================================================================================================== prose facts
def parse_interest(ctx):
    t = _flat(_page(ctx, PAGE_STRUCT))
    a = _search(r"през 2024 г\. възлизат на ([\d ]+,\d) млн\. евро \(([\d ]+,\d) млн\. евро по външния и ([\d ]+,\d) млн\. евро по вътрешния\)", t)
    b = _search(r"през 2025 г\. [-–] на ([\d ]+,\d) млн\. евро \(([\d ]+,\d) млн\. евро по външния и ([\d ]+,\d) млн\. евро по вътрешния", t)
    c = _search(r"достигне до ([\d,]+)% \(при ([\d,]+)% в края на 2024", t)
    return {"years": [2024, 2025], "totalMln": [_num(a[0]), _num(b[0])], "externalMln": [_num(a[1]), _num(b[1])],
            "domesticMln": [_num(a[2]), _num(b[2])], "pctGdpPrinted": {"2024": _num(c[1]), "2028": _num(c[0])}}


def parse_guaranteed(ctx):
    t = _flat(_page(ctx, PAGE_GUARANTEED))
    tot = _search(r"намалява до ниво от ([\d ]+,\d) млн\. евро от ([\d ]+,\d) млн\. евро през 2024 г\. Съотношението му спрямо БВП "
                  r"също отбелязва спад до ([\d,]+)% от ([\d,]+)%", t)
    ext = _search(r"външният държавногарантиран дълг възлиза на ([\d ]+,\d) млн\. евро \(при ([\d ]+,\d) млн\. евро през 2024 г\.\), "
                  r"а вътрешният на ([\d ]+,\d) млн\. евро \(при ([\d ]+,\d) млн\. евро през 2024", t)
    new = _search(r"са издадени нови държавни гаранции в общ размер на ([\d ]+,\d) млн\. евро", t)
    i = t.index("През годината превес имат")
    j = t.index("докато през 2024 г.")
    k = t.index("В рамките на ограничението", j)
    names = [n for _, n in SECTORS]
    s25 = dict(re.findall(r"сектор „([^“]+)“ [-–] ([\d,]+)%", t[i:j]))
    s24 = dict(re.findall(r"сектор „([^“]+)“ [-–] ([\d,]+)%", t[j:k]))
    if sorted(s25) != sorted(names) or sorted(s24) != sorted(names):
        raise ValueError("guaranteed debt: the sector list changed: %r %r" % (sorted(s25), sorted(s24)))
    return {"years": [2024, 2025], "totalMln": [_num(tot[1]), _num(tot[0])], "pctGdpPrinted": [_num(tot[3]), _num(tot[2])],
            "externalMln": [_num(ext[1]), _num(ext[0])], "domesticMln": [_num(ext[3]), _num(ext[2])],
            "newGuarantees2025Mln": _num(new),
            "sectors": [{"id": sid, "label": SECTOR_LABELS[sid], "values": [_num(s24[n]), _num(s25[n])]} for sid, n in SECTORS]}


def parse_new_debt(ctx):
    """New state debt taken in 2025 (pp.138-139), the 2026-2028 limits and plans (pp.140-141), the domestic issues of 2026."""
    t39 = _flat(_page(ctx, 139))
    t = _flat(_page(ctx, 139) + " " + _page(ctx, 140) + " " + _page(ctx, 141))
    tot, eur, dom, st = _search(r"Поетият нов дълг през 2025 г\. е в размер на ([\d ]+,\d) млн\. евро, от които ([\d ]+,\d) млн\. евро [-–] "
                                r"еврооблигации на външните пазари, ([\d ]+,\d) млн\. евро \([\d ]+,\d млн\. лв\.\) [-–] емисии ДЦК, "
                                r"деноминирани в лева, на вътрешния пазар, ([\d ]+,\d) млн\. евро [-–] ратифицирани структурни", t39)
    repay = _search(r"погашения към външни и вътрешни кредитори достигат ([\d,]+) млрд\. евро", t39)
    limit26 = _search(r"планираният максимален размер на новия държавен дълг, който може да бъде поет през годината е до ([\d,]+) млрд\. евро", t)
    n27, n28, r27, r28 = _search(r"съответно от ([\d,]+) млрд\. евро и ([\d,]+) млрд\. евро годишно, като дългът в обращение, който ще бъде "
                                 r"рефинансиран е в размер на ([\d,]+) млрд\. евро за 2027 г\. и ([\d,]+) млрд\. евро за 2028", t)
    end26 = _search(r"ограничение за максималния размер на държавния дълг към края на годината до ([\d,]+) млрд\. евро", t)
    total26 = _search(r"деноминирани в евро, с общ номинален размер от ([\d ]+,\d) млн\. евро, от които", t)
    months = [(m, _num(v)) for m, v in re.findall(r"през (януари|февруари|март|април) - ДЦК, с общ номинален размер от ([\d ]+,\d) млн\. евро", t)]
    may = _search(r"през май [-–] 10-годишни ДЦК с номинален размер от ([\d ]+,\d) млн\. евро", t)
    months.append(("май", _num(may)))
    if [m for m, _ in months] != ["януари", "февруари", "март", "април", "май"]:
        raise ValueError("2026 domestic issues: the month list changed: %r" % months)
    nums = lambda *xs: [_num(x) for x in xs]       # noqa: E731
    # purposes of the new debt (p. 141): the source prints „рефинасиране“ (one n) and a footnote number after „съучастия“;
    # both are normalised here, the four items follow the order of the sentence
    uses = list(_search(r"ще бъдат насочени за (рефинан?сиране на дълга в обращение), "
                        r"(покриване на бюджетен дефицит, включително за префинансиране по Плана за възстановяване и устойчивост "
                        r"на Република България), за (придобиване на дялове, акции и съучастия)\s*\d*\s*и (други финансиращи операции)", t))
    uses[0] = uses[0].replace("рефинасиране", "рефинансиране")
    return {
        "uses": uses,
        "y2025": {"totalMln": _num(tot),
                  "parts": [{"id": "eurobonds", "label": "Еврооблигации на международните капиталови пазари", "mln": _num(eur)},
                            {"id": "domesticBonds", "label": "ДЦК на вътрешния пазар (деноминирани в лева)", "mln": _num(dom)},
                            {"id": "structuralLoans", "label": "Структурни програмни заеми (Европейска инвестиционна банка, Банка за развитие на Съвета на Европа)", "mln": _num(st)}],
                  "repaymentsBln": _num(repay)},
        "plan": [{"year": 2026, "kind": "limit", "bln": _num(limit26)},
                 {"year": 2027, "kind": "plan", "bln": nums(n27)[0], "refinancedBln": nums(r27)[0]},
                 {"year": 2028, "kind": "plan", "bln": nums(n28)[0], "refinancedBln": nums(r28)[0]}],
        "limitEnd2026Bln": _num(end26),
        "issued2026": {"months": [{"month": m, "mln": v} for m, v in months], "totalMln": _num(total26)},
    }


# =================================================================================================== the adopted law
def parse_law_limits(paras):
    """Debt limits of the adopted law (ЗДБ 2026, ДВ бр. 69): art. 65 fiscal reserve, 66 debt cap, 67(1) new debt incl. the
    SAFE loan, 69(1) and 71 guarantees. `paras` = the text of the law's paragraphs (budget_law_parser.dv_blocks, kind 'p')."""
    by_art = {}
    for p in paras:
        m = re.match(r"^Чл\. (\d+)\. (.*)$", p)
        if m:
            by_art.setdefault(int(m.group(1)), []).append(m.group(2))

    def art(n):
        if len(by_art.get(n, [])) != 1:
            raise ValueError("ЗДБ 2026: art. %d found %d times (expected 1)" % (n, len(by_art.get(n, []))))
        return by_art[n][0]

    def one(pattern, n):
        m = re.fullmatch(pattern, art(n))
        if not m:
            raise ValueError("ЗДБ 2026: art. %d no longer reads as expected: %r" % (n, art(n)[:120]))
        return m.groups()

    reserve, = one(r"Минималният размер на фискалния резерв към 31 декември 2026 г\. е в размер на ([\d,]+) млрд\. евро\.", 65)
    cap, = one(r"Максималният размер на държавния дълг към края на 2026 г\. не може да надвишава ([\d,]+) млрд\. евро\.", 66)
    new, safe = _art67(art(67))
    guar, = one(r"\(1\) Максималният размер на новите държавни гаранции, които могат да бъдат поети по реда на Закона за държавния "
                r"дълг през 2026 г\., е до ([\d ]+) млн\. евро\.", 69)
    guar_all, = one(r"Максималният размер на новите държавни гаранции, които могат да бъдат издадени по реда на чл\. 69 и 70, "
                    r"е до ([\d ]+)\s*млн\. евро\.", 71)
    return {"reserveMinBln": _num(reserve), "debtCapEnd2026Bln": _num(cap), "newDebtBln": _num(new), "safeLoanMln": _num(safe),
            "newGuaranteesMln": _num(guar), "guaranteesAllMln": _num(guar_all)}


def _art67(text):
    m = re.match(r"\(1\) Максималният размер на новия държавен дълг, който може да бъде поет през годината по реда на Закона за "
                 r"държавния дълг, е ([\d,]+) млрд\. евро, в това число заем в размер до ([\d ]+,\d) млн\. евро за получаване на "
                 r"финансова подкрепа по линия на инструмента „Мерки за сигурността на Европа \(SAFE\)", text)
    if not m:
        raise ValueError("ЗДБ 2026: art. 67(1) no longer reads as expected: %r" % text[:120])
    return m.groups()
