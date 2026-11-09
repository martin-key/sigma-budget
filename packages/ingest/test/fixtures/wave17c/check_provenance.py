#!/usr/bin/env python3
"""Check the closed donor inventory against its named Git blobs and pinned evidence."""
import hashlib, json, subprocess
from pathlib import Path
here=Path(__file__).resolve().parent
inventory=json.loads((here/'inventory.json').read_text(encoding='utf8'))
base='e4168b09df77d3f48cb3be38c52b173d5887f7fe'
if inventory['base'] != base or inventory['buildDate'] != '2026-11-08': raise SystemExit('unexpected base or date')
files={str(p.relative_to(here/'corpus')) for p in (here/'corpus').rglob('*') if p.is_file()}
if files != set(inventory['files']): raise SystemExit('corpus inventory differs')
for name,info in inventory['files'].items():
    frozen=(here/'corpus'/name).read_bytes()
    original=subprocess.check_output(['git','show',base+':'+name])
    if frozen!=original or len(frozen)!=info['bytes'] or hashlib.sha256(frozen).hexdigest()!=info['sha256']: raise SystemExit('donor differs: '+name)
evidence=json.loads((here/'evidence.json').read_text(encoding='utf8'))
for name,sha in evidence.items():
    if hashlib.sha256((here/name).read_bytes()).hexdigest()!=sha: raise SystemExit('evidence differs: '+name)
print('Verified %d frozen Git blobs and %d evidence files' % (len(files),len(evidence)))
