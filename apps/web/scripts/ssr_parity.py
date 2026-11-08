"""Compare the screens the SSR app draws (docs/adr/0002-react-router-ssr.md) with the prerendered files of apps/web/scripts/build.py.

    python3 -m apps.web.scripts.ssr_parity --dist dist --url http://127.0.0.1:8791 [--limit 50] [--show 5]

For every HTML file of dist/ the same address is fetched from the running SSR app (pnpm exec wrangler dev -c build/server/wrangler.json),
and what a crawler and a reader get is compared: the title, the description, robots, the canonical path, the JSON-LD types, the h1, the
lede, the text of the article and its internal links. Byte equality is not the aim: the prerendered file is the page after the browser
mounted its widgets and drew its charts, the server's is the screen before that. Text that only the browser adds (a chart's own labels,
a widget's state) is reported as a difference to look at, not hidden.

Exit 0 when every screen matches, 1 when some differ, 2 when the app cannot be reached or --dist has no screen to compare.
"""

from pathlib import Path as _Path
import argparse
import html
import json
import urllib.parse
import pathlib
import re
import sys
import urllib.error
import urllib.request
from html.parser import HTMLParser

SKIP_TEXT = {'script', 'style', 'template', 'noscript'}


class Page(HTMLParser):
    """the parts of a document that the comparison looks at"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title, self.meta, self.canonical, self.ld = '', {}, '', ''
        self.h1, self.lede, self.text, self.links = '', '', [], set()
        self._stack, self._in, self._buf = [], None, []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'meta' and (a.get('name') or a.get('property')):
            self.meta[a.get('name') or a.get('property')] = a.get('content', '')
        if tag == 'link' and a.get('rel') == 'canonical':
            self.canonical = a.get('href', '')
        if tag in ('br', 'img', 'input', 'meta', 'link', 'hr', 'wbr', 'source', 'col', 'area', 'base', 'embed', 'track'):
            return
        self._stack.append((tag, a))
        inside = any(t == 'article' for t, _ in self._stack)
        if tag == 'a' and inside and a.get('href', '').startswith('/') and not a.get('href', '').startswith('//'):
            self.links.add(a['href'].split('#')[0])
        if tag == 'title':
            self._in = 'title'
        elif tag == 'script' and a.get('type') == 'application/ld+json':
            self._in = 'ld'
        elif tag == 'h1' and inside:
            self._in = 'h1'
        elif tag == 'p' and 'lede' in a.get('class', '').split() and inside and not self.lede:
            self._in = 'lede'

    def handle_endtag(self, tag):
        # HTMLParser dispatches <input/> as start + end. A void end callback must
        # not pop the surrounding article and discard the remainder of its text.
        if tag in ('br', 'img', 'input', 'meta', 'link', 'hr', 'wbr', 'source', 'col', 'area', 'base', 'embed', 'track'):
            return
        while self._stack:
            t, _ = self._stack.pop()
            if t == tag:
                break
        if self._in and tag in ('title', 'script', 'h1', 'p'):
            s = ' '.join(''.join(self._buf).split())
            if self._in == 'ld':
                self.ld = ''.join(self._buf)
            else:
                setattr(self, self._in, s)
            self._in, self._buf = None, []

    def handle_data(self, d):
        if self._in:
            self._buf.append(d)
        if any(t == 'article' for t, _ in self._stack) and not any(t in SKIP_TEXT for t, _ in self._stack):
            hidden = any('sr-only' in a.get('class', '').split() or a.get('aria-hidden') == 'true' for _, a in self._stack)
            if not hidden and d.strip():
                self.text.append(d)


def parse(doc):
    p = Page()
    p.feed(doc)
    p.text = ' '.join(' '.join(p.text).split())
    return p


def ld_types(s):
    try:
        g = json.loads(s or '{}').get('@graph', [])
    except ValueError:
        return ['<invalid>']
    return sorted(n.get('@type', '') for n in g)


def path_of(u):
    return re.sub(r'^https?://[^/]+', '', u or '')


def address_of(dist, f):
    rel = f.relative_to(dist).as_posix()
    if rel == 'index.html':
        return '/'
    if rel == '404.html':
        return '/nyama-takava-stranitsa'
    return '/' + rel[:-len('.html')]


def compare(a, b):
    """the differences between the prerendered page a and the server's b: [(field, prerendered, server)]"""
    out = []
    for f in ('title', 'h1', 'lede'):
        if getattr(a, f) != getattr(b, f):
            out.append((f, getattr(a, f), getattr(b, f)))
    for k in ('description', 'robots', 'og:title', 'og:description', 'twitter:title'):
        if a.meta.get(k, '') != b.meta.get(k, ''):
            out.append((k, a.meta.get(k, ''), b.meta.get(k, '')))
    if path_of(a.canonical) != path_of(b.canonical):
        out.append(('canonical', path_of(a.canonical), path_of(b.canonical)))
    if ld_types(a.ld) != ld_types(b.ld):
        out.append(('json-ld', ld_types(a.ld), ld_types(b.ld)))
    if a.links != b.links:
        out.append(('links', sorted(a.links - b.links)[:6], sorted(b.links - a.links)[:6]))
    if a.text != b.text:
        i = next((k for k in range(min(len(a.text), len(b.text))) if a.text[k] != b.text[k]), min(len(a.text), len(b.text)))
        out.append(('text', a.text[max(0, i - 60):i + 120], b.text[max(0, i - 60):i + 120]))
    return out


