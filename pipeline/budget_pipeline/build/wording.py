#!/usr/bin/env python3
"""Apply the terminology differences preserved by the historical mock-v2 and mock-v4 tags to a current dataset. The ordered replacement pairs are frozen in data/inputs/wording.json."""

import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]   # repository root
def enc(s): return json.dumps(s, ensure_ascii=False)[1:-1]   # content between the quotes
def main():
    rel, tgt = sys.argv[1], sys.argv[2]
    pairs = json.loads((ROOT / 'data/inputs/wording.json').read_text())[rel]
    p = ROOT / tgt / rel; txt = open(p, encoding='utf-8').read(); n = 0; miss = []
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
