"""Build context shared by the bd_*.py modules: lazy loaders for every input, plus the registry of built datasets.

Inputs are read ONLY from frozen input/ (frozen, read-only), data/cache/research/, data/cache/ and the already-built
data/release/execution.json (produced by kfp_full.py). Nothing here touches the network.
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import json

import budget_pipeline.build.forecast_tables as forecast_tables
import budget_pipeline.validate.execution_contract as execution_contract
from budget_pipeline.build.data_io import CACHE, DATA, RAW, RESEARCH, SRC, jload

PDF_PAGES = RESEARCH / "mf-umtbf-2026-2028" / "extracts" / "pdf_pages_clean.json"


class Ctx:
    def __init__(self):
        self._memo = {}
        self.out = {}          # rel path (with .json) -> object to write; filled by the builders
        self.texts = {}        # rel path -> text to write verbatim (feed.xml)
        self.notes = []        # human-readable build notes (printed at the end)

    # ------------------------------------------------------------------------------------------ memo helper
    def _get(self, key, fn):
        if key not in self._memo:
            self._memo[key] = fn()
        return self._memo[key]

    # ------------------------------------------------------------------------------------------ inputs
    @property
    def annex(self):
        """Annex 3 (forecast_tables.load()): mln/pct/labels/tree/gdp."""
        return self._get("annex", forecast_tables.load)

    @property
    def tables(self):
        return self._get("tables", lambda: jload(RAW / "asbp" / "asbp_tables.json")["tables"])

    @property
    def docx_check(self):
        return self._get("docx_check", lambda: jload(RAW / "asbp" / "asbp_tables.json")["docx_check"])

    @property
    def pdf_pages(self):
        return self._get("pdf_pages", lambda: jload(PDF_PAGES))

    def src(self, name):
        """A data/inputs/<name>.json file (memoised)."""
        return self._get("src:" + name, lambda: jload(SRC / (name + ".json")))

    def raw(self, rel):
        return self._get("raw:" + rel, lambda: jload(RAW / rel))

    def cache(self, name):
        return self._get("cache:" + name, lambda: jload(CACHE / name))

    def cache_exists(self, name):
        return (CACHE / name).exists()

    @property
    def execution(self):
        """The already-built execution.json (kfp_full.py writes it before datasets runs)."""
        def load():
            p = DATA / "execution.json"
            if not p.exists():
                raise FileNotFoundError("data/release/execution.json is missing: run pipeline/budget_pipeline/extract/kfp_full.py first")
            return execution_contract.numbers(json.loads(p.read_text(encoding="utf-8")))   # contract v2: money as decimal strings
        return self._get("execution", load)

    @property
    def law(self):
        return self._get("law", lambda: jload(CACHE / "law_bill.json"))

    @property
    def gdp(self):
        """GDP series [2024..2028]: Табл. I-2 (integers) and Annex 3 (unrounded)."""
        a = self.annex
        return {"mlnPrecise": list(a["gdp"]), "mlnPrinted": [round(v) for v in a["gdp"]]}

    # ------------------------------------------------------------------------------------------ registry
    def put(self, rel, obj):
        self.out[rel] = obj
        return obj

    def get(self, rel, default=None):
        return self.out.get(rel, default)

    def put_text(self, rel, text):
        self.texts[rel] = text
        return text
