"""Frozen Python byte/route-loader and container-operation regressions."""
import copy
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
original = LEGACY / "generate_oracle.py"
ns = {"__file__": str(original), "__name__": "frozen_reader_donor"}
exec(compile(original.read_text().split("\nobserved = {}")[0], str(original), "exec"), ns)
cases = [{"name": "reader-baseline", "groups": ["CORE", "CATALOG"], "compiled": True, "ops": []}]
for name in ("core", "execution", "catalog"):
    file = "data/release/" + name + ".json"
    cases.append({"name": "reader-bom-" + name, "groups": ["CORE"] if name != "catalog" else ["CATALOG"], "compiled": True, "ops": [{"op": "write", "file": file, "value": "\ufeff" + (LEGACY / "corpus" / file).read_text(encoding="utf8")} ]})
for field in ("traps", "methodology"):
    for value in (None, False, 0, {}, ""):
        cases.append({"name": "reader-" + field + "-" + repr(value), "groups": ["CATALOG"], "compiled": True, "ops": [{"op": "set", "file": "data/release/catalog.json", "path": [field], "value": value}]})
cases.append({"name": "reader-traps-first", "groups": ["CATALOG"], "compiled": True, "ops": [{"op": "set", "file": "data/release/catalog.json", "path": ["traps"], "value": None}, {"op": "deleteKey", "file": "data/release/catalog.json", "path": ["methodology"]}]})
for path in (["build"], ["counts"], ["population"], ["population", "series"], ["functions", 0]):
    cases.append({"name": "reader-string-index-" + str(len(cases)), "groups": ["CORE"], "compiled": True, "ops": [{"op": "set", "file": "data/release/core.json", "path": path, "value": ""}]})
route_file = "apps/web/app/lib/routes.json"
route_original = json.loads((LEGACY / "corpus" / route_file).read_text())
def route_case(name, change):
    doc = copy.deepcopy(route_original)
    change(doc)
    cases.append({"name": "reader-route-" + name, "groups": ["CORE", "CATALOG"], "compiled": True, "ops": [{"op": "write", "file": route_file, "value": json.dumps(doc, ensure_ascii=False)}]})
route_case("short", lambda d: d["routes"].__setitem__(0, d["routes"][0][:6]))
route_case("long", lambda d: d["routes"].__setitem__(0, d["routes"][0][:7] + [{}, None]))
route_case("duplicate", lambda d: d["routes"].append(copy.deepcopy(d["routes"][0])))
for label, options in [("duplicate-options", {"id": route_original["routes"][1][0]}), ("new-id", {"id": "S_READER"}), ("pattern", {"pattern": "/reader-route"}), ("pairs", [["pattern", "/reader-route"]]), ("empty-mapping", {}), ("empty-pairs", []), ("null-options", None), ("bool-options", False), ("string-options", "ab"), ("bad-pair", [1]), ("short-pair", [["x"]]), ("long-pair", [["x", 1, 2]]), ("unhashable-pair", [[["id"], "S_READER"]]), ("unhashable-id", {"id": []}), ("float-pattern", {"pattern": 0.0}), ("float-pattern-samples", {"pattern": 0.0, "samples": ["x"]}), ("list-pattern", {"pattern": []}), ("number-pattern", {"pattern": 1}), ("list-pattern-samples", {"pattern": [1], "samples": ["x"]})]:
    route_case(label, lambda d, o=options: d["routes"].__setitem__(0, d["routes"][0][:7] + [o]))
for label, rows in [("empty", []), ("empty-dict", {}), ("null", None)]:
    route_case(label, lambda d, r=rows: d.__setitem__("routes", r))
cases.append({"name": "reader-route-bom", "groups": ["CORE", "CATALOG"], "compiled": True, "ops": [{"op": "write", "file": route_file, "value": "\ufeff" + (LEGACY / "corpus" / route_file).read_text()}]})
queries = ["#/", "#/reader-route", "#/vedomstvo/0600", "#/danni/revenue", "#/zakon?per=2026.law", "#/not-a-screen"]
observed, routes = {}, {}
with tempfile.TemporaryDirectory(prefix="sigma-reader-") as temp:
    for case in cases:
        root = Path(temp) / case["name"]
        shutil.copytree(LEGACY / "corpus", root)
        shutil.copytree(LEGACY / "overlay", root, dirs_exist_ok=True)
        for op in case["ops"]: ns["mutate"](root, op)
        observed[case["name"]] = {group: ns["capture"](root, group) for group in case["groups"]}
        if case["name"] == "reader-baseline" or case["name"].startswith("reader-route-"):
            load = ns["routes"].load_routes
            ns["routes"].load_routes = lambda: load(root / route_file)
            try:
                compiled = ns["checks"].Routes()
                routes[case["name"]] = {"ids": list(compiled.routes), "matches": [compiled.match(q) for q in queries]}
            except Exception as error:
                routes[case["name"]] = {"crash": type(error).__name__ + ": " + str(error)}
            finally: ns["routes"].load_routes = load
        shutil.rmtree(root)
outputs = {"cases.json": (json.dumps(cases, ensure_ascii=True, separators=(",", ":")) + "\n").encode(), "oracle.json": (json.dumps(observed, ensure_ascii=True, separators=(",", ":")) + "\n").encode(), "routes.json": (json.dumps({"queries": queries, "results": routes}, ensure_ascii=True, separators=(",", ":")) + "\n").encode()}
proof = {"python": "3.12", "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "inputs": {name: hashlib.sha256((LEGACY / name).read_bytes()).hexdigest() for name in ("generate_oracle.py", "provenance.json", "review/provenance.json", "key-whitespace/provenance.json", "integer/provenance.json", "integer-limit/provenance.json")}, "outputs": {name: hashlib.sha256(data).hexdigest() for name, data in outputs.items()}, "cases": len(cases)}
outputs["provenance.json"] = (json.dumps(proof, indent=2) + "\n").encode()
for name, data in outputs.items():
    target = HERE / name
    if "--check" in sys.argv:
        if not target.exists() or target.read_bytes() != data: raise SystemExit("Reader proof differs: " + name)
    else: target.write_bytes(data)
