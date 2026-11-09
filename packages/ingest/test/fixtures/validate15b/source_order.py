"""Capture combined-damage failure order using the unchanged frozen Python validator."""
import hashlib
import json
import os
import shutil
import socket
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent
if sys.version_info[:2] != (3, 12):
    raise SystemExit("Python 3.12 required")
for path, expected in json.loads((HERE / "inventory.json").read_text())["sha256"].items():
    if hashlib.sha256((FIXTURES / path).read_bytes()).hexdigest() != expected:
        raise SystemExit("Frozen input changed: " + path)
socket.socket = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("network denied"))
os.environ["BUILD_DATE"] = "2026-11-08"
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE / "donor"))
from budget_pipeline.build import annual_periods
from budget_pipeline.validate import budget_2027 as donor
from budget_pipeline.validate.checks import Check

cases = []
for document in ("forecast", "bill"):
    for missing, damage in [
        ("member", "archive_sha256"),
        ("archive", "archive_sha256"),
        ("member", "archive"),
        ("member", "pdf_sha256"),
        ("source", "none"),
        ("archive+member", "none"),
        ("none", "archive_sha256"),
        ("none", "pdf_sha256"),
    ]:
        cases.append({"document": document, "missing": missing, "damage": damage})
observations = []
with tempfile.TemporaryDirectory(prefix="sigma-15b-order-") as temp:
    root = Path(temp)
    shutil.copytree(FIXTURES / "fiscal/inputs/data/inputs", root / "data/inputs")
    archive = root / "data/originals/budget_2027/ZDBRB-2027.zip"
    archive.parent.mkdir(parents=True)
    shutil.copyfile(FIXTURES / "fiscal/inputs/data/originals/budget_2027/ZDBRB-2027.zip", archive)
    originals = {name: (root / ("data/inputs/budget_" + name + "_2027.json")).read_bytes() for name in ("forecast", "bill")}
    annual_periods.ROOT = root
    annual_periods.SRC = root / "data/inputs"
    for case in cases:
        for name, data in originals.items():
            (root / ("data/inputs/budget_" + name + "_2027.json")).write_bytes(data)
        path = root / ("data/inputs/budget_" + case["document"] + "_2027.json")
        doc = json.loads(path.read_text(encoding="utf8"))
        if case["damage"] != "none":
            doc["source"][case["damage"]] = "missing.zip" if case["damage"] == "archive" else "0" * 64
        if case["missing"] == "source":
            del doc["source"]
        elif case["missing"] != "none":
            for field in case["missing"].split("+"):
                del doc["source"][field]
        path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf8")
        try:
            donor.g_budget_2027(None)
            raise AssertionError("Combined damaged input unexpectedly passed")
        except AssertionError:
            raise
        except Exception as error:
            check = Check("BUDGET2027")
            check.fail("group crashed: " + type(error).__name__ + ": " + str(error).replace(str(root), "<ROOT>"))
        observations.append({"case": case, "result": {"name": check.name, "n": check.n, "problems": check.problems, "warnings": check.warnings, "facts": check.facts}})
encoded = (json.dumps(observations, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
proof = {
    "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "inventorySha256": hashlib.sha256((HERE / "inventory.json").read_bytes()).hexdigest(),
    "oracleSha256": hashlib.sha256(encoded).hexdigest(),
    "cases": len(cases),
}
outputs = {"source-order.json": encoded, "source-order-provenance.json": (json.dumps(proof, indent=2) + "\n").encode()}
for name, data in outputs.items():
    path = HERE / name
    if "--check" in sys.argv:
        if not path.exists() or path.read_bytes() != data:
            raise SystemExit("Source-order observations differ: " + name)
    else:
        path.write_bytes(data)
