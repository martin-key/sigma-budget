"""Independent iterator, set-operand and primary-source membership outcomes."""
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
original = LEGACY / "generate_oracle.py"
ns = {"__file__": str(original), "__name__": "frozen_iterators_donor"}
exec(compile(original.read_text().split("\nobserved = {}")[0], str(original), "exec"), ns)
cases = []
def add(group, file, path, value):
    file = "data/release/" + file
    doc = json.loads((LEGACY / "corpus" / file).read_text())
    node = doc
    for key in path[:-1]: node = node[key]
    node[path[-1]] = value
    cases.append({"name": "iterator-" + str(len(cases)), "groups": [group], "compiled": True, "ops": [{"op": "write", "file": file, "value": json.dumps(doc, ensure_ascii=False)}]})

core = json.loads((LEGACY / "corpus/data/release/core.json").read_text())
paths = [
    ("CORE", "core.json", ["sources", next(iter(core["sources"]))]),
    ("CORE", "core.json", ["pending", "P01"]),
    ("CORE", "core.json", ["functions", 0]),
    ("CORE", "core.json", ["revenueGroups", 0]),
    ("CORE", "execution.json", ["data", "2025"]),
    ("CATALOG", "catalog.json", ["groups", 0]),
    ("CATALOG", "catalog.json", ["datasets", 0]),
    ("CATALOG", "catalog.json", ["traps", 0]),
    ("CATALOG", "catalog.json", ["files", 0]),
    ("CATALOG", "core.json", ["meta", "source"]),
    ("CATALOG", "catalog.json", ["datasets", 0, "pending"]),
    ("CATALOG", "core.json", ["meta", "pending"]),
]
for group, file, path in paths:
    for value in (0.0, 1.0, 0, None, [], {}): add(group, file, path, value)
for group, file, path in [
    ("CORE", "core.json", ["functions", 1]),
    ("CORE", "core.json", ["revenueGroups", 1]),
    ("CATALOG", "catalog.json", ["datasets", 1]),
    ("CATALOG", "catalog.json", ["files", 1]),
]:
    for value in (0.0, 1.0): add(group, file, path, value)
for group, file, path in [
    ("CORE", "core.json", ["kpis", "revenue", "href"]),
    ("CORE", "core.json", ["sources", "budget2027", "url"]),
    ("CATALOG", "core.json", ["meta", "id"]),
]:
    add(group, file, path, 1.0)
for value in (True, "", "name", ["name", "title", "sha256", "bytes", "source", "role", "usedBy"]):
    add("CATALOG", "catalog.json", ["files", 0], value)
for field in ("data", "monthly"):
    for value in (0.0, 1.0, 0, None, [], {}):
        add("CORE", "execution.json", [field], value)
for left, right in (([1], [True]), ([True], [1]), ([0], [False]), ([False], [0])):
    catalog = json.loads((LEGACY / "corpus/data/release/catalog.json").read_text())
    next(row for row in catalog["datasets"] if row["slug"] == "core")["pending"] = left
    doc = json.loads((LEGACY / "corpus/data/release/core.json").read_text())
    doc["meta"]["pending"] = right
    cases.append({"name": "iterator-" + str(len(cases)), "groups": ["CATALOG"], "compiled": True, "ops": [{"op": "write", "file": "data/release/catalog.json", "value": json.dumps(catalog, ensure_ascii=False)}, {"op": "write", "file": "data/release/core.json", "value": json.dumps(doc, ensure_ascii=False)}]})
observed = {}
with tempfile.TemporaryDirectory(prefix="sigma-iterators-donor-") as temp:
    for case in cases:
        root = Path(temp) / case["name"]
        shutil.copytree(LEGACY / "corpus", root)
        shutil.copytree(LEGACY / "overlay", root, dirs_exist_ok=True)
        for op in case["ops"]: ns["mutate"](root, op)
        observed[case["name"]] = {group: ns["capture"](root, group) for group in case["groups"]}
        shutil.rmtree(root)
outputs = {"cases.json": (json.dumps(cases, ensure_ascii=True, separators=(",", ":")) + "\n").encode(), "oracle.json": (json.dumps(observed, ensure_ascii=True, separators=(",", ":")) + "\n").encode()}
proof = {"python": "3.12", "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "inputs": {name: hashlib.sha256((LEGACY / name).read_bytes()).hexdigest() for name in ("generate_oracle.py", "provenance.json", "reader/provenance.json", "boundaries/provenance.json", "containers/provenance.json")}, "outputs": {name: hashlib.sha256(raw).hexdigest() for name, raw in outputs.items()}, "cases": len(cases)}
outputs["provenance.json"] = (json.dumps(proof, indent=2) + "\n").encode()
for name, raw in outputs.items():
    target = HERE / name
    if "--check" in sys.argv:
        if not target.exists() or target.read_bytes() != raw: raise SystemExit("Iterator proof differs: " + name)
    else: target.write_bytes(raw)
