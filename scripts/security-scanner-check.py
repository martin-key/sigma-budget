"""Negative controls: scanners must block an introduced issue and accept safe input."""
import pathlib
import os
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
kind, binary = sys.argv[1:]
with tempfile.TemporaryDirectory(prefix='security-control-') as directory:
    target = pathlib.Path(directory)
    if kind == 'semgrep':
        command = [binary, 'scan', '--config', str(ROOT / '.semgrep/security.yml'), '--metrics=off', '--error', '--strict', str(target)]
        samples = [('bad.js', 'eval(input);'), ('bad.js', 'new Function(input);'),
                   ('bad.js', "import * as cp from 'node:child_process'; cp.exec(input);"), ('bad.js', 'db.prepare(`SELECT ${input}`);'),
                   ('bad.py', 'import pickle\npickle.loads(payload)'),
                   ('bad.py', 'import subprocess\nsubprocess.run(command, shell=True)')]
    else:
        command = [binary, 'dir', str(target), '--config', str(ROOT / '.gitleaks.toml'), '--redact', '--no-banner']
        # Public, fixed test data; chosen to exercise the detector, outside reviewed checksums.
        control_value = 'b1fe548869255ebb76ff76b0f5042749a8afaa501f44e7a64f306aa4b256d8c7'
        samples = [('bad.txt', 'api_key = "' + control_value + '"')]
        for name in ['validate14/code-path-capture', 'validate15/compound/provenance', 'validate17a/provenance', 'validate15/oracle', 'wave13b/proof']:
            samples.append(('packages/ingest/test/fixtures/' + name + '.json', '{"api_key":"' + control_value + '"}'))
    for name, content in samples:
        file = target / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content)
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={**os.environ, 'SEMGREP_ENABLE_VERSION_CHECK': '0'})
        if result.returncode != 1:
            raise SystemExit(f'{kind}: negative control did not fail with a finding ({name}, exit {result.returncode})')
        file.unlink()
    (target / 'safe.js').write_text("const key = '2028.forecast'; const laterKey = '2029.forecast';")
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={**os.environ, 'SEMGREP_ENABLE_VERSION_CHECK': '0'})
    if result.returncode:
        raise SystemExit(f'{kind}: safe control failed (exit {result.returncode})')
print(f'{kind}: {len(samples)} unsafe controls blocked; safe control passed')
