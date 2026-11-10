"""Additional review regressions; the original captures and donor remain immutable."""
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

if sys.version_info[:2] != (3, 12):
    raise SystemExit("Python 3.12 is required")
HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
namespace = {"__file__": str(LEGACY / "generate_oracle.py"), "__name__": "frozen_review_donor"}
source = (LEGACY / "generate_oracle.py").read_text(encoding="utf8")
exec(compile(source.split("\nobserved = {}")[0], namespace["__file__"], "exec"), namespace)
cases = json.loads((HERE / "cases.json").read_text(encoding="utf8"))
observed = {}
with tempfile.TemporaryDirectory() as temp:
    for case in cases:
        root = Path(temp) / case["name"]
        shutil.copytree(LEGACY / "corpus", root)
        shutil.copytree(LEGACY / "overlay", root, dirs_exist_ok=True)
        for op in case["ops"]:
            if op["op"] != "rawSet":
                namespace["mutate"](root, op)
                continue
            marker = "__review_raw_number__"
            namespace["mutate"](root, {**op, "op": "set", "value": marker})
            path = root / op["file"]
            text = path.read_text(encoding="utf8")
            if text.count(json.dumps(marker)) != 1:
                raise ValueError("raw marker must be unique")
            path.write_text(text.replace(json.dumps(marker), op["value"]), encoding="utf8")
        observed[case["name"]] = {
            group: namespace["capture"](root, group) for group in case["groups"]
        }
        shutil.rmtree(root)

def reject_constant(value):
    raise ValueError("non-finite number " + value + " in JSON")

diagnostics = []
for text in json.loads((HERE / "json-cases.json").read_text(encoding="utf8")):
    try:
        result = {"value": json.loads(text, parse_constant=reject_constant)}
    except Exception as error:
        result = {"error": type(error).__name__ + ": " + str(error)}
    diagnostics.append({"text": text, **result})
outputs = {
    "oracle.json": (json.dumps(observed, ensure_ascii=False, separators=(",", ":")) + "\n").encode(),
    "json-oracle.json": (json.dumps(diagnostics, ensure_ascii=True, separators=(",", ":")) + "\n").encode(),
}
inputs = {
    "cases.json": HERE / "cases.json",
    "json-cases.json": HERE / "json-cases.json",
    "generate_oracle.py": Path(__file__),
    "../generate_oracle.py": LEGACY / "generate_oracle.py",
    "../provenance.json": LEGACY / "provenance.json",
    "../cases.json": LEGACY / "cases.json",
    "../oracle.json": LEGACY / "oracle.json",
    "../cases-extra.json": LEGACY / "cases-extra.json",
    "../oracle-extra.json": LEGACY / "oracle-extra.json",
    "../extra-provenance.json": LEGACY / "extra-provenance.json",
}
proof = {
    "python": "3.12",
    "inputs": {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in inputs.items()},
    "outputs": {name: hashlib.sha256(data).hexdigest() for name, data in outputs.items()},
}
outputs["provenance.json"] = (json.dumps(proof, indent=2) + "\n").encode()
for name, data in outputs.items():
    path = HERE / name
    if "--check" in sys.argv:
        if not path.exists() or path.read_bytes() != data:
            raise SystemExit("Review oracle differs: " + name)
    else:
        path.write_bytes(data)
