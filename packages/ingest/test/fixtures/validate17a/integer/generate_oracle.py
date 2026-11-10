"""Capture Python 3.12 integer parsing independently of TypeScript and live data."""
import hashlib
import json
import shutil
import sys
import tempfile
import unicodedata
from pathlib import Path

if sys.version_info[:2] != (3, 12) or unicodedata.unidata_version != "15.0.0":
    raise SystemExit("Python 3.12 with Unicode 15.0.0 is required")
HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
original = LEGACY / "generate_oracle.py"
namespace = {"__file__": str(original), "__name__": "frozen_integer_donor"}
exec(compile(original.read_text().split("\nobserved = {}")[0], str(original), "exec"), namespace)
zeroes = [cp for cp in range(0x110000) if unicodedata.decimal(chr(cp), None) == 0]
nonprintable = []
for cp in range(0x110000):
    if not chr(cp).isprintable():
        if nonprintable and nonprintable[-1][1] == cp - 1:
            nonprintable[-1][1] = cp
        else:
            nonprintable.append([cp, cp])
texts = ["2020", "+2020", "-2020", "2_020", "2__020", "_2020", "2020_", "2020.0", "2020e0", "", " ", "0x7e4", "'2020", '"2020']
for cp in list(range(0x09, 0x0e)) + list(range(0x1c, 0x21)) + [0x85, 0xa0, 0x1680, *range(0x2000, 0x200c), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]:
    ch = chr(cp)
    texts.extend([ch + "2020" + ch, "20" + ch + "20"])
for zero in zeroes:
    texts.append("".join(chr(zero + int(d)) for d in "2020"))
texts += [chr(0x10d43) + "2020", chr(0x1ccf2) + "020", "²020", "𝟚0２０", "\ud8002020"]
texts = list(dict.fromkeys(texts))
cases = [{"name": "integer-" + str(i), "groups": ["CORE"], "compiled": i < 14 or "\ufeff" in text or "\x85" in text or i >= len(texts) - 5, "ops": [{"op": "set", "file": "data/inputs/population.json", "path": ["years", 0], "value": text}]} for i, text in enumerate(texts)]
observed = {}
with tempfile.TemporaryDirectory(prefix="sigma-integer-donor-") as temp:
    for case in cases:
        root = Path(temp) / case["name"]
        shutil.copytree(LEGACY / "corpus", root)
        shutil.copytree(LEGACY / "overlay", root, dirs_exist_ok=True)
        for op in case["ops"]:
            # ASCII escapes preserve lone surrogate JSON values exactly.
            path = root / op["file"]
            doc = json.loads(path.read_text(encoding="utf8"))
            doc["years"][0] = op["value"]
            path.write_text(json.dumps(doc, ensure_ascii=True), encoding="utf8")
        observed[case["name"]] = {"CORE": namespace["capture"](root, "CORE")}
        shutil.rmtree(root)
outputs = {
    "cases.json": (json.dumps(cases, ensure_ascii=True, separators=(",", ":")) + "\n").encode(),
    "oracle.json": (json.dumps(observed, ensure_ascii=True, separators=(",", ":")) + "\n").encode(),
    "data.json": (json.dumps({"zeroes": zeroes, "nonprintable": nonprintable}, separators=(",", ":")) + "\n").encode(),
}
proof = {
    "python": "3.12",
    "unicode": unicodedata.unidata_version,
    "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "donorInventorySha256": hashlib.sha256((LEGACY / "provenance.json").read_bytes()).hexdigest(),
    "donorGeneratorSha256": hashlib.sha256(original.read_bytes()).hexdigest(),
    "cases": len(cases),
    "outputs": {name: hashlib.sha256(encoded).hexdigest() for name, encoded in outputs.items()},
}
outputs["provenance.json"] = (json.dumps(proof, indent=2) + "\n").encode()
for name, encoded in outputs.items():
    path = HERE / name
    if "--check" in sys.argv:
        if not path.exists() or path.read_bytes() != encoded:
            raise SystemExit("Integer evidence differs: " + name)
    else:
        path.write_bytes(encoded)
