"""D07 components.json: who collects and who spends - the state budget, the two social-insurance budgets, the municipalities, the EU
accounts and the transfers between them (screen S15).

Everything is re-derived from the primary documents and then cross-checked against the hand-curated
prototype/src/kfp_components_2026.json (a mismatch is a build error):
  * state budget      ЗДБ чл. 1 (the art. 1 rows already parsed into law.json by bd_law)
  * ДОО and НЗОК      ЗБДОО and ЗБНЗОК чл. 1 (ДВ бр. 68), parsed from the Държавен вестник HTML with lawparse
  * municipalities    MF motives Табл. IV-1, the text above it and Прил. 9 (asbp_tables.json) + the ЗДБ чл. 51 totals (municipalities.json)
  * EU accounts, national budget, KFP split  Табл. II-3 and II-4 (млн. €, 2024-2028), cross-checked against outlook.json and execution.json
  * other budgets     Прил. 6 (БНТ, БНР, БТА, БАН, universities)
  * execution         execution.json `latest` (the last report) splits only national vs EU; the split by component budgets (state, ДОО,
                      НЗОК, municipalities) is not available in machine-readable form -> pending P02 (no numbers)
"""
import re

import lawparse
from bd_common import fmt_money, fmt_num, pending_block
from dlib import RAW, meta, rnd

TOL = 0.051          # khil EUR: rounding tolerance for sums of printed one-decimal numbers
TOL_MLN = 0.151      # mln EUR: two printed tables added together
YEARS = [2024, 2025, 2026, 2027, 2028]
FILES = {"doo": "zbdoo2026_dv68_idMat244982.html", "nzok": "zbnzok2026_dv68_idMat244981.html"}


def _same(what, a, b, tol=TOL):
    if a is None or b is None or abs(a - b) > tol:
        raise ValueError("components: %s differs: %r vs %r" % (what, a, b))
    return a


def _sum(what, parts, total, tol=TOL):
    s = sum(parts)
    if abs(s - total) > tol:
        raise ValueError("components: %s: parts add up to %.1f, not %.1f" % (what, s, total))
    return total


def _num(c):
    try:
        return lawparse.bgnum(c)
    except ValueError:
        return None


# ------------------------------------------------------------------------------------------------ the two social laws (ДВ HTML)
def _law_art(blocks, n):
    """The tables of art. n of a law: a list of {no: (label, value)} (one dict per table, in print order).
    A two-cell row (deficit/surplus line) is stored under the key '#'."""
    start = end = None
    for i, (k, x) in enumerate(blocks):
        if k != "p":
            continue
        m = re.match(r"Чл\.\s*(\d+)\.", x)
        if m and int(m.group(1)) == n and start is None:
            start = i
        elif m and int(m.group(1)) == n + 1 and start is not None:
            end = i
            break
    if start is None or end is None:
        raise ValueError("components: art. %d not found in the law text" % n)
    out = []
    for k, x in blocks[start:end]:
        if k != "t":
            continue
        t = {}
        for row in x:
            cells = [lawparse.ws(c) for c in row]
            if len(cells) >= 3 and _num(cells[-1]) is not None:
                t[cells[0].rstrip(".")] = (cells[1], _num(cells[-1]))
            elif len(cells) == 2 and _num(cells[1]) is not None:
                t["#"] = (cells[0], _num(cells[1]))
        if t:
            out.append(t)
    return out


def _rows(t, spec, what):
    """spec: [(id, law row no, text that must occur in the law's label, our label)] -> rows with khil values."""
    out = []
    for rid, no, must, label in spec:
        lab, val = t[no]
        if lawparse.fold(must).lower() not in lawparse.fold(lab).lower():
            raise ValueError("components: %s row %s reads %r, expected %r" % (what, no, lab[:70], must))
        out.append({"id": rid, "no": no, "label": label, "khil": val})
    return out


