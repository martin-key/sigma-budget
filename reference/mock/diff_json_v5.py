#!/usr/bin/env python3
"""V5 helper: field-by-field diff of two JSON data trees (two data/ folders given as arguments: the donor v1 against v5, e.g. extracted from the tags mock-v1 and mock-v5 into tmp/versions/).
Usage: diff_json_v5.py DONOR_DIR TARGET_DIR [--all]
Classifies every differing leaf as DATE-ONLY (both values look like ISO dates / build stamps) or CONTENT."""
import json, re, sys, os
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}([T ].*)?$')
STAMP = re.compile(r'2026-10-0[2-9](\.\d+)?')
def walk(a, b, path, out):
    if type(a) != type(b):
        out.append((path, a, b)); return
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a: out.append((path + '/' + k, '<missing>', b[k]))
            elif k not in b: out.append((path + '/' + k, a[k], '<missing>'))
            else: walk(a[k], b[k], path + '/' + k, out)
    elif isinstance(a, list):
        if len(a) != len(b): out.append((path + '[len]', len(a), len(b)))
        for i, (x, y) in enumerate(zip(a, b)): walk(x, y, '%s[%d]' % (path, i), out)
    elif a != b:
        out.append((path, a, b))
def dateish(x, y):
    sx, sy = str(x), str(y)
    if DATE.match(sx) and DATE.match(sy): return True
    if STAMP.sub('#', sx) == STAMP.sub('#', sy): return True
    return False
def main():
    da, db = sys.argv[1], sys.argv[2]
    show_all = '--all' in sys.argv
    for root, _, files in os.walk(da):
        for f in sorted(files):
            if not f.endswith('.json'): continue
            pa = os.path.join(root, f); rel = os.path.relpath(pa, da); pb = os.path.join(db, rel)
            if not os.path.exists(pb): print('ONLY-DONOR', rel); continue
            a = json.load(open(pa)); b = json.load(open(pb))
            out = []; walk(a, b, '', out)
            if not out: continue
            content = [o for o in out if not dateish(o[1], o[2])]
            print('%-40s diffs=%d date-only=%d content=%d' % (rel, len(out), len(out) - len(content), len(content)))
            if content and (show_all or len(content) <= 6):
                for p, x, y in content[:12]:
                    print('     ', p, '|', str(x)[:90], '|', str(y)[:90])
main()
