"""Build context shared by the bd_*.py modules: lazy loaders for every input, plus the registry of built datasets.

Inputs are read ONLY from prototype/ (frozen, read-only), tmp/research/, tools/mock/cache/ and the already-built
site/data/execution.json (produced by extract_kfp_full.py). Nothing here touches the network.
"""
import json

import asbp
import exec_contract
from dlib import CACHE, DATA, RAW, RESEARCH, SRC, jload

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
        """Annex 3 (asbp.load()): mln/pct/labels/tree/gdp."""
        return self._get("annex", asbp.load)

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
        """A prototype/src/<name>.json file (memoised)."""
        return self._get("src:" + name, lambda: jload(SRC / (name + ".json")))

    def raw(self, rel):
        return self._get("raw:" + rel, lambda: jload(RAW / rel))

    def cache(self, name):
        return self._get("cache:" + name, lambda: jload(CACHE / name))

    def cache_exists(self, name):
        return (CACHE / name).exists()

    @property
    def execution(self):
        """The already-built execution.json (extract_kfp_full.py writes it before build_data runs)."""
        def load():
            p = DATA / "execution.json"
            if not p.exists():
                raise FileNotFoundError("site/data/execution.json is missing: run tools/extract_kfp_full.py first")
            return exec_contract.numbers(json.loads(p.read_text(encoding="utf-8")))   # contract v2: money as decimal strings
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