# ------------------------------------------------------------------------------------------------ state budget (law.json art. 1)
def _state(ctx):
    lines = ctx.get("law.json")["art1"]["lines"]
    top = {}
    for l in lines:                                    # the first printed row of each section is its total (I, II, III, IV, V, VI)
        if not l.get("header"):
            top.setdefault(l["sec"], l)
    sub = {(l["sec"], l["no"]): l for l in lines if not l.get("header") and l["level"] > 0}

    def row(sec, no, must):
        l = sub[(sec, no)]
        if must not in l["text"].lower():
            raise ValueError("components: ЗДБ art. 1 row %s.%s reads %r, expected %r" % (sec, no, l["text"][:60], must))
        return l["law"]

    s = {
        "revKhil": top["I"]["law"], "taxKhil": row("I", "1", "данъчни"), "nonTaxKhil": row("I", "2", "неданъчни"),
        "grantsKhil": row("I", "3", "помощи"),
        "expKhil": top["II"]["law"], "transfersNetKhil": top["III"]["law"], "euContributionKhil": top["IV"]["law"],
        "balanceKhil": top["V"]["law"], "financingKhil": top["VI"]["law"],
        "providedKhil": row("III", "1", "предоставени трансфери"), "receivedKhil": row("III", "2", "получени трансфери"),
    }
    to = {
        "municipalities": row("III", "1.1", "общините"), "doo": row("III", "1.2", "обществено осигуряване"),
        "nzok": row("III", "1.3", "здравноосигурителна каса"), "euNf": row("III", "1.4", "националния фонд"),
        "euDfz": row("III", "1.5", "земеделие"),
    }
    s["nzokFromHealthMinistryKhil"] = row("III", "1.3.1", "здравеопазването")
    _same("ЗДБ rev - exp - transfers - EU contribution = balance",
          s["revKhil"] - s["expKhil"] - s["transfersNetKhil"] - s["euContributionKhil"], s["balanceKhil"])
    _same("ЗДБ financing = -balance", s["financingKhil"], -s["balanceKhil"])
    _same("ЗДБ provided - received = net transfers", s["providedKhil"] - s["receivedKhil"], s["transfersNetKhil"])
    _sum("ЗДБ revenue = tax + non-tax + grants", [s["taxKhil"], s["nonTaxKhil"], s["grantsKhil"]], s["revKhil"])
    return s, to


# ------------------------------------------------------------------------------------------------ ДОО and НЗОК
def _doo(blocks):
    rev, exp, bal = _law_art(blocks, 1)
    p_rev, p_exp, p_bal = _law_art(blocks, 2)[:3]
    r = _rows(rev, [
        ("contributions", "1.1", "осигурителни вноски", "Осигурителни вноски"),
        ("nonTax", "2", "неданъчни приходи", "Неданъчни приходи"),
        ("vat", "3", "ддс", "Внесени ДДС и други данъци върху продажбите"),
        ("transfers", "4", "получени трансфери от централния бюджет", "Трансфери от централния бюджет"),
        ("transfersShortage", "5", "допълнителни трансфери", "Допълнителни трансфери от централния бюджет за покриване на недостига"),
    ], "ЗБДОО revenue")
    e = _rows(exp, [
        ("pensions", "1.1", "пенсии", "Пенсии"),
        ("benefits", "1.2", "социални помощи и обезщетения", "Социални помощи и обезщетения"),
        ("programmes", "1.3", "програми, дейности и служби", "Програми, дейности и служби по социалното осигуряване, подпомагане и заетостта"),
        ("defence", "1.4", "отбрана", "Отбрана и сигурност"),
        ("transfersOut", "2", "предоставени трансфери", "Предоставени трансфери"),
    ], "ЗБДОО expenditure")
    pens = _rows(exp, [
        ("fromDoo", "1.1.1", "за сметка на държавното обществено осигуряване", "Пенсии за сметка на ДОО"),
        ("fromState", "1.1.2", "за сметка на държавния бюджет", "Пенсии за сметка на държавния бюджет"),
        ("euRights", "1.1.3", "капиталов трансфер", "Капиталов трансфер за прехвърляне на пенсионни права към пенсионните схеми на ЕС, ЕЦБ и ЕИБ"),
    ], "ЗБДОО pensions")
    total = rev["I"][1]
    _same("ЗБДОО revenue total = expenditure total", total, exp["I"][1])
    _sum("ЗБДОО revenue rows", [x["khil"] for x in r], total)
    _sum("ЗБДОО expenditure: 1 + 2", [exp["1"][1], exp["2"][1]], total)
    _sum("ЗБДОО expenditure rows", [exp["1"][1], exp["2"][1]], total)
    _sum("ЗБДОО expenditure 1 = rows 1.1-1.4", [x["khil"] for x in e[:4]], exp["1"][1])
    _sum("ЗБДОО pensions", [x["khil"] for x in pens], exp["1.1"][1])
    _same("ЗБДОО deficit", bal["#"][1], 0.0)
    fund = {
        "revAndTransfersKhil": p_rev["I"][1], "expAndTransfersKhil": p_exp["I"][1], "balanceKhil": p_bal["#"][1],
        "sourceNote": "ЗБДОО 2026, чл. 2 (бюджетът на фонд „Пенсии“)",
    }
    _same("фонд „Пенсии“ balance = revenue - expenditure", fund["revAndTransfersKhil"] - fund["expAndTransfersKhil"], fund["balanceKhil"])
    to_central = r[3]["khil"] + r[4]["khil"]
    return {
        "revAndTransfersKhil": total, "expAndTransfersKhil": exp["I"][1], "balanceKhil": bal["#"][1],
        "ownRevKhil": rnd(total - to_central, 1), "transfersFromCentralKhil": rnd(to_central, 1),
        "rev": r, "exp": e, "pensionsSplit": pens, "pensionFund": fund,
    }


