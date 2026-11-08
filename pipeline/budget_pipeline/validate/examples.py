"""Independent checks of the two published example datasets M06 and M07."""
import argparse
import collections
import datetime
import hashlib
import json
import math
import os
import re
import sys
from budget_pipeline.build import example_support as L


MAX_BYTES = 150 * 1024

MOTIVES_TXT = os.path.join(L.ROOT, "data/cache/research", "mf-umtbf-2026-2028", "extracts", "docx_motives.txt")

CYR = re.compile("[\u0400-\u04ff]")

LAT = re.compile("[A-Za-z]")

WORD = re.compile(r"[^\W\d_]+", re.UNICODE)

EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27bf\u2b00-\u2bff\ufe0f\u200d\u20e3]")

FORBIDDEN = re.compile(r"private channel|частен канал|\.secrets|\b\d{17,19}\b", re.I)

WHY_MARK = re.compile("пример|измислен|ориентировъч", re.I)

ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")

class Check(object):
    """The problems, warnings and key numbers of one dataset."""

    def __init__(self, name):
        self.name = name
        self.problems = []
        self.warnings = []
        self.facts = []

    def fail(self, msg):
        self.problems.append(msg)

    def ok(self, cond, msg):
        if not cond:
            self.problems.append(msg)
        return bool(cond)

    def warn(self, msg):
        self.warnings.append(msg)

    def fact(self, text):
        self.facts.append(text)

class Inputs(object):
    """The real files a check compares with (cached; a missing one is reported once, not a crash)."""

    def __init__(self):
        self.cache = {}

    def json(self, path):
        if path not in self.cache:
            try:
                self.cache[path] = L.load_json(path)
            except (IOError, OSError, ValueError):
                self.cache[path] = None
        return self.cache[path]

    def data(self, name):
        return self.json(os.path.join(L.DATA_DIR, name))

    def text(self, path):
        if path not in self.cache:
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    self.cache[path] = fh.read()
            except (IOError, OSError):
                self.cache[path] = None
        return self.cache[path]

def need(c, inp, name):
    """A real input of DATA; fails the check (once) when it is missing."""
    d = inp.data(name)
    if d is None:
        c.fail("input data/release/%s is missing or unreadable (run budget build first)" % name)
    return d

def strings(obj, path="$"):
    """Every string value of a JSON tree with its path."""
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            for x in strings(v, path + "." + k):
                yield x
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            for x in strings(v, "%s[%d]" % (path, i)):
                yield x

def records(doc, path):
    """(location, record) pairs of the list at `path` ('items', 'functions[].groups'); record None = the list is missing."""
    cur = [("$", doc)]
    for step in path.split("[]."):
        nxt = []
        for loc, node in cur:
            lst = node.get(step) if isinstance(node, dict) else None
            if not isinstance(lst, list):
                nxt.append((loc + "." + step, None))
                continue
            for i, rec in enumerate(lst):
                nxt.append(("%s.%s[%d]" % (loc, step, i), rec))
        cur = nxt
    return cur

def path_exists(doc, path):
    """True when a field path such as 'items[].regionId' or 'totals.capexPlanMln' resolves in at least one record."""
    nodes = [doc]
    for tok in path.split("."):
        is_list = tok.endswith("[]")
        key = tok[:-2] if is_list else tok
        nxt = []
        for n in nodes:
            if isinstance(n, dict) and key in n:
                if is_list:
                    if isinstance(n[key], list):
                        nxt.extend(n[key])
                else:
                    nxt.append(n[key])
        nodes = nxt
        if not nodes:
            return False
    return True

def mixed_words(text):
    return [w for w in WORD.findall(text) if CYR.search(w) and LAT.search(w)]

def bad_text(text):
    """Why a string must not be published: mixed scripts, an emoji, or a forbidden mention (empty list = fine)."""
    out = []
    for w in mixed_words(text):
        out.append("mixed Cyrillic/Latin word %r" % w)
    m = EMOJI.search(text)
    if m:
        out.append("emoji U+%04X" % ord(m.group(0)))
    m = FORBIDDEN.search(text)
    if m:
        out.append("forbidden mention %r" % m.group(0))
    return out

