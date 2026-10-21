#!/usr/bin/env python3
"""WCAG contrast of the palette of the simplified trial version, read straight from site/css/tokens.css (run at the tag mock-v3) (stdlib only, no browser).
(Copy of contrast_v2.py.)

  python3 tools/mock/contrast_v3.py [path/to/tokens.css]

Light = the bare :root block, dark = the :root[data-theme="dark"] block laid over it. Text pairs need 4.5:1, UI marks and
chart series 3:1. Prints one line per pair and exits 1 if any pair falls short. check_mock.py repeats the main pairs in
a real browser (--only theme); this script also covers the new grey card (--card) and the inverse card (--inv).
"""
import re
import sys
from pathlib import Path

CSS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / 'site' / 'css' / 'tokens.css'

TEXT = [('--ink', b) for b in ('--bg', '--card', '--surface', '--sunk')] + [('--muted', b) for b in ('--bg', '--card', '--surface', '--sunk')] \
    + [('--faint', b) for b in ('--bg', '--card')] \
    + [('--data', b) for b in ('--bg', '--card', '--data-soft')] + [('--data-hover', '--surface'), ('--on-data', '--data')] \
    + [('--accent-ink', '--accent-soft'), ('--accent-ink', '--surface'), ('--on-accent', '--accent')] \
    + [('--on-inv', '--inv'), ('--on-inv-2', '--inv')] \
    + [('--' + k, '--' + k + '-soft') for k in ('ok', 'warn', 'bad')] + [('--' + k, '--card') for k in ('ok', 'warn', 'bad')] \
    + [('--st-' + k, '--st-' + k + '-soft') for k in ('real', 'partial', 'pending', 'mock', 'forecast')] \
    + [('--st-' + k, '--surface') for k in ('real', 'partial', 'pending', 'mock', 'forecast')]
UI = [('--line-strong', '--bg'), ('--line-strong', '--card'), ('--line-strong', '--surface'), ('--focus', '--bg'), ('--focus', '--card'),
      ('--rev', '--surface'), ('--exp', '--surface'), ('--data', '--surface'), ('--accent', '--inv')]
SERIES = [('--series-%d' % i, '--surface') for i in range(1, 9)] + [('--series-other', '--surface'), ('--series-other-2', '--surface')] \
    + [('--series-%d' % i, '--card') for i in range(1, 9)]


def block(css, head):
    """The declarations of the first rule whose selector is exactly `head` (comments dropped)."""
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    m = re.search(re.escape(head) + r'\s*\{(.*?)\n\}', css, flags=re.S)
    return dict(re.findall(r'(--[\w-]+)\s*:\s*([^;]+);', m.group(1))) if m else {}


def lum(hexv):
    hexv = hexv.strip().lstrip('#')
    if len(hexv) == 3:
        hexv = ''.join(c * 2 for c in hexv)
    r, g, b = (int(hexv[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def main():
    css = CSS.read_text(encoding='utf-8')
    light = block(css, ':root')
    dark = {**light, **block(css, ':root[data-theme="dark"]')}
    bad = 0
    for name, tok in (('light', light), ('dark', dark)):
        for kind, need, pairs in (('text', 4.5, TEXT), ('ui', 3.0, UI), ('series', 3.0, SERIES)):
            for fg, bg in pairs:
                f, g = tok.get(fg, '').strip(), tok.get(bg, '').strip()
                if not (f.startswith('#') and g.startswith('#')):
                    print(f'{name:5} {kind:6} {fg} on {bg}: not a plain hex ({f!r} / {g!r})')
                    bad += 1
                    continue
                r = ratio(f, g)
                ok = r >= need
                bad += not ok
                print(f'{name:5} {kind:6} {fg:16} on {bg:14} {r:5.2f}:1 (need {need})  {"ok" if ok else "SHORT"}')
    print(f'\n{bad} pair(s) short of the target' if bad else '\nall pairs reach their target')
    sys.exit(1 if bad else 0)


main()