def _nzok(blocks):
    rev, exp = _law_art(blocks, 1)[:2]
    r = _rows(rev, [
        ("contributions", "1.1", "здравноосигурителни вноски", "Здравноосигурителни вноски"),
        ("transfersInsurance", "1.2", "трансфери за здравно осигуряване", "Трансфери за здравно осигуряване (от държавния бюджет)"),
        ("nonTax", "2", "неданъчни приходи", "Неданъчни приходи"),
        ("transfersHealthMinistry", "3", "получени трансфери от министерството на здравеопазването", "Трансфери от Министерството на здравеопазването"),
    ], "ЗБНЗОК revenue")
    e = _rows(exp, [
        ("staff", "1.1.1", "разходи за персонал", "Разходи за персонал"),
        ("admin", "1.1.2", "издръжка на административните", "Издръжка на административните дейности"),
        ("payments", "1.1.3", "здравноосигурителни плащания", "Здравноосигурителни плащания"),
        ("healthMinistry", "1.1.4", "плащания от трансфери от министерството на здравеопазването", "Плащания от трансфери на Министерството на здравеопазването"),
        ("assets", "1.2", "придобиване на нефинансови активи", "Придобиване на нефинансови активи"),
        ("reserve", "1.3", "резерв", "Резерв, включително за непредвидени и неотложни разходи"),
    ], "ЗБНЗОК expenditure")
    pay = _rows(exp, [
        ("primary", "1.1.3.1", "първична извънболнична", "Първична извънболнична помощ"),
        ("specialised", "1.1.3.2", "специализирана извънболнична", "Специализирана извънболнична помощ"),
        ("dental", "1.1.3.3", "дентална", "Дентална помощ"),
        ("diagnostics", "1.1.3.4", "медико-диагностична", "Медико-диагностична дейност"),
        ("medicines", "1.1.3.5", "лекарствени продукти", "Лекарствени продукти, медицински изделия и диетични храни за домашно лечение"),
        ("devicesHospital", "1.1.3.6", "медицински изделия, прилагани в болничната", "Медицински изделия, прилагани в болничната помощ"),
        ("hospital", "1.1.3.7", "болнична медицинска помощ", "Болнична медицинска помощ"),
        ("other", "1.1.3.8", "други здравноосигурителни плащания", "Други здравноосигурителни плащания"),
    ], "ЗБНЗОК payments")
    total = rev["I"][1] if "I" in rev else rev["II"][1]
    _same("ЗБНЗОК revenue total = expenditure total", total, exp["II"][1])
    _sum("ЗБНЗОК revenue rows", [x["khil"] for x in r], total)
    _sum("ЗБНЗОК expenditure: 1 = 1.1 + 1.2 + 1.3", [exp["1.1"][1], exp["1.2"][1], exp["1.3"][1]], exp["1"][1])
    _same("ЗБНЗОК expenditure total = row 1", exp["1"][1], exp["II"][1])
    _sum("ЗБНЗОК current expenditure 1.1", [x["khil"] for x in e[:4]], exp["1.1"][1])
    _sum("ЗБНЗОК payments 1.1.3", [x["khil"] for x in pay], exp["1.1.3"][1])
    to_state = r[1]["khil"] + r[3]["khil"]
    return {
        "revAndTransfersKhil": total, "expAndTransfersKhil": exp["II"][1], "balanceKhil": rnd(total - exp["II"][1], 1),
        "ownRevKhil": rnd(total - to_state, 1), "transfersFromStateKhil": rnd(to_state, 1),
        "contributionRatePct": 8.0, "rev": r, "exp": e, "paymentsSplit": pay,
    }


