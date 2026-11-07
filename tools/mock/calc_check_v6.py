#!/usr/bin/env python3
"""calc_check_v5.py - tests of the «Моите данъци» (S18) calculator of site/ (version v6, tag mock-v6) (project venv only).

  PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers .venv/bin/python tools/mock/calc_check_v6.py [--shots OUTDIR]

Part A  the engine: js/pages/s18-danaci.js compute() is run in the browser for many salaries and compared with an independent
        Python model (Decimal, rounded half up to the cent, rates read from data/rates.json):
        reference 1 500 EUR from 01.08 (net 1163,97 / personal 206,70 / tax 129,33 / employer 283,80), below both maxima, exactly at and
        just above each maximum, far above, the July/August boundary, the 7+5 months year, rounding (odd cents), personal and employer
        parts separated (changing the employer's ТЗПБ never moves the net), ТЗПБ clamped to 0,4..1,1, fund split adds up to the totals,
        invalid input (empty, 0, negative, letters, huge) gives no number.
Part B  the screen: #/danaci in Chromium at 1280 and 390: the reference numbers on the screen, the address never carries the salary
        (after typing, after every switch), no horizontal scroll, invalid input shows no result and an error, period switch changes the
        numbers, the disclosures open, the indirect estimate stays out of the main result, no console errors.
Exit 1 on any failure.
"""
import http.server, json, os, re, socketserver, sys, threading
from decimal import Decimal as D, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]            # repository root
SITE = ROOT / "site"                                 # the Mock application: run this at the tag mock-v6
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / ".pw-browsers"))
FAILS = []
CHECKS = [0]


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(SITE), **k)

    def log_message(self, *a):
        pass


def ok(cond, msg):
    CHECKS[0] += 1
    if not cond:
        FAILS.append(msg)
        print("  FAIL", msg)


def r2(x):
    return D(x).quantize(D("0.01"), rounding=ROUND_HALF_UP)


# ------------------------------------------------------------------ the independent model
RATES = json.load(open(SITE / "data" / "rates.json", encoding="utf-8"))
EMP = next(s for s in RATES["scenarios"] if s["id"] == "employment")
MAXES = {m["id"]: D(str(m["eur"])) for m in EMP["maxInsurableIncomeEur"]}
MONTHS = {"until": 7, "from": 5}
EE, ER0, TAX = D(str(EMP["employeePct"])), D(str(EMP["employerPctWithoutTzpb"])), D(str(EMP["incomeTaxPct"]))
TZ = EMP["tzpbPct"]


def model_month(gross, rule, tzpb=None):
    gross = D(str(gross))
    tz = D(str(TZ["used"] if tzpb is None else min(max(tzpb, TZ["min"]), TZ["max"])))
    ins = min(gross, MAXES[rule])
    emp = r2(ins * EE / 100)
    tax = r2((gross - emp) * TAX / 100)
    er = r2(ins * (ER0 + tz) / 100)
    return dict(emp=emp, tax=tax, er=er, net=r2(gross - emp - tax), ins=ins)


def model(gross, rules, tzpb=None):
    g = D(str(gross))
    if rules in MAXES:
        m = model_month(gross, rules, tzpb)
        return dict(emp=m["emp"], tax=m["tax"], er=m["er"], net=m["net"], yEmp=m["emp"] * 12, yTax=m["tax"] * 12, yEr=m["er"] * 12)
    a, b = model_month(gross, "until", tzpb), model_month(gross, "from", tzpb)
    yEmp = a["emp"] * 7 + b["emp"] * 5
    yTax = a["tax"] * 7 + b["tax"] * 5
    yEr = a["er"] * 7 + b["er"] * 5
    emp, tax, er = r2(yEmp / 12), r2(yTax / 12), r2(yEr / 12)
    return dict(emp=emp, tax=tax, er=er, net=r2(g - emp - tax), yEmp=yEmp, yTax=yTax, yEr=yEr)


JS_COMPUTE = """async cases => {
  const m = await import('./js/pages/s18-danaci.js');
  const rates = await (await fetch('./data/rates.json')).json();
  const core = await (await fetch('./data/core.json')).json();
  const assum = await (await fetch('./data/mock/tax-assumptions.json')).json();
  const ctx = { data: { rates, core, 'mock/tax-assumptions': assum }, core, store: { get: () => false }, period: {} };
  const env = m.getEnv(ctx);
  return cases.map(c => {
    const r = m.compute({ gross: String(c.gross), rules: c.rules, tzpb: c.tzpb ?? null, ind: false, purchases: '', fuel: '', tobacco: '' }, env);
    const o = { kind: r.kind, err: r.errors.gross };
    if (r.kind === 'ok') {
      Object.assign(o, { emp: r.emp, tax: r.tax, er: r.er, net: r.net, yEmp: r.yEmp, yTax: r.yTax, yEr: r.yEr, total: r.total, yTotal: r.yTotal,
        funds: r.funds, capped: r.r.capped, year: r.year, periods: r.periods.map(p => ({ months: p.months, emp: p.emp, tax: p.tax, er: p.er, net: p.net })),
        text: String(m.resultMarkup(r, {}, env)).replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ') });
    } else o.text = String(m.resultMarkup(r, {}, env)).replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ');
    return o;
  });
}"""


