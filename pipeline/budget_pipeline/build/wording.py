#!/usr/bin/env python3
"""Apply the terminology differences preserved by the historical mock-v2 and mock-v4 tags to a current dataset. The tag dependency is retained until its separate migration."""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import json, sys, os
M = str(_Path(__file__).resolve().parents[3])   # repository root
def leaves(a, b, out):
    if type(a) != type(b): return
    if isinstance(a, dict):
        for k in a:
            if k in b: leaves(a[k], b[k], out)
    elif isinstance(a, list) and len(a) == len(b):
        for x, y in zip(a, b): leaves(x, y, out)
    elif isinstance(a, str) and a != b: out.append((a, b))
def enc(s): return json.dumps(s, ensure_ascii=False)[1:-1]   # content between the quotes
def main():
    rel, tgt = sys.argv[1], sys.argv[2]
    old = json.load(open(os.path.join(M, 'tmp/versions/site-v2/data', rel))); new = json.load(open(os.path.join(M, 'tmp/versions/site-v4/data', rel)))
    out = []; leaves(old, new, out)
    pairs = {}
    for a, b in out: pairs[a] = b
    p = os.path.join(M, tgt, rel); txt = open(p, encoding='utf-8').read(); n = 0; miss = []
    for a, b in pairs.items():
        ea, eb = enc(a), enc(b)
        c = txt.count(ea)
        if c: txt = txt.replace(ea, eb); n += c
        else: miss.append(a[:120])
    open(p, 'w', encoding='utf-8').write(txt)
    print(rel, 'pairs', len(pairs), 'replaced', n, 'unmatched', len(miss))
    for m in miss: print('   UNMATCHED:', m)
if __name__ == '__main__':
    main()
