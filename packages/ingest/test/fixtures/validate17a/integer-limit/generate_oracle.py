"""Capture the pinned CPython integer-string digit limit without changing earlier evidence."""
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

if sys.version_info[:2] != (3, 12) or sys.get_int_max_str_digits() != 4300:
    raise SystemExit("Python 3.12 with the default 4300-digit limit is required")
HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
path = LEGACY / "generate_oracle.py"
namespace = {"__file__": str(path), "__name__": "frozen_integer_limit_donor"}
exec(compile(path.read_text().split("\nobserved = {}")[0], str(path), "exec"), namespace)
cases = []
for length in (4300, 4301):
    base = "0" * (length - 4) + "2020"
    for name, value in [("plain", base), ("sign", "+" + base), ("underscores", "_".join(base)), ("fullwidth", "".join(chr(0xff10 + int(x)) for x in base)), ("numeric-space", "\x85" + base + "\x85")]:
        cases.append({"name": "integer-limit-" + name + "-" + str(length), "groups": ["CORE"], "compiled": True, "ops": [{"op": "set", "file": "data/inputs/population.json", "path": ["years", 0], "value": value}]})
for name, value in [("invalid-ascii", "x" * 201), ("invalid-wide", "０" * 201 + "x"), ("invalid-nonbmp", "😀" * 201), ("invalid-long", "0" * 4301 + "x")]:
    cases.append({"name": "integer-limit-" + name, "groups": ["CORE"], "compiled": True, "ops": [{"op": "set", "file": "data/inputs/population.json", "path": ["years", 0], "value": value}]})
observed = {}
with tempfile.TemporaryDirectory(prefix="sigma-int-limit-") as temp:
    for case in cases:
        root = Path(temp) / case["name"]
        shutil.copytree(LEGACY / "corpus", root)
        shutil.copytree(LEGACY / "overlay", root, dirs_exist_ok=True)
        for op in case["ops"]:
            namespace["mutate"](root, op)
        observed[case["name"]] = {"CORE": namespace["capture"](root, "CORE")}
        shutil.rmtree(root)
outputs = {"cases.json": (json.dumps(cases, ensure_ascii=True, separators=(",", ":")) + "\n").encode(), "oracle.json": (json.dumps(observed, ensure_ascii=True, separators=(",", ":")) + "\n").encode()}
proof = {"python": "3.12", "maxDigits": 4300, "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "inputs": {name: hashlib.sha256((LEGACY / name).read_bytes()).hexdigest() for name in ("generate_oracle.py", "provenance.json", "integer/provenance.json")}, "outputs": {name: hashlib.sha256(raw).hexdigest() for name, raw in outputs.items()}, "cases": len(cases)}
outputs["provenance.json"] = (json.dumps(proof, indent=2) + "\n").encode()
for name, raw in outputs.items():
    target = HERE / name
    if "--check" in sys.argv:
        if not target.exists() or target.read_bytes() != raw:
            raise SystemExit("Integer-limit proof differs: " + name)
    else:
        target.write_bytes(raw)
