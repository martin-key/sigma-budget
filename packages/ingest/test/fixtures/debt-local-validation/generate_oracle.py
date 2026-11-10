#!/usr/bin/env python3.12
"""Offline test-only oracle. Uses frozen validation donors, never production builders."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "donor"))
from budget_pipeline.validate import checks, debt, local_finance  # noqa: E402


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def mutate(data, ops):
    for op in ops:
        value = data[op["file"]]
        for key in op["path"][:-1]:
            value = value[int(key)] if isinstance(value, list) else value[key]
        key = int(op["path"][-1]) if isinstance(value, list) else op["path"][-1]
        if op["op"] == "delete":
            del value[key]
        elif op["op"] == "add":
            value[key] += op["value"]
        else:
            value[key] = copy.deepcopy(op["value"])


class Context:
    def __init__(self, data):
        self.data = data

    def get(self, rel):
        # The debt donor reads only execution row ids and latest.asOf. No money
        # projection or production import is needed for these three groups.
        return self.data[rel]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        raise SystemExit("frozen oracle requires Python 3.12")
    provenance = load(HERE / "provenance.json")
    for rel, expected in provenance["pins"].items():
        if hashlib.sha256((HERE / rel).read_bytes()).hexdigest() != expected:
            raise SystemExit("frozen evidence pin mismatch: " + rel)
    repo = HERE.parents[4]
    for pin in provenance["availableOriginals"]:
        if hashlib.sha256((repo / pin["path"]).read_bytes()).hexdigest() != pin["sha256"]:
            raise SystemExit("available original pin mismatch: " + pin["path"])
    functions = {"DEBT": debt.g_debt, "MUNIC": local_finance.g_munic, "SEBRA": local_finance.g_sebra}
    result = {}
    for case in load(HERE / "cases.json"):
        base = case["baseline"]
        data = {str(p.relative_to(HERE / base)): load(p) for p in (HERE / base).rglob("*.json")}
        mutate(data, case["ops"])
        checks.BUILD_DATE = provenance[base]["buildDate"]
        try:
            c = functions[case["group"]](Context(data))
            row = dict(name=c.name, n=c.n, problems=c.problems, warnings=c.warnings, facts=c.facts)
            status = "FAIL" if c.problems else "PASS"
        except Exception as error:
            row = dict(crash=type(error).__name__, message=str(error))
            status = "FAIL"
        if status != case["expected"]:
            raise SystemExit(f"unexpected donor outcome: {case['name']}: {status} {row}")
        result[case["name"]] = row
    output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    target = HERE / "oracle.json"
    if args.check:
        if target.read_text(encoding="utf-8") != output:
            raise SystemExit("frozen donor oracle differs")
    else:
        target.write_text(output, encoding="utf-8")
    print(f"Python {sys.version.split()[0]}: {len(result)} frozen donor scenarios verified")


if __name__ == "__main__":
    main()
