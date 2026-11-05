# -*- coding: utf-8 -*-
"""mock_lib.py - helpers shared by build_mock.py and validate_mock.py (pure Python 3 standard library).

Layout, deterministic JSON writer (same style as tools/mock/dlib.py: minified UTF-8, keys in insertion order, no NaN, no
"-0.0"), the seeded random streams, exact-sum apportionment, the Bulgarian working-day calendar of the mock payments
and the ЕИК check-digit rule (the validator uses it to prove that the invented ЕИК numbers are NOT valid ones).

Nothing here reads the clock or the network. The build date is a constant (BUILD_DATE env var, default 2026-11-05; was 2026-10-09 until the 09.2026 rebuild, 2026-10-02 before the KFP 2024 + 08.2026 one) so
that two builds are byte-identical.
"""
import datetime
import json
import math
import os
import random
import re

HERE = os.path.dirname(os.path.abspath(__file__))    # .../tools/mock
ROOT = os.path.dirname(os.path.dirname(HERE))        # repository root
SITE = os.path.join(ROOT, "site")                    # the Mock application
RAW = os.path.join(ROOT, "prototype", "data", "raw")   # raw sources, NOT in the repository: see docs/data-sources.md
TMP = os.path.join(ROOT, "tmp")                      # scratch and outputs (gitignored)
DATA_DIR = os.path.join(SITE, "data")
OUT_DIR = os.path.join(DATA_DIR, "mock")
CACHE = os.path.join(HERE, "cache")
PROTO_SRC = os.path.join(ROOT, "prototype", "src")
ROUTES_JS = os.path.join(SITE, "js", "routes.js")

SEED = 20261002
BUILD_DATE = os.environ.get("BUILD_DATE", "2026-11-05")

GISCO_JSON = os.path.join(CACHE, "gisco_lau_bg.json")
LAW_JSON = os.path.join(CACHE, "law_bill.json")
TRANSFERS_JSON = os.path.join(PROTO_SRC, "municipal_transfers_2026.json")

# ---- the numbers every mock set is tied to (all are re-derived from disk by validate_mock.py as well)
MUNICIPAL_EXP_MLN = 6881.9          # АСБП с. 128: общо разходи на общините 2026 (млн. €)
CAPEX_PLAN_MLN = 9360.6             # КФП 2026, капиталови разходи (млн. €), core.kpis.capex.planMln

FILES = {                            # dataset id -> published file name under site/data/mock/
    "M01": "activities.json",
    "M02": "indicators.json",
    "M03": "municipal-finance.json",
    "M04": "payments.json",
    "M05": "projects.json",
    "M06": "measure-labels.json",
    "M07": "tax-assumptions.json",
}