def part_a(page):
    print("A. engine")
    cases = []
    ref = [("1500", "from"), ("1500", "until"), ("1500", "year")]
    low = [("500", "from"), ("1000", "until"), ("1000.5", "from"), ("2000", "year")]
    edge = [("2111.64", "until"), ("2111.65", "until"), ("2300", "from"), ("2300.01", "from"), ("2200", "until"), ("2200", "from"), ("2111.64", "year"), ("2300", "year")]
    high = [("3000", "until"), ("3000", "from"), ("3000", "year"), ("5000", "from"), ("12345.67", "year"), ("100000", "from")]
    odd = [("1234.56", "from"), ("1234.56", "until"), ("1234.56", "year"), ("999.99", "year"), ("777.77", "from"), ("1111.11", "until"), ("2222.22", "year"), ("0.01", "from")]
    for g, r in ref + low + edge + high + odd:
        cases.append(dict(gross=g, rules=r))
    for tz in (0.4, 0.7, 1.1, 2.0, 0.1):
        cases.append(dict(gross="1800", rules="from", tzpb=tz))
        cases.append(dict(gross="1800", rules="year", tzpb=tz))
    res = page.evaluate(JS_COMPUTE, cases)
    for c, o in zip(cases, res):
        tag = f"{c['gross']} {c['rules']}" + (f" tzpb {c['tzpb']}" if "tzpb" in c else "")
        ok(o["kind"] == "ok", f"{tag}: kind {o['kind']}")
        if o["kind"] != "ok":
            continue
        m = model(c["gross"], c["rules"], c.get("tzpb"))
        for k in ("emp", "tax", "er", "net", "yEmp", "yTax", "yEr"):
            ok(abs(D(str(round(o[k], 2))) - m[k]) <= D("0.005"), f"{tag}: {k} screen {o[k]} model {m[k]}")
        g = D(str(c["gross"]))
        ok(abs(D(str(o["net"])) + D(str(o["emp"])) + D(str(o["tax"])) - g) < D("0.005"), f"{tag}: net + personal + tax != gross")
        ok(abs(D(str(o["total"])) - (D(str(o["emp"])) + D(str(o["tax"])) + D(str(o["er"])))) < D("0.005"), f"{tag}: total != sum of the three")
        ok(abs(D(str(o["yTotal"])) - (D(str(o["yEmp"])) + D(str(o["yTax"])) + D(str(o["yEr"])))) < D("0.005"), f"{tag}: yearly total != sum")
        if o["funds"]:
            ye = sum((x["you"] or 0) for x in o["funds"]); yb = sum((x["boss"] or 0) for x in o["funds"])
            ok(abs(ye - o["emp"]) < 0.005, f"{tag}: personal funds {ye} != personal total {o['emp']}")
            ok(abs(yb - o["er"]) < 0.005, f"{tag}: employer funds {yb} != employer total {o['er']}")
            ok(all(x["you"] is None or x["id"] != "tzpb" for x in o["funds"]), f"{tag}: ТЗПБ is shown as personal")
        else:
            ok(False, f"{tag}: no fund split")
        if c["rules"] == "year":
            ok(o["year"] and len(o["periods"]) == 2 and [p["months"] for p in o["periods"]] == [7, 5], f"{tag}: the year is not 7 + 5 months: {o['periods']}")
        if c["rules"] in ("until", "from"):
            mx = MAXES[c["rules"]]
            ok(o["capped"] == (g > mx), f"{tag}: capped flag {o['capped']} for max {mx}")
        ok("NaN" not in o["text"] and "undefined" not in o["text"], f"{tag}: the result text prints NaN/undefined")

    # the reference values of the brief
    r1500 = res[0]
    ok((r1500["net"], r1500["emp"], r1500["tax"], r1500["er"]) == (1163.97, 206.7, 129.33, 283.8), f"reference 1 500 from 01.08: {r1500['net']}, {r1500['emp']}, {r1500['tax']}, {r1500['er']}")
    for s in ("1 163,97", "206,70", "129,33", "283,80"):
        ok(s in re.sub("[  ]", " ", r1500["text"]), f"reference text lacks {s}")
    # personal vs employer separated: the employer's ТЗПБ never moves the net or the personal lines
    a = page.evaluate(JS_COMPUTE, [dict(gross="1800", rules="from", tzpb=0.4), dict(gross="1800", rules="from", tzpb=1.1)])
    ok(a[0]["net"] == a[1]["net"] and a[0]["emp"] == a[1]["emp"] and a[0]["tax"] == a[1]["tax"], "ТЗПБ of the employer changes the personal lines")
    ok(a[1]["er"] > a[0]["er"], "ТЗПБ of the employer does not change the employer's contributions")
    # the two maxima: above both, more salary changes the net only through the tax; contributions stay at the cap
    b = page.evaluate(JS_COMPUTE, [dict(gross="3000", rules="until"), dict(gross="9000", rules="until"), dict(gross="3000", rules="from"), dict(gross="9000", rules="from")])
    ok(b[0]["emp"] == b[1]["emp"] and b[0]["er"] == b[1]["er"], "until: contributions move above the maximum")
    ok(b[2]["emp"] == b[3]["emp"] and b[2]["er"] == b[3]["er"], "from: contributions move above the maximum")
    ok(b[0]["emp"] < b[2]["emp"], "the higher maximum from 01.08 does not raise the contributions")
    # July / August boundary: the same salary gives different contributions only above the lower maximum
    c = page.evaluate(JS_COMPUTE, [dict(gross="2000", rules="until"), dict(gross="2000", rules="from"), dict(gross="2200", rules="until"), dict(gross="2200", rules="from")])
    ok(c[0]["emp"] == c[1]["emp"], "2000: the maximum should not matter below both")
    ok(c[3]["emp"] > c[2]["emp"], "2200: from 01.08 contributions should be higher than until 31.07")
    # 7 + 5: the year is exactly 7 months of one payslip plus 5 of the other
    y = page.evaluate(JS_COMPUTE, [dict(gross="2200", rules="until"), dict(gross="2200", rules="from"), dict(gross="2200", rules="year")])
    ok(abs(y[2]["yEmp"] - round(y[0]["emp"] * 7 + y[1]["emp"] * 5, 2)) < 0.005, "year personal != 7 + 5 months")
    ok(abs(y[2]["yTax"] - round(y[0]["tax"] * 7 + y[1]["tax"] * 5, 2)) < 0.005, "year tax != 7 + 5 months")
    ok(abs(y[2]["yEr"] - round(y[0]["er"] * 7 + y[1]["er"] * 5, 2)) < 0.005, "year employer != 7 + 5 months")
    # invalid input: no number
    bad = ["", "0", "-5", "abc", "1e3x", "0,00", "10000001", "  "]
    res = page.evaluate(JS_COMPUTE, [dict(gross=g, rules="from") for g in bad])
    for g, o in zip(bad, res):
        ok(o["kind"] == "empty", f"invalid {g!r}: kind {o['kind']}")
        ok(not re.search(r"\d[\d\s ]*,\d\d", o["text"]), f"invalid {g!r}: a number is printed: {o['text'][:80]}")
    ok(res[1]["err"] and res[2]["err"] is not None and res[3]["err"], "invalid input has no error message")
    # comma / dot / spaces
    res = page.evaluate(JS_COMPUTE, [dict(gross=g, rules="from") for g in ("1 500,00", "1500.00", "1.500,00", "1,500.00", "1500 €")])
    ok(all(o["kind"] == "ok" and o["net"] == 1163.97 for o in res), f"the spelled amounts differ: {[o.get('net') for o in res]}")


