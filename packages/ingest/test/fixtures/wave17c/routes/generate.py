"""Independent SEARCH outcomes for the frozen route-loader contract."""
import copy
import hashlib
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
path = LEGACY / "generate.py"
namespace = {"__file__": str(path), "__name__": "frozen_route_donor"}
exec(compile(path.read_text().split("\nresult =")[0], str(path), "exec"), namespace)
from budget_pipeline import routes

original = json.loads((LEGACY / "corpus/apps/web/app/lib/routes.json").read_text())
cases = []
def capture(name, change):
    doc = copy.deepcopy(original)
    change(doc)
    cases.append({"name": name, "catalogue": json.dumps(doc, ensure_ascii=False)})

capture("baseline", lambda doc: None)
capture("six-fields", lambda doc: doc["routes"].__setitem__(0, doc["routes"][0][:6]))
capture("nine-fields", lambda doc: doc["routes"].__setitem__(0, doc["routes"][0][:7] + [{}, None]))
capture("duplicate-id", lambda doc: doc["routes"].append(copy.deepcopy(doc["routes"][0])))
capture("options-duplicate-id", lambda doc: doc["routes"].__setitem__(0, doc["routes"][0][:7] + [{"id": doc["routes"][1][0]}]))
capture("options-new-id", lambda doc: doc["routes"].__setitem__(0, doc["routes"][0][:7] + [{"id": "S_SEARCH_ROUTE"}]))
capture("options-new-pattern", lambda doc: doc["routes"].__setitem__(0, doc["routes"][0][:7] + [{"pattern": "/search-route"}]))
capture("empty-options", lambda doc: doc["routes"].__setitem__(0, doc["routes"][0][:7] + [{}]))
capture("null-options", lambda doc: doc["routes"].__setitem__(0, doc["routes"][0][:7] + [None]))
capture("empty-catalogue", lambda doc: doc.__setitem__("routes", []))
cases.append({"name": "bom-catalogue", "catalogue": "\ufeff" + json.dumps(original, ensure_ascii=False)})
load = routes.load_routes
with tempfile.TemporaryDirectory(prefix="sigma-search-route-donor-") as temp:
    for case in cases:
        file = Path(temp) / (case["name"] + ".json")
        file.write_text(case["catalogue"], encoding="utf8")
        routes.load_routes = lambda file=file: load(file)
        try: case["expected"] = namespace["run_case"]([])
        finally: routes.load_routes = load
encoded = (json.dumps({"cases": cases}, ensure_ascii=False, indent=2) + "\n").encode()
inputs = {name: hashlib.sha256((LEGACY / name).read_bytes()).hexdigest() for name in ("generate.py", "inventory.json", "evidence.json", "differential.json", "sources/provenance.json")}
proof = {"python": "3.12", "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "inputs": inputs, "oracleSha256": hashlib.sha256(encoded).hexdigest(), "cases": len(cases)}
for name, data in {"differential.json": encoded, "provenance.json": (json.dumps(proof, indent=2) + "\n").encode()}.items():
    target = HERE / name
    if "--check" in sys.argv:
        if not target.exists() or target.read_bytes() != data:
            raise SystemExit("SEARCH route proof differs: " + name)
    else: target.write_bytes(data)