def compare_servers(baseline, current, host=None):
    """Strict response parity for every runtime route sample, including synthesized samples."""
    import subprocess
    root = pathlib.Path(__file__).resolve().parents[3]
    script = "import {ROUTES} from './apps/web/client/routes.js'; process.stdout.write(JSON.stringify([...new Set(ROUTES.flatMap(r => r.samples).map(s => s.replace(/^#/, '')))]));"
    routes = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script], cwd=root))

    def response(base, path):
        request = urllib.request.Request(base.rstrip('/') + urllib.parse.quote(path, safe='/?=&%'),
                                         headers={'Host': host} if host else {})
        try:
            result = urllib.request.urlopen(request)
        except urllib.error.HTTPError as error:
            result = error
        with result:
            return result.status, result.read()

    bad = []
    for path in routes:
        if response(baseline, path) != response(current, path):
            bad.append(path)
            print('DIFFERENT ' + path)
    print(f'{len(routes)} sample routes · {len(routes) - len(bad)} byte-identical · {len(bad)} different')
    return 1 if bad or not routes else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--baseline-url', help='compare every runtime route sample byte for byte against another Worker')
    ap.add_argument('--host', help='the same HTTP Host header for both Workers')
    ap.add_argument('--dist', default='dist')
    ap.add_argument('--url', default='http://127.0.0.1:8791')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--show', type=int, default=8, help='how many differing screens to print in full')
    a = ap.parse_args()
    if a.baseline_url:
        return compare_servers(a.baseline_url, a.url, a.host)
    dist = pathlib.Path(a.dist)
    files = sorted(f for f in dist.rglob('*.html') if f.name != 'app.html')
    if a.limit:
        files = files[:a.limit]
    counts, shown, bad = {}, 0, 0
    for f in files:
        addr = address_of(dist, f)
        try:
            with urllib.request.urlopen(urllib.request.Request(a.url.rstrip('/') + urllib.parse.quote(addr, safe='/?=&%'))) as r:
                doc = r.read().decode('utf-8')
        except urllib.error.HTTPError as e:
            doc = e.read().decode('utf-8', 'replace')
        except urllib.error.URLError as e:
            print(f'cannot reach {a.url}: {e}', file=sys.stderr)
            return 2
        diffs = compare(parse(f.read_text(encoding='utf-8')), parse(doc))
        if not diffs:
            continue
        bad += 1
        for field, *_ in diffs:
            counts[field] = counts.get(field, 0) + 1
        if shown < a.show:
            shown += 1
            print(f'\n{addr}')
            for field, x, y in diffs:
                print(f'  {field}:\n    prerendered: {html.unescape(str(x))[:240]}\n    server:      {html.unescape(str(y))[:240]}')
    print(f'\n{len(files)} screens · {len(files) - bad} the same · {bad} differ · by field: {json.dumps(counts, ensure_ascii=False)}')
    if not files:                                             # a wrong --dist compares nothing: that is not a pass
        print(f'no prerendered screens in {dist}: nothing was compared', file=sys.stderr)
        return 2
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
