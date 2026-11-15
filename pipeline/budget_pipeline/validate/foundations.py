"""Cross-cutting groups of base.py: INPUTS, ENVELOPE, NUMBERS, SIZES, PRIVACY, GLOSSARY (CORE and CATALOG live in catalog.py).

Pure standard library. Each group is a function `g_x(ctx) -> Check`; `GROUPS` lists (name, function, one-line doc).
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import hashlib
import os
from budget_pipeline.validate.programme_supplements import valid_supplement
import re

import budget_pipeline.validate.checks as L
from budget_pipeline.validate.catalog import g_core, g_catalog
from budget_pipeline.validate.budget_tables import valid_budget_tables
from budget_pipeline.validate.checks import Check, isnum, pattern, walk

STATUSES = ("real", "mock", "pending")
SOURCE_KEYS = ("budget2027", "kfp", "asbp", "bill", "zdb", "zbdoo", "zbnzok", "prb", "parliament", "eurostat", "bnb", "nap", "sebra",
               "gisco", "dataeuropa", "minfin", "wg", "ec-oil", "excise-law", "customs-excise-law", "nsi-pack")


# ------------------------------------------------------------------------------------------------------- INPUTS
def g_inputs(ctx):
    """Inputs are pinned: same file SET and the same SHA-256 of every file as in data/originals.sha256 (raw files may be absent; regenerate the rest with input_checksums.py)."""
    c = Check("INPUTS")
    expected = {}
    with open(os.path.join(L.ROOT, "data", "originals.sha256"), "r", encoding="utf-8") as fh:
        for ln in fh:
            ln = ln.rstrip("\n")
            if not ln.strip():
                continue
            m = re.match(r"^([0-9a-f]{64})\s+(\S.*)$", ln)
            if not c.ok(m, "originals.sha256: unparsable line %r" % ln[:60]):
                continue
            c.ok(m.group(2) not in expected, "originals.sha256: duplicate path %s" % m.group(2))
            expected[m.group(2)] = m.group(1)
    actual = {}
    for dp, dn, fn in (entry for base in ("data/originals", "data/inputs") for entry in os.walk(os.path.join(L.ROOT, base))):
        dn.sort()
        for f in sorted(fn):
            full = os.path.join(dp, f)
            rel = os.path.relpath(full, L.ROOT).replace(os.sep, "/")
            h = hashlib.sha256()
            with open(full, "rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            actual[rel] = h.hexdigest()
    raw_prefix = "data/originals/"                      # the raw files are not in the repository (docs/data-sources.md)
    absent = sorted(p for p in set(expected) - set(actual) if p.startswith(raw_prefix))
    missing = sorted(p for p in set(expected) - set(actual) if not p.startswith(raw_prefix))
    extra = sorted(set(actual) - set(expected))
    if absent:
        c.warn("%d raw files of the manifest are not in the repository (data/originals, see docs/data-sources.md); the files that are present are compared" % len(absent))
    c.ok(not missing, "pinned input files missing: %s" % ", ".join(missing[:5]))
    c.ok(not extra, "Input directories have files not in the manifest: %s" % ", ".join(extra[:5]))
    changed = sorted(p for p in expected if p in actual and expected[p] != actual[p])
    c.ok(not changed, "pinned input files changed: %s" % ", ".join(changed[:5]))
    c.fact("%d files, all sha256 equal" % len(expected) if not (missing or extra or changed) else "%d files" % len(expected))
    return c


# ---------------------------------------------------------------------------------------------------- ENVELOPE
def g_envelope(ctx):
    """Every file has a meta envelope with a valid status and known sources; every nested status block is valid."""
    c = Check("ENVELOPE")
    core = ctx.get("core.json")
    srcs = set(core["sources"])
    pend = set(core["pending"])
    c.ok(set(core["sources"]) == set(SOURCE_KEYS), "core.sources keys differ from the registry: %s" %
         sorted(set(core["sources"]) ^ set(SOURCE_KEYS)))
    counts = {"real": 0, "mock": 0}
    for f in L.json_files():
        d = ctx.get(f)
        m = d.get("meta") if isinstance(d, dict) else None
        if not c.ok(isinstance(m, dict), "%s: no meta envelope" % f):
            continue
        for k in ("id", "title", "status", "source", "asOf", "retrieved"):
            c.ok(m.get(k) not in (None, "", []), "%s: meta.%s missing or empty" % (f, k))
        c.ok(m.get("status") in STATUSES, "%s: meta.status %r" % (f, m.get("status")))
        c.ok(m.get("mock") is (m.get("status") == "mock"), "%s: meta.mock must equal (status == 'mock')" % f)
        if m.get("status") in counts:
            counts[m["status"]] += 1
        if f in ('state-budget.json', 'kfp-subsectors.json'):
            c.ok(valid_budget_tables(d, f), f + ': strict budget table contract')
        for s in m.get("source") or []:
            c.ok(s in srcs, "%s: meta.source %r is not in core.sources" % (f, s))
        for k in ("asOf", "retrieved"):
            v = m.get(k)
            c.ok(isinstance(v, str) and L.ISO.match(v) and v <= L.BUILD_DATE, "%s: meta.%s %r not an ISO date <= %s" %
                 (f, k, v, L.BUILD_DATE))
        for p in m.get("pending") or []:
            c.ok(p in pend, "%s: meta.pending %r is not in core.pending" % (f, p))
        if not f.startswith("mock/"):
            for p, v in walk(d):
                if p == "$.meta" or not isinstance(v, dict) or "status" not in v:
                    continue
                if p.startswith('$.byPeriod.'):
                    from budget_pipeline.build.annual_periods import PERIODS
                    key = p.split('.')[2] + '.' + p.split('.')[3]
                    c.ok(key in PERIODS and v['status'] == PERIODS[key][0], '%s %s: period status' % (f,p))
                    continue
                c.ok(v["status"] in STATUSES, "%s %s: status %r" % (f, p, v["status"]))
                if v["status"] == "pending":
                    nums = [(q, x) for q, x in walk(v) if isnum(x) and not q.endswith(".month")]
                    c.ok(not nums, "%s %s: a pending block carries numbers %s" % (f, p, nums[:2]))
                for s in (v.get("source") or []) if isinstance(v.get("source"), list) else []:
                    c.ok(s in srcs, "%s %s: source %r not in core.sources" % (f, p, s))
    for pid, b in core["pending"].items():
        c.ok(b.get("status") == "pending" and b.get("id") == pid, "core.pending.%s: bad status or id" % pid)
        for k in ("title", "reason", "expected", "source", "screens"):
            c.ok(b.get(k), "core.pending.%s: %s missing" % (pid, k))
    c.fact("%d json files (%d real, %d mock)" % (len(L.json_files()), counts["real"], counts["mock"]))
    return c


# ------------------------------------------------------------------------------------------------------ NUMBERS
# Documented nulls: a value that does not exist (no own revenue, a bill that has no such row, ...). Everything else
# must be a finite number, and a string is never a number in disguise.
NULL_OK = (
    ("catalog.json", r"^\$\.datasets\[\]\.file$"),                                      # multi-file datasets use fileTemplate
    ("law.json", r"^\$\.bills\[\]\.inForce\.exceptions\[\]\.from$"),
    ("law.json", r"^\$\.budgets\[\]\.(bill|law|diff)\.(rev|transfers)$"),
    ("law.json", r"^\$\.changes\[\]\.headline\.(balance|financing)\.(bill|diff)$"),
    ("law.json", r"^\$\.changes\[\]\.lines\[\]\.(bill|diff)$"),
    ("rates.json", r"^\$\.minInsurableIncome\.rows\[\]\.(from|until)\[\]$"),
)
EMPTY_OK = (
    ("debt.json", r"^\$\.quarterly\.eurostat\.flags\[\]$"),
    ("law.json", r"^\$\.art1\.lines\[\]\.no$"),
    ("programs.json", r"^\$\.items\[\]\[\]$"),
    ("rates.json", r"^\$\.assumptions\[\](\.sub\[\])?\.unit$"),
    ("rates.json", r"^\$\.minInsurableIncome\.rows\[\]\.code$"),
    ("search-index.json", r"^\$\.items\[\]\[\]$"),
)
NUMSTR_OK = (
    (r".*", r"\.(id|code|no|n|eik|ministry|nap|period|name)$"),
    (r".*", r"\.(ministries|changedCodes)\[\]$"),
    (r"^rates\.json$", r"^\$\.assumptions\[\](\.sub\[\])?\.years\.\d{4}$"),           # NAP's printed assumption values
    (r"^(programs|search-index)\.json$", r"^\$\.items\[\]\[\]$"),
)
NUMSTR = re.compile(r"^-?\d+([.,]\d+)?$")


def _allowed(table, f, pat):
    """(file, path-pattern) is in the table; a file entry starting with ^ or .* is a regex, else an exact name."""
    for fr, pr in table:
        file_ok = (re.match(fr, f) is not None) if fr.startswith(("^", ".*")) else (f == fr)
        if file_ok and re.search(pr, pat):
            return True
    return False


def g_numbers(ctx):
    """No NaN/Infinity; null and "" only at documented positions; no number stored as a string; no float noise."""
    c = Check("NUMBERS")
    nulls = empties = numstr = noise = 0
    biggest = 0.0
    for f in L.json_files():
        d = ctx.get(f)                                   # strict load: NaN / Infinity raise
        programme_contract = f in ("ministries/0100.json","ministries/1800.json","ministries/2300.json","ministries/7400.json") and valid_supplement(d)
        budget_contract = f in ("state-budget.json", "kfp-subsectors.json") and valid_budget_tables(d, f)
        bad = {}
        for p, v in walk(d):
            if v is None:
                nulls += 1
                if not _allowed(NULL_OK, f, pattern(p)) and not (programme_contract and (re.fullmatch(r"\$\.sourceAudit\.rows\[\]\.values\[\]",pattern(p)) or re.fullmatch(r"\$\.(total|policies).*\.2026\[\]",pattern(p)))) and not (budget_contract and re.fullmatch(r"\$\.tables\[\]\.rows\[\]\.(source|eur)\[\]", pattern(p))):
                    bad.setdefault("null", []).append(p)
            elif v == "":
                empties += 1
                if not _allowed(EMPTY_OK, f, pattern(p)):
                    bad.setdefault("empty string", []).append(p)
            elif isinstance(v, str) and NUMSTR.match(v):
                numstr += 1
                printed = (f == 'budget2027-provenance.json' or
                           (f == 'execution-provenance.json' and p.startswith('$.plan2026.kfp.rows.'))) and p.endswith('.printed')
                if not printed and not _allowed(NUMSTR_OK, f, pattern(p)):
                    bad.setdefault("number as string", []).append(p)
            elif isinstance(v, float):
                biggest = max(biggest, abs(v))
                s = repr(v)
                if "e" not in s and len(s.partition(".")[2]) > 8:
                    noise += 1
        c.n += 1
        for kind, paths in bad.items():
            c.fail("%s: %d unexpected %s, e.g. %s" % (f, len(paths), kind, ", ".join(sorted(set(pattern(x) for x in paths))[:3])))
    c.ok(noise == 0, "%d floats with more than 8 decimals (binary noise)" % noise)
    c.fact("%d documented nulls, %d empty strings, %d code-like numeric strings" % (nulls, empties, numstr))
    return c


# -------------------------------------------------------------------------------------------------------- SIZES
def _kb(n):
    return "%.1f KB" % (n / 1024.0)


def g_sizes(ctx):
    """DATA_SPEC section 1: hard fail above N x 1024 bytes, warning above N x 1000."""
    c = Check("SIZES")

    def limit(f):
        # New lazy files have separate payload budgets; existing file budgets are unchanged.
        if f == "budget2027.json":
            return 800, "raw"
        if f == "budget2027-provenance.json":
            return 3000, "raw"
        if f == "core.json":
            return 40, "raw"
        if f == "search-index.json":
            return 250, "raw"
        if f == "geo/obshtini.json":
            return 400, "raw"
        if re.match(r"^ministries/\d{4}\.json$", f):
            return 80, "raw"
        return 150, "raw"

    total_raw = 0
    worst = (0.0, "")
    for f in L.data_files():
        n = os.path.getsize(os.path.join(L.DATA, f))
        total_raw += n
        lim, _w = limit(f)
        c.ok(n <= lim * 1024, "%s: %s raw exceeds the %d KB budget" % (f, _kb(n), lim))
        if lim * 1000 < n <= lim * 1024:
            c.warn("%s: %s raw is within 2.4%% of its %d KB budget" % (f, _kb(n), lim))
        worst = max(worst, (n / (lim * 1024.0), "%s %s of %d KB" % (f, _kb(n), lim)))
    for f, lim in (("core.json", 10), ("glossary.json", 60)):
        raw = open(os.path.join(L.DATA, f), "rb").read()
        gz = L.gz_size(raw)
        c.ok(gz <= lim * 1024, "%s: %s gzip exceeds the %d KB budget" % (f, _kb(gz), lim))
        c.fact("%s %s gz" % (f, _kb(gz)))
    c.fact("%d files, %s raw in total, tightest: %s" % (len(L.data_files()), _kb(total_raw), worst[1]))
    return c


# ------------------------------------------------------------------------------------------------------ PRIVACY
FORBIDDEN = ("private channel", "частен канал", ".secrets", "gdoc.txt", "lovable", "artifact-files",
             "/workspaces", "anthropic", "claude")
WORD = r"(?<![\w])%s(?![\w])"


def g_privacy(ctx):
    """data/release is public: no private-channel references, no repository paths, no personal names."""
    c = Check("PRIVACY")
    scanned = 0
    for f in L.data_files():
        t = ctx.text(f)
        low = t.lower()
        scanned += 1
        for w in FORBIDDEN:
            c.ok(w not in low, "%s: contains %r" % (f, w))
        m = re.search(r"(?<![\w.])\d{17,20}(?![\w.])", t)
        c.ok(not m, "%s: a 17-20 digit number (message id?) %s" % (f, m.group(0) if m else ""))
    cat = ctx.get("catalog.json")
    for fl in cat.get("files", []):
        for k in ("url", "page"):
            u = (fl.get(k) or "")
            c.ok(not u or u.lower().startswith("https://"), "catalog.files[] %s %r" % (k, u[:80]))
    # the rest of the shipped site (not mine): a warning only
    hits = []
    for dp, dn, fn in (entry for base in (L.SITE, os.path.join(L.ROOT, "apps/web/client")) for entry in os.walk(base)):
        if os.path.abspath(dp).startswith(os.path.abspath(L.DATA)):
            continue
        for f in fn:
            if f.endswith((".png", ".woff", ".woff2", ".ico", ".jpg", ".webp", ".gz")):
                continue
            try:
                t = open(os.path.join(dp, f), "r", encoding="utf-8").read().lower()
            except (UnicodeDecodeError, OSError):
                continue
            if "private channel" in t or "частен канал" in t:
                hits.append(os.path.relpath(os.path.join(dp, f), L.SITE))
    if hits:
        c.warn("web assets outside data mentions a private channel: %s" % ", ".join(hits[:5]))
    c.fact("%d files scanned, 0 forbidden words" % scanned)
    return c


# ----------------------------------------------------------------------------------------------------- GLOSSARY
def g_glossary(ctx):
    """glossary.json is consistent and every `glossary` slug used by the data exists in it."""
    c = Check("GLOSSARY")
    g = ctx.get("glossary.json")
    terms = g["terms"]
    slugs = [t["slug"] for t in terms]
    c.ok(len(slugs) == len(set(slugs)), "duplicate glossary slugs")
    c.ok(len(terms) == 64, "glossary has %d terms (the plan says 64)" % len(terms))
    c.ok(len(terms) == ctx.get("core.json")["counts"]["terms"], "core.counts.terms differs from glossary.json")
    cats = set(x["id"] if isinstance(x, dict) else x for x in g["categories"])
    have = set(slugs)
    for t in terms:
        c.ok(t.get("def"), "term %s has no definition" % t["slug"])
        c.ok(t.get("cat") in cats, "term %s: category %r unknown" % (t["slug"], t.get("cat")))
        for r in t.get("related") or []:
            c.ok(r.get("slug") in have, "term %s: related slug %r does not exist" % (t["slug"], r.get("slug")))
        for r in t.get("see") or []:
            c.ok(ctx.routes().match(r.get("href", "")) is not None, "term %s: see.href %r matches no route" % (t["slug"], r.get("href")))
    for r in g.get("relations") or []:
        for slug in r.get("terms") or []:
            c.ok(slug in have, "relations: slug %r does not exist" % slug)
    used = 0
    for f, where in (("revenue.json", lambda d: d["groups"]), ("expenditure.json", lambda d: d["functions"]["items"])):
        for row in where(ctx.get(f)):
            s = row.get("glossary")
            if s:
                used += 1
                c.ok(s in have, "%s: glossary slug %r (%s) does not exist" % (f, s, row.get("id")))
    c.fact("%d terms in %d categories, %d slug references resolve" % (len(terms), len(cats), used))
    return c


GROUPS = (
    ("INPUTS", g_inputs, "pinned input file set and every sha256 equal data/originals.sha256"),
    ("ENVELOPE", g_envelope, "meta envelopes, status/source/pending ids, nested pending blocks carry no numbers"),
    ("NUMBERS", g_numbers, "no NaN/Infinity; null and empty strings only at documented positions"),
    ("SIZES", g_sizes, "size budget of DATA_SPEC section 1"),
    ("PRIVACY", g_privacy, "no private-channel references / personal names / repository paths in data/release"),
    ("GLOSSARY", g_glossary, "glossary terms and slug references"),
    ("CORE", g_core, "core.json: KPIs, counts, population, functions and revenue groups equal their owning datasets"),
    ("CATALOG", g_catalog, "catalog.json against the files on disk: sizes, meta, schema, sources, traps, screens vs page needs"),
)
