"""Independent owner-year %d boundaries from the unchanged frozen FEED donor."""
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
path = LEGACY / "generate.py"
namespace = {"__file__": str(path), "__name__": "frozen_year_donor"}
exec(compile(path.read_text().split("\nresults = {}")[0], str(path), "exec"), namespace)
owners = [
    ("population", "core.json", ["population", "year"]),
    ("maastricht", "debt.json", ["latest", "maastricht", "year"]),
    ("cofog", "expenditure.json", ["cofog", "years", -1]),
]
values = ["2026", [], {}, None, True, False, 2026, 2026.0, 2026.75, -0.0, 1e20, 123456789012345678901234567890]
outputs = {}
observed = []
with tempfile.TemporaryDirectory(prefix="sigma-year-donor-") as temp:
    for owner, file, location in owners:
        for i, value in enumerate(values):
            name = owner + "-" + str(i)
            root = Path(temp) / name
            shutil.copytree(LEGACY / "corpus", root)
            target = root / "data/release" / file
            data = json.loads(target.read_text(encoding="utf8"))
            receiver = data
            for key in location[:-1]: receiver = receiver[key]
            receiver[location[-1]] = value
            raw = (json.dumps(data, ensure_ascii=False) + "\n").encode()
            target.write_bytes(raw)
            outputs["mutations/" + name + ".json"] = raw
            observed.append({"name": name, "file": file, "expected": namespace["run"](root, False)})
            shutil.rmtree(root)
outputs["oracle.json"] = (json.dumps(observed, ensure_ascii=False, indent=2) + "\n").encode()
proof = {
    "python": "3.12",
    "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "inputs": {name: hashlib.sha256((LEGACY / name).read_bytes()).hexdigest() for name in ("generate.py", "provenance.json", "oracle.json", "extra-provenance.json")},
    "outputs": {name: hashlib.sha256(raw).hexdigest() for name, raw in outputs.items()},
    "cases": len(observed),
}
outputs["provenance.json"] = (json.dumps(proof, indent=2) + "\n").encode()
for name, raw in outputs.items():
    target = HERE / name
    if "--check" in sys.argv:
        if not target.exists() or target.read_bytes() != raw:
            raise SystemExit("Year donor proof differs: " + name)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