# ------------------------------------------------------------------------------------------------ municipalities (motives + ЗДБ чл. 51)
def _municipal(ctx, all_khil):
    T = ctx.tables
    iv = {lawparse.fold(r["label"]).lower(): r["values"] for r in T["IV_1"]["rows"]}

    def line(prefix):
        hits = [v for k, v in iv.items() if k.startswith(prefix)]
        if len(hits) != 1:
            raise ValueError("components: Табл. IV-1 row %r found %d times" % (prefix, len(hits)))
        return hits[0]

    tot, dele, equal, winter, capital = (line(p) for p in ("общо", "обща субсидия за делегираните", "обща изравнителна", "трансфер за зимно", "целева субсидия за капиталови"))
    idx = (0, 3, 4)                                    # 2026, 2027, 2028 (columns 1 and 2 split 2026 into local / delegated)
    kinds = [("delegated", "Обща субсидия за делегираните от държавата дейности", dele),
             ("equalizing", "Обща изравнителна субсидия", equal),
             ("winterRoads", "Зимно поддържане и снегопочистване на общински пътища", winter),
             ("capital", "Целева субсидия за капиталови разходи", capital)]
    for j in idx:
        _sum("Табл. IV-1 column %d" % j, [k[2][j] for k in kinds], tot[j])
    txt = T["IV_text"]

    def grab(key, pat):
        m = re.search(pat, txt[key])
        if not m:
            raise ValueError("components: %s: pattern %r not found" % (key, pat))
        return float(m.group(1).replace(" ", "").replace(",", "."))

    exp_mln = grab("quote", r"в размер на ([\d ]+,\d) млн\. евро")
    pct_gdp = grab("quote", r"([\d,]+)% от БВП")
    pct_kfp = grab("quote", r"структура на разходите по КФП\D+([\d,]+)%")
    loc_mln = grab("quote_local", r"в размер на ([\d ]+,\d) млн\. евро")
    loc_pct = grab("quote_local", r"([\d,]+)% от общите разходи")
    del_mln = grab("quote_delegated", r"в размер на ([\d ]+,\d) млн\. евро")
    _same("municipal expenditure = local + delegated", exp_mln, loc_mln + del_mln, TOL_MLN)
    _same("delegated expenditure = delegated part of the main transfers", del_mln, tot[2] / 1000.0, TOL_MLN)
    _same("local share of expenditure", loc_pct, 100.0 * loc_mln / exp_mln, 0.06)
    mun = ctx.get("municipalities.json")
    t = mun["totals"]
    _same("main transfers: Табл. IV-1 = ЗДБ чл. 51", tot[0], t["transfersKhil"])
    _same("all transfers: ЗДБ чл. 1 III.1.1 = чл. 51 total + other targeted", all_khil, t["allKhil"])
    cols = dict(zip(mun["columns"], mun["check"]["columnSums"]))
    for kid, _l, v in kinds:
        _same("kind %s: Табл. IV-1 = ЗДБ чл. 51" % kid, v[0], cols[kid])
    _same("other targeted: чл. 51", t["otherTargetedKhil"], cols["otherTargeted"])
    return {
        "name": "Общини", "unit": "хил. €", "count": t["count"], "year": 2026,
        "expMln": exp_mln, "expPctGdp": pct_gdp, "expPctKfp": pct_kfp,
        "localExpMln": loc_mln, "localExpPct": loc_pct, "delegatedExpMln": del_mln,
        "transfers": {
            "years": [2026, 2027, 2028], "mainKhil": [tot[j] for j in idx],
            "byKind": [{"id": k, "label": lab, "khil": [v[j] for j in idx]} for k, lab, v in kinds],
            "mainSplit2026": {"localKhil": tot[1], "delegatedKhil": tot[2]},
            "otherTargetedKhil": t["otherTargetedKhil"], "allKhil": t["allKhil"],
        },
        "source": ["zdb", "asbp"],
        "sourceNote": "ЗДБ 2026, чл. 51; мотиви към законопроекта (АСБП 2026–2028): таблица IV-1 (с. 128), приложение № 9 и текстът към нея",
        "dataset": "municipalities",
    }


# ------------------------------------------------------------------------------------------------ national budget, EU accounts, KFP
def _series(T, key, label_start):
    """The row of table T (II_3 / II_4) whose label starts with label_start: 5 values, 2024..2028."""
    rows = [r for r in T[key]["rows"] if lawparse.fold(r["label"]).upper().startswith(label_start) and r["values"][0] is not None]
    if len(rows) != 1:
        raise ValueError("components: %s row %r found %d times" % (key, label_start, len(rows)))
    return list(rows[0]["values"])


def _text_split(ctx, n, u):
    """The motives' own text (pp. 171 and 175) gives the 2024 and 2025 split of the KFP balance between the national budget and the
    EU funds; it differs from tables II-3 / II-4 while the KFP total is the same. Both are reported, the tables are the ones shown."""
    pages = {p["page"]: re.sub(r"\s+", " ", p["body"]) for p in ctx.pdf_pages}

    def val(word, v):
        x = float(v.replace(" ", "").replace(",", "."))
        return -x if word == "дефицит" else x

    m1 = re.search(r"(дефицит|излишък) в размер на ([\d ]+,\d) млн\. евро по националния бюджет и (дефицит|излишък) в размер на ([\d ]+,\d) "
                   r"млн\. евро по европейските средства", pages[171])
    m2 = re.search(r"(дефицит|излишък) по националния бюджет в размер на ([\d ]+,\d) млн\. евро и (дефицит|излишък) по европейските "
                   r"средства в размер на ([\d ]+,\d) млн\. евро", pages[175])
    if not (m1 and m2):
        raise ValueError("components: the 2024/2025 balance-split sentences were not found on pp. 171 / 175 of the motives")
    nat = [val(m1.group(1), m1.group(2)), val(m2.group(1), m2.group(2))]
    eu = [val(m1.group(3), m1.group(4)), val(m2.group(3), m2.group(4))]
    for j, y in enumerate((2024, 2025)):
        i = YEARS.index(y)
        _same("%d: text split adds up to the KFP balance" % y, nat[j] + eu[j], n["balanceMln"][i] + u["balanceMln"][i], TOL_MLN)
    return {
        "unit": "млн. €", "years": [2024, 2025], "pages": [171, 175], "nationalMln": nat, "euMln": eu,
        "diffNationalMln": [rnd(nat[j] - n["balanceMln"][YEARS.index(y)], 1) for j, y in enumerate((2024, 2025))],
        "diffEuMln": [rnd(eu[j] - u["balanceMln"][YEARS.index(y)], 1) for j, y in enumerate((2024, 2025))],
    }


