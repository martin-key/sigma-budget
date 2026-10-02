"""LAW group of validate_data.py: law.json (D10 + D11), the bill against the law, the 46 budgets, the legislative path.

Differences are law minus bill in thousand euro; both sides are printed with one decimal, so a diff may be off by 0.06.
A budget without a revenue (or transfers) line has null there (the documented "no value" of DATA_SPEC section 0.3).
Pure standard library.
"""
import re

import vd_lib as L
from vd_lib import Check, fmt, isnum

TOL = 0.06                      # one printed decimal on both sides
TOL_SUM = 0.15                  # a sum of up to a dozen printed values
PHASES = ("prehistory", "parliament", "execution")
HEAD_KEYS = ("rev", "exp", "transfers", "eucontrib", "balance", "financing")
HEAD_ROW = {"rev": "I", "exp": "II", "transfers": "III", "eucontrib": "IV", "balance": "V", "financing": "VI"}
# the 46 budgets of art. 2-47 summed, thousand euro (reference values read off the bill and the law)
REF = {"bill": {"rev": 2279189.7, "exp": 13352084.8}, "law": {"rev": 2284302.7, "exp": 13326470.3}}
# budgets whose transfers differ from exp - rev by their own "budget balance" row (same in bill and law unless listed)
OWN_BALANCE = {"1600": -2202.9, "2200": -10225.8, "7400": 2014.4, "8400": 20451.6}
ISO_OR_NONE = lambda v: v is None or (isinstance(v, str) and L.ISO.match(v) is not None)


def _dd(c, node, where, tol=TOL):
    """bill / law / diff of one node: diff = law - bill when both sides exist, no diff otherwise."""
    b, l, d = node.get("bill"), node.get("law"), node.get("diff")
    if isnum(b) and isnum(l):
        return c.near(d, l - b, tol, where + " diff")
    return c.ok(d is None, where + ": a diff without both sides")


def _nz(x):
    return x if isnum(x) else 0.0


def _month_or_date(t):
    """A sortable day for a timeline entry (month -> its first day), None for an open-ended one."""
    if t.get("date"):
        return t["date"]
    if t.get("month"):
        return t["month"] + "-01"
    return None


