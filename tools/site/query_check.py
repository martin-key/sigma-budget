#!/usr/bin/env python3
"""Check that the query lists of site/js/routes.js are complete: the edge cache keys a drawn screen on them alone (workers/app.ts).

    python tools/site/query_check.py

The server draws a screen from the keys of its route only (`query` in the route table and SCREEN_QUERY, site/js/routes.js
screenSearch), as СИГМА does (midt-bg/sigma, apps/web/app/lib/query-params.ts and its drift test). A key that a page reads but its
route does not list still works in the browser, but the first paint from the server ignores it. This check reads every page module
of a route and finds the keys it reads or writes:
  ctx.query.x, ctx.query?.x, ctx.query['x']   a read
  setQuery({ x: … })                          a write
  query: 'x' or query: 'x=…' or `x=…`         a control of ui/ (seg, tabs, chips, forms, treemap-list) that writes ?x=
  data-query="x…"                             a control that writes ?x= (js/actions.js)
  query: true                                 a sortable table of ui/table.js: ?sort= and ?dir=
  QUERY_KEYS = [...], CONTROL_KEYS = [...]     the keys a page names itself
and the keys of the sample addresses of every route. Each must be in the route's list. A read through another name (const q =
ctx.query) is not found here, so the lists stay the source of truth and this check is the floor under them.
Exit 0 when every key is listed, 1 otherwise.
"""
import pathlib
import re
import sys
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[2]
JS = ROOT / 'site' / 'js'

ROUTE = re.compile(r"^\s*R\('(S\d+)', '[^']*', (?:null|'([^']*)'), '([^']+)'(.*)$", re.M)
LIST = re.compile(r"\bquery: \[([^\]]*)\]")
SAMPLES = re.compile(r"\bsamples: \[([^\]]*)\]")
STRINGS = re.compile(r"'([^']*)'")

READS = [
    re.compile(r"ctx\.query\??\.([a-zA-Z_]\w*)"),
    re.compile(r"ctx\.query\[['\"]([a-zA-Z_]\w*)['\"]\]"),
    re.compile(r"\bquery:\s*['\"`]([a-zA-Z_]\w*)"),
    re.compile(r"data-query=\"([a-zA-Z_]\w*)"),
]
SET_QUERY = re.compile(r"setQuery\(\{([^}]*)\}")
NAMED = re.compile(r"\b(?:QUERY_KEYS|CONTROL_KEYS)\s*=\s*\[([^\]]*)\]")


def keys_of(src):
    found = set()
    for rx in READS:
        found.update(rx.findall(src))
    for body in SET_QUERY.findall(src):
        found.update(re.findall(r"(?:^|,)\s*([a-zA-Z_]\w*)\s*:", body))
    for body in NAMED.findall(src):
        found.update(STRINGS.findall(body))
    if re.search(r"\bquery:\s*true\b", src):
        found.update({'sort', 'dir'})
    return found


def main():
    routes_src = (JS / 'routes.js').read_text(encoding='utf-8')
    m = re.search(r"export const SCREEN_QUERY = \[([^\]]*)\]", routes_src)
    if not m:
        print('site/js/routes.js: SCREEN_QUERY not found')
        return 1
    every = set(STRINGS.findall(m.group(1)))
    bad, n = [], 0
    for rid, pattern, file, rest in ROUTE.findall(routes_src):
        lm = LIST.search(rest)
        listed = set(STRINGS.findall(lm.group(1))) if lm else set()
        page = JS / 'pages' / (file + '.js')
        if not page.exists():
            bad.append('%s: no page module %s' % (rid, page.relative_to(ROOT)))
            continue
        n += 1
        found = keys_of(page.read_text(encoding='utf-8'))
        sm = SAMPLES.search(rest)
        for sample in STRINGS.findall(sm.group(1)) if sm else []:
            q = sample.split('?', 1)[1] if '?' in sample else ''
            found.update(k for k, _v in urllib.parse.parse_qsl(q, keep_blank_values=True))
        found.discard('to')                                   # the scroll target: the browser's, never part of the screen
        missing = sorted(found - listed - every)
        if missing:
            bad.append('%s %s (%s): reads %s, not in its query list' % (rid, pattern, file, ', '.join(missing)))
    for line in bad:
        print('FAIL ' + line)
    print('%d screens: %s' % (n, 'every key the pages read is in its route\'s query list' if not bad else '%d problem(s)' % len(bad)))
    return 1 if bad or not n else 0


if __name__ == '__main__':
    sys.exit(main())