def _national_vs_eu(ctx):
    T = ctx.tables
    n = {
        "revMln": _series(T, "II_3", "ПРИХОДИ, ПОМОЩИ"), "expMln": _series(T, "II_3", "ОБЩО РАЗХОДИ И ВНОСКА"),
        "spendingMln": _series(T, "II_3", "РАЗХОДИ"), "euContributionMln": _series(T, "II_3", "ВНОСКА В ОБЩИЯ БЮДЖЕТ"),
        "transferToEuMln": _series(T, "II_3", "ТРАНСФЕР ЗА СМЕТКИ"), "balanceMln": _series(T, "II_3", "БЮДЖЕТНО САЛДО"),
    }
    u = {
        "revMln": _series(T, "II_4", "ПРИХОДИ, ПОМОЩИ"), "expMln": _series(T, "II_4", "ОБЩО РАЗХОДИ"),
        "transferFromStateMln": _series(T, "II_4", "ТРАНСФЕР ОТ/ЗА"), "balanceMln": _series(T, "II_4", "БЮДЖЕТНО САЛДО"),
    }
    ok = ctx.get("outlook.json")
    k = {"revMln": ok["kfp"]["revenue"]["mln"], "expMln": ok["kfp"]["expenditure"]["mln"], "balanceMln": ok["kfp"]["balance"]["mln"]}
    for i, y in enumerate(YEARS):
        _same("%d: national + EU revenue = KFP" % y, n["revMln"][i] + u["revMln"][i], k["revMln"][i], TOL_MLN)
        _same("%d: national + EU expenditure = KFP" % y, n["expMln"][i] + u["expMln"][i], k["expMln"][i], TOL_MLN)
        _same("%d: national + EU balance = KFP" % y, n["balanceMln"][i] + u["balanceMln"][i], k["balanceMln"][i], TOL_MLN)
        _same("%d: transfer to EU accounts = transfer from the state" % y, n["transferToEuMln"][i], -u["transferFromStateMln"][i], 0.0001)
        _same("%d: national balance = revenue - expenditure + transfer" % y,
              n["revMln"][i] - n["expMln"][i] + n["transferToEuMln"][i], n["balanceMln"][i], TOL_MLN)
        _same("%d: EU balance = revenue - expenditure + transfer" % y,
              u["revMln"][i] - u["expMln"][i] + u["transferFromStateMln"][i], u["balanceMln"][i], TOL_MLN)
        _same("%d: national expenditure = spending + EU contribution" % y, n["spendingMln"][i] + n["euContributionMln"][i], n["expMln"][i], TOL_MLN)
    # execution: only the national / EU split exists in the monthly report
    L = ctx.execution["latest"]
    pick = ("cum", "plan", "pctPlan", "prevYearCum", "yoyPct")
    ex = {"asOf": L["asOf"], "month": L["month"], "ref": "execution", "unit": "млн. €"}
    for key, name in (("nat", "national"), ("eu", "eu")):
        ex[name] = {}
        for rid, out in (("rev", "rev"), ("exp.total", "exp"), ("balance", "balance")):
            ex[name][out] = {p: L[key][rid][p] for p in pick if p in L[key][rid]}
    i26 = YEARS.index(2026)
    for name, plan in (("national", n), ("eu", u)):
        for out, key in (("rev", "revMln"), ("exp", "expMln"), ("balance", "balanceMln")):
            _same("%s %s: plan in execution.json = Табл. II-3/II-4" % (name, out), ex[name][out]["plan"], plan[key][i26], 0.0001)
    for out in ("rev", "exp", "balance"):
        _same("cumulative %s: national + EU = KFP" % out, ex["national"][out]["cum"] + ex["eu"][out]["cum"], L["kfp"]["exp.total" if out == "exp" else out]["cum"], TOL_MLN)
    return {
        "unit": "млн. €", "years": YEARS, "vintage": list(ok["vintage"]),
        "national": n, "eu": u, "kfp": k, "exec": ex, "textSplit": _text_split(ctx, n, u),
        "source": ["asbp"],
        "sourceNote": "Мотиви към законопроекта (АСБП 2026–2028): таблица II-3 (с. 31) и таблица II-4 (с. 32); за 2026 г. това е „Проект“, за 2027–2028 г. — прогноза",
    }