# ------------------------------------------------------------------------------------------------ art. 1
def _art1(c, law):
    a = law["art1"]
    h = a["headline"]
    c.ok(list(h) == list(HEAD_KEYS), "art1.headline keys %s" % list(h))
    for k in HEAD_KEYS:
        for s in ("bill", "law", "diff"):
            c.ok(k in h and isnum(h[k].get(s)), "art1.headline.%s.%s is not a number" % (k, s))
        if k in h:
            _dd(c, h[k], "art1.headline." + k)
    if all(k in h and all(isnum(h[k].get(s)) for s in ("bill", "law", "diff")) for k in HEAD_KEYS):
        for s in ("bill", "law", "diff"):
            v = dict((k, h[k][s]) for k in HEAD_KEYS)
            c.near(v["balance"], v["rev"] - v["exp"] - v["transfers"] - v["eucontrib"], TOL_SUM,
                   "art1 %s balance = rev - exp - transfers - eucontrib" % s)
            c.near(v["financing"], -v["balance"], TOL, "art1 %s financing = -balance" % s)
    lines = a["lines"]
    c.ok(len(lines) == 50, "art1 has %d lines (50 expected)" % len(lines))
    c.ok([r["id"] for r in lines] == ["a1.%02d" % (i + 1) for i in range(len(lines))], "art1 line ids are a1.01.. consecutive")
    row = {}
    for r in lines:
        where = "art1 line %s" % r["id"]
        c.ok(isinstance(r.get("text"), str) and r["text"].strip() != "" and isinstance(r.get("level"), int) and 0 <= r["level"] <= 3,
             where + ": text/level")
        if r.get("header"):
            c.ok(not any(k in r for k in ("bill", "law", "diff", "changed")), where + ": a header row must not carry numbers")
            continue
        c.ok(isinstance(r.get("no"), str) and r["no"] != "" and all(ord(ch) < 128 for ch in r["no"]) and isinstance(r.get("sec"), str),
             where + ": 'no' %r must be plain ASCII" % r.get("no"))
        if not (c.ok(isnum(r.get("bill")) and isnum(r.get("law")) and isnum(r.get("diff")), where + ": bill/law/diff must be numbers")):
            continue
        _dd(c, r, where)
        c.ok(r.get("changed") == (abs(r["diff"]) > 0.05), where + ": changed flag %r vs diff %s" % (r.get("changed"), r["diff"]))
        key = (r["sec"], r["no"])
        c.ok(key not in row, where + ": duplicate row %s" % (key,))
        row[key] = r

    def g(sec, no, s):
        return row[(sec, no)][s]
    try:
        for k in HEAD_KEYS:
            for s in ("bill", "law", "diff"):
                c.near(g(HEAD_ROW[k], HEAD_ROW[k], s), h[k][s], TOL, "art1 headline %s %s = line %s" % (k, s, HEAD_ROW[k]))
        for s in ("bill", "law", "diff"):
            c.near(g("I", "I", s), sum(g("I", n, s) for n in ("1", "2", "3")), TOL_SUM, "art1 %s: I = 1 + 2 + 3" % s)
            c.near(g("I", "1", s), sum(g("I", "1.%d" % i, s) for i in range(1, 9)), TOL_SUM, "art1 %s: taxes = 1.1..1.8" % s)
            c.near(g("II", "II", s), sum(g("II", n, s) for n in ("1", "2", "3", "4", "5")), TOL_SUM, "art1 %s: II = 1..5" % s)
            c.near(g("II", "2", s), g("II", "2.1", s) + g("II", "2.2", s), TOL_SUM, "art1 %s: capital = 2.1 + 2.2" % s)
            c.near(g("II", "5", s), sum(g("II", "5.%d" % i, s) for i in (1, 2, 3)), TOL_SUM, "art1 %s: reserve = 5.1..5.3" % s)
            c.near(g("III", "III", s), g("III", "1", s) - g("III", "2", s), TOL_SUM, "art1 %s: net transfers = given - received" % s)
            c.near(g("V", "V", s), g("I", "I", s) - g("II", "II", s) - g("III", "III", s) - g("IV", "IV", s), TOL_SUM,
                   "art1 %s: V = I - II - III - IV" % s)
            c.near(g("VI", "VI", s), -g("V", "V", s), TOL, "art1 %s: VI = -V" % s)
    except KeyError as e:
        c.fail("art1: row %s is missing" % (e,))
        return {}
    return row