def load_file(c, path, dsid_name):
    """Read, parse (NaN is refused) and compare with the canonical form. Returns (doc, text) or (None, None)."""
    if not os.path.exists(path):
        c.fail("file is missing: %s" % os.path.relpath(path, L.ROOT))
        return None, None
    with open(path, "rb") as fh:
        raw = fh.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        c.fail("not UTF-8: %s" % e)
        return None, None

    def refuse(tok):
        raise ValueError("non-finite number " + tok)
    try:
        doc = json.loads(text, parse_constant=refuse)
    except ValueError as e:
        c.fail("does not parse: %s" % e)
        return None, None
    c.ok(len(raw) <= MAX_BYTES, "size %d B is over the %d KB limit" % (len(raw), MAX_BYTES // 1024))
    c.ok(not text.startswith("\ufeff"), "starts with a byte-order mark")
    try:
        canon = L.jdumps(doc) + "\n"
    except ValueError as e:
        c.fail("cannot be re-serialised: %s" % e)
        return doc, text
    if canon != text:
        i = next((k for k in range(min(len(canon), len(text))) if canon[k] != text[k]), min(len(canon), len(text)))
        c.fail("not the canonical minified form of example_support.jdumps (first difference at character %d: %r vs %r)"
               % (i, text[i:i + 24], canon[i:i + 24]))
    return doc, text

def check_meta(c, doc, dsid, registry):
    m = doc.get("meta") if isinstance(doc, dict) else None
    if not isinstance(m, dict):
        c.fail("no meta object")
        return
    c.ok(m.get("id") == dsid, "meta.id is %r, expected %r" % (m.get("id"), dsid))
    c.ok(m.get("status") == "mock", "meta.status must be \"mock\", is %r" % m.get("status"))
    c.ok(m.get("mock") is True, "meta.mock must be true")
    c.ok(m.get("seed") == L.SEED, "meta.seed must be %d, is %r" % (L.SEED, m.get("seed")))
    t = m.get("title")
    c.ok(isinstance(t, str) and len(t) > 8 and CYR.search(t), "meta.title must be a Bulgarian title")
    src = m.get("source")
    if not (isinstance(src, list) and src and all(isinstance(s, str) for s in src)):
        c.fail("meta.source must be a non-empty list of source keys")
    else:
        for s in src:
            c.ok(s in registry, "meta.source key %r is not in the core.json source registry" % s)
        c.ok("mockgen" in src, "meta.source must contain \"mockgen\" (the registry entry of the generator)")
    sn = m.get("sourceNote")
    c.ok(isinstance(sn, str) and len(sn) >= 30 and CYR.search(sn), "meta.sourceNote must be a Bulgarian sentence")
    for k in ("asOf", "retrieved"):
        v = m.get(k)
        good = isinstance(v, str) and ISO.match(v)
        if good:
            try:
                datetime.date.fromisoformat(v)
            except ValueError:
                good = False
        c.ok(good, "meta.%s must be an ISO date, is %r" % (k, v))
    cb = m.get("constrainedBy")
    c.ok(isinstance(cb, list) and cb and all(isinstance(s, str) and len(s) > 20 for s in cb),
         "meta.constrainedBy must be a non-empty list of sentences")
    lab = m.get("label")
    c.ok(isinstance(lab, str) and lab.strip(), "meta.label must be a non-empty string")
    if dsid != "M07":
        n = m.get("notice")
        c.ok(isinstance(n, str) and re.match("ПРИМЕРНИ ДАННИ|РЕДАКЦИОННИ ЕТИКЕТИ", n or ""),
             "meta.notice must start with ПРИМЕРНИ ДАННИ or РЕДАКЦИОННИ ЕТИКЕТИ")
    for k in ("realFields", "modelFields"):
        lst = m.get(k)
        if not (isinstance(lst, list) and lst and all(isinstance(s, str) for s in lst)):
            c.fail("meta.%s must be a non-empty list of field paths" % k)
            continue
        for p in lst:
            c.ok(path_exists(doc, p), "meta.%s names %r, which does not exist in the file" % (k, p))
    c.ok(not (set(m.get("realFields") or []) & set(m.get("modelFields") or [])),
         "a field is listed both as real and as model")

def check_records(c, doc, paths):
    """Every record of the named lists is marked mock and explains itself."""
    n = 0
    for p in paths:
        for loc, rec in records(doc, p):
            if rec is None:
                c.fail("%s: the list is missing" % loc)
                continue
            n += 1
            if not isinstance(rec, dict):
                c.fail("%s: a record must be an object" % loc)
                continue
            if rec.get("mock") is not True:
                c.fail("%s: \"mock\": true is missing" % loc)
            why = rec.get("why")
            if not (isinstance(why, str) and len(why) >= 12 and CYR.search(why) and WHY_MARK.search(why)):
                c.fail("%s: \"why\" must be a Bulgarian sentence saying the data are examples, got %r" % (loc, why))
    c.fact("%d records carry mock + why" % n)

def check_scans(c, doc):
    """Mixed scripts, emoji and forbidden mentions in any string of the file."""
    seen = 0
    for path, s in strings(doc):
        for why in bad_text(s):
            seen += 1
            if seen <= 6:
                c.fail("%s: %s in %r" % (path, why, s[:60]))
    if seen > 6:
        c.fail("... and %d more text problems" % (seen - 6))

M06_PERSONAS = ["Работещ", "Пенсионер", "Родител", "Шофьор", "Бизнес", "Студент"]

M06_RISK_KINDS = ["stated", "indicative", "avoided", "none"]

def measure_texts(it):
    """The measure's own words (the texts a label's excerpt may be taken from)."""
    out = [it[k] for k in ("quote", "text") if isinstance(it.get(k), str)]
    ctx = it.get("context")
    if isinstance(ctx, dict) and isinstance(ctx.get("quote"), str):
        out.append(ctx["quote"])
    return out

def check_m06(c, doc, inp):
    """An editorial label for EVERY measure id: affects[] (six groups), payer, winner, risk, since; everything derived only
    from the measure's real text (the excerpts are verbatim parts of it)."""
    ms = need(c, inp, "measures.json")
    if ms is None:
        return
    meta, items = doc["meta"], doc.get("items") or []
    mids = [m["id"] for m in ms.get("items", [])]
    by = dict((m["id"], m) for m in ms.get("items", []))
    got = [x.get("id") for x in items]
    c.ok(got == mids, "labelled ids differ from measures.json: missing %s, unknown %s, order %s"
         % (sorted(set(mids) - set(got))[:6], sorted(set(got) - set(mids))[:6], "same" if sorted(got) == sorted(mids) else "differs"))
    c.ok(len(mids) == len(set(mids)) and len(items) == len(mids), "%d labels for %d measures" % (len(items), len(mids)))
    pers = meta.get("personas") or []
    c.ok([p.get("label") for p in pers] == M06_PERSONAS and all(isinstance(p.get("hint"), str) and CYR.search(p["hint"]) for p in pers),
         "meta.personas must be the six groups %s, each with a Bulgarian hint" % M06_PERSONAS)
    kinds = meta.get("riskKinds") or []
    c.ok([k.get("id") for k in kinds] == M06_RISK_KINDS and all(isinstance(k.get("label"), str) and CYR.search(k["label"]) for k in kinds),
         "meta.riskKinds must be %s with Bulgarian labels" % M06_RISK_KINDS)
    by_group = collections.OrderedDict((p, 0) for p in M06_PERSONAS)
    n_none = n_date = n_legal = 0
    n_ev = 0
    for x in items:
        mid = x.get("id")
        m = by.get(mid)
        if m is None:
            continue
        aff = x.get("affects")
        if not (isinstance(aff, list) and len(set(aff)) == len(aff) and all(a in M06_PERSONAS for a in aff)):
            c.fail("%s: affects must be distinct names from %s" % (mid, M06_PERSONAS))
            aff = []
        c.ok(aff == [p for p in M06_PERSONAS if p in aff], "%s: affects must follow the order of the six groups" % mid)
        for p in aff:
            by_group[p] += 1
        n_none += 0 if aff else 1
        for f in ("payer", "winner", "risk"):
            v = x.get(f)
            c.ok(isinstance(v, str) and len(v.strip()) >= 8 and CYR.search(v) is not None, "%s: %s must be a Bulgarian sentence or phrase" % (mid, f))
        srcs = measure_texts(m)
        for f in ("evidence", "riskEvidence", "legal", "sinceText"):
            if f in x or f == "evidence":
                v = x.get(f)
                if not (isinstance(v, str) and v.strip()):
                    c.fail("%s: %s must be a non-empty string" % (mid, f))
                elif not any(v in s for s in srcs):
                    c.fail("%s: %s is not a verbatim part of the measure's text: %r" % (mid, f, v[:60]))
                elif f == "evidence":
                    n_ev += 1
                    c.ok(len(v) >= 15, "%s: the evidence excerpt is too short to show anything" % mid)
        given = m.get("from")
        since = x.get("since")
        if given:
            c.ok(since == given, "%s: since is %r, the measure data say %s" % (mid, since, given))
        if since is not None:
            c.ok(isinstance(since, str) and ISO.match(since) is not None, "%s: since must be an ISO date" % mid)
            if not given:
                c.ok(since in L.dates_in(x.get("evidence", "")), "%s: since %s is not a date stated in the evidence excerpt" % (mid, since))
            c.ok("sinceText" not in x, "%s: give either since or sinceText, not both" % mid)
        n_date += (1 if since else 0) + (1 if "sinceText" in x else 0)
        n_legal += 1 if "legal" in x else 0
        want = m.get("estimateKind") or ("stated" if m.get("hasEstimate") else "none")
        c.ok(x.get("riskKind") == want and want in M06_RISK_KINDS, "%s: riskKind is %r, the measure's estimate status says %r" % (mid, x.get("riskKind"), want))
        extra = set(x) - set("id affects payer winner risk riskKind evidence riskEvidence since sinceText legal mock why".split())
        c.ok(not extra, "%s: unexpected keys %s" % (mid, sorted(extra)))
    cn = meta.get("counts") or {}
    c.ok(cn.get("measures") == len(items) and cn.get("noGroup") == n_none and cn.get("withDate") == n_date and cn.get("withLegalBasis") == n_legal
         and dict(cn.get("byGroup", {})) == dict(by_group), "meta.counts do not match the items: %s, expected measures %d, noGroup %d, withDate %d, withLegalBasis %d, byGroup %s"
         % (cn, len(items), n_none, n_date, n_legal, dict(by_group)))
    c.fact("%d measures labelled, every id of measures.json covered once; %d without a group, %d with a date, %d with a legal basis; groups %s; "
           "all %d evidence excerpts are verbatim parts of the measure's own text"
           % (len(items), n_none, n_date, n_legal, ", ".join("%s %d" % kv for kv in by_group.items()), n_ev))

M07_KINDS = ["официална ставка", "ориентировъчно"]

M07_FLAT = [("vatRatePct", "vat-standard"), ("vatShareOfPurchases", "vat-share-of-purchases"), ("fuelPricePerLitreEur", "fuel-price"),
            ("fuelExcisePerLitreEur", "fuel-excise-petrol"), ("tobaccoPricePerPackEur", "tobacco-price-pack")]

_NB = "\u00a0\u202f"

def motives_nums(txt, pattern):
    """Every capture group of the first match of `pattern` in the motives extract, as floats (None: text not on disk or no match)."""
    if txt is None:
        return None
    m = re.search(pattern, txt)
    if not m:
        return None
    out = []
    for g in m.groups():
        out.append(float(re.sub("[ " + _NB + "]", "", g).replace(",", ".")))
    return out

def check_m07(c, doc, inp):
    """Indirect-tax assumptions of the calculator: real rates (VAT, excise) exactly as in the law's motives where the text is on
    disk, everything else a model labelled ориентировъчно; the flat numbers the calculator reads equal the detailed items."""
    meta, items = doc["meta"], doc.get("items") or []
    by = collections.OrderedDict((x.get("id"), x) for x in items)
    c.ok(len(by) == len(items) and len(items) >= 10, "item ids must be unique and there must be at least 10 items")
    c.ok(meta.get("label") == "ориентировъчно", "meta.label must be \"ориентировъчно\"")
    c.ok(isinstance(meta.get("why"), str) and WHY_MARK.search(meta["why"]) and CYR.search(meta["why"]), "meta.why must say the numbers are indicative")
    for x in items:
        iid = x.get("id")
        c.ok(x.get("kind") in M07_KINDS, "%s: kind must be one of %s" % (iid, M07_KINDS))
        c.ok(isinstance(x.get("value"), (int, float)) and not isinstance(x.get("value"), bool) and x["value"] > 0, "%s: value must be a positive number" % iid)
        c.ok(all(isinstance(x.get(k), str) and x[k].strip() for k in ("group", "name", "unit", "basis")), "%s: group/name/unit/basis are required" % iid)
        c.ok(isinstance(x.get("basis"), str) and CYR.search(x["basis"]), "%s: basis must be a Bulgarian sentence" % iid)
        if x.get("kind") == "ориентировъчно":
            c.ok(isinstance(x.get("why"), str) and WHY_MARK.search(x["why"]), "%s: a model item must say it is indicative" % iid)
        if "since" in x:
            c.ok(isinstance(x["since"], str) and ISO.match(x["since"]), "%s: since must be an ISO date" % iid)
    # --- the flat numbers the calculator reads
    for key, iid in M07_FLAT:
        c.ok(iid in by and doc.get(key) == by[iid].get("value"), "%s (%r) differs from item %s (%r)" % (key, doc.get(key), iid, (by.get(iid) or {}).get("value")))
    tob = sorted((x for x in items if x.get("id", "").startswith("tobacco-excise-pack-")), key=lambda x: x.get("since", ""))
    c.ok(len(tob) >= 3 and all("since" in x for x in tob), "the tobacco excise steps need one item per step, each with since")
    cur = [x for x in tob if x.get("since", "9") <= meta.get("asOf", "")]
    c.ok(bool(cur) and doc.get("tobaccoExcisePerPackEur") == cur[-1].get("value"),
         "tobaccoExcisePerPackEur must equal the step in force on %s (%s)" % (meta.get("asOf"), cur[-1].get("value") if cur else None))
    real_flat = {"vatRatePct", "fuelExcisePerLitreEur", "tobaccoExcisePerPackEur"}
    model_flat = {"vatShareOfPurchases", "fuelPricePerLitreEur", "tobaccoPricePerPackEur"}
    c.ok(set(meta.get("realFields") or []) == real_flat and set(meta.get("modelFields") or []) == model_flat,
         "meta.realFields / modelFields must be the flat keys %s / %s" % (sorted(real_flat), sorted(model_flat)))
    for key, iid in M07_FLAT:
        want = "официална ставка" if key in real_flat else "ориентировъчно"
        c.ok((by.get(iid) or {}).get("kind") == want, "item %s must be labelled %r" % (iid, want))
    c.ok(0 < doc.get("vatShareOfPurchases", 0) <= 1, "vatShareOfPurchases must be a share between 0 and 1")
    c.ok(doc.get("fuelPricePerLitreEur", 0) * 5.0 / 6.0 > doc.get("fuelExcisePerLitreEur", 9) and
         doc.get("tobaccoPricePerPackEur", 0) * 5.0 / 6.0 > doc.get("tobaccoExcisePerPackEur", 9),
         "a price without VAT must exceed the excise it carries (fuel and cigarettes)")
    # --- the real rates against the law's motives
    txt = inp.text(MOTIVES_TXT)
    if txt is None:
        c.warn("the motives extract is not on disk (tmp/research/mf-umtbf-2026-2028/extracts/docx_motives.txt): real rates not re-checked")
        return
    s = r"\s*‖\s*‖\s*(\d+)\s*‖"
    checks = [
        ("vat-standard", r"Размер на данъчната ставка за облагане с ДДС ‖ % ‖ (\d+) ‖", 1.0),
        ("vat-reduced-accommodation", r"настаняване, предоставяно в хотели и подобни заведения" + s, 1.0),
        ("vat-reduced-books", r"доставка на книги на физически носители[^\n‖]*" + s, 1.0),
        ("vat-reduced-baby-food", r"храни, подходящи за бебета или за малки деца по приложение № 4 от ЗДДС" + s, 1.0),
        ("vat-reduced-baby-hygiene", r"бебешки пелени и подобни бебешки хигиенни артикули по приложение № 4 от ЗДДС" + s, 1.0),
        ("fuel-excise-petrol", r"Акциз на безоловен бензин ‖ евро/1000 л\. ‖ ([\d ,]+) евро/1000 л\.", 1000.0),
        ("fuel-excise-diesel", r"Акциз на газьол[^‖\n]*‖ евро/1000 л\. ‖ ([\d ,]+) евро/1000 л\.", 1000.0),
        ("fuel-excise-lpg", r"използван като моторно гориво\s*‖\s*‖ ([\d ,]+) евро/1000 л\.", 1000.0),
    ]
    got = 0
    for iid, rx, div in checks:
        nums = motives_nums(txt, rx)
        if nums is None:
            c.fail("%s: the row was not found in the motives extract (pattern %r)" % (iid, rx[:50]))
            continue
        got += 1
        c.ok(abs((by.get(iid) or {}).get("value", -1) - nums[0] / div) <= 1e-9, "%s: %r differs from the law's motives (%s / %d)" % (iid, (by.get(iid) or {}).get("value"), nums[0], div))
    cig = motives_nums(txt, r"Акциз на цигари - общ[^\n]*?‖ [\d ,]+ евро/1000 къса ‖ ([\d ,]+) евро/1000 къса \(от 1 януари 2026 г\.\) / ([\d ,]+) евро/1000 къса "
                            r"\(от 1 август 2026 г\.\) ‖ ([\d ,]+) евро/1000 къса \(от 1 март 2027 г\.\)")
    if cig is None:
        c.fail("the cigarette excise row was not found in the motives extract")
    else:
        got += 1
        for x, per1000 in zip(tob, cig):
            c.ok(abs(x["value"] - round(per1000 * 20.0 / 1000.0, 2)) <= 1e-9,
                 "%s: %r differs from the law's %s per 1000 cigarettes x 20 / 1000" % (x["id"], x["value"], per1000))
        c.ok([x["since"] for x in tob][:3] == ["2026-01-01", "2026-08-01", "2027-03-01"], "the tobacco steps must start 2026-01-01, 2026-08-01 and 2027-03-01")
    c.fact("%d flat numbers = items (tobacco %s €/pack from 2026-08); %d real rates re-read from the motives' Annex 2 (VAT 20/9%%, petrol/diesel/LPG per 1000 l, "
           "cigarettes per 1000 pcs x 20), model items labelled ориентировъчно: %s"
           % (len(M07_FLAT) + 1, doc.get("tobaccoExcisePerPackEur"), got, ", ".join(k for k, i in M07_FLAT if k in model_flat)))

CHECKS = collections.OrderedDict([("M06", (check_m06, ["items"])), ("M07", (check_m07, ["items"]))])

def run_dataset(dsid, inp, registry):
    c = Check(dsid)
    fn, rec_paths = CHECKS[dsid]
    doc, _ = load_file(c, os.path.join(L.OUT_DIR, L.FILES[dsid]), dsid)
    if not isinstance(doc, dict):
        return c
    for step in (lambda: check_meta(c, doc, dsid, registry), lambda: check_scans(c, doc),
                 lambda: check_records(c, doc, rec_paths) if dsid != "M07" else None, lambda: fn(c, doc, inp)):
        try:
            step()
        except Exception as e:                       # a check that cannot run is a violation, never a silent pass
            c.fail("the check crashed: %s: %s" % (type(e).__name__, e))
    return c

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', default='M06,M07')
    args = parser.parse_args(argv)
    wanted = args.only.split(',')
    if any(name not in CHECKS for name in wanted):
        parser.error('only M06 and M07 are supported')
    inputs = Inputs()
    registry = inputs.data('core.json')['sources']
    failed = 0
    for name in wanted:
        check = run_dataset(name, inputs, registry)
        failed += len(check.problems)
        print(name, 'PASS' if not check.problems else 'FAIL', check.problems)
    return int(bool(failed))

if __name__ == '__main__':
    sys.exit(main())
