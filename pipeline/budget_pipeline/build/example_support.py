"""Metadata and deterministic serialization for the two published example datasets."""
import datetime
import json
import math
import os
import random
import re


ROOT = str(__import__("pathlib").Path(__file__).resolve().parents[3])

DATA_DIR = os.path.join(ROOT, "data", "release")

OUT_DIR = os.path.join(DATA_DIR, "mock")

SEED = 20261002

BUILD_DATE = os.environ.get("BUILD_DATE", "2026-11-05")

FILES = {                            # dataset id -> published file name under data/release/mock/
    "M06": "measure-labels.json",
    "M07": "tax-assumptions.json",
}

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
    """File-level envelope of DATA_SPEC 0.1 for a MOCK set (key order as in pipeline/budget_pipeline/build/data_io.py meta())."""
    m = {"id": id_, "title": title, "status": "mock", "source": list(source), "sourceNote": source_note,
         "asOf": BUILD_DATE, "retrieved": BUILD_DATE}
    if unit:
        m["unit"] = unit
    for k, v in extra.items():
        m[k] = v
    m["seed"] = SEED
    m["mock"] = True
    return m

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