# ------------------------------------------------------------------------------------------------ the 46 budgets
def _budgets(c, law):
    bs = law["budgets"]
    c.ok(len(bs) == 46, "%d budgets (46 expected: art. 2-47)" % len(bs))
    c.ok([b["art"] for b in bs] == list(range(2, 2 + len(bs))), "budget arts are 2..%d consecutive" % (1 + len(bs)))
    ids = [b["id"] for b in bs]
    c.ok(len(set(ids)) == len(ids) and all(isinstance(i, str) and re.match(r"^\d{4}$", i) for i in ids), "budget ids unique 4-digit strings")
    changed = []
    sums = dict((s, {"rev": 0.0, "exp": 0.0}) for s in ("bill", "law"))
    for b in bs:
        w = "budget %s (art. %s)" % (b["id"], b["art"])
        for k in ("name", "short", "kind"):
            c.ok(isinstance(b.get(k), str) and b[k].strip() != "", "%s: %s" % (w, k))
        for k in ("rev", "exp", "transfers"):
            sides = [b[s][k] for s in ("bill", "law", "diff")]
            c.ok(all(x is None for x in sides) or (isnum(sides[0]) and isnum(sides[1]) and isnum(sides[2])),
                 "%s.%s: the three sides must be all numbers or all null: %s" % (w, k, sides))
            if isnum(sides[0]) and isnum(sides[1]):
                c.near(sides[2], sides[1] - sides[0], TOL, "%s.%s diff" % (w, k))
        for s in ("bill", "law"):
            c.ok(isnum(b[s]["exp"]), "%s.%s.exp must be a number" % (w, s))
            sums[s]["rev"] += _nz(b[s]["rev"])
            sums[s]["exp"] += _nz(b[s]["exp"])
            if isnum(b[s]["exp"]) and isnum(b[s]["transfers"]):
                gap = b[s]["transfers"] - (b[s]["exp"] - _nz(b[s]["rev"]))
                want = OWN_BALANCE.get(b["id"], 0.0)
                if b["id"] == "0600" and s == "law":
                    want = -7000.0
                if b["id"] == "1700":
                    want = 1866.2
                c.near(gap, want, TOL_SUM, "%s %s: transfers - (exp - rev) is the budget's own balance row" % (w, s))
        ln = b["lines"]
        c.ok(sorted(ln) == ["add", "chg", "del"] and all(isinstance(v, int) and v >= 0 for v in ln.values()), "%s: lines %s" % (w, ln))
        moved = any(abs(_nz(b["diff"][k])) > 0.05 for k in ("rev", "exp", "transfers")) or any(ln.values())
        c.ok(b["changed"] == moved, "%s: changed flag %r vs differences" % (w, b["changed"]))
        if moved:
            changed.append(b["art"])
    t = law["totals"]
    c.ok(t["count"] == len(bs) == 46, "totals.count %s" % t["count"])
    for s in ("bill", "law"):
        for k in ("rev", "exp"):
            c.near(t[s][k], sums[s][k], TOL_SUM, "totals.%s.%s = sum of the budgets" % (s, k))
            c.near(t[s][k], REF[s][k], TOL, "totals.%s.%s reference value" % (s, k))
    for k in ("rev", "exp"):
        c.near(t["diff"][k], t["law"][k] - t["bill"][k], TOL, "totals.diff.%s" % k)
    c.ok(changed == [2, 3, 16, 17], "budgets that differ: %s (arts 2, 3, 16, 17 expected)" % changed)
    c.ok("46" in law["note"] and "чл. 2, 3, 16 и 17" in law["note"], "law.note must name the 46 budgets and the four that differ")
    return changed


# ------------------------------------------------------------------------------------------------ the five changes
def _changes(c, law, art1_row):
    bs = dict((b["art"], b) for b in law["budgets"])
    ch = law["changes"]
    c.ok([x["art"] for x in ch] == [1, 2, 3, 16, 17], "changes arts %s" % [x["art"] for x in ch])
    for x in ch:
        w = "changes art. %s" % x["art"]
        c.ok(x["id"] == "state" if x["art"] == 1 else x["id"] == bs[x["art"]]["id"], w + ": id %s" % x["id"])
        c.ok(isinstance(x["notes"], list) and x["notes"] and all(isinstance(n, str) and n.strip() for n in x["notes"]), w + ": notes")
        for k, node in x["headline"].items():
            _dd(c, node, "%s headline %s" % (w, k))
        for key in ("areas", "bodies", "commitments"):
            for i, node in enumerate(x.get(key, [])):
                c.ok(isnum(node.get("bill")) and isnum(node.get("law")), "%s %s[%d]: both sides must be numbers" % (w, key, i))
                _dd(c, node, "%s %s[%d]" % (w, key, i))
        ops = {"chg": 0, "add": 0, "del": 0}
        for i, r in enumerate(x["lines"]):
            ww = "%s line %d (%s %s)" % (w, i, r.get("sec"), r.get("no"))
            c.ok(r["op"] in ops and isinstance(r["text"], str) and r["text"].strip(), ww + ": op/text")
            c.ok(all(ord(ch_) < 128 for ch_ in r["no"]), ww + ": 'no' must be plain ASCII")
            if r["op"] in ops:
                ops[r["op"]] += 1
            c.ok((r["op"] != "add" or r["bill"] is None) and (r["op"] != "del" or r["law"] is None) and
                 (r["op"] != "chg" or (isnum(r["bill"]) and isnum(r["law"]))), ww + ": op %s vs the two sides" % r["op"])
            _dd(c, r, ww)
        if x["art"] in bs:
            c.ok(ops == bs[x["art"]]["lines"], "%s: op counts %s vs the budget's lines %s" % (w, ops, bs[x["art"]]["lines"]))
            for k in ("rev", "exp", "transfers"):
                if k in x["headline"]:
                    for s in ("bill", "law"):
                        c.near(x["headline"][k][s], bs[x["art"]][s][k], TOL, "%s headline %s %s = the budget" % (w, k, s))
            if "areas" in x:                                    # the policy / area split adds up to the expenditure
                for s in ("bill", "law"):
                    c.near(sum(a[s] for a in x["areas"]), bs[x["art"]][s]["exp"], TOL_SUM, "%s areas %s sum to the expenditure" % (w, s))
        else:                                                   # art. 1: the changed rows of the state budget table
            marked = dict(((r["sec"], r["no"]), r) for r in x["lines"])
            changed_rows = dict((k, r) for k, r in art1_row.items() if r.get("changed"))
            c.ok(set(marked) == set(changed_rows), "art. 1: changed rows differ: %s" % sorted(set(marked) ^ set(changed_rows)))
            for k, r in marked.items():
                if k in changed_rows:
                    c.ok(r["bill"] == changed_rows[k]["bill"] and r["law"] == changed_rows[k]["law"], "art. 1 row %s differs from art1.lines" % (k,))
            c.ok(ops["add"] == 0 and ops["del"] == 0, "art. 1 has only changed rows")
    c.ok(set(ch[0]["headline"]) == {"rev", "exp", "balance", "financing"}, "art. 1 change headline keys")


