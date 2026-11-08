#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""validate_mock.py - checks the nine MOCK files of the „Бюджет на светло“ prototype against every constraint of the brief.

    python3 tools/validate_mock.py                 # all checks, one OK/FAIL line per dataset, exit 1 on any violation
    python3 tools/validate_mock.py --only M03,M04  # some datasets (M01-M07, TEXT = glossary + guide, PROTO = prototype/ hashes)
    python3 tools/validate_mock.py -v              # also print the key numbers of every check
    python3 tools/validate_mock.py --no-rebuild    # skip the reproducibility run (build_mock.py --check, build_text.py --check)

Pure Python 3 standard library. Nothing is written, nothing is fetched. It re-derives every number a mock set is tied to from
the real files on disk (site/data/*.json of DATA, tools/mock/cache/*, prototype/src/*, the motives extract under tmp/research/ when
it is there) and compares; it never imports the builder, so a mistake in build_mock.py cannot hide itself.

Checks of every file:   it parses (no NaN), it is the canonical minified form of mock_lib.jdumps, size <= 150 KB; meta
(id, status "mock", source keys of the core.json registry, seed 20261002, constrainedBy, real/model field lists that exist);
every record of every record list carries "mock": true and a Bulgarian "why" that says plainly the data are examples; no mixed
Cyrillic/Latin words, no emoji, no mention of private channels or of project members anywhere in site/data.
Per dataset the constraints of the brief (M01 ... M07) are re-computed below.

Exit status 0 = every check passed, 1 = at least one violation (listed), 2 = bad usage.
"""
import argparse
import collections
import datetime
import hashlib
import json
import math
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mock_lib as L  # noqa: E402

DATASETS = ["M01", "M02", "M03", "M04", "M05", "M06", "M07"]
EXTRA = ["TEXT", "PROTO"]
MAX_BYTES = 150 * 1024
TEXT_FILES = ["glossary.json", "guide.json"]
MOTIVES_TXT = os.path.join(L.TMP, "research", "mf-umtbf-2026-2028", "extracts", "docx_motives.txt")   # not in the repository (optional)
PROTO_SHA = os.path.join(L.HERE, "prototype.sha256")

CYR = re.compile("[\u0400-\u04ff]")
LAT = re.compile("[A-Za-z]")
WORD = re.compile(r"[^\W\d_]+", re.UNICODE)
EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27bf\u2b00-\u2bff\ufe0f\u200d\u20e3]")
FORBIDDEN = re.compile(r"private channel|частен канал|\.secrets|\b\d{17,19}\b", re.I)
WHY_MARK = re.compile("пример|измислен|ориентировъч", re.I)          # stems: example / invented / indicative (not just "model")
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
        c.fail("real input site/data/%s is missing or unreadable (run tools/build_data.py first)" % name)
    return d


def t10(x):
    """A value with one decimal -> integer tenths (exact)."""
    return int(round(x * 10))


def bg(x, d=1):
    return ("{:,.%df}" % d).format(x).replace(",", " ").replace(".", ",")


# ----------------------------------------------------------------------------------------------------- generic walkers
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


def keys_of(obj):
    """Every dict key of a JSON tree."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            for x in keys_of(v):
                yield x
    elif isinstance(obj, list):
        for v in obj:
            for x in keys_of(v):
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


# ----------------------------------------------------------------------------------------------------- common checks
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
        c.fail("not the canonical minified form of mock_lib.jdumps (first difference at character %d: %r vs %r)"
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


# ===================================================================================================== M01
def check_m01(c, doc, inp):
    """Здравеопазване and Образование: 12-20 activities each, descriptive names, no ЕБК codes, per function the activities
    add up EXACTLY to the real item of Табл. III-1 (2026); 2025 = 2026 / the item's real growth +-3% per activity."""
    ex = need(c, inp, "expenditure.json")
    if ex is None:
        return
    fx = ex["functions"]
    real = dict((it["id"], it) for it in fx["items"])
    funcs, items = doc.get("functions"), doc.get("items")
    if not (isinstance(funcs, list) and isinstance(items, list)):
        c.fail("functions and items must be lists")
        return
    c.ok(sorted(f.get("id") for f in funcs) == ["obrazovanie", "zdraveopazvane"],
         "functions must be exactly zdraveopazvane (Здравеопазване) and obrazovanie (Образование)")
    m = doc["meta"]
    c.ok(m.get("years") == fx["years"][:2], "meta.years differ from expenditure.json")
    c.ok(m.get("vintage") == fx["vintage"][:2] and m.get("yearLabels") == fx["yearLabels"][:2],
         "meta.vintage / yearLabels differ from expenditure.json")
    ids = [x.get("id") for x in items]
    c.ok(len(set(ids)) == len(ids), "activity ids are not unique")
    for f in funcs:
        fid = f.get("id")
        it = real.get(fid)
        if it is None:
            c.fail("function %r is not in expenditure.json" % fid)
            continue
        c.ok(f.get("name") == it["name"], "%s: name differs from the real item" % fid)
        m25, m26 = t10(it["mln"][0]), t10(it["mln"][1])
        g = m26 / float(m25)
        rows = [x for x in items if x.get("function") == fid]
        c.ok(12 <= len(rows) <= 20, "%s: %d activities, expected 12-20" % (fid, len(rows)))
        c.ok(f.get("activities") == len(rows), "%s: activities is %r, there are %d" % (fid, f.get("activities"), len(rows)))
        s25 = sum(t10(x["mln"][0]) for x in rows)
        s26 = sum(t10(x["mln"][1]) for x in rows)
        c.ok(s26 == m26, "%s: activities add up to %s, the real item of Табл. III-1 (2026) is %s"
             % (fid, s26 / 10.0, m26 / 10.0))
        c.ok(s25 == m25, "%s: 2025 activities add up to %s, the real item is %s" % (fid, s25 / 10.0, m25 / 10.0))
        c.ok([t10(v) for v in f.get("totalMln", [])] == [m25, m26], "%s: totalMln differs from the real item" % fid)
        c.ok(abs(f.get("growthPct", 1e9) - (g - 1.0) * 100.0) <= 0.006,
             "%s: growthPct %r, the real growth is %.2f" % (fid, f.get("growthPct"), (g - 1.0) * 100.0))
        worst = 0.0
        for x in rows:
            a25, a26 = t10(x["mln"][0]), t10(x["mln"][1])
            exp25 = a26 / g
            dev = abs(a25 - exp25) / exp25
            worst = max(worst, dev)
            if dev > 0.03 + 1e-9:
                c.fail("%s: the 2025 value %s is %.2f%% from 2026 / growth (limit 3%%)" % (x["id"], a25 / 10.0, dev * 100))
            c.ok(abs(x.get("growthPct", 1e9) - (a26 / float(a25) - 1.0) * 100.0) <= 0.06,
                 "%s: growthPct is inconsistent with its two amounts" % x["id"])
            c.ok(a25 > 0 and a26 > 0, "%s: an amount is not positive" % x["id"])
            nm = x.get("name")
            c.ok(isinstance(nm, str) and 8 <= len(nm) <= 90 and CYR.search(nm),
                 "%s: the name must be a descriptive Bulgarian name" % x["id"])
            if isinstance(nm, str) and re.search(r"\d{3,}|\d+\.\d+\.\d+|\d{4}\.\d{2}", nm):
                c.fail("%s: the name looks like it holds an ЕБК code: %r" % (x["id"], nm))
        names = [x.get("name") for x in rows]
        c.ok(len(set(names)) == len(names), "%s: activity names are not unique" % fid)
        gids = [gg.get("id") for gg in f.get("groups", [])]
        c.ok(len(gids) >= 3 and len(set(gids)) == len(gids), "%s: expected at least 3 distinct groups" % fid)
        t25 = t26 = ta = 0
        for gr in f.get("groups", []):
            grows = [x for x in rows if x.get("group") == gr.get("id")]
            c.ok(len(grows) >= 2, "%s: the group has %d activities (at least 2 expected)" % (gr.get("id"), len(grows)))
            c.ok(gr.get("activities") == len(grows), "%s: the activities count is wrong" % gr.get("id"))
            e25 = sum(t10(x["mln"][0]) for x in grows)
            e26 = sum(t10(x["mln"][1]) for x in grows)
            c.ok([t10(v) for v in gr.get("mln", [])] == [e25, e26],
                 "%s: the group amounts differ from the sum of its activities" % gr.get("id"))
            t25 += e25
            t26 += e26
            ta += len(grows)
        c.ok((t25, t26, ta) == (m25, m26, len(rows)), "%s: the groups do not add up to the function" % fid)
        c.ok(all(x.get("group") in gids for x in rows), "%s: an activity names an unknown group" % fid)
        c.fact("%s: %s млн. € in 2026 (real %s), 2025 %s, %d activities, worst 2025 deviation %.2f%%"
               % (fid, bg(s26 / 10.0), bg(m26 / 10.0), bg(s25 / 10.0), len(rows), worst * 100))


# ===================================================================================================== M02
M02_MINISTRIES = ["1000", "1500", "1700"]               # МФ, МТСП, МОН
M02_KEYS = ["id", "name", "unit", "better", "decimals", "target2024", "achieved2024", "deviationPct", "met", "target2026",
            "mock", "why"]


def check_m02(c, doc, inp):
    """2-3 result indicators for EVERY program of МФ, МОН and МТСП; achieved2024 = target +-10%; no 2026 achieved values."""
    prg = need(c, inp, "programs.json")
    mins = need(c, inp, "ministries.json")
    if prg is None or mins is None:
        return
    f = prg["fields"]
    ix = dict((k, f.index(k)) for k in ("ministry", "code", "name", "level", "y2026"))
    nodata = (prg.get("sentinels") or {}).get("noData", -1)
    real = collections.OrderedDict()
    for row in prg["items"]:
        if row[ix["level"]] == "program" and row[ix["ministry"]] in M02_MINISTRIES:
            if row[ix["y2026"]] == nodata:                     # a program WITHOUT a 2026 amount (named or not) is only a placeholder
                continue
            if not row[ix["name"]]:
                c.fail("programs.json: program %s has money but no name" % row[ix["code"]])
                continue
            real[row[ix["code"]]] = (row[ix["ministry"]], row[ix["name"]])
    items = doc.get("items") or []
    got = collections.OrderedDict((it.get("code"), it) for it in items)
    c.ok(len(got) == len(items), "program codes are not unique")
    missing = [k for k in real if k not in got]
    extra = [k for k in got if k not in real]
    c.ok(not missing, "programs of МФ/МТСП/МОН without indicators: %s" % ", ".join(missing[:8]))
    c.ok(not extra, "programs that programs.json does not have: %s" % ", ".join(str(k) for k in extra[:8]))
    for k in keys_of(doc):
        if re.search(r"(achieved|actual|outturn|reported)\w*20(2[5-9])|20(2[5-9])\w*(achieved|actual|outturn|reported)", k, re.I):
            c.fail("key %r: only achieved2024 may exist; 2026 has targets only" % k)
        if re.match(r"^achieved\d{4}$", k) and k != "achieved2024":
            c.fail("key %r: only achieved2024 may exist" % k)
    c.ok(doc["meta"].get("achievedYear") == 2024, "meta.achievedYear must be 2024")
    count = dict((m, [0, 0]) for m in M02_MINISTRIES)
    worst = 0.0
    n_ind = 0
    for code, it in got.items():
        r = real.get(code)
        if r is None:
            continue
        c.ok(it.get("id") == code and it.get("ministry") == r[0] and it.get("name") == r[1],
             "%s: id / ministry / name differ from programs.json" % code)
        inds = it.get("indicators") or []
        c.ok(2 <= len(inds) <= 3, "%s: %d indicators, expected 2-3" % (code, len(inds)))
        count[r[0]][0] += 1
        count[r[0]][1] += len(inds)
        n_ind += len(inds)
        c.ok(len(set(d.get("name") for d in inds)) == len(inds), "%s: indicator names repeat" % code)
        for n, d in enumerate(inds, 1):
            iid = d.get("id")
            c.ok(list(d.keys()) == M02_KEYS, "%s: keys are %s" % (iid, list(d.keys())))
            c.ok(iid == "%s-i%d" % (code, n), "%s: id must be %s-i%d" % (iid, code, n))
            dec, unit, better = d.get("decimals"), d.get("unit"), d.get("better")
            if not (isinstance(dec, int) and 0 <= dec <= 3):
                c.fail("%s: decimals must be 0-3" % iid)
                continue
            c.ok(better in ("up", "down"), "%s: better must be up or down" % iid)
            c.ok(isinstance(unit, str) and unit.strip(), "%s: unit is missing" % iid)
            sc = 10 ** dec
            tS, aS = int(round(d["target2024"] * sc)), int(round(d["achieved2024"] * sc))
            c.ok(abs(d["target2024"] * sc - tS) < 1e-6 and abs(d["achieved2024"] * sc - aS) < 1e-6,
                 "%s: more decimals than 'decimals' says" % iid)
            c.ok(tS > 0, "%s: target2024 must be positive" % iid)
            if tS <= 0:
                continue
            dev = abs(aS - tS) / float(tS)
            worst = max(worst, dev)
            c.ok(dev <= 0.10 + 1e-9, "%s: achieved2024 %s is %.1f%% from the target %s (limit 10%%)"
                 % (iid, d["achieved2024"], dev * 100, d["target2024"]))
            c.ok(abs(d["deviationPct"] - round((aS / float(tS) - 1.0) * 100.0, 1)) <= 0.051,
                 "%s: deviationPct %r is wrong" % (iid, d["deviationPct"]))
            c.ok(d["met"] == ((aS >= tS) if better == "up" else (aS <= tS)), "%s: met is inconsistent" % iid)
            if unit == "%":
                for k in ("target2024", "achieved2024", "target2026"):
                    c.ok(0 <= d[k] <= 100, "%s: %s = %s is a percentage over 100" % (iid, k, d[k]))
            c.ok(isinstance(d.get("target2026"), (int, float)) and d["target2026"] > 0, "%s: target2026 is missing" % iid)
    mrow = dict((m["id"], m) for m in mins["items"])
    ml = doc.get("ministries") or []
    c.ok([m.get("id") for m in ml] == M02_MINISTRIES, "ministries must be %s in this order" % M02_MINISTRIES)
    for m in ml:
        mid = m.get("id")
        rm = mrow.get(mid)
        if rm is None:
            c.fail("ministry %s is not in ministries.json" % mid)
            continue
        c.ok(m.get("name") == rm["name"] and m.get("short") == rm.get("short", ""), "%s: name/short differ" % mid)
        c.ok((m.get("programs"), m.get("indicators")) == tuple(count.get(mid, [-1, -1])),
             "%s: programs/indicators counts are %r/%r, computed %r" % (mid, m.get("programs"), m.get("indicators"), count.get(mid)))
    c.fact("%d programs (МФ %d, МТСП %d, МОН %d), %d indicators, worst achieved2024 deviation %.1f%%"
           % (len(got), count["1000"][0], count["1500"][0], count["1700"][0], n_ind, worst * 100))


# ===================================================================================================== M03
def motives_number(txt, pattern):
    """A number like '6 881,9' from the motives extract, as float; None when the text is not on disk."""
    if txt is None:
        return None
    m = re.search(pattern, txt)
    if not m:
        return None
    return float(re.sub("[ \u00a0\u202f]", "", m.group(1)).replace(",", "."))


def check_m03(c, doc, inp):
    """All 265 municipalities; sum of expenditure 6 881,9 млн. €; own revenue = expenditure - real transfers +- a small balance
    (|balance| <= 3%, sum 0); bigger cities have more own revenue per resident; plausible debt; quarterly split."""
    gis = inp.json(L.GISCO_JSON)
    tr = inp.json(L.TRANSFERS_JSON)
    if gis is None or tr is None:
        c.fail("cache inputs are missing: %s / %s" % (os.path.relpath(L.GISCO_JSON, L.ROOT), os.path.relpath(L.TRANSFERS_JSON, L.ROOT)))
        return
    items, regions, tot = doc.get("items") or [], doc.get("regions") or [], doc.get("totals") or {}
    lau = dict((x["id"], x) for x in gis["items"])
    d19 = inp.data("municipalities.json")                  # the real set of DATA: the single source of the population
    pop19 = dict((x["id"], x["population"]) for x in ((d19 or {}).get("items") or [])
                 if x.get("id") and isinstance(x.get("population"), int))
    if not pop19:
        c.warn("site/data/municipalities.json is not on disk: the population is compared with the GISCO cache only")
    ids = [x.get("id") for x in items]
    c.ok(len(items) == 265, "%d municipalities, expected 265" % len(items))
    c.ok(len(set(ids)) == len(ids) and ids == sorted(ids), "ids must be unique and sorted")
    c.ok(set(ids) == set(lau), "the ids differ from the GISCO LAU list (%d only in the file, %d only in GISCO)"
         % (len(set(ids) - set(lau)), len(set(lau) - set(ids))))
    real_tr = sorted(t10(m.get("total") or 0.0) + t10(m.get("other_targeted") or 0.0) for m in tr["municipalities"])
    c.ok(len(real_tr) == 265, "the real transfers file has %d rows, expected 265" % len(real_tr))
    c.ok(sorted(t10(x["transfers"]) for x in items) == real_tr, "the transfers per municipality are not the real ones (ЗДБ чл. 51)")
    S = dict((k, 0) for k in ("e", "o", "t", "b", "d", "pop"))
    worst_bal = worst_debt = 0.0
    per, pops = [], []
    for x in items:
        mid = x["id"]
        g = lau.get(mid)
        if g is not None:
            c.ok(x.get("name") == g["name"], "%s: the name differs from GISCO" % mid)
            want = pop19.get(mid, int(g["pop"]))
            c.ok(x.get("population") == want, "%s: population %s differs from %s (%s; run tools/build_mock.py)"
                 % (mid, x.get("population"), want, "municipalities.json" if mid in pop19 else "the GISCO cache"))
        c.ok(x.get("regionId") == mid[:3], "%s: regionId must be the first three characters of the id" % mid)
        e, o, t, b, d = (t10(x[k]) for k in ("expenditure", "ownRevenue", "transfers", "balance", "debt"))
        c.ok(e == t + o + b, "%s: expenditure %s != transfers %s + own revenue %s + balance %s"
             % (mid, e / 10.0, t / 10.0, o / 10.0, b / 10.0))
        c.ok(e > 0 and o >= 0 and t >= 0 and d >= 0, "%s: a negative or zero amount" % mid)
        if e > 0:
            worst_bal = max(worst_bal, abs(b) / float(e))
            worst_debt = max(worst_debt, d / float(e))
            c.ok(abs(b) <= 0.03 * e, "%s: |balance| %.2f%% of expenditure (limit 3%%)" % (mid, abs(b) / float(e) * 100))
            c.ok(d <= 0.31 * e, "%s: debt %.1f%% of annual expenditure is not plausible" % (mid, d / float(e) * 100))
        q = x.get("quarterly") or []
        if len(q) == 2 and e > 0:
            rev = e - b
            c.ok([r.get("q") for r in q] == [1, 2], "%s: quarterly must be Q1 and Q2" % mid)
            q1e, q2e, q1r, q2r = (t10(q[0]["expenditure"]), t10(q[1]["expenditure"]), t10(q[0]["revenue"]), t10(q[1]["revenue"]))
            c.ok(0.17 <= q1e / float(e) <= 0.27 and 0.38 <= q2e / float(e) <= 0.55, "%s: the quarterly expenditure path is implausible" % mid)
            c.ok(0.15 <= q1r / float(rev) <= 0.30 and 0.30 <= q2r / float(rev) <= 0.60, "%s: the quarterly revenue path is implausible" % mid)
            c.ok(q1e < q2e and q1r < q2r, "%s: quarters are cumulative, Q2 must exceed Q1" % mid)
        else:
            c.fail("%s: quarterly must hold the first two quarters" % mid)
        S["e"] += e
        S["o"] += o
        S["t"] += t
        S["b"] += b
        S["d"] += d
        S["pop"] += x.get("population", 0)
        pops.append(x.get("population", 0))
        per.append(o / 10.0 / max(1, x.get("population", 1)))
    exp_t = t10(L.MUNICIPAL_EXP_MLN * 1000.0)
    c.ok(S["e"] == exp_t, "expenditure adds up to %s хил. €, expected %s (6 881,9 млн. €)" % (S["e"] / 10.0, exp_t / 10.0))
    c.ok(S["b"] == 0, "the balances add up to %s хил. €, expected 0" % (S["b"] / 10.0))
    c.ok(S["o"] == S["e"] - S["t"], "own revenue does not equal expenditure - transfers")
    c.ok(0.02 <= S["d"] / float(S["e"]) <= 0.12, "total debt is %.1f%% of expenditure, not plausible" % (S["d"] / float(S["e"]) * 100))
    rho = L.spearman(pops, per)
    c.ok(rho >= 0.5, "own revenue per resident hardly rises with size (Spearman %.2f, expected >= 0.5)" % rho)
    order = sorted(range(len(items)), key=lambda i: -pops[i])
    top = sum(per[i] for i in order[:10]) / 10.0
    med = sorted(per)[len(per) // 2]
    c.ok(top > med, "the 10 biggest municipalities must have more own revenue per resident than the median one")
    c.ok((t10(tot.get("expenditure", 0)), t10(tot.get("ownRevenue", 0)), t10(tot.get("transfers", 0)), t10(tot.get("balance", 0)),
          t10(tot.get("debt", 0)), tot.get("population")) == (S["e"], S["o"], S["t"], S["b"], S["d"], S["pop"]),
         "totals differ from the sums of items")
    # regions
    byr = collections.OrderedDict()
    for x in items:
        a = byr.setdefault(x["regionId"], [x["region"], 0, 0, 0, 0, 0])
        a[1] += x["population"]
        a[2] += t10(x["expenditure"])
        a[3] += t10(x["ownRevenue"])
        a[4] += t10(x["transfers"])
        a[5] += t10(x["debt"])
        c.ok(a[0] == x["region"], "%s: the region name differs inside oblast %s" % (x["id"], x["regionId"]))
    c.ok([r.get("id") for r in regions] == sorted(byr), "regions must be the %d oblasts of the items, sorted" % len(byr))
    for r in regions:
        a = byr.get(r.get("id"))
        if a is None:
            continue
        c.ok((r["name"], r["population"], t10(r["expenditure"]), t10(r["ownRevenue"]), t10(r["transfers"]), t10(r["debt"])) == tuple(a),
             "%s: the region differs from the sum of its municipalities" % r.get("id"))
    txt = inp.text(MOTIVES_TXT)
    mexp = motives_number(txt, r"разходи за общините за 2026 г\. в размер на ([\d  ]+,\d) млн")
    mrev = motives_number(txt, r"общински приходи за 2026 г\. са в размер на ([\d  ]+,\d) млн")
    if mexp is None:
        c.warn("the motives extract is not on disk: 6 881,9 not re-checked against the source text")
    else:
        c.ok(abs(mexp - L.MUNICIPAL_EXP_MLN) < 0.05, "the motives say %s млн. € of municipal expenditure, the builder uses %s" % (mexp, L.MUNICIPAL_EXP_MLN))
    note = ""
    if mrev is not None:
        note = "; own revenue implied %s vs АСБП %s млн. € (difference %s)" % (
            bg(S["o"] / 10000.0), bg(mrev), bg(abs(mrev - S["o"] / 10000.0)))
    if pop19:
        gd = sorted(i for i in pop19 if i in lau and pop19[i] != int(lau[i]["pop"]))
        note += "; population = municipalities.json (%s)" % (
            "same as the GISCO cache for all %d" % len(pop19) if not gd else
            "differs from the GISCO cache for %d: %s" % (len(gd), ", ".join(gd[:6])))
    c.fact("265 municipalities, %d oblasts; expenditure %s млн. € = transfers %s (real) + own revenue %s + balance %s; "
           "max |balance| %.2f%%, max debt %.1f%%, Spearman(size, own revenue per resident) %.2f%s"
           % (len(byr), bg(S["e"] / 10000.0), bg(S["t"] / 10000.0), bg(S["o"] / 10000.0), bg(S["b"] / 10000.0),
              worst_bal * 100, worst_debt * 100, rho, note))


# ===================================================================================================== M04
M04_TYPES = ["exp.personnel", "exp.maint", "exp.subsidies", "exp.social", "exp.capex", "other"]
HOLIDAYS = ["2026-01-01", "2026-03-03", "2026-04-10", "2026-04-13", "2026-05-01", "2026-05-06"]   # weekday holidays, Jan-Aug 2026


def law_weights(lines):
    """[personnel, maintenance, subsidies, social, capital, other] of one budget in the law (section II of its expenditure
    lines): the real economic structure the mock payments of that institution must follow."""
    cur = pers = subs = soc = cap = oth = 0.0
    has_pers = False
    for sec, n, label, val in lines:
        if sec != "II" or n in ("II", ""):
            continue
        v = float(val) if val is not None else 0.0
        if n == "1":
            cur = v
        elif n == "1.1":
            pers, has_pers = v, True
        elif n in ("1.2", "1.3", "1.4"):
            if label.startswith("Субсидии"):
                subs += v
            elif label.startswith("Текущи трансфери, обезщетения"):
                soc += v
        elif n == "2":
            cap = v
        elif n == "3":
            oth = v
    if not has_pers:
        pers = 0.5 * cur            # the three budgets without a personnel line: half of the current expenditure
    return [pers, max(0.0, cur - pers - subs - soc), subs, soc, cap, oth]


def working_days(month_from=1, month_to=8):
    d = datetime.date(2026, month_from, 1)
    out = []
    while d.month <= month_to:
        if d.weekday() < 5 and d.isoformat() not in HOLIDAYS:
            out.append(d.isoformat())
        d += datetime.timedelta(days=1)
    return out


def check_m04(c, doc, inp):
    """SEBRA-like payments Jan-Aug 2026 by institution, type, day and recipient: institution shares follow the real
    expenditure of the law, types its real economic structure, monthly totals stay under the real national-budget expenditure;
    recipients are invented (ЕИК 999xxxxxx); size <= 150 KB (checked with the file)."""
    mins = need(c, inp, "ministries.json")
    exe = need(c, inp, "execution.json")
    law = inp.json(L.LAW_JSON)
    if law is None:
        c.fail("cache input %s is missing" % os.path.relpath(L.LAW_JSON, L.ROOT))
    if mins is None or exe is None or law is None:
        return
    tot = doc.get("totals") or {}
    months, bytype, byinst = doc.get("months") or [], doc.get("byType") or [], doc.get("byInstitution") or []
    daily, recs = doc.get("daily") or [], doc.get("recipients") or []
    meta = doc["meta"]
    c.ok(meta.get("period") == {"from": "2026-01-01", "to": "2026-08-31"}, "meta.period must be 2026-01-01 .. 2026-08-31")
    c.ok(meta.get("typeOrder") == M04_TYPES, "meta.typeOrder must be %s" % M04_TYPES)
    c.ok(meta.get("monthOrder") == ["2026-%02d" % m for m in range(1, 9)], "meta.monthOrder must be 2026-01 .. 2026-08")
    c.ok(meta.get("holidays") == HOLIDAYS, "meta.holidays differ from the official weekday holidays of 2026")
    # --- institutions follow the real budgets
    real = sorted(mins["items"], key=lambda x: x["id"])
    c.ok([x.get("id") for x in byinst] == [r["id"] for r in real], "institutions must be the %d budgets of ministries.json, sorted by id" % len(real))
    c.ok(len(real) == 46, "ministries.json has %d budgets, expected 46" % len(real))
    law_total = sum(float(r["expKhil"]) for r in real)
    tot_eur = tot.get("eur", 0)
    sum_eur = sum(x.get("eur", 0) for x in byinst)
    c.ok(sum_eur == tot_eur, "institutions add up to %s €, totals.eur is %s" % (sum_eur, tot_eur))
    pace = exe["pace"]["2025"]["exp.total"][7]
    c.ok(abs(tot_eur - round(law_total * 1000.0 * pace / 100.0)) <= 1,
         "totals.eur %s differs from the law's expenditure x the 2025 Jan-Aug pace (%s%%)" % (tot_eur, pace))
    law_by_art = law["law"]
    worst_share = worst_type = 0.0
    for r, x in zip(real, byinst):
        iid = r["id"]
        c.ok((x.get("name"), x.get("short"), x.get("kind"), x.get("lawExpKhil")) == (r["name"], r.get("short") or r["name"], r["kind"], float(r["expKhil"])),
             "%s: name/short/kind/lawExpKhil differ from ministries.json" % iid)
        e = x.get("eur", 0)
        c.ok(abs(x.get("shareOfLawExpPct", -1) - round(float(r["expKhil"]) / law_total * 100.0, 2)) <= 0.006, "%s: shareOfLawExpPct is wrong" % iid)
        c.ok(abs(x.get("shareOfPaymentsPct", -1) - round(e / float(tot_eur) * 100.0, 2)) <= 0.006, "%s: shareOfPaymentsPct is wrong" % iid)
        ratio = (e / float(tot_eur)) / (float(r["expKhil"]) / law_total) if tot_eur and r["expKhil"] else 0
        worst_share = max(worst_share, abs(ratio - 1.0))
        c.ok(0.85 <= ratio <= 1.15, "%s: its share of payments is %.2f x its share of the law's expenditure (limit 0.85-1.15)" % (iid, ratio))
        c.ok(sum(x.get("monthlyEur", [])) == e and len(x.get("monthlyEur", [])) == 8, "%s: monthlyEur does not add up to eur" % iid)
        c.ok(sum(x.get("byTypeEur", [])) == e and len(x.get("byTypeEur", [])) == 6, "%s: byTypeEur does not add up to eur" % iid)
        entry = law_by_art.get(str(r["art"]))
        if entry is None:
            c.fail("%s: no law budget (art. %s) in the cache" % (iid, r["art"]))
            continue
        w = law_weights(entry["lines"])
        ws = sum(w)
        for t in range(6):
            want = w[t] / ws * e if ws else 0.0
            dev = abs(x["byTypeEur"][t] - want)
            worst_type = max(worst_type, dev / float(e) if e else 0.0)
            if dev > 2.0:
                c.fail("%s: %s is %s €, the law's structure gives %.0f €" % (iid, M04_TYPES[t], x["byTypeEur"][t], want))
    rho = L.spearman([float(r["expKhil"]) for r in real], [x.get("eur", 0) for x in byinst])
    c.ok(rho >= 0.99, "institution payments do not follow the law's expenditure (Spearman %.3f)" % rho)
    # --- types
    c.ok([t.get("code") for t in bytype] == M04_TYPES, "byType codes must be %s" % M04_TYPES)
    c.ok(sum(t.get("eur", 0) for t in bytype) == tot_eur, "byType does not add up to totals.eur")
    for ti, t in enumerate(bytype):
        c.ok(t.get("eur") == sum(x["byTypeEur"][ti] for x in byinst), "%s: differs from the institutions' cells" % t.get("code"))
        c.ok(sum(t.get("monthlyEur", [])) == t.get("eur") and len(t.get("monthlyEur", [])) == 8, "%s: monthlyEur does not add up" % t.get("code"))
        c.ok(isinstance(t.get("name"), str) and t["name"].strip(), "%s: name is missing" % t.get("code"))
    # --- months against the real national-budget expenditure
    nat26, nat25 = exe["monthly"]["2026"]["nat"]["exp.total"], exe["monthly"]["2025"]["nat"]["exp.total"]
    caps, kinds = [], []
    for m in range(8):
        if m < len(nat26):
            caps.append(float(nat26[m]))
            kinds.append("real")
        else:
            caps.append(caps[-1] * float(nat25[m]) / float(nat25[m - 1]))
            kinds.append("model")
    c.ok(len(months) == 8, "months must hold 8 entries")
    worst_cap = 0.0
    for m, row in enumerate(months[:8]):
        c.ok(row.get("month") == "2026-%02d" % (m + 1), "months[%d].month is %r" % (m, row.get("month")))
        c.ok(row.get("eur", 0) <= caps[m] * 1e6, "%s: payments %s € exceed the national-budget expenditure of the month (%.1f млн. €, %s)"
             % (row.get("month"), row.get("eur"), caps[m], kinds[m]))
        worst_cap = max(worst_cap, row.get("eur", 0) / (caps[m] * 1e6))
        c.ok(abs(row.get("natExpMln", -1) - round(caps[m], 1)) <= 0.051 and row.get("natExpKind") == kinds[m],
             "%s: natExpMln/natExpKind differ from execution.json (%.1f, %s)" % (row.get("month"), caps[m], kinds[m]))
        c.ok(row.get("eur") == sum(x["monthlyEur"][m] for x in byinst) == sum(t["monthlyEur"][m] for t in bytype),
             "%s: the month differs from the institutions or the types" % row.get("month"))
    c.ok(sum(r.get("eur", 0) for r in months) == tot_eur and sum(r.get("count", 0) for r in months) == tot.get("count"),
         "months do not add up to the totals")
    c.ok(sum(x.get("count", 0) for x in byinst) == tot.get("count") == sum(t.get("count", 0) for t in bytype),
         "the payment-order counts of institutions / types / months differ")
    # --- days: only working days, every working day once, adding up to the months
    wd = working_days()
    c.ok([d.get("date") for d in daily] == wd, "daily must list every working day of Jan-Aug 2026 exactly once (%d days), got %d"
         % (len(wd), len(daily)))
    c.ok(tot.get("workingDays") == len(wd), "totals.workingDays must be %d" % len(wd))
    for m in range(8):
        key = "2026-%02d" % (m + 1)
        rows = [d for d in daily if str(d.get("date", "")).startswith(key)]
        c.ok(sum(d["eur"] for d in rows) == months[m]["eur"] and sum(d["count"] for d in rows) == months[m]["count"],
             "%s: days do not add up to the month" % key)
    c.ok(all(d.get("eur", 0) > 0 and d.get("count", 0) >= 1 for d in daily), "a day has no payments")
    # --- recipients: invented
    names, eiks = set(), set()
    inst_names = dict((x["name"], x) for x in byinst)
    by_inst_sum = collections.defaultdict(int)
    for r in recs:
        eik = r.get("eik", "")
        c.ok(re.match(r"^999\d{6}$", eik) is not None, "%r: an invented ЕИК must be 999 + six digits" % eik)
        c.ok(not L.eik9_is_valid(eik), "%s: the ЕИК has a VALID check digit, so it could be a real firm's number" % eik)
        c.ok(eik not in eiks and r.get("name") not in names, "%s: duplicate recipient" % eik)
        eiks.add(eik)
        names.add(r.get("name"))
        c.ok(re.match("Примерен |Примерна |Примерно ", r.get("name", "")) is not None, "%s: the name must start with Примерен/Примерна/Примерно" % eik)
        c.ok(isinstance(r.get("kind"), str) and isinstance(r.get("subject"), str) and r["kind"] and r["subject"], "%s: kind/subject missing" % eik)
        e = r.get("eur", 0)
        c.ok(e == sum(x["eur"] for x in r.get("byInstitution", [])) == sum(x["eur"] for x in r.get("byType", [])) and e > 0,
             "%s: eur differs from its byInstitution / byType" % eik)
        c.ok(r.get("count", 0) >= 1 and 0 < e <= r.get("paidEur", 0) <= r.get("contractedEur", 0),
             "%s: need 0 < eur <= paidEur <= contractedEur and count >= 1" % eik)
        tnames = [t["name"] for t in bytype]
        for x in r.get("byInstitution", []):
            c.ok(x["name"] in inst_names, "%s: unknown institution %r" % (eik, x["name"]))
            by_inst_sum[x["name"]] += x["eur"]
        for x in r.get("byType", []):
            c.ok(x["name"] in tnames, "%s: unknown type %r" % (eik, x["name"]))
        rsum = 0
        for p in r.get("recent", []):
            c.ok(p.get("date") in wd and p["date"] >= "2026-01-01", "%s: payment on %r, not a working day of the period" % (eik, p.get("date")))
            c.ok(p.get("institution") in [x["name"] for x in r["byInstitution"]] and p.get("type") in [x["name"] for x in r["byType"]],
                 "%s: a recent payment names an institution or type the recipient was not paid by" % eik)
            rsum += p.get("eur", 0)
        c.ok(rsum <= e, "%s: recent payments (%s) exceed its total (%s)" % (eik, rsum, e))
    for name, s in by_inst_sum.items():
        x = inst_names[name]
        room = x["byTypeEur"][1] + x["byTypeEur"][2] + x["byTypeEur"][4]
        c.ok(s <= room, "%s: recipients got %s €, more than its maintenance + subsidies + capital cells (%s €)" % (name, s, room))
    rec_eur = sum(r.get("eur", 0) for r in recs)
    c.ok(tot.get("recipients") == len(recs) and tot.get("recipientsEur") == rec_eur and 30 <= len(recs) <= 80,
         "totals.recipients / recipientsEur are inconsistent, or the number of recipients is outside 30-80")
    c.ok(rec_eur <= 0.10 * tot_eur, "the recipients' sample is %.1f%% of all payments (limit 10%%)" % (rec_eur / float(tot_eur) * 100))
    c.ok(tot.get("institutions") == len(byinst), "totals.institutions is wrong")
    c.fact("%s € in %s orders, %d institutions, %d working days, %d invented recipients (%.1f%% of payments); biggest month %.1f%% of "
           "the national-budget expenditure; institution share vs law within %.1f%%, type structure within %.3f%%; Spearman %.3f"
           % (tot_eur, tot.get("count"), len(byinst), len(daily), len(recs), rec_eur / float(tot_eur) * 100, worst_cap * 100,
              worst_share * 100, worst_type * 100, rho))


# ===================================================================================================== M05
M05_ASOF = "2026-08-31"
M05_STATUSES = ["planned", "building", "late", "done"]


def check_m05(c, doc, inp):
    """12-16 invented capital projects: plausible stages, financing that adds up, statuses that follow the stages, and a
    total that is a small plausible share of the real 9 360,6 млн. € capital-expenditure plan."""
    core = need(c, inp, "core.json")
    m03 = inp.data(os.path.join("mock", "municipal-finance.json"))
    if core is None:
        return
    if m03 is None:
        c.fail("M03 (mock/municipal-finance.json) is missing: the projects' oblasts are checked against it")
    meta, items, tot = doc["meta"], doc.get("items") or [], doc.get("totals") or {}
    capex = core["kpis"]["capex"]["planMln"]
    c.ok(abs(capex - L.CAPEX_PLAN_MLN) <= 0.05, "core.kpis.capex.planMln is %s, the brief says %s" % (capex, L.CAPEX_PLAN_MLN))
    c.ok(12 <= len(items) <= 16, "%d projects, the brief says 12-16" % len(items))
    c.ok([x.get("id") for x in items] == ["pr-%02d" % n for n in range(1, len(items) + 1)], "ids must be pr-01 ... pr-%02d, in order" % len(items))
    c.ok(meta.get("progressAsOf") == M05_ASOF, "meta.progressAsOf must be %s" % M05_ASOF)
    weights = meta.get("stageWeights")
    c.ok(isinstance(weights, list) and len(weights) == 4 and sum(weights) == 100, "meta.stageWeights must be four weights adding up to 100")
    c.ok([x.get("id") for x in meta.get("statusLabels", [])] == M05_STATUSES, "meta.statusLabels ids must be %s" % M05_STATUSES)
    c.ok([x.get("id") for x in meta.get("stageStatusLabels", [])] == ["done", "doing", "todo"], "meta.stageStatusLabels ids must be done, doing, todo")
    sources = meta.get("financingSources") or []
    c.ok(len(sources) >= 3 and len(set(sources)) == len(sources), "meta.financingSources must list the distinct financing sources")
    if not weights or len(weights) != 4:
        return
    regions = dict((r["id"], r["name"]) for r in (m03 or {}).get("regions", []))
    asof = datetime.date.fromisoformat(M05_ASOF)
    stage_names = None
    tot_t = year_t = paid_t = 0
    by_status = collections.OrderedDict((k, 0) for k in M05_STATUSES)
    for x in items:
        pid = x.get("id")
        c.ok(re.match("Примерен |Примерна |Примерно ", x.get("name", "")) is not None, "%s: the name must start with Примерен/Примерна/Примерно" % pid)
        if regions:
            c.ok(x.get("regionId") in regions and regions.get(x.get("regionId")) == x.get("region"), "%s: oblast %r / %r is not one of M03's" % (pid, x.get("regionId"), x.get("region")))
        c.ok(isinstance(x.get("expectedResult"), str) and x["expectedResult"].strip() and CYR.search(x["expectedResult"]), "%s: expectedResult missing" % pid)
        try:
            start, dead = datetime.date.fromisoformat(x["start"]), datetime.date.fromisoformat(x["deadline"])
        except (KeyError, ValueError):
            c.fail("%s: start / deadline are not ISO dates" % pid)
            continue
        st = x.get("stages") or []
        c.ok(len(st) == 4, "%s: four stages expected" % pid)
        if len(st) != 4:
            continue
        names = [s.get("name") for s in st]
        if stage_names is None:
            stage_names = names
        c.ok(names == stage_names, "%s: stage names differ from the other projects" % pid)
        seq = "".join({"done": "d", "doing": "g", "todo": "t"}.get(s.get("status"), "?") for s in st)
        c.ok(re.match(r"^d*g?t*$", seq) is not None and seq.count("g") <= 1, "%s: stage statuses %s are not done..., one doing, todo..." % (pid, seq))
        try:
            dates = [datetime.date.fromisoformat(s["date"]) for s in st]
        except (KeyError, ValueError):
            c.fail("%s: a stage date is not an ISO date" % pid)
            continue
        c.ok(all(a <= b for a, b in zip(dates, dates[1:])), "%s: stage dates must not decrease" % pid)
        c.ok(dates[3] == dead, "%s: the last stage must end on the deadline" % pid)
        c.ok(all(dates[i] <= asof for i in range(4) if st[i]["status"] == "done"), "%s: a stage is done but its date is after %s" % (pid, M05_ASOF))
        cend = dates[2]
        c.ok(start < cend < dead, "%s: need start < construction end < deadline" % pid)
        started = start <= asof
        c.ok(not started or seq[:2] == "dd", "%s: construction began on %s but the stages before it are not finished" % (pid, x["start"]))
        c.ok(seq[2] != "g" or started, "%s: construction is under way but starts on %s, after %s" % (pid, x["start"], M05_ASOF))
        now = None if "g" not in seq and "t" not in seq else seq.find("g") if "g" in seq else seq.find("t")
        done_w = sum(w for w, s in zip(weights, seq) if s == "d")
        prog = x.get("progressPct")
        if now is None:
            c.ok(prog == 100, "%s: all stages done, progress must be 100" % pid)
        else:
            top = done_w + (weights[now] if seq[now] == "g" else 0)
            c.ok(isinstance(prog, int) and done_w <= prog <= top, "%s: progress %s is outside the stages' range %d-%d" % (pid, prog, done_w, top))
        span = max(1, (cend - start).days)
        expected = sum(weights[:2]) + weights[2] * min(1.0, max(0.0, (asof - start).days / float(span)))
        if now is None:
            want = "done"
        elif start > asof:
            want = "planned"
        elif dead < asof or (isinstance(prog, int) and prog + 10 < expected):
            want = "late"
        else:
            want = "building"
        c.ok(x.get("status") == want, "%s: status %r, the stages and dates give %r" % (pid, x.get("status"), want))
        c.ok(want != "planned" or seq[2:] == "tt", "%s: planned, but construction is already under way" % pid)
        by_status[x.get("status")] = by_status.get(x.get("status"), 0) + 1
        # money
        t, y, p = x.get("totalMln"), x.get("yearMln"), x.get("paidMln")
        c.ok(all(isinstance(v, (int, float)) for v in (t, y, p)) and 0 < y <= t and 0 <= p <= t * (prog or 0) / 100.0 + 0.05,
             "%s: need 0 < yearMln <= totalMln and paidMln <= totalMln x progress" % pid)
        fin = x.get("financing") or []
        fs = [f.get("source") for f in fin]
        c.ok(len(fin) >= 1 and len(set(fs)) == len(fs) and all(s in sources for s in fs), "%s: financing sources must be distinct and listed in meta.financingSources" % pid)
        c.ok(sum(t10(f.get("mln", 0)) for f in fin) == t10(t or 0) and all(f.get("mln", 0) > 0 for f in fin),
             "%s: financing adds up to %.1f, totalMln is %s" % (pid, sum(t10(f.get("mln", 0)) for f in fin) / 10.0, t))
        tot_t += t10(t or 0)
        year_t += t10(y or 0)
        paid_t += t10(p or 0)
    c.ok(t10(tot.get("totalMln", -1)) == tot_t and t10(tot.get("yearMln", -1)) == year_t and t10(tot.get("paidMln", -1)) == paid_t and tot.get("projects") == len(items),
         "totals do not add up to the projects")
    share = 100.0 * (year_t / 10.0) / capex
    c.ok(abs(tot.get("yearSharePct", -1) - round(share, 2)) <= 0.006 and tot.get("capexPlanMln") == capex, "totals.yearSharePct / capexPlanMln are wrong")
    c.ok(0.5 <= share <= 5.0, "the projects' 2026 expenditure is %.2f%% of the capital plan, not a small plausible share (0.5-5%%)" % share)
    c.ok(dict(tot.get("byStatus", {})) == dict(by_status), "totals.byStatus is wrong: %s, expected %s" % (tot.get("byStatus"), dict(by_status)))
    c.fact("%d invented projects, total %s млн. €, 2026: %s млн. € = %.2f%% of the capital plan (%s); statuses %s"
           % (len(items), bg(tot_t / 10.0), bg(year_t / 10.0), share, bg(capex), ", ".join("%s %d" % kv for kv in by_status.items())))


# ===================================================================================================== M06
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


# ===================================================================================================== M07
M07_KINDS = ["реална ставка", "ориентировъчно"]
M07_FLAT = [("vatRatePct", "vat-standard"), ("vatShareOfPurchases", "vat-share-of-purchases"), ("fuelPricePerLitreEur", "fuel-price"),
            ("fuelExcisePerLitreEur", "fuel-excise-petrol"), ("tobaccoPricePerPackEur", "tobacco-price-pack")]
_NB = "\u00a0\u202f"                       # no-break spaces the extract may use as thousands separators


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
        want = "реална ставка" if key in real_flat else "ориентировъчно"
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


# ===================================================================================================== TEXT (glossary + guide)
def route_regexes(txt):
    """{route id: compiled regex of its pattern} read from site/js/routes.js rows R('S01', 'key', '/pattern', ...)."""
    out = collections.OrderedDict()
    for rid, pat in re.findall(r"^\s*R\('(S\d+)', '[^']+', (null|'[^']*')", txt or "", re.M):
        if pat == "null":
            continue
        rx = ""
        for seg in [s for s in pat.strip("'").split("/") if s]:
            m = re.match(r"^:(\w+)(?:\(([^)]+)\))?(\?)?$", seg)
            if m:
                part = "/" + ("(?:%s)" % m.group(2) if m.group(2) else "[^/]+")
                rx += "(?:%s)?" % part if m.group(3) else part
            else:
                rx += "/" + re.escape(seg)
        out[rid] = re.compile("^" + (rx or "/") + "$", re.I)
    return out


def href_route(routes, href):
    """The route id a '#/path?query' link resolves to (None = no such screen)."""
    if not isinstance(href, str) or not href.startswith("#/"):
        return None
    path = href[1:].split("?", 1)[0].rstrip("/") or "/"
    hits = [rid for rid, rx in routes.items() if rx.match(path)]
    return hits[0] if hits else None


def check_text_meta(c, doc, dsid, fname):
    m = doc.get("meta") if isinstance(doc, dict) else None
    if not isinstance(m, dict):
        c.fail("%s: no meta object" % fname)
        return
    c.ok(m.get("id") == dsid and m.get("status") == "real" and m.get("source") == ["wg"] and m.get("mock") is False,
         "%s: meta must be id %s, status \"real\" (the texts are the group's own), source [\"wg\"], mock false" % (fname, dsid))
    for k in ("asOf", "retrieved"):
        c.ok(isinstance(m.get(k), str) and ISO.match(m[k]), "%s: meta.%s must be an ISO date" % (fname, k))
    c.ok(isinstance(m.get("title"), str) and CYR.search(m["title"]) and isinstance(m.get("sourceNote"), str) and CYR.search(m["sourceNote"]),
         "%s: Bulgarian title and sourceNote are required" % fname)


def check_text(c, inp, no_rebuild):
    routes = route_regexes(inp.text(L.ROUTES_JS))
    c.ok(len(routes) >= 20, "site/js/routes.js: only %d routes could be read" % len(routes))
    gl, _ = load_file(c, os.path.join(L.DATA_DIR, "glossary.json"), "glossary.json")
    gd, _ = load_file(c, os.path.join(L.DATA_DIR, "guide.json"), "guide.json")
    for doc, dsid, fname in ((gl, "D22", "glossary.json"), (gd, "D23", "guide.json")):
        if isinstance(doc, dict):
            check_text_meta(c, doc, dsid, fname)
            for path, s in strings(doc):
                for why in bad_text(s):
                    c.fail("%s %s: %s in %r" % (fname, path, why, s[:50]))
    if isinstance(gl, dict):
        terms = gl.get("terms") or []
        c.ok([t.get("n") for t in terms] == list(range(1, len(terms) + 1)) and len(terms) >= 50, "glossary: terms must be numbered 1..n without gaps (at least 50)")
        slugs = [t.get("slug") for t in terms]
        c.ok(len(set(slugs)) == len(slugs) and all(isinstance(s, str) and re.match(r"^[a-z0-9-]+$", s) for s in slugs), "glossary: slugs must be unique lowercase ASCII")
        cats = dict((k.get("id"), k) for k in gl.get("categories", []))
        for t in terms:
            for f in ("title", "name", "def", "example"):
                c.ok(isinstance(t.get(f), str) and t[f].strip() and CYR.search(t[f]), "glossary %s: %s must be Bulgarian text" % (t.get("slug"), f))
            c.ok(t.get("cat") in cats, "glossary %s: unknown category %r" % (t.get("slug"), t.get("cat")))
            for s in t.get("see", []):
                c.ok(href_route(routes, s.get("href")) is not None, "glossary %s: 'Виж в бюджета' link %r matches no screen of routes.js" % (t.get("slug"), s.get("href")))
        for cid, k in cats.items():
            ns = [t["n"] for t in terms if t.get("cat") == cid]
            c.ok(ns and k.get("from") == min(ns) and k.get("to") == max(ns) and ns == list(range(min(ns), max(ns) + 1)),
                 "glossary: category %s must cover the terms %s..%s exactly" % (cid, k.get("from"), k.get("to")))
        for r in gl.get("relations", []):
            c.ok(all(s in slugs for s in r.get("terms", [])), "glossary: a relation names an unknown term: %s" % r.get("terms"))
        links = sum(1 for t in terms if t.get("see"))
        c.fact("glossary: %d terms in %d categories, %d with a working link into the site, %d relations; guide: %d steps" %
               (len(terms), len(cats), links, len(gl.get("relations", [])), len((gd or {}).get("steps", []))))
    if isinstance(gd, dict):
        steps = gd.get("steps") or []
        c.ok([s.get("n") for s in steps] == list(range(1, 9)), "guide: eight steps numbered 1..8 expected")
        for s in steps:
            scr = s.get("screen") or {}
            c.ok(href_route(routes, scr.get("href")) == scr.get("id"), "guide step %s: link %r does not lead to screen %r" % (s.get("n"), scr.get("href"), scr.get("id")))
            nx = s.get("next")
            if nx:
                c.ok(href_route(routes, nx.get("href")) is not None, "guide step %s: 'next' link %r matches no screen" % (s.get("n"), nx.get("href")))
        ck = gd.get("checks") or {}
        c.ok(len(ck.get("items", [])) == 5, "guide: five checks expected")
        c.ok(gd.get("credit") == "Работна група „Бюджет на светло“", "guide: the credit must be the generic working-group name")
    if not no_rebuild:
        r = subprocess.run([sys.executable, os.path.join(L.HERE, "build_text.py"), "--check"], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           universal_newlines=True, cwd=L.HERE)
        c.ok(r.returncode == 0 and r.stdout.count("identical to disk") == 2,
             "build_text.py --check failed (exit %d): %s" % (r.returncode, (r.stderr or r.stdout).strip()[:200]))
        last = [ln for ln in r.stdout.strip().split("\n") if ln.startswith(("glossary:", "guide:"))]
        if last:
            c.fact("build_text.py --check identical to disk; " + " | ".join(last))


# ===================================================================================================== PROTO (the finished prototype must stay unchanged)
def check_proto(c):
    """Every file of prototype/ equals its recorded SHA-256 and nothing was added or removed."""
    if not os.path.exists(PROTO_SHA):
        c.fail("tools/mock/prototype.sha256 is missing")
        return
    want = collections.OrderedDict()
    with open(PROTO_SHA, "r", encoding="utf-8") as fh:
        for ln in fh:
            ln = ln.rstrip("\n")
            if ln:
                h, _, rel = ln.partition("  ")
                want[rel] = h
    base = os.path.join(L.ROOT, "prototype")
    have = []
    for dp, dn, fn in os.walk(base):
        dn.sort()
        for f in sorted(fn):
            have.append(os.path.relpath(os.path.join(dp, f), L.ROOT).replace(os.sep, "/"))
    changed = []
    absent = 0
    for rel, h in want.items():
        p = os.path.join(L.ROOT, rel)
        if not os.path.exists(p):
            if rel.startswith("prototype/data/raw/"):      # raw files are not in the repository (docs/data-sources.md)
                absent += 1
            else:
                changed.append("missing " + rel)
            continue
        with open(p, "rb") as fh:
            if hashlib.sha256(fh.read()).hexdigest() != h:
                changed.append("changed " + rel)
    added = sorted(set(have) - set(want))
    c.ok(not changed, "prototype/ was modified: %s" % changed[:5])
    c.ok(not added, "prototype/ gained files: %s" % added[:5])
    if absent:
        c.warn("%d raw files of the manifest are not in the repository (prototype/data/raw, see docs/data-sources.md); the files that are present are compared" % absent)
    c.ok(len(want) == 125, "tools/mock/prototype.sha256 lists %d files, expected 125" % len(want))   # 111 + the 13 KFP reports added on 2026-10-09 (2024, 08.2026) + 09.2026
    c.fact("prototype/: %d files present, all equal to the recorded SHA-256, none added" % len(have))


# ===================================================================================================== BUILD (two builds are byte-identical)
def check_build(c):
    """build_mock.py --check builds every set in memory and compares it with the file on disk; run with two different hash seeds,
    so a dependence on dictionary/set order would show."""
    outs = []
    for seed in ("1", "2"):
        env = dict(os.environ)
        env["PYTHONHASHSEED"] = seed
        r = subprocess.run([sys.executable, os.path.join(L.HERE, "build_mock.py"), "--check"], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           universal_newlines=True, cwd=L.HERE, env=env)
        c.ok(r.returncode == 0, "build_mock.py --check (PYTHONHASHSEED=%s) exit %d: %s" % (seed, r.returncode, (r.stderr or r.stdout).strip()[:300]))
        outs.append(r.stdout)
    c.ok(outs[0] == outs[1], "build_mock.py --check prints different results for two hash seeds")
    n = outs[0].count("identical")
    c.ok(n == len(DATASETS), "build_mock.py --check: %d of %d sets identical to disk" % (n, len(DATASETS)))
    c.fact("build_mock.py --check: %d of %d sets identical to the files on disk, same result with two hash seeds" % (n, len(DATASETS)))


# ===================================================================================================== runner
CHECKS = collections.OrderedDict([
    ("M01", (check_m01, ["functions", "functions[].groups", "items"])),
    ("M02", (check_m02, ["ministries", "items", "items[].indicators"])),
    ("M03", (check_m03, ["regions", "items"])),
    ("M04", (check_m04, ["months", "byType", "byInstitution", "daily", "recipients"])),
    ("M05", (check_m05, ["items"])),
    ("M06", (check_m06, ["items"])),
    ("M07", (check_m07, ["items"])),
])


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


def scan_other_data(inp, limit=12):
    """DATA_SPEC 0.4 for the files that are not mine: reported as warnings only."""
    out = []
    for dp, dn, fn in os.walk(L.DATA_DIR):
        dn.sort()
        rel_dir = os.path.relpath(dp, L.DATA_DIR)
        if rel_dir == "mock":
            continue
        for f in sorted(fn):
            if not f.endswith(".json") or (rel_dir == "." and f in TEXT_FILES):
                continue
            doc = inp.json(os.path.join(dp, f))
            if doc is None:
                out.append("%s: does not parse" % os.path.normpath(os.path.join(rel_dir, f)))
                continue
            n = 0
            for path, s in strings(doc):
                for why in bad_text(s):
                    if n < 2 and len(out) < limit:
                        out.append("%s %s: %s in %r" % (os.path.normpath(os.path.join(rel_dir, f)), path, why, s[:40]))
                    n += 1
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Validate the MOCK datasets M01-M07, glossary/guide, the reproducibility of the builds and the prototype hashes.")
    ap.add_argument("--only", default="", help="comma-separated: %s" % ",".join(DATASETS + EXTRA + ["BUILD"]))
    ap.add_argument("-v", "--verbose", action="store_true", help="print every key number and warning")
    ap.add_argument("--no-rebuild", action="store_true", help="skip build_mock.py --check and build_text.py --check")
    args = ap.parse_args(argv)
    known = DATASETS + EXTRA + ["BUILD"]
    only = [x.strip().upper() for x in args.only.split(",") if x.strip()]
    bad = [x for x in only if x not in known]
    if bad:
        sys.stderr.write("unknown id(s) %s; choose from %s\n" % (",".join(bad), ",".join(known)))
        return 2
    todo = only or known
    if args.no_rebuild and "BUILD" in todo:
        todo.remove("BUILD")
    inp = Inputs()
    core = inp.data("core.json")
    registry = (core or {}).get("sources") or {}
    results = []
    for dsid in todo:
        if dsid in CHECKS:
            if not registry:
                pre = Check(dsid)
                pre.fail("site/data/core.json (source registry) is missing: run tools/build_data.py first")
                results.append(pre)
                continue
            results.append(run_dataset(dsid, inp, registry))
            continue
        c = Check(dsid)
        try:
            if dsid == "TEXT":
                check_text(c, inp, args.no_rebuild)
            elif dsid == "PROTO":
                check_proto(c)
            else:
                check_build(c)
        except Exception as e:
            c.fail("the check crashed: %s: %s" % (type(e).__name__, e))
        results.append(c)
    total = 0
    for c in results:
        total += len(c.problems)
        print("%-5s %s" % (c.name, "OK" if not c.problems else "FAIL (%d)" % len(c.problems)))
        shown = c.facts if args.verbose else c.facts[-1:]
        for f in shown:
            print("      %s" % f)
        for p in c.problems[:25]:
            print("    - %s" % p)
        if len(c.problems) > 25:
            print("    - ... and %d more" % (len(c.problems) - 25))
        if args.verbose:
            for w in c.warnings:
                print("    ! %s" % w)
    warns = scan_other_data(inp) if not only else []
    for w in warns:
        print("  warning (DATA's file, not mine): %s" % w)
    for c in results:
        for w in c.warnings:
            if not args.verbose:
                print("  warning (%s): %s" % (c.name, w))
    print("validate_mock: %d check group(s), %d violation(s)%s" % (len(results), total, "" if total == 0 else " -> FAIL"))
    return 0 if total == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