# ------------------------------------------------------------------------------------------------ other budgets (Прил. 6)
def _other(ctx):
    rows = [r for r in ctx.tables["annex6"]["rows"] if r["values"][0] is not None]
    pick = {}
    for r in rows:
        m = re.match(r"(\d) ", r["label"])
        if m:
            pick[m.group(1)] = r
        elif r["label"].startswith("- за бюджета на Българската академия"):
            pick["4a"] = r
        elif r["label"].startswith("- за бюджетите на държавните висши училища"):
            pick["4b"] = r
    spec = [("bnt", "1", "телевизия", "Българска национална телевизия (БНТ)"), ("bnr", "2", "радио", "Българско национално радио (БНР)"),
            ("bta", "3", "телеграфна", "Българска телеграфна агенция (БТА)"),
            ("banMon", "4a", "академия", "Българска академия на науките (БАН), чрез бюджета на МОН"),
            ("universities", "4b", "висши училища", "Държавни висши училища, чрез бюджета на МОН"),
            ("banMoew", "5", "околната среда", "Българска академия на науките (БАН), чрез бюджета на МОСВ"),
            ("militaryUniversities", "6", "военни училища", "Държавни висши военни училища, чрез бюджета на МО")]
    items = []
    for iid, key, must, label in spec:
        if must not in pick[key]["label"].lower() and must not in lawparse.fold(pick[key]["label"]).lower():
            raise ValueError("components: Прил. 6 row %s reads %r, expected %r" % (key, pick[key]["label"][:60], must))
        items.append({"id": iid, "label": label, "khil": list(pick[key]["values"])})
    _sum("Прил. 6, row 4 = БАН + universities (2026)", [items[3]["khil"][0], items[4]["khil"][0]], pick["4"]["values"][0])
    return {
        "name": "БНТ, БНР, БТА, БАН и държавни университети", "unit": "хил. €", "years": [2026, 2027, 2028], "items": items,
        "sumKhil": [rnd(sum(i["khil"][j] for i in items), 1) for j in range(3)],
        "source": ["asbp"], "sourceNote": "Мотиви към законопроекта (АСБП 2026–2028), приложение № 6 (с. 197)",
    }


