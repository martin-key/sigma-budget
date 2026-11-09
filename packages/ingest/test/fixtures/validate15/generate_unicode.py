"""Freeze Python 3.12 diagnostic repr, independently of Node's Unicode version."""
import hashlib
import json
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
if sys.version_info[:2] != (3, 12) or unicodedata.unidata_version != '15.0.0':
    raise SystemExit('Python 3.12 with Unicode 15.0 required')
if sys.argv[1:] not in ([], ['--check']):
    raise SystemExit('usage: generate_unicode.py [--check]')
check = bool(sys.argv[1:])
provenance = json.loads((HERE / 'provenance.json').read_text())
donor = (HERE / 'donor/checks.py').read_bytes()
if hashlib.sha256(donor).hexdigest() != provenance['inputs']['donor/checks.py']:
    raise SystemExit('frozen checks donor changed')
ranges = []
for code in range(0x110000):
    if chr(code).isprintable():
        if ranges and code == ranges[-1][1] + 1:
            ranges[-1][1] = code
        else:
            ranges.append([code, code])
planes = []
for plane in range(17):
    digest = hashlib.sha256()
    for code in range(plane * 0x10000, (plane + 1) * 0x10000):
        digest.update((repr(chr(code)) + '\n').encode('utf8'))
    planes.append({'plane': plane, 'sha256': digest.hexdigest()})
oracle = {'python': '3.12', 'unicode': unicodedata.unidata_version,
          'donorSha256': hashlib.sha256(donor).hexdigest(), 'planes': planes}
source = '''/** Printability frozen from Python 3.12 / Unicode 15.0. */
const ranges: ReadonlyArray<readonly [number, number]> = [
'''
source += ''.join('  [%d, %d],\n' % (a, b) for a, b in ranges)
source += '''];

export function pythonPrintable(code: number): boolean {
  if (code < 128) return code >= 32 && code < 127;
  let low = 0, high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const [first, last] = ranges[middle]!;
    if (code < first) high = middle - 1;
    else if (code > last) low = middle + 1;
    else return true;
  }
  return false;
}
'''
# Keep generated TypeScript in the repository's formatter layout.
source = source.replace('  let low = 0, high = ranges.length - 1;', '  let low = 0,\n    high = ranges.length - 1;')
artifacts = {HERE / 'unicode-oracle.json': json.dumps(oracle, ensure_ascii=False, indent=2) + '\n',
             HERE.parents[2] / 'src/validate/unicode15.ts': source}
for path, expected in artifacts.items():
    if check:
        if path.read_text() != expected:
            raise SystemExit('Unicode capture differs: ' + path.name)
    else:
        path.write_text(expected)
print('Unicode repr: %d printable ranges, 17 full-plane digests, %s' % (len(ranges), 'byte-identical' if check else 'regenerated'))
