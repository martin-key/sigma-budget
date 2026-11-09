"""Independent container read, length, join and raw-number diagnostic outcomes."""
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
original = LEGACY / "generate_oracle.py"
ns = {"__file__": str(original), "__name__": "frozen_containers_donor"}
exec(compile(original.read_text().split("\nobserved = {}")[0], str(original), "exec"), ns)
cases = []
def add(group, file, path, value):
    file = "data/release/" + file
    doc = json.loads((LEGACY / "corpus" / file).read_text())
    node = doc
    for key in path[:-1]: node = node[key]
    node[path[-1]] = value
    cases.append({"name": "container-" + str(len(cases)), "groups": [group], "compiled": True, "ops": [{"op": "write", "file": file, "value": json.dumps(doc, ensure_ascii=False)}]})

for group, file, paths in [
    ("CORE", "core.json", [["counts"], ["population"], ["population", "series"], ["population", "series", "years"], ["population", "series", "persons"], ["functions"], ["revenueGroups"], ["sources"], ["pending"], ["kpis"], ["years"]]),
    ("CATALOG", "catalog.json", [["groups"], ["datasets"], ["files"], ["counts"], ["datasets", 0, "source"], ["datasets", 0, "screens"], ["datasets", 0, "contains"], ["traps"]]),
]:
    for path in paths:
        for value in (0.0, 1.0): add(group, file, path, value)
for value in (["missing", []], ["S01", []], ["missing", {}], ["S01", {}], [], ["S01"]):
    add("CORE", "core.json", ["pending", "P01", "screens"], value)
    add("CATALOG", "catalog.json", ["datasets", 0, "screens"], value)
for value in (None, 0, [], {}, ""):
    add("CATALOG", "catalog.json", ["files"], value)
for value in (0.0, 0, None, True):
    add("CATALOG", "catalog.json", ["datasets", 0, "screens"], ["missing", value])
for value in (-0.0, 1e-5, 1e20, 1705.0):
    add("CATALOG", "catalog.json", ["counts"], value)
observed = {}
with tempfile.TemporaryDirectory(prefix="sigma-containers-donor-") as temp:
    for case in cases:
        root = Path(temp) / case["name"]
        shutil.copytree(LEGACY / "corpus", root)
        shutil.copytree(LEGACY / "overlay", root, dirs_exist_ok=True)
        for op in case["ops"]: ns["mutate"](root, op)
        observed[case["name"]] = {group: ns["capture"](root, group) for group in case["groups"]}
        shutil.rmtree(root)
outputs = {"cases.json": (json.dumps(cases, ensure_ascii=True, separators=(",", ":")) + "\n").encode(), "oracle.json": (json.dumps(observed, ensure_ascii=True, separators=(",", ":")) + "\n").encode()}
proof = {"python": "3.12", "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "inputs": {name: hashlib.sha256((LEGACY / name).read_bytes()).hexdigest() for name in ("generate_oracle.py", "provenance.json", "reader/provenance.json", "boundaries/provenance.json")}, "outputs": {name: hashlib.sha256(raw).hexdigest() for name, raw in outputs.items()}, "cases": len(cases)}
outputs["provenance.json"] = (json.dumps(proof, indent=2) + "\n").encode()
for name, raw in outputs.items():
    target = HERE / name
    if "--check" in sys.argv:
        if not target.exists() or target.read_bytes() != raw: raise SystemExit("Container proof differs: " + name)
    else: target.write_bytes(raw)
