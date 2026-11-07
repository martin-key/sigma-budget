"""Shared helpers for the DATA pipeline (pure stdlib, no third-party imports).

Every data script in tools/mock/ imports this module. It fixes the directory layout, the deterministic JSON writer
(minified, UTF-8, keys in insertion order, no NaN/Infinity, no "-0.0") and a few small utilities.

The pipeline reads ONLY from prototype/ (src/, data/raw/ - the raw files are not in the repository, see docs/data-sources.md),
tmp/sources/, tmp/research/ and tools/mock/cache/ and writes ONLY to site/data/, tools/mock/cache/ and tmp/.
It never touches prototype/.
"""
import gzip
import hashlib
import json
import math
import os
import sys
from pathlib import Path

# ----------------------------------------------------------------------------------------------- layout
ROOT = Path(__file__).resolve().parents[2]       # repository root (this file is tools/mock/dlib.py)
P = ROOT                                         # older name of ROOT
SITE = ROOT / "site"                             # the Mock application
DATA = SITE / "data"
TOOLS = ROOT / "tools" / "mock"
CACHE = TOOLS / "cache"                          # fetched inputs (gitignored; fetch_gisco.py, fetch_sebra.py, extract_bill.py fill it)
TMP = ROOT / "tmp"                               # scratch and outputs (gitignored)
PROTO = ROOT / "prototype"
SRC = PROTO / "src"
RAW = PROTO / "data" / "raw"                     # raw sources, NOT in the repository: see docs/data-sources.md
SOURCES = TMP / "sources"                        # documents supplied by hand (the 2027 draft budgetary plan PDF), not in the repository
RESEARCH = TMP / "research"                      # working extracts, not in the repository

BUILD_DATE = os.environ.get("BUILD_DATE", "2026-11-05")
DATA_VERSION = BUILD_DATE + ".1"
SEED = 20261002
EUR = 1.95583                                     # BGN per EUR (fixed conversion rate)

DATASET_SOURCES_NOTE = "Данните са от публични източници; пълните препратки са в „Данни“ → източници."


# ----------------------------------------------------------------------------------------------- json
def jload(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def clean(obj, where="$"):
    """Return `obj` with -0.0 normalised to 0.0; raise on NaN/Infinity (they are not valid JSON)."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            raise ValueError("non-finite number at " + where)
        return 0.0 if obj == 0 else obj
    if isinstance(obj, dict):
        return {k: clean(v, where + "." + str(k)) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v, where + "[%d]" % i) for i, v in enumerate(obj)]
    return obj


def jdumps(obj):
    return json.dumps(clean(obj), ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def write_text(path, text):
    """Write only when the content changed (keeps mtimes stable on idempotent re-runs)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = text.encode("utf-8")
    if path.exists() and path.read_bytes() == data:
        return False
    path.write_bytes(data)
    return True


def write_data(rel, obj):
    """Write `obj` as minified JSON to site/data/<rel> (rel includes the .json extension)."""
    text = jdumps(obj) + "\n"
    path = DATA / rel
    changed = write_text(path, text)
    return path, len(text.encode("utf-8")), changed


def write_cache(name, obj):
    text = jdumps(obj) + "\n"
    write_text(CACHE / name, text)


def gz_size(data_bytes):
    return len(gzip.compress(data_bytes, compresslevel=9, mtime=0))


def sha256_file(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


# ----------------------------------------------------------------------------------------------- numbers
def rnd(x, n=3):
    """round() that never returns -0.0 and keeps ints as ints."""
    if x is None:
        return None
    r = round(float(x), n)
    return 0.0 if r == 0 else r


def to_eur(bgn_value, n=3):
    """млн. лв. -> млн. €, rounded AFTER dividing."""
    return rnd(bgn_value / EUR, n)


def pct(part, whole, n=2):
    return rnd(100.0 * part / whole, n)


def isnum(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


# ----------------------------------------------------------------------------------------------- envelope
def meta(id_, title, status="real", source=None, source_note=None, as_of=None, unit=None, **extra):
    """Build the file-level `meta` envelope of DATA_SPEC §0.1 (key order is deterministic)."""
    m = {"id": id_, "title": title, "status": status, "source": list(source or [])}
    if source_note:
        m["sourceNote"] = source_note
    m["asOf"] = as_of or BUILD_DATE
    m["retrieved"] = BUILD_DATE
    if unit:
        m["unit"] = unit
    for k, v in extra.items():
        m[k] = v
    m["mock"] = status == "mock"
    return m


# ----------------------------------------------------------------------------------------------- diagnostics
class Problems:
    """Collects errors/warnings; `finish()` exits non-zero when there are errors."""

    def __init__(self, name):
        self.name = name
        self.errors = []
        self.warnings = []

    def error(self, msg):
        self.errors.append(msg)
        print("ERROR  [%s] %s" % (self.name, msg), file=sys.stderr)

    def warn(self, msg):
        self.warnings.append(msg)
        print("WARN   [%s] %s" % (self.name, msg), file=sys.stderr)

    def check(self, cond, msg):
        if not cond:
            self.error(msg)
        return cond

    def finish(self):
        print("[%s] %d error(s), %d warning(s)" % (self.name, len(self.errors), len(self.warnings)))
        if self.errors:
            sys.exit(1)


def say(msg):
    print(msg, flush=True)


# ----------------------------------------------------------------------------------------------- JSON-stat (Eurostat)
def jsonstat_cells(js):
    """Decode a JSON-stat 2.0 dataset (Eurostat dissemination API) into a list of cells.

    Returns [{"coords": {dim_id: category_code}, "value": number, "status": flag_or_None}, ...] for every
    non-empty cell. `value` is a dict {flat_index: number} (sparse) or a list; the flat index is row-major over
    `size` in `id` order (the LAST dimension varies fastest). `status` maps flat index -> flag ('p', 'e', ...).
    """
    ids, sizes = js["id"], js["size"]
    cats = []
    for dim in ids:
        idx = js["dimension"][dim]["category"]["index"]
        if isinstance(idx, dict):
            cats.append([c for c, _ in sorted(idx.items(), key=lambda kv: kv[1])])
        else:
            cats.append(list(idx))
    values = js["value"]
    status = js.get("status") or {}
    items = values.items() if isinstance(values, dict) else enumerate(values)
    out = []
    for flat, v in items:
        if v is None:
            continue
        flat = int(flat)
        rem = flat
        coords = {}
        for d in range(len(ids) - 1, -1, -1):
            rem, r = divmod(rem, sizes[d])
            coords[ids[d]] = cats[d][r]
        flag = status.get(str(flat)) if isinstance(status, dict) else None
        out.append({"coords": coords, "value": v, "status": flag})
    return out


def jsonstat_series(js, dim="time", fixed=None):
    """One series of a JSON-stat dataset: {category_of_dim: (value, flag)} for the cells matching `fixed`
    ({other_dim: code}); the other dimensions must all be fixed or of size 1."""
    fixed = fixed or {}
    res = {}
    for c in jsonstat_cells(js):
        if all(c["coords"].get(k) == v for k, v in fixed.items()):
            res[c["coords"][dim]] = (c["value"], c["status"])
    return res
