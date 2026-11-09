"""Capture ZIP lookup/hash ordering and raw required-source kinds independently."""
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
original = HERE / "source_order.py"
namespace = {"__file__": str(original), "__name__": "source_methods_donor"}
exec(compile(original.read_text().split("\ncases = []")[0], str(original), "exec"), namespace)
FIXTURES = HERE.parent
cases = []
for document in ("forecast", "bill"):
    existing = json.loads((FIXTURES / ("fiscal/inputs/data/inputs/budget_" + document + "_2027.json")).read_text())["source"]["member"]
    for member in ("missing.pdf", None, [], {}, 1, 1.0, True, existing):
        for mode in ("null", "absent", "wrong"):
            ops = [{"path": ["source", "member"], **({"raw": json.dumps(member)} if isinstance(member, float) else {"value": member})}]
            if mode == "absent":
                ops += [{"path": ["source", key], "delete": True} for key in ("pdf_sha256", "memberSha256")]
            else:
                ops.append({"path": ["source", "pdf_sha256"], "value": None if mode == "null" else "0" * 64})
            cases.append({"document": document, "ops": ops})
    for token in ("1.0", "1e0", "0.0", "1", "true", "null", "[]", "{}", '"text"'):
        cases.append({"document": document, "ops": [{"path": ["source"], "raw": token}]})
observations = []
with tempfile.TemporaryDirectory(prefix="sigma-source-methods-") as temp:
    root = Path(temp)
    shutil.copytree(FIXTURES / "fiscal/inputs/data/inputs", root / "data/inputs")
    archive = root / "data/originals/budget_2027/ZDBRB-2027.zip"
    archive.parent.mkdir(parents=True)
    shutil.copyfile(FIXTURES / "fiscal/inputs/data/originals/budget_2027/ZDBRB-2027.zip", archive)
    originals = {name: (root / ("data/inputs/budget_" + name + "_2027.json")).read_bytes() for name in ("forecast", "bill")}
    namespace["annual_periods"].ROOT = root
    namespace["annual_periods"].SRC = root / "data/inputs"
    for case in cases:
        for name, data in originals.items():
            (root / ("data/inputs/budget_" + name + "_2027.json")).write_bytes(data)
        path = root / ("data/inputs/budget_" + case["document"] + "_2027.json")
        doc = json.loads(path.read_text(encoding="utf8"))
        for op in case["ops"]:
            holder = doc
            for key in op["path"][:-1]:
                holder = holder[key]
            key = op["path"][-1]
            if op.get("delete"):
                holder.pop(key, None)
            else:
                holder[key] = "__SOURCE_METHOD_TOKEN__" if "raw" in op else op["value"]
        encoded = json.dumps(doc, ensure_ascii=False)
        for op in case["ops"]:
            if "raw" in op:
                encoded = encoded.replace('"__SOURCE_METHOD_TOKEN__"', op["raw"])
        path.write_text(encoded, encoding="utf8")
        try:
            namespace["donor"].g_budget_2027(None)
            raise AssertionError("Malformed source unexpectedly passed")
        except AssertionError:
            raise
        except Exception as error:
            check = namespace["Check"]("BUDGET2027")
            check.fail("group crashed: " + type(error).__name__ + ": " + str(error).replace(str(root), "<ROOT>"))
        observations.append({"case": case, "result": {"name": check.name, "n": check.n, "problems": check.problems, "warnings": check.warnings, "facts": check.facts}})
encoded = (json.dumps(observations, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
proof = {
    "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "sourceOrderSha256": hashlib.sha256(original.read_bytes()).hexdigest(),
    "inventorySha256": hashlib.sha256((HERE / "inventory.json").read_bytes()).hexdigest(),
    "oracleSha256": hashlib.sha256(encoded).hexdigest(),
    "cases": len(cases),
}
for name, data in {"source-methods.json": encoded, "source-methods-provenance.json": (json.dumps(proof, indent=2) + "\n").encode()}.items():
    target = HERE / name
    if "--check" in sys.argv:
        if not target.exists() or target.read_bytes() != data:
            raise SystemExit("Source-method observations differ: " + name)
    else:
        target.write_bytes(data)
