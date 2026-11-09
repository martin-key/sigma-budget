"""Independent supplemental tuple/key observations from the unchanged Python donor."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

if sys.version_info[:2] != (3, 12):
    raise SystemExit("Python 3.12 is required")
HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent
cases = json.loads((HERE / "cases.json").read_text(encoding="utf8"))

def capture():
    path = LEGACY / "generate_oracle.py"
    namespace = {"__file__": str(path), "__name__": "frozen_compound_donor"}
    exec(compile(path.read_text().split("\ncases = json.loads")[0], str(path), "exec"), namespace)
    results = {}
    with tempfile.TemporaryDirectory(prefix="sigma-compound-donor-") as temp:
        for case in cases:
            root = Path(temp) / case["name"]
            shutil.copytree(LEGACY / "corpus", root)
            for op in case["ops"]:
                namespace["mutate"](root, op)
            results[case["name"]] = namespace["result"](case["group"], root)
            shutil.rmtree(root)
    return results

if "--capture" in sys.argv:
    print(json.dumps(capture(), ensure_ascii=False, separators=(",", ":")))
    raise SystemExit

seeds = list(range(8))
observations = {}
for seed in seeds:
    env = {**os.environ, "PYTHONHASHSEED": str(seed), "PYTHONDONTWRITEBYTECODE": "1"}
    run = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--capture"],
        env=env, check=True, capture_output=True, text=True,
    )
    for name, result in json.loads(run.stdout).items():
        variants = observations.setdefault(name, [])
        found = next((v for v in variants if v["result"] == result), None)
        if found is None:
            variants.append({"seeds": [seed], "result": result})
        else:
            found["seeds"].append(seed)

outputs = {}
with tempfile.TemporaryDirectory(prefix="sigma-compound-preimages-") as temp:
    path = LEGACY / "generate_oracle.py"
    namespace = {"__file__": str(path), "__name__": "frozen_compound_preimages"}
    exec(compile(path.read_text().split("\ncases = json.loads")[0], str(path), "exec"), namespace)
    for case in cases:
        root = Path(temp) / case["name"]
        shutil.copytree(LEGACY / "corpus", root)
        for op in case["ops"]:
            namespace["mutate"](root, op)
        for file in sorted({op["file"] for op in case["ops"]}):
            outputs["mutations/" + case["name"] + "/" + file] = (root / "data/release" / file).read_bytes()
        shutil.rmtree(root)

vectors = []
for first in json.loads((HERE / "keys.json").read_text(encoding="utf8")):
    for second in json.loads((HERE / "keys.json").read_text(encoding="utf8")):
        try:
            a, b = tuple(first), tuple(second)
            mapping = {a: 1, b: 2}
            result = {
                "keys": [repr(key) for key in mapping],
                "values": list(mapping.values()),
                "equal": a == b,
                "sorted": [repr(key) for key in sorted([a, b])],
            }
        except Exception as error:
            result = {"crash": type(error).__name__ + ": " + str(error)}
        vectors.append({"first": first, "second": second, "result": result})
outputs["oracle.json"] = (json.dumps(observations, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
outputs["tuple-oracle.json"] = (json.dumps(vectors, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
inputs = {name: (HERE / name).read_bytes() for name in ["cases.json", "keys.json", "generate_oracle.py"]}
for name in ["generate_oracle.py", "provenance.json", "cases.json", "oracle.json", "sum-cases.json", "sum-oracle.json"]:
    inputs["../" + name] = (LEGACY / name).read_bytes()
proof = {
    "python": "3.12",
    "hashSeeds": seeds,
    "inputs": {name: hashlib.sha256(data).hexdigest() for name, data in inputs.items()},
    "outputs": {name: hashlib.sha256(data).hexdigest() for name, data in outputs.items()},
}
outputs["provenance.json"] = (json.dumps(proof, indent=2) + "\n").encode()
expected_mutations = {name for name in outputs if name.startswith("mutations/")}
if "--check" in sys.argv:
    actual_mutations = {str(p.relative_to(HERE)) for p in (HERE / "mutations").rglob("*") if p.is_file()}
    if actual_mutations != expected_mutations:
        raise SystemExit("Compound mutation file set differs")
for name, data in outputs.items():
    path = HERE / name
    if "--check" in sys.argv:
        if not path.exists() or path.read_bytes() != data:
            raise SystemExit("Compound donor proof differs: " + name)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