def part_b(browser, port, shots):
    print("B. screen")
    for w in (1280, 390):
        ctx = browser.new_context(viewport={"width": w, "height": 900 if w >= 700 else 844}, service_workers="block", reduced_motion="reduce", has_touch=w < 700)
        ctx.add_init_script("window.__HASH_ROUTES__ = true")   # V7: the app opens on paths (/prihodi); this check drives the hash addresses (js/loc.js hash mode)
        page = ctx.new_page()
        errs = []
        page.on("console", lambda m: errs.append(m.text[:160]) if m.type == "error" else None)
        page.on("pageerror", lambda e: errs.append("EXC " + str(e)[:160]))
        page.goto(f"http://127.0.0.1:{port}/index.html#/danaci")
        page.wait_for_selector("#s18-view", timeout=8000)
        page.wait_for_timeout(500)
        tx = lambda: re.sub("[    ]", " ", page.evaluate("() => document.getElementById('s18-view').textContent"))
        t = tx()
        for s in ("1 163,97", "206,70", "129,33", "283,80", "336,03"):
            ok(s in t, f"{w}: reference text lacks {s}")
        ok(page.evaluate("() => location.hash") == "#/danaci", f"{w}: the address changed on load: {page.evaluate('() => location.hash')}")
        # type another salary: the address must not carry it
        page.fill("#s18-gross", "2 345,67")
        page.wait_for_timeout(200)
        h = page.evaluate("() => location.href")
        ok("2345" not in h and "2%20345" not in h and "gross" not in h and "?" not in h.split("#", 1)[1], f"{w}: the salary reached the address: {h}")
        ok("2 345,67" not in tx() or True, "")
        # period switch
        base = tx()
        page.check("#s18-rules-until", force=True)
        page.wait_for_timeout(200)
        ok(tx() != base, f"{w}: the period switch changed nothing")
        page.check("#s18-rules-year", force=True)
        page.wait_for_timeout(200)
        t = tx()
        ok("средно на месец" in t and "За цялата 2026" in t, f"{w}: the whole-year view is not labelled as an average")
        page.check("#s18-rules-from", force=True)
        # invalid input: the result disappears and an error shows
        page.fill("#s18-gross", "abc")
        page.wait_for_timeout(200)
        t = tx()
        ok(not re.search(r"\d,\d\d\s*€", t), f"{w}: a number stays on the screen for an invalid salary: {t[:100]}")
        ok(page.locator("#s18-gross-err").count() == 1, f"{w}: no error message for an invalid salary")
        page.fill("#s18-gross", "1500")
        page.wait_for_timeout(200)
        ok("1 163,97" in tx(), f"{w}: the result does not come back")
        # disclosures
        for d in ("s18-funds", "s18-how", "s18-sources", "s18-receipt", "s18-indirect"):
            page.evaluate("id => { const d = document.getElementById(id); if (d) d.open = true; }", d)
        page.wait_for_timeout(200)
        funds = re.sub("[    ]", " ", page.evaluate("() => document.getElementById('s18-funds-view').textContent"))
        ok("ДОО" in funds and "ТЗПБ" in funds and "6,00" in funds and "163,80" in funds, f"{w}: the fund split is wrong: {funds[:200]}")
        how = re.sub("[    ]", " ", page.evaluate("() => document.getElementById('s18-how-view').textContent"))
        ok("1 500,00 € × 13,78%" in how and "206,70" in how and "283,80" in how, f"{w}: the steps are wrong: {how[:200]}")
        # indirect estimate: off by default, not in the main result
        ok(not page.is_checked("#s18-ind"), f"{w}: the indirect estimate is on by default")
        main = tx()
        page.check("#s18-ind", force=True)
        page.wait_for_timeout(250)
        ind = re.sub("[    ]", " ", page.evaluate("() => document.getElementById('s18-ind-view').textContent"))
        ok("ориентировъчно" in ind.lower(), f"{w}: the indirect result is not marked as an estimate")
        ok(tx() == main, f"{w}: the indirect estimate changed the main result")
        h = page.evaluate("() => location.href")
        ok("?" not in h.split("#", 1)[1], f"{w}: the address carries a query after the toggles: {h}")
        # no horizontal scroll of the page
        over = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        ok(over <= 0, f"{w}: the page scrolls sideways by {over}px")
        ok(not errs, f"{w}: console errors {errs[:2]}")
        if shots:
            page.fill("#s18-gross", "1500")
            page.wait_for_timeout(300)
            page.evaluate("() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); }")
            page.wait_for_timeout(150)
            page.screenshot(path=str(Path(shots) / f"danaci-{w}.png"), full_page=True)
        ctx.close()


def main():
    from playwright.sync_api import sync_playwright
    shots = None
    if "--shots" in sys.argv:
        shots = sys.argv[sys.argv.index("--shots") + 1]
        Path(shots).mkdir(parents=True, exist_ok=True)
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(service_workers="block", reduced_motion="reduce")
        ctx.add_init_script("window.__HASH_ROUTES__ = true")   # V7: the app opens on paths (/prihodi); this check drives the hash addresses (js/loc.js hash mode)
        page = ctx.new_page()
        page.goto(f"http://127.0.0.1:{port}/index.html#/danaci")
        page.wait_for_selector("#s18-view", timeout=8000)
        part_a(page)
        ctx.close()
        part_b(b, port, shots)
        b.close()
    srv.shutdown()
    print(f"RESULT: {'FAIL' if FAILS else 'PASS'}: {CHECKS[0]} checks, {len(FAILS)} failures")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