# ------------------------------------------------------------------------------------------------ reconciliation
def _reconciliation(c, law):
    rec = law["reconciliation"]
    h = law["art1"]["headline"]
    rows = [{"art": b["art"], "name": b["name"], "rev": _nz(b["diff"]["rev"]), "exp": _nz(b["diff"]["exp"])}
            for b in law["budgets"] if abs(_nz(b["diff"]["rev"])) > 0.05 or abs(_nz(b["diff"]["exp"])) > 0.05]
    c.ok([(r["art"], r["name"]) for r in rec["rows"]] == [(r["art"], r["name"]) for r in rows],
         "reconciliation rows %s vs the budgets with a money difference %s" % ([r["art"] for r in rec["rows"]], [r["art"] for r in rows]))
    for mine, theirs in zip(rows, rec["rows"]):
        c.near(theirs["rev"], mine["rev"], TOL, "reconciliation art. %s rev" % mine["art"])
        c.near(theirs["exp"], mine["exp"], TOL, "reconciliation art. %s exp" % mine["art"])
    s = {"rev": sum(r["rev"] for r in rows), "exp": sum(r["exp"] for r in rows)}
    s["balance"] = s["rev"] - s["exp"]
    for k in ("rev", "exp", "balance"):
        c.near(rec["sum"][k], s[k], TOL_SUM, "reconciliation sum.%s" % k)
        c.near(rec["art1"][k], h[k]["diff"], TOL, "reconciliation art1.%s = art. 1 headline diff" % k)
        c.near(rec["sum"][k], rec["art1"][k], TOL_SUM, "arts. 2 + 3 + 17 = art. 1 on %s" % k)
    c.ok(rec["ok"] is True, "reconciliation.ok must be true")
    c.ok(rec["unit"] == law["meta"]["unit"] == "хил. €", "reconciliation unit")
    return s


