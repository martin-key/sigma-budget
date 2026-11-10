"""Regenerate CORE/CATALOG donor observations from the pinned Git-exported closure."""
import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

if sys.version_info[:2] != (3, 12):
    raise SystemExit("Python 3.12 is required")
HERE = Path(__file__).resolve().parent
provenance = json.loads((HERE / "provenance.json").read_text(encoding="utf8"))
actual = {str(p.relative_to(HERE)) for folder in ("corpus", "donor") for p in (HERE / folder).rglob("*") if p.is_file()}
if actual != set(provenance["inputs"]):
    raise SystemExit("Frozen input file set changed")
for path, wanted in provenance["inputs"].items():
    if hashlib.sha256((HERE / path).read_bytes()).hexdigest() != wanted:
        raise SystemExit("Frozen input changed: " + path)
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE / "donor"))
from budget_pipeline.validate import catalog, checks
from budget_pipeline import routes

extra = "--extra" in sys.argv
case_file = "cases-extra.json" if extra else "cases.json"
extra_provenance = json.loads((HERE / "extra-provenance.json").read_text(encoding="utf8")) if extra else provenance
overlay = HERE / "overlay/data/release/releases/current.json"
if extra:
    overlay_files = {p for p in (HERE / "overlay").rglob("*") if p.is_file()}
    if overlay_files != {overlay} or hashlib.sha256(overlay.read_bytes()).hexdigest() != extra_provenance["overlaySha256"]:
        raise SystemExit("Frozen dynamic release pointer changed")
cases = json.loads((HERE / case_file).read_text(encoding="utf8"))
if hashlib.sha256((HERE / case_file).read_bytes()).hexdigest() != extra_provenance["casesSha256"]:
    raise SystemExit("Cases changed")

def mutate(root, op):
    path = root / op["file"]
    if op["op"] == "deleteFile":
        path.unlink()
    elif op["op"] == "write":
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(op["value"], encoding="utf8")
    elif op["op"] == "replace":
        source = path.read_text(encoding="utf8")
        if source.count(op["old"]) != 1: raise ValueError("replacement must be unique")
        path.write_text(source.replace(op["old"], op["value"]), encoding="utf8")
    elif op["op"] == "append":
        with path.open("a", encoding="utf8") as fh: fh.write(op["value"])
    else:
        value = json.loads(path.read_text(encoding="utf8"))
        target = value
        for part in op["path"][:-1]: target = target[part]
        if op["op"] == "set": target[op["path"][-1]] = op["value"]
        elif op["op"] == "deleteKey": del target[op["path"][-1]]
        else: raise ValueError(op)
        path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf8")

def capture(root, group):
    checks.ROOT = str(root)
    checks.DATA = str(root / "data/release")
    catalog.ROOT = root
    original = routes.load_routes
    routes.load_routes = lambda: original(root / "apps/web/app/lib/routes.json")
    try:
        c = {"CORE": catalog.g_core, "CATALOG": catalog.g_catalog}[group](checks.Ctx())
        return {"name": c.name, "n": c.n, "problems": c.problems, "warnings": c.warnings, "facts": c.facts}
    except Exception as e:
        return {"crash": type(e).__name__ + ": " + str(e).replace(str(root), "<ROOT>")}
    finally:
        routes.load_routes = original

observed = {}
with tempfile.TemporaryDirectory() as temp:
    for case in cases:
        root = Path(temp) / case["name"]
        shutil.copytree(HERE / "corpus", root)
        if extra:
            dest = root / "data/release/releases/current.json"
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(overlay, dest)
        for op in case["ops"]: mutate(root, op)
        observed[case["name"]] = {group: capture(root, group) for group in case["groups"]}
        shutil.rmtree(root)
encoded = (json.dumps(observed, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
path = HERE / ("oracle-extra.json" if extra else "oracle.json")
if "--check" in sys.argv:
    if not path.exists() or path.read_bytes() != encoded or hashlib.sha256(encoded).hexdigest() != extra_provenance["oracleSha256"]:
        raise SystemExit("Frozen donor oracle differs")
else:
    path.write_bytes(encoded)
