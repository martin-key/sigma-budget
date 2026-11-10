"""Capture full-group optional EU-contribution truth semantics from the frozen donor."""
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent
original = HERE / "source_order.py"
namespace = {"__file__": str(original), "__name__": "frozen_optional_values_donor"}
exec(compile(original.read_text().split("\ncases = []")[0], str(original), "exec"), namespace)
observed = []
with tempfile.TemporaryDirectory(prefix="sigma-15b-optional-") as temp:
    root = Path(temp)
    shutil.copytree(FIXTURES / "fiscal/inputs/data/inputs", root / "data/inputs")
    archive = root / "data/originals/budget_2027/ZDBRB-2027.zip"
    archive.parent.mkdir(parents=True)
    shutil.copyfile(FIXTURES / "fiscal/inputs/data/originals/budget_2027/ZDBRB-2027.zip", archive)
    docs = {name + ".json": json.loads((FIXTURES / "wave13a/published" / (name + ".json")).read_text()) for name in ("outlook", "revenue", "expenditure", "budget2027", "budget2027-provenance")}
    class Context:
        def get(self, name): return docs[name]
    namespace["annual_periods"].ROOT = root
    namespace["annual_periods"].SRC = root / "data/inputs"
    path = root / "data/inputs/budget_bill_2027.json"
    original_bytes = path.read_bytes()
    for index, value in enumerate([[], {}, None, False, 0, ""]):
        doc = json.loads(original_bytes)
        doc["bill"]["2"]["headline"]["eucontrib"] = value
        path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf8")
        check = namespace["donor"].g_budget_2027(Context())
        observed.append({"name": "optional-eu-" + str(index), "value": value, "result": {"name": check.name, "n": check.n, "problems": check.problems, "warnings": check.warnings, "facts": check.facts}})
encoded = (json.dumps(observed, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
proof = {"generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "inputs": {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest() for name in ("inventory.json", "source_order.py", "source-methods-provenance.json")}, "oracleSha256": hashlib.sha256(encoded).hexdigest(), "cases": len(observed)}
for name, raw in {"optional-values.json": encoded, "optional-values-provenance.json": (json.dumps(proof, indent=2) + "\n").encode()}.items():
    target = HERE / name
    if "--check" in sys.argv:
        if not target.exists() or target.read_bytes() != raw:
            raise SystemExit("Optional-value donor proof differs: " + name)
    else:
        target.write_bytes(raw)