# ------------------------------------------------------------------------------------------------ the legislative path
def _bills(c, law, core_src):
    gz = dict(((g["issue"], g["date"]), g) for g in law["gazette"])
    bills = law["bills"]
    c.ok([b["id"] for b in bills] == ["zdb", "zbdoo", "zbnzok"], "bills %s" % [b["id"] for b in bills])
    c.ok([b["sign"] for b in bills] == ["52-602-01-19", "52-602-01-18", "52-602-01-17"], "bill signs")
    for b in bills:
        w = "bill %s" % b["id"]
        days = [b["submitted"], b["firstReading"]] + list(b["secondReading"])
        c.ok(all(L.ISO.match(d) for d in days + [b["adopted"], b["decree"]["issued"], b["gazette"]["date"]]), w + ": dates must be ISO")
        c.ok(days == sorted(days), w + ": submitted <= first reading <= second reading: %s" % days)
        c.ok(b["adopted"] == b["secondReading"][-1], w + ": adopted = last second reading")
        c.ok(b["adopted"] <= b["decree"]["issued"] <= b["gazette"]["date"] <= L.BUILD_DATE, w + ": adopted <= decree <= gazette <= build date")
        c.ok((b["gazette"]["issue"], b["gazette"]["date"]) in gz, w + ": gazette issue %s of %s is not in law.gazette" % (b["gazette"]["issue"], b["gazette"]["date"]))
        c.ok(isinstance(b["decree"]["no"], int) and isinstance(b["gazette"]["issue"], int), w + ": decree / issue numbers")
        c.ok(L.ISO.match(b["inForce"]["from"]) is not None, w + ": inForce.from")
        for e in b["inForce"]["exceptions"]:
            c.ok(ISO_OR_NONE(e["from"]) and e["when"].strip() and e["scope"].strip(), w + ": exception %s" % e)
            c.ok(e["from"] is None or e["from"] >= b["gazette"]["date"], w + ": an exception starts before the gazette date: %s" % e["from"])
        c.ok(all(isinstance(b["counts"][k], int) and b["counts"][k] >= 0 for k in ("committeeReports", "opinions", "proposals")), w + ": counts")
        c.ok(b["page"].startswith("https://www.parliament.bg/") and b["law"].startswith("https://dv.parliament.bg/"), w + ": urls")
        c.ok(all(k in core_src for k in b["source"]), w + ": source keys")
    z = bills[0]["counts"]
    cn = law["counts"]
    for k in ("committeeReports", "opinions", "proposals"):
        c.ok(cn[k] == z[k], "counts.%s %s vs the bill %s" % (k, cn[k], z[k]))
    for k, d in (("committeeReports", "reportDates"), ("opinions", "opinionDates"), ("proposals", "proposalDates")):
        c.ok(sum(cn[d].values()) == cn[k], "counts.%s sums to %s, not %s" % (d, sum(cn[d].values()), cn[k]))
        c.ok(all(L.ISO.match(x) and x <= L.BUILD_DATE for x in cn[d]), "counts.%s dates" % d)
    c.ok(cn["committees"]["reported"] == cn["committeeReports"] <= cn["committees"]["total"] == 24, "counts.committees %s" % cn["committees"])
    c.ok(cn["proposalDates"] == law["proposals"]["byDate"], "counts.proposalDates = proposals.byDate")
    g = law["gazette"]
    c.ok([x["date"] for x in g] == sorted(x["date"] for x in g) and len(g) == 4, "gazette: 4 issues in date order")
    for x in g:
        c.ok(L.ISO.match(x["date"]) and int(x["date"][:4]) == x["year"] and isinstance(x["issue"], int) and x["laws"], "gazette %s" % x)
    docs = law["documents"]
    c.ok(len(docs) == 7 and all(d["kind"] and d["title"] and d["url"].startswith("https://") for d in docs), "documents: 7 https links")
    c.ok(docs[0]["url"] == law["versions"]["bill"]["url"], "documents[0] is the bill file of versions.bill")


def _timeline(c, law, ctx):
    tl = law["timeline"]
    c.ok(len(tl) == 21, "timeline has %d entries (21 expected)" % len(tl))
    days = []
    for i, t in enumerate(tl):
        w = "timeline[%d] %s" % (i, t.get("title", "")[:30])
        c.ok(t["kind"] in law["kinds"] and t["phase"] in PHASES, w + ": kind/phase")
        c.ok(isinstance(t["title"], str) and t["title"].strip() and isinstance(t["dateText"], str) and t["dateText"].strip(), w + ": title/dateText")
        c.ok(t["source"], w + ": source")
        d = _month_or_date(t)
        c.ok((d is None) == bool(t.get("ongoing")), w + ": only an ongoing entry may have no date")
        if d is not None:
            c.ok(L.ISO.match(d) and d <= L.BUILD_DATE, w + ": date %s" % d)
            days.append(d)
        if t.get("href"):                                       # an internal route that resolves, or an https link to the source
            h = t["href"]
            c.ok((h.startswith("#/") and ctx.routes().match(h) is not None) or h.startswith("https://"), w + ": href %s does not resolve" % h)
    c.ok(days == sorted(days), "timeline is not in date order")
    c.ok(sum(1 for t in tl if t["phase"] == "execution") == 1 and tl[-1]["phase"] == "execution", "one execution entry, last")
    used = set(t["kind"] for t in tl)
    c.ok(used <= set(law["kinds"]), "timeline kinds %s" % sorted(used - set(law["kinds"])))


