"""Independent population-format boundaries from the unchanged frozen FEED donor."""
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
path = LEGACY / "generate.py"
namespace = {"__file__": str(path), "__name__": "frozen_population_donor"}
exec(compile(path.read_text().split("\nresults = {}")[0], str(path), "exec"), namespace)
values = [[], {}, None, "", "123", True, False, 0, 0.0, 1.0, -0.0, 1234567.5, 1234567.123456, 1e-5, 1e16, 123456789012345678901234567890]
outputs = {}
observed = []
with tempfile.TemporaryDirectory(prefix="sigma-population-donor-") as temp:
    for i, value in enumerate(values):
        name = "population-" + str(i)
        root = Path(temp) / name
        shutil.copytree(LEGACY / "corpus", root)
        target = root / "data/release/core.json"
        core = json.loads(target.read_text(encoding="utf8"))
        core["population"]["persons"] = value
        raw = (json.dumps(core, ensure_ascii=False) + "\n").encode()
        target.write_bytes(raw)
        outputs["mutations/" + name + ".json"] = raw
        observed.append({"name": name, "expected": namespace["run"](root, False)})
        shutil.rmtree(root)
outputs["oracle.json"] = (json.dumps(observed, ensure_ascii=False, indent=2) + "\n").encode()
proof = {
    "python": "3.12",
    "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "inputs": {name: hashlib.sha256((LEGACY / name).read_bytes()).hexdigest() for name in ("generate.py", "provenance.json", "oracle.json", "extra-provenance.json")},
    "outputs": {name: hashlib.sha256(raw).hexdigest() for name, raw in outputs.items()},
    "cases": len(values),
}
outputs["provenance.json"] = (json.dumps(proof, indent=2) + "\n").encode()
for name, raw in outputs.items():
    target = HERE / name
    if "--check" in sys.argv:
        if not target.exists() or target.read_bytes() != raw:
            raise SystemExit("Population donor proof differs: " + name)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