# --------------------------------------------------------------------------------------------------------- io helpers
def load_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def clean(obj, where="$"):
    """Normalise -0.0 and refuse NaN/Infinity (not valid JSON)."""
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
    """Write only when the content changed. Returns True when the file was (re)written."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = text.encode("utf-8")
    if os.path.exists(path):
        with open(path, "rb") as fh:
            if fh.read() == data:
                return False
    with open(path, "wb") as fh:
        fh.write(data)
    return True


def meta(id_, title, source, source_note, unit=None, **extra):
    """File-level envelope of DATA_SPEC 0.1 for a MOCK set (key order as in tools/mock/dlib.py meta())."""
    m = {"id": id_, "title": title, "status": "mock", "source": list(source), "sourceNote": source_note,
         "asOf": BUILD_DATE, "retrieved": BUILD_DATE}
    if unit:
        m["unit"] = unit
    for k, v in extra.items():
        m[k] = v
    m["seed"] = SEED
    m["mock"] = True
    return m


# --------------------------------------------------------------------------------------------------------- randomness
def rng(tag):
    """Independent, reproducible random stream per dataset/purpose (string seeds are hashed with SHA-512)."""
    return random.Random("%d:%s" % (SEED, tag))


def lognormal(r, median, sigma):
    return median * math.exp(r.gauss(0.0, sigma))


def apportion(weights, total):
    """Largest-remainder apportionment: non-negative integers that add up to exactly `total`, proportional to weights."""
    s = float(sum(weights))
    if s <= 0:
        raise ValueError("apportion: weights add up to zero")
    raw = [w * total / s for w in weights]
    base = [int(math.floor(x)) for x in raw]
    rest = total - sum(base)
    order = sorted(range(len(raw)), key=lambda i: (-(raw[i] - base[i]), i))
    k = 0
    while rest > 0:                                   # normally 0 <= rest < len(weights); the loop also survives float noise
        base[order[k % len(order)]] += 1
        rest -= 1
        k += 1
    k = len(order) - 1
    while rest < 0:
        i = order[k % len(order)]
        if base[i] > 0:
            base[i] -= 1
            rest += 1
        k -= 1
    return base


def tenths(x):
    """A value with one decimal -> integer tenths (exact, avoids float drift)."""
    return int(round(x * 10))


# --------------------------------------------------------------------------------------------------------- calendar
# Official holidays of Bulgaria that fall on weekdays between 1 January and 31 August 2026 (new year, 3 March, the
# four Easter days of the Orthodox Easter of 12 April 2026, 1 May, 6 May). 24 May 2026 is a Sunday.
HOLIDAYS_2026 = {"2026-01-01", "2026-03-03", "2026-04-10", "2026-04-13", "2026-05-01", "2026-05-06"}
PERIOD_FROM = "2026-01-01"
PERIOD_TO = "2026-08-31"
MONTHS = ["2026-%02d" % m for m in range(1, 9)]


def working_days(month):
    """ISO dates of the working days of 'YYYY-MM' (Mon-Fri, not a holiday)."""
    y, m = int(month[:4]), int(month[5:7])
    d = datetime.date(y, m, 1)
    out = []
    while d.month == m:
        iso = d.isoformat()
        if d.weekday() < 5 and iso not in HOLIDAYS_2026:
            out.append(iso)
        d += datetime.timedelta(days=1)
    return out


# --------------------------------------------------------------------------------------------------------- dates in text
BG_MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември",
             "декември"]
_DATE_NUM = re.compile(r"(?<![\d.])(\d{1,2})\.(\d{1,2})\.(20\d\d)(?!\d)")
_DATE_WORD = re.compile(r"(?<!\d)(\d{1,2})\s+(" + "|".join(BG_MONTHS) + r")\s+(20\d\d)(?!\d)")


def dates_in(text):
    """ISO dates a Bulgarian text states outright: 'dd.mm.yyyy' and 'D месец yyyy' (a month or a year alone is not a date)."""
    found = []
    for rx, kind in ((_DATE_NUM, "n"), (_DATE_WORD, "w")):
        for m in rx.finditer(text or ""):
            d = int(m.group(1))
            mo = int(m.group(2)) if kind == "n" else BG_MONTHS.index(m.group(2)) + 1
            try:
                iso = datetime.date(int(m.group(3)), mo, d).isoformat()
            except ValueError:
                continue
            found.append((m.start(), iso))
    out = []
    for _, iso in sorted(found):
        if iso not in out:
            out.append(iso)
    return out


# --------------------------------------------------------------------------------------------------------- ЕИК rule
def eik9_check_digit(d8):
    """Check digit of a nine-digit ЕИК/БУЛСТАТ computed from its first eight digits (the official modulus-11 rule)."""
    ds = [int(c) for c in d8]
    s = sum(d * w for d, w in zip(ds, range(1, 9))) % 11
    if s == 10:
        s = sum(d * w for d, w in zip(ds, range(3, 11))) % 11
        if s == 10:
            s = 0
    return s


def eik9_is_valid(eik):
    return len(eik) == 9 and eik.isdigit() and eik9_check_digit(eik[:8]) == int(eik[8])


# --------------------------------------------------------------------------------------------------------- stats
def ranks(values):
    """Average ranks (1-based), ties share the mean rank."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    rk = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        mean = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            rk[order[k]] = mean
        i = j + 1
    return rk


def spearman(xs, ys):
    rx, ry = ranks(xs), ranks(ys)
    n = len(xs)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return num / den if den else 0.0