def _proposals(c, law):
    p = law["proposals"]
    c.ok(sorted(p) == ["byDate", "count", "items", "note", "urlPattern"], "proposals keys %s" % sorted(p))
    items = p["items"]
    c.ok(p["count"] == len(items) == 69 == sum(p["byDate"].values()), "proposals: count %s, items %d, byDate %s" % (p["count"], len(items), sum(p["byDate"].values())))
    seen = {}
    nos = set()
    for i, r in enumerate(items):
        w = "proposals.items[%d]" % i
        c.ok(sorted(r) == ["date", "file", "no"], w + ": keys %s (only no, date, file: no author, no text)" % sorted(r))
        c.ok(re.match(r"^52-\d{3}-\d{2}-\d+$", r["no"]) is not None and r["file"] == r["no"] + ".pdf", w + ": no/file %s %s" % (r["no"], r["file"]))
        c.ok(L.ISO.match(r["date"]) and r["date"] in p["byDate"], w + ": date %s" % r["date"])
        c.ok(r["no"] not in nos, w + ": duplicate number")
        nos.add(r["no"])
        seen[r["date"]] = seen.get(r["date"], 0) + 1
    c.ok(seen == p["byDate"], "proposals.byDate %s vs items %s" % (p["byDate"], seen))
    c.ok(p["urlPattern"] == "https://www.parliament.bg/bills/52/{file}", "proposals.urlPattern")
    nx = law["next"]
    c.ok(nx["status"] == "pending" and L.numbers_in(nx) == 0 and nx["expected"] and nx["note"], "next: a pending block without numbers")


def g_law(ctx):
    c = Check("LAW")
    law = ctx.get("law.json")
    core = ctx.get("core.json")
    m = law["meta"]
    c.ok(sorted(law) == sorted(["meta", "note", "versions", "art1", "budgets", "totals", "changes", "reconciliation", "bills", "timeline",
                                "kinds", "counts", "gazette", "documents", "proposals", "next", "pending"]), "law.json keys %s" % sorted(law))
    c.ok(m["id"] == "D10+D11" and m["status"] == "real" and m["unit"] == "хил. €" and m["pending"] == ["P07"] and law["pending"] == ["P07"],
         "meta id/status/unit/pending")
    c.ok(L.ISO.match(m["asOf"]) and m["asOf"] <= L.BUILD_DATE, "meta.asOf %s" % m["asOf"])
    v = law["versions"]
    c.ok(v["bill"]["date"] == "2026-07-01" and v["law"]["date"] == "2026-07-24" and v["bill"]["ref"] == "52-602-01-19", "versions dates/ref")
    c.ok(all(x["url"].startswith("https://") and x["label"] for x in v.values()), "versions urls")
    row = _art1(c, law)
    _budgets(c, law)
    _changes(c, law, row)
    s = _reconciliation(c, law)
    _bills(c, law, core["sources"])
    _timeline(c, law, ctx)
    _proposals(c, law)
    t = law["totals"]
    c.fact("46 budgets: revenue %s -> %s, expenditure %s -> %s хил. €; 4 differ (arts 2, 3, 16, 17); arts 2 + 3 + 17 = art. 1: revenue %s, "
           "expenditure %s, balance %s; %d timeline entries, %d committee reports, %d opinions, %d proposals" % (
               fmt(t["bill"]["rev"]), fmt(t["law"]["rev"]), fmt(t["bill"]["exp"]), fmt(t["law"]["exp"]), fmt(s["rev"]), fmt(s["exp"]),
               fmt(s["balance"]), len(law["timeline"]), law["counts"]["committeeReports"], law["counts"]["opinions"], law["counts"]["proposals"]))
    return c