# ------------------------------------------------------------------------------------------------ build
def build_components(ctx):
    state, to = _state(ctx)
    doo = _doo(lawparse.dv_blocks(str(RAW / "dv" / FILES["doo"])))
    nzok = _nzok(lawparse.dv_blocks(str(RAW / "dv" / FILES["nzok"])))
    mun = _municipal(ctx, to["municipalities"])
    nve = _national_vs_eu(ctx)
    other = _other(ctx)

    # the same numbers, said by both sides of each transfer
    _same("ДОО receives what the state budget gives", doo["transfersFromCentralKhil"], to["doo"])
    _same("НЗОК receives what the state budget gives", nzok["transfersFromStateKhil"], to["nzok"])
    _same("НЗОК: part from the Ministry of Health", nzok["rev"][3]["khil"], state["nzokFromHealthMinistryKhil"])
    itemised = rnd(sum(to.values()), 1)
    other_khil = rnd(state["providedKhil"] - itemised, 1)
    if other_khil < 0:
        raise ValueError("components: itemised transfers exceed the provided transfers")

    # cross-check with the hand-curated prototype summary
    S = ctx.src("kfp_components_2026")
    B = S["budgets_2026_law"]
    for what, mine, theirs in (
            ("state rev", state["revKhil"], B["state_budget"]["rev"]), ("state exp", state["expKhil"], B["state_budget"]["exp"]),
            ("state transfers", state["transfersNetKhil"], B["state_budget"]["transfers_net"]),
            ("EU contribution", state["euContributionKhil"], B["state_budget"]["eu_contribution"]),
            ("to municipalities", to["municipalities"], B["state_budget"]["transfers_to"]["municipalities"]),
            ("to ДОО", to["doo"], B["state_budget"]["transfers_to"]["doo"]), ("to НЗОК", to["nzok"], B["state_budget"]["transfers_to"]["nzok"]),
            ("to EU NF", to["euNf"], B["state_budget"]["transfers_to"]["eu_nf"]), ("to EU DFZ", to["euDfz"], B["state_budget"]["transfers_to"]["eu_dfz"]),
            ("ДОО total", doo["revAndTransfersKhil"], B["doo"]["rev_and_transfers"]), ("ДОО own revenue", doo["ownRevKhil"], B["doo"]["own_rev"]),
            ("ДОО contributions", doo["rev"][0]["khil"], B["doo"]["contributions"]),
            ("НЗОК total", nzok["revAndTransfersKhil"], B["nzok"]["rev_and_transfers"]), ("НЗОК own revenue", nzok["ownRevKhil"], B["nzok"]["own_rev"]),
            ("НЗОК contributions", nzok["rev"][0]["khil"], B["nzok"]["contributions"]),
            ("municipal expenditure (млн. €)", mun["expMln"], B["municipalities"]["exp_mln"]),
            ("municipal main transfers", mun["transfers"]["mainKhil"][0], B["municipalities"]["main_transfers"]),
            ("EU accounts revenue 2026", nve["eu"]["revMln"][2], B["eu_accounts"]["rev"]),
            ("EU accounts expenditure 2026", nve["eu"]["expMln"][2], B["eu_accounts"]["exp_incl_eu_contribution"]),
            ("EU accounts balance 2026", nve["eu"]["balanceMln"][2], B["eu_accounts"]["balance"]),
            ("EU transfer 2026", nve["eu"]["transferFromStateMln"][2], B["eu_accounts"]["transfer_from_state_budget_net"]),
            ("БНТ", other["items"][0]["khil"][0], B["other_transfers"]["bnt"]), ("БНР", other["items"][1]["khil"][0], B["other_transfers"]["bnr"]),
            ("БТА", other["items"][2]["khil"][0], B["other_transfers"]["bta"]),
            ("БАН + universities", other["items"][3]["khil"][0] + other["items"][4]["khil"][0], B["other_transfers"]["ban_and_universities"]),
            ("military universities", other["items"][6]["khil"][0], B["other_transfers"]["military_universities"])):
        _same("prototype summary: " + what, mine, theirs)
    # the prototype summary is the report of 31.07.2026: compare it with that month of execution.json (not with the latest report)
    X = S["national_vs_eu_2026"]["exec_2026_07_31"]
    d26 = ctx.execution["data"]["2026"]
    if d26["asOf"][6] != "2026-07-31":
        raise ValueError("components: month 7 of execution.json 2026 is %s, expected 2026-07-31" % d26["asOf"][6])
    for name, key in (("national", "nat"), ("eu", "eu")):
        for out, src_key, rid in (("rev", "rev", "rev"), ("exp", "exp_incl_eu_contribution", "exp.total"), ("balance", "balance", "balance")):
            _same("prototype summary: execution %s %s at 31.07.2026" % (name, out), rnd(d26[key][rid][6], 1), X[name][src_key], 0.0001)

    state_out = dict(state, name="Държавен бюджет", unit="хил. €", source=["zdb"],
                     sourceNote="ЗДБ 2026, чл. 1, ал. 1–4 (ДВ бр. 69 от 31.07.2026 г.)")
    doo_out = dict(doo, name="Държавно обществено осигуряване (ДОО)", short="ДОО", unit="хил. €", source=["zbdoo"],
                   sourceNote="ЗБДОО 2026, чл. 1 и 2 (ДВ бр. 68 от 28.07.2026 г.)")
    nzok_out = dict(nzok, name="Национална здравноосигурителна каса (НЗОК)", short="НЗОК", unit="хил. €", source=["zbnzok"],
                    sourceNote="ЗБНЗОК 2026, чл. 1 и 2 (ДВ бр. 68 от 28.07.2026 г.)")
    eu_out = {
        "name": "Сметки за средства от ЕС", "unit": "млн. €", "year": 2026, "vintage": "draft",
        "revMln": nve["eu"]["revMln"][2], "expMln": nve["eu"]["expMln"][2],
        "transferFromStateMln": nve["eu"]["transferFromStateMln"][2], "balanceMln": nve["eu"]["balanceMln"][2],
        "fromStateBudgetKhil": {"nf": to["euNf"], "dfz": to["euDfz"], "sum": rnd(to["euNf"] + to["euDfz"], 1)},
        "source": ["asbp", "zdb"],
        "sourceNote": "Мотиви към законопроекта (АСБП 2026–2028), таблица II-4 (с. 32); ЗДБ 2026, чл. 1, III.1.4 и III.1.5",
    }
    transfers = {
        "unit": "хил. €", "toMunicipalitiesKhil": to["municipalities"], "toDooKhil": to["doo"], "toNzokKhil": to["nzok"],
        "toEuNfKhil": to["euNf"], "toEuDfzKhil": to["euDfz"], "itemisedKhil": itemised, "otherKhil": other_khil,
        "providedKhil": state["providedKhil"], "receivedKhil": state["receivedKhil"], "netKhil": state["transfersNetKhil"],
        "toNzokFromHealthMinistryKhil": state["nzokFromHealthMinistryKhil"],
        "source": ["zdb"], "sourceNote": ("ЗДБ 2026, чл. 1, раздел III. „Други“ е разликата между всички предоставени трансфери и изброените в закона "
                                          "получатели (общини, ДОО, НЗОК, двете сметки за средства от ЕС): законът не ги назовава."),
    }
    nodes = [("state", "Държавен бюджет"), ("municipalities", "Общини"), ("doo", "ДОО"), ("nzok", "НЗОК"),
             ("euNf", "Национален фонд (средства от ЕС)"), ("euDfz", "Държавен фонд „Земеделие“ (средства от ЕС)"),
             ("other", "Други получатели (не са посочени поименно в закона)")]
    links = [("municipalities", to["municipalities"]), ("doo", to["doo"]), ("nzok", to["nzok"]), ("euNf", to["euNf"]),
             ("euDfz", to["euDfz"]), ("other", other_khil)]
    sankey = {
        "unit": "млн. €", "nodes": [{"id": i, "name": n} for i, n in nodes],
        "links": [{"source": "state", "target": t, "value": rnd(v / 1000.0, 1), "khil": v} for t, v in links],
    }
    _same("sankey links add up to the provided transfers (млн. €)", sum(l["value"] for l in sankey["links"]), state["providedKhil"] / 1000.0, 0.31)

    notes = [
        "Националният бюджет в консолидираната фискална програма (КФП) е по-широк от държавния бюджет по чл. 1 от ЗДБ: обхваща и бюджетите на ДОО, НЗОК и общините. Затова числата по двата източника не се сравняват пряко.",
        "Националният бюджет (таблица II-3) и сметките за средства от ЕС (таблица II-4) са двете части на КФП: за всяка година от 2024 до 2028 сборът им съвпада с общата КФП (разликите са до 0,1 млн. € от закръгляне). Преводът между тях се вижда в двете таблици с обратен знак (за 2026 г.: %s) и се взаимно погасява." % fmt_money(nve["eu"]["transferFromStateMln"][2]),
        "В текста на мотивите (с. 171 и 175) разбивката на салдото на КФП между националния бюджет и европейските средства за 2024 и 2025 г. е различна от таблици II-3 и II-4 (%s). Общото салдо на КФП е еднакво в двата източника; тук са показани таблиците." % "; ".join("%d: %s / %s срещу %s / %s" % (y, fmt_num(nve["textSplit"]["nationalMln"][j], 1, True), fmt_num(nve["textSplit"]["euMln"][j], 1, True), fmt_num(nve["national"]["balanceMln"][YEARS.index(y)], 1, True), fmt_num(nve["eu"]["balanceMln"][YEARS.index(y)], 1, True)) for j, y in enumerate((2024, 2025))),
        "ЗДБ посочва предоставените трансфери към двете сметки за средства от ЕС (%s), а таблица II-4 дава нетния трансфер към сметките за средства от ЕС (%s). Това са различни величини: не ги събирайте и не ги изваждайте една от друга." % (fmt_money(eu_out["fromStateBudgetKhil"]["sum"] / 1000.0), fmt_money(nve["eu"]["transferFromStateMln"][2])),
        "Общините харчат повече, отколкото получават като основни трансфери от държавния бюджет (%s плюс %s за други целеви разходи): те събират и собствени приходи (местни данъци и такси), които тук не са показани." % (fmt_money(mun["transfers"]["mainKhil"][0] / 1000.0), fmt_money(mun["transfers"]["otherTargetedKhil"] / 1000.0)),
        "Приложение № 6 изброява и трансфери към бюджетите на БНТ, БНР, БТА, БАН и държавните университети (общо %s за 2026 г.). Чл. 1 на ЗДБ не ги назовава, затова не твърдим, че те са цялата сума в „Други получатели“." % fmt_money(other["sumKhil"][0] / 1000.0),
        "Окончателните числа за 2026 г. са в законите (ЗДБ, ЗБДОО, ЗБНЗОК). Таблиците II-3 и II-4, приложение № 6 и таблица IV-1 са от мотивите към законопроекта; за 2027 и 2028 г. това са прогнози.",
    ]
    pend = pending_block("P02")
    out = {
        "meta": meta("D07", "Съставни бюджети и трансфери", "real", ["zdb", "zbdoo", "zbnzok", "asbp", "kfp"],
                     "ЗДБ 2026 (ДВ бр. 69), ЗБДОО и ЗБНЗОК 2026 (ДВ бр. 68), мотиви към законопроекта (АСБП 2026–2028), месечен отчет на КФП към %s"
                     % ".".join(reversed(ctx.execution["latest"]["asOf"].split("-"))),
                     "2026-07-31", "хил. €", pending=["P02"]),
        "budgets": {"state": state_out, "doo": doo_out, "nzok": nzok_out, "municipalities": mun, "euAccounts": eu_out, "other": other},
        "transfers": transfers,
        "nationalVsEu": nve,
        "sankey": sankey,
        "monthlyByBudget": pend,
        "notes": notes,
        "pending": ["P02"],
    }
    ctx.put("components.json", out)
    ctx.notes.append("components.json: %d transfer links, %d notes; other recipients %.1f хил. €" % (len(links), len(notes), other_khil))
    return out
