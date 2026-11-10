"""Independent decimal, raw-float and screen-membership donor boundaries."""
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
original = LEGACY / "generate_oracle.py"
ns = {"__file__": str(original), "__name__": "frozen_boundaries_donor"}
exec(compile(original.read_text().split("\nobserved = {}")[0], str(original), "exec"), ns)
cases = []
def add(name, group, file, path, value):
    doc = json.loads((LEGACY / "corpus" / file).read_text())
    node = doc
    for key in path[:-1]: node = node[key]
    node[path[-1]] = value
    cases.append({"name": "boundary-" + name, "groups": [group], "compiled": True, "ops": [{"op": "write", "file": file, "value": json.dumps(doc, ensure_ascii=False)}]})

for label, suffix in [("ascii", "1"), ("arabic", "١"), ("fullwidth", "１"), ("superscript", "¹"), ("new-unicode", "\U00010d43"), ("newline", "1\n"), ("space", "1 ")]:
    add("version-" + label, "CORE", "data/release/core.json", ["build", "dataVersion"], "2026-11-08." + suffix)
for field in ("traps", "methodology"):
    for value in (0.0, 1.0):
        add(field + "-float-" + str(value), "CATALOG", "data/release/catalog.json", [field], value)
for path, label in [(["build"], "build"), (["build", "dataVersion"], "dataVersion")]:
    for value in (0.0, 1.0):
        add(label + "-float-" + str(value), "CORE", "data/release/core.json", path, value)
for label, value in [("list", [[]]), ("dict", [{}]), ("empty", []), ("valid", ["S01"])]:
    add("pending-screen-" + label, "CORE", "data/release/core.json", ["pending", "P01", "screens"], value)
for label, value in [("list", [[]]), ("dict", [{}])]:
    add("dataset-screen-" + label, "CATALOG", "data/release/catalog.json", ["datasets", 0, "screens"], value)
observed = {}
with tempfile.TemporaryDirectory(prefix="sigma-boundaries-donor-") as temp:
    for case in cases:
        root = Path(temp) / case["name"]
        shutil.copytree(LEGACY / "corpus", root)
        shutil.copytree(LEGACY / "overlay", root, dirs_exist_ok=True)
        for op in case["ops"]: ns["mutate"](root, op)
        observed[case["name"]] = {group: ns["capture"](root, group) for group in case["groups"]}
        shutil.rmtree(root)
outputs = {"cases.json": (json.dumps(cases, ensure_ascii=True, separators=(",", ":")) + "\n").encode(), "oracle.json": (json.dumps(observed, ensure_ascii=True, separators=(",", ":")) + "\n").encode()}
proof = {"python": "3.12", "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "inputs": {name: hashlib.sha256((LEGACY / name).read_bytes()).hexdigest() for name in ("generate_oracle.py", "provenance.json", "integer/provenance.json", "reader/provenance.json")}, "outputs": {name: hashlib.sha256(raw).hexdigest() for name, raw in outputs.items()}, "cases": len(cases)}
outputs["provenance.json"] = (json.dumps(proof, indent=2) + "\n").encode()
for name, raw in outputs.items():
    target = HERE / name
    if "--check" in sys.argv:
        if not target.exists() or target.read_bytes() != raw: raise SystemExit("Boundary proof differs: " + name)
    else: target.write_bytes(raw)
