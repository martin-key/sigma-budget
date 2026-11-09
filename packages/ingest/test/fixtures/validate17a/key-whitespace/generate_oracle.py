"""Supplemental dictionary-key and text predicates from the unchanged Python donor."""
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
path = LEGACY / "generate_oracle.py"
namespace = {"__file__": str(path), "__name__": "frozen_key_whitespace_donor"}
exec(compile(path.read_text().split("\nobserved = {}")[0], str(path), "exec"), namespace)
cases = json.loads((HERE / "cases.json").read_text(encoding="utf8"))
observed = {}
with tempfile.TemporaryDirectory(prefix="sigma-key-whitespace-") as temp:
    for case in cases:
        root = Path(temp) / case["name"]
        shutil.copytree(LEGACY / "corpus", root)
        shutil.copytree(LEGACY / "overlay", root, dirs_exist_ok=True)
        for op in case["ops"]:
            namespace["mutate"](root, op)
        observed[case["name"]] = {group: namespace["capture"](root, group) for group in case["groups"]}
        shutil.rmtree(root)
encoded = (json.dumps(observed, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
inputs = {name: HERE / name for name in ["cases.json", "generate_oracle.py"]}
for name in ["generate_oracle.py", "provenance.json", "cases.json", "oracle.json", "cases-extra.json", "oracle-extra.json", "extra-provenance.json", "review/cases.json", "review/oracle.json", "review/json-cases.json", "review/json-oracle.json", "review/provenance.json"]:
    inputs["../" + name] = LEGACY / name
proof = {
    "python": "3.12",
    "inputs": {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in inputs.items()},
    "oracleSha256": hashlib.sha256(encoded).hexdigest(),
}
outputs = {"oracle.json": encoded, "provenance.json": (json.dumps(proof, indent=2) + "\n").encode()}
for name, data in outputs.items():
    target = HERE / name
    if "--check" in sys.argv:
        if not target.exists() or target.read_bytes() != data:
            raise SystemExit("Key/whitespace donor capture differs: " + name)
    else:
        target.write_bytes(data)
