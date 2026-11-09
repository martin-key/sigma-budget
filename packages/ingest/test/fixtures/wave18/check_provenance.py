#!/usr/bin/env python3
"""Verify every frozen input byte against the named Git base, without live data reads."""
import hashlib
import json
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf8'))
base = '027a262288c0b0ca4b188482a8b8da43bb378047'
if manifest['base'] != base or manifest['buildDate'] != '2026-11-08':
    raise SystemExit('incorrect base or build date')
for name, expected in manifest['sha256'].items():
    original = subprocess.check_output(['git', 'show', base + ':' + name])
    if hashlib.sha256(original).hexdigest() != expected:
        raise SystemExit('base hash mismatch: ' + name)
print('Verified %d fixture inputs against %s' % (len(manifest['sha256']), base))
