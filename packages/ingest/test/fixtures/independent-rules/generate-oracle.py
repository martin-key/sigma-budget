"""Explicit regeneration only: Python 3.12 frozen donors, owned temporary roots.

Run with the project's Python 3.12 data environment (pdfplumber/lxml), not Node.
Never writes the source repository or any pre-existing fixture. --repo is read-only.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--repo', type=Path, required=True)
args = parser.parse_args()
assert sys.version_info[:2] == (3, 12)
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE/'donor'))
from budget_pipeline.validate import checks as L, components as C, execution as E, indirect_taxes as I
from budget_pipeline.build import annual_periods as A

manifest = json.loads((HERE/'manifest.json').read_text())
for rel, digest in manifest['frozen'].items():
    assert hashlib.sha256((HERE/rel).read_bytes()).hexdigest() == digest, rel
def required_input(rel):
    # Mutable baseline inputs are captured; --repo supplies only immutable raw originals.
    base = HERE/'inputs' if rel == 'data/originals.sha256' or rel.startswith('data/inputs/') else args.repo
    return base/rel

for rel, digest in manifest['requiredInputs'].items():
    assert hashlib.sha256(required_input(rel).read_bytes()).hexdigest() == digest, rel

class Context:
    def get(self, rel):
        return L.load(rel)

results = {}
with tempfile.TemporaryDirectory(prefix='sigma-independent-oracle-') as tmp:
    root = Path(tmp)
    for rel in manifest['requiredInputs']:
        dest = root/rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(required_input(rel), dest)
    data = root/'data/release'
    L.ROOT = I.ROOT = str(root)
    L.DATA = E.DATA = I.DATA = str(data)
    L.BUILD_DATE = manifest['buildDate']
    A.ROOT = root
    A.SRC = root/'data/inputs'
    funcs = {'COMPONENTS': C.g_components, 'RATES': C.g_rates, 'INDIRECT': I.check, 'CONTRACT': E.g_contract}
    for case in json.loads((HERE/'cases.json').read_text()):
        shutil.copytree(HERE/'data', data, dirs_exist_ok=True)
        for op in case['ops']:
            p = data/op['file']
            d = json.loads(p.read_text())
            target = d
            for key in op['path'][:-1]: target = target[key]
            if op['op'] == 'delete': del target[op['path'][-1]]
            else: target[op['path'][-1]] = copy.deepcopy(op['value'])
            p.write_text(json.dumps(d, ensure_ascii=False))
        output = {}
        for group in case['groups']:
            c = funcs[group](Context())
            output[group] = dict(n=c.n, problems=c.problems, warnings=c.warnings, facts=c.facts)
        results[case['name']] = output
(HERE/'oracle.json').write_text(json.dumps(results, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({name:{g:dict(checks=c['n'], problems=len(c['problems'])) for g,c in groups.items()} for name,groups in results.items()}, indent=2))
