"""Independent required-status and hashable-source regressions; original proof unchanged."""
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
path = LEGACY / "generate.py"
namespace = {"__file__": str(path), "__name__": "frozen_source_donor"}
exec(compile(path.read_text().split("\nresult =")[0], str(path), "exec"), namespace)
original = namespace["original"]
cases = []
for index in (0, 26, len(original["catalog.json"]["datasets"]) - 1):
    cases.append({"name": "missing-status-" + str(index), "ops": [{"op": "delete", "file": "catalog.json", "path": ["datasets", index, "status"]}]})
for file, collection, key in [("ministries.json", "items", "id"), ("municipalities.json", "items", "id"), ("measures.json", "items", "id"), ("glossary.json", "terms", "slug"), ("catalog.json", "datasets", "slug")]:
    for value in ([], {}, None, True):
        index = 26 if file == "catalog.json" else 0
        cases.append({"name": file + "-key-" + repr(value), "ops": [{"op": "set", "file": file, "path": [collection, index, key], "value": value}]})
fields = original["programs.json"]["fields"]
code = fields.index("code")
for value in ([], {}):
    cases.append({"name": "program-field-" + repr(value), "ops": [{"op": "set", "file": "programs.json", "path": ["fields"], "value": fields + [value]}]})
    cases.append({"name": "program-code-" + repr(value), "ops": [{"op": "set", "file": "programs.json", "path": ["items", 0, code], "value": value}]})
for value in (None, [], {}, True):
    cases.append({"name": "catalog-status-" + repr(value), "ops": [{"op": "set", "file": "catalog.json", "path": ["datasets", 0, "status"], "value": value}]})
for case in cases:
    case["expected"] = namespace["run_case"](case["ops"])
encoded = (json.dumps({"cases": cases}, ensure_ascii=False, indent=2) + "\n").encode()
inputs = {name: hashlib.sha256((LEGACY / name).read_bytes()).hexdigest() for name in ("generate.py", "inventory.json", "evidence.json", "differential.json")}
proof = {"python": "3.12", "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "inputs": inputs, "oracleSha256": hashlib.sha256(encoded).hexdigest(), "cases": len(cases)}
for name, data in {"differential.json": encoded, "provenance.json": (json.dumps(proof, indent=2) + "\n").encode()}.items():
    target = HERE / name
    if "--check" in sys.argv:
        if not target.exists() or target.read_bytes() != data:
            raise SystemExit("Source-boundary proof differs: " + name)
    else:
        target.write_bytes(data)
