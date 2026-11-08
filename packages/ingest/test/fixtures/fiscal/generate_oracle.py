"""Regenerate the VI-1 oracle using only its adjacent frozen input."""
import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

from budget_pipeline.build.fiscal import zdd_table

HERE = Path(__file__).parent
if any(arg != '--check' for arg in sys.argv[1:]):
    raise SystemExit('usage: generate_oracle.py [--check]')
check = '--check' in sys.argv[1:]


def encode(value):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode()


def emit(name, value):
    data = encode(value)
    path = HERE / name
    if check:
        if path.read_bytes() != data:
            raise ValueError('Fixture differs: ' + name)
    else:
        path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


data = (HERE / 'vi-1-input.json').read_bytes()
ctx = SimpleNamespace(tables={'VI_1': json.loads(data)})
output_hash = emit('vi-1-oracle.json', zdd_table(ctx))
emit('provenance.json', {
    'baseline': 'bd973a0a3dfbc8d8bd03ac85e6aa1f0784669bf2',
    'archive': 'release-build-inputs-2026-11-08-period-selector-complete.tar.gz',
    'archiveSha256': '9430d8acfe5bd178a1675041aaae22295c89f2768474ebd27af347b465ace5e3',
    'source': 'data/originals/asbp/asbp_tables.json#/tables/VI_1',
    'sourceFileSha256': '27b82e1b8059c88b70dab8cf588c944e444b3532d4eba9fe1b085a776e4b2d3a',
    'frozenInputSha256': hashlib.sha256(data).hexdigest(),
    'oracleSha256': output_hash,
    'oracle': 'Python 3.12 budget_pipeline.build.fiscal.zdd_table',
})
print('VI-1 oracle: byte-identical' if check else 'VI-1 oracle: regenerated')
