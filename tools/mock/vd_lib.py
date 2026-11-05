"""Shared helpers of validate_data.py (the DATA validator): the Check collector, file loading, walking, tolerances.

Pure standard library. Nothing here writes a file.
"""
import json
import math
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))     # .../tools/mock
ROOT = os.path.dirname(os.path.dirname(HERE))         # repository root
SITE = os.path.join(ROOT, "site")                     # the Mock application
DATA = os.environ.get("BUDGET_DATA_DIR") or os.path.join(SITE, "data")   # tools/budget.py validate points it at a release
PROTO = os.path.join(ROOT, "prototype")
RAW = os.path.join(PROTO, "data", "raw")              # raw sources, NOT in the repository: see docs/data-sources.md
TMP = os.path.join(ROOT, "tmp")                       # scratch and outputs (gitignored)
BUILD_DATE = os.environ.get("BUILD_DATE", "2026-11-05")
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class Check(object):
    """Problems, warnings and key facts of one group of checks."""

    def __init__(self, name):
        self.name = name
        self.problems = []
        self.warnings = []
        self.facts = []
        self.n = 0

    def ok(self, cond, msg):
        """Count one check; a failed one records `msg`. Returns the truth value."""
        self.n += 1
        if not cond:
            self.problems.append(msg)
        return bool(cond)

    def fail(self, msg):
        self.n += 1
        self.problems.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)

    def fact(self, msg):
        self.facts.append(msg)

    def near(self, a, b, tol, msg):
        """a and b are numbers within tol (inclusive, with a float guard)."""
        good = isnum(a) and isnum(b) and abs(a - b) <= tol + 1e-9
        self.n += 1
        if not good:
            self.problems.append("%s: %s vs %s (tolerance %s)" % (msg, a, b, tol))
        return good


def isnum(x):
    """A finite JSON number (bool excluded)."""
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _no_constants(name):
    raise ValueError("non-finite number %s in JSON" % name)


def load(rel, base=None):
    """Parse site/data/<rel> (NaN / Infinity are errors). execution.json comes through the adapter of its contract v2 (money as decimal
    strings -> floats), so the checks compute as before; vd_contract.py checks the file as written."""
    path = os.path.join(base or DATA, rel)
    with open(path, "r", encoding="utf-8") as fh:
        obj = json.loads(fh.read(), parse_constant=_no_constants)
    if os.path.basename(rel) == "execution.json":
        import exec_contract
        obj = exec_contract.numbers(obj)
    return obj


def exists(rel, base=None):
    return os.path.exists(os.path.join(base or DATA, rel))


def data_files():
    """Every file under site/data as site-data-relative paths with '/' separators, sorted. site/data/releases/ is left out: the manifests
    describe the release (tools/budget.py, docs/release.md), they are not datasets of it."""
    out = []
    for dp, dn, fn in os.walk(DATA):
        if os.path.samefile(dp, DATA) and "releases" in dn:
            dn.remove("releases")
        dn.sort()
        for f in fn:
            out.append(os.path.relpath(os.path.join(dp, f), DATA).replace(os.sep, "/"))
    return sorted(out)


def json_files():
    return [f for f in data_files() if f.endswith(".json")]


def walk(obj, path=""):
    """Yield (path, value) for every node, depth first; paths look like $.a.b[3].c ."""
    yield path or "$", obj
    if isinstance(obj, dict):
        for k, v in obj.items():
            for item in walk(v, "%s.%s" % (path or "$", k)):
                yield item
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            for item in walk(v, "%s[%d]" % (path or "$", i)):
                yield item


def pattern(path):
    """$.items[12].x -> $.items[].x (so one allowlist entry covers every row)."""
    return re.sub(r"\[\d+\]", "[]", path)


def numbers_in(obj):
    """Count the JSON numbers (bool excluded) inside obj."""
    return sum(1 for _p, v in walk(obj) if isnum(v))


def by_id(rows, key="id"):
    return {r[key]: r for r in rows if isinstance(r, dict) and key in r}


def total(values):
    return sum(v for v in values if isnum(v))


def fmt(x, nd=1):
    """12345.6 -> '12 345,6' (Bulgarian grouping) for messages."""
    if not isnum(x):
        return str(x)
    s = ("%." + str(nd) + "f") % x
    ip, _, fp = s.partition(".")
    neg = ip.startswith("-")
    ip = ip.lstrip("-")
    ip = "{:,}".format(int(ip)).replace(",", " ")
    return ("-" if neg else "") + ip + ("," + fp if fp else "")


def gz_size(raw):
    import gzip
    import io
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0, compresslevel=9) as fh:
        fh.write(raw)
    return len(buf.getvalue())


class Ctx(object):
    """Run context shared by the groups: a cache of parsed data files and of raw text."""

    def __init__(self, opts=None):
        self.opts = opts or {}
        self._json = {}
        self._text = {}

    def get(self, rel):
        if rel not in self._json:
            self._json[rel] = load(rel)
        return self._json[rel]

    def text(self, rel):
        if rel not in self._text:
            with open(os.path.join(DATA, rel), "r", encoding="utf-8") as fh:
                self._text[rel] = fh.read()
        return self._text[rel]

    def routes(self):
        if not hasattr(self, "_routes"):
            self._routes = Routes()
        return self._routes

    def proto(self, rel):
        """A JSON file of the frozen prototype (read only)."""
        with open(os.path.join(PROTO, rel), "r", encoding="utf-8") as fh:
            return json.loads(fh.read())


# ------------------------------------------------------------------------------------------------ route patterns
class Routes(object):
    """The route table of site/js/routes.js, parsed from its R('S01', 'key', '/pattern', ...) lines."""

    LINE = re.compile(r"""^\s*R\(\s*'(S\d\d)'\s*,\s*'([^']+)'\s*,\s*(null|'([^']*)')""", re.M)

    def __init__(self):
        with open(os.path.join(SITE, "js", "routes.js"), "r", encoding="utf-8") as fh:
            src = fh.read()
        self.routes = {}                                    # id -> (key, pattern or None)
        self.compiled = []
        for m in self.LINE.finditer(src):
            rid, key, pat = m.group(1), m.group(2), m.group(4)
            self.routes[rid] = (key, pat)
            if pat is None:
                continue
            segs = []
            for s in [x for x in pat.split("/") if x]:
                mm = re.match(r"^:(\w+)(?:\(([^)]+)\))?(\?)?$", s)
                segs.append(("var", mm.group(1), re.compile("^(?:%s)$" % mm.group(2)) if mm.group(2) else None, bool(mm.group(3)))
                            if mm else ("lit", s, None, False))
            self.compiled.append((rid, segs))
        self.compiled.sort(key=lambda x: -len(x[1]))        # longer patterns first, as the client does

    def match(self, href):
        """'#/razhodi/obrazovation?x=1' -> route id, or None. The query string and any #fragment are ignored."""
        h = href[1:] if href.startswith("#") else href
        h = h.split("?", 1)[0]
        segs = [x for x in h.split("/") if x]
        for rid, ps in self.compiled:
            required = sum(1 for p in ps if not p[3])
            if len(segs) < required or len(segs) > len(ps):
                continue
            ok = True
            for i, p in enumerate(ps):
                v = segs[i] if i < len(segs) else None
                if v is None:
                    ok = ok and p[3]
                elif p[0] == "lit":
                    ok = ok and p[1] == v.lower()
                elif p[2] is not None:
                    ok = ok and (p[2].match(v) or p[2].match(v.lower())) is not None
            if ok:
                return rid
        return None
