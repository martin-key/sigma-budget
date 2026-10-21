#!/usr/bin/env python3
"""V5 helper: re-apply the v3/v4 wording edits («реални данни» -> «официални данни», etc.) onto donor JSON text.
Compares string leaves of the v2 tree (old wording) vs the v4 tree (new wording), both extracted from their tags into tmp/versions/site-v2 and site-v4; for each changed string, replaces the exact
JSON-encoded old string by the new one in the target file text. Prints strings that did not match (manual work).
Usage: v5_wording.py FILE_REL TARGET_DIR   (e.g. search-index.json site/data; TARGET_DIR is relative to the repository root)"""
import json, sys, os
M = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # repository root
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
main()
