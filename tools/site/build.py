"""Build the site for the host: dist/ with one prerendered HTML file per screen, plus sitemap.xml, robots.txt, llms.txt, llms-full.txt and _headers.

    PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers .venv/bin/python tools/site/build.py
    ... build.py --origin https://preview.example.org     # the address the canonical links, the sitemap and llms.txt name
    ... build.py --limit 40 --out tmp/dist-try            # a quick partial build (the checks below still run)
    ... build.py --origin https://staging.example --noindex   # a staging build: robots.txt and X-Robots-Tag keep it out of search engines

How it works. dist/ starts as a copy of site/. The app is served from there (tools/site/serve.py, every path gets the app shell) and
headless Chromium crawls it from the start page: every screen it reaches through a link becomes one file, /razhodi/obrazovanie ->
dist/razhodi/obrazovanie.html, written from the live DOM after the screen is built (reduced motion: the final state). The head of
each file is what js/seo.js set: title, description, canonical, social cards and JSON-LD. In the browser the app then takes over
the same HTML (the router repaints it without a skeleton). The 404 screen is written to dist/404.html. /embed/* is not prerendered.

The build is also a check of the path addresses: a screen that is not ready, shows an error, logs a console error, links to an
address that is not a screen or still carries an old #/ link, or lacks a title, description or canonical link fails the build (exit 1).
"""
import argparse
import asyncio
import collections
import datetime
import gzip
import html
import io
import json
import pathlib
import re
import shutil
import subprocess
import sys
import time
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import serve  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
SITE = ROOT / 'site'
NOT_FOUND_PROBE = '/nyama-takava-stranitsa'
FILE_EXT = re.compile(r'\.[A-Za-z][A-Za-z0-9]{0,4}$')     # as FILE_EXT in site/js/loc.js: /vedomstvo/0200/0200.01.00 is a screen
UI_NOISE = {'Сподели', 'PNG', 'Копирай', 'Таблица', 'Графика', 'Източник', 'Източници', 'Покажи още', 'Скрий', 'Следва', 'Виж още', 'CSV', 'JSON'}

# Run in the page once the screen is ready: what the build needs to know, and the document as the file should hold it.
SNAPSHOT_JS = r"""
() => {
  const art = document.querySelector('article.page');
  const m = n => document.querySelector(`meta[name="${n}"]`)?.content || '';
  const info = {
    route: art?.dataset.route || '', view: art?.dataset.view || '', title: document.title, h1: (art?.querySelector('h1')?.textContent || '').trim(),
    desc: m('description'), robots: m('robots'), canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    ld: document.getElementById('ld-page')?.textContent || '',
    hashLinks: [...document.querySelectorAll('a[href^="#/"]')].map(a => a.getAttribute('href')).slice(0, 5),
    links: [...new Set([...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h && h.startsWith('/') && !h.startsWith('//')))],
    answer: (document.querySelector('#view .answer')?.innerText || '').replace(/^Накратко\s*/, '').trim(),
    lede: (art?.querySelector(':scope > .lede')?.innerText || '').trim(),
    text: art?.querySelector('.page-body')?.innerText || '',
    routes: location.pathname === '/' ? window.__ROUTES__ : null
  };
  const doc = document.documentElement.cloneNode(true);
  doc.removeAttribute('class');
  doc.setAttribute('data-prerendered', location.pathname + location.search);   // the address this HTML is the screen of (js/router.js compares it)
  for (const el of doc.querySelectorAll('[_echarts_instance_]')) { el.replaceChildren(); el.removeAttribute('_echarts_instance_'); }   // a canvas has no content in HTML: the app draws it again
  for (const el of doc.querySelectorAll('script[src]')) if (el.type !== 'module' && !el.hasAttribute('data-keep')) el.remove();   // vendor/echarts.min.js (1 MB), added by js/charts.js: in the file it would block the first paint; the app loads it again. js/theme-boot.js (data-keep) stays: it sets the theme before the first paint
  for (const el of doc.querySelectorAll('svg.map-svg')) el.replaceChildren();          // 265 municipality outlines are ~280 KB of HTML: the app draws the map again
  for (const el of doc.querySelectorAll('[data-hydrated]')) el.removeAttribute('data-hydrated');
  for (const el of doc.querySelectorAll('#toasts, #live')) el.replaceChildren();
  // the same HTML from every build: the „има непрочетено“ dot is the visitor's own state (js/shell.js checkNews sets it again), and the page
  // styles land in <head> wherever their module happened to finish loading (js/router.js loadStyle): they go after the shared styles, by name
  for (const dot of doc.querySelectorAll('[data-news-dot]')) { dot.hidden = true; delete dot.dataset.latest; dot.parentElement?.removeAttribute('aria-label'); }
  const shared = [...doc.querySelectorAll('head > link[rel="stylesheet"]:not([data-page])')].pop();
  const css = [...doc.querySelectorAll('link[data-page]')].sort((x, y) => (x.dataset.page < y.dataset.page ? -1 : 1));
  if (shared) shared.after(...css);
  for (const el of doc.querySelectorAll('dialog, .popover')) el.remove();
  doc.querySelector('#view')?.removeAttribute('aria-busy');
  const o = location.origin;
  for (const el of doc.querySelectorAll('[href],[src]')) for (const a of ['href', 'src']) {
    const v = el.getAttribute(a);
    if (v && v.startsWith(o + '/')) el.setAttribute(a, v.slice(o.length));       // the file is served from the root of the host, whatever its name
  }
  info.html = '<!doctype html>\n' + doc.outerHTML;
  return info;
}
"""


def norm_path(href):
    """'/razhodi/obrazovanie?per=x#y' -> '/razhodi/obrazovanie'; None for files, the embed view and anything else that is not a screen"""
    p = urllib.parse.urlsplit(href).path or '/'
    if p != '/' and p.endswith('/'):
        p = p.rstrip('/')
    if FILE_EXT.search(p) and not p.startswith('/embed/'):
        return None
    if p.startswith('/embed/'):
        return None
    return p


def out_file(out, path):
    """'/' -> index.html, '/razhodi/obrazovanie' -> razhodi/obrazovanie.html (the host maps /x to x.html: no trailing-slash redirect)"""
    return out / 'index.html' if path == '/' else out / (urllib.parse.unquote(path).lstrip('/') + '.html')


class Crawl:
    def __init__(self, base, jobs, limit):
        self.base, self.jobs, self.limit = base, jobs, limit
        self.queue = collections.deque()
        self.seen = set()
        self.pages = {}            # path -> info
        self.fails = []            # (path, message)
        self.warns = []

    def add(self, path):
        if path and path not in self.seen and (not self.limit or len(self.seen) < self.limit):
            self.seen.add(path)
            self.queue.append(path)

    async def visit(self, ctx, path):
        page = await ctx.new_page()
        errs = []
        page.on('console', lambda m: errs.append('console: ' + m.text[:200]) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:200]))
        page.on('requestfailed', lambda r: errs.append(f'request failed: {r.url[-90:]} ({r.failure})') if 'ERR_ABORTED' not in str(r.failure) else None)
        try:
            await page.goto(self.base.rstrip('/') + path, wait_until='domcontentloaded')
            await page.wait_for_selector('article.page[data-ready="1"]', timeout=45000)
            await page.wait_for_timeout(150)
            info = await page.evaluate(SNAPSHOT_JS)
        except Exception as e:  # noqa: BLE001 - every failure of one page is reported, the crawl goes on
            self.fails.append((path, f'not built: {str(e).splitlines()[0][:200]}'))
            await page.close()
            return None
        await page.close()
        info['errors'] = errs
        return info

    async def worker(self, browser):
        ctx = await browser.new_context(viewport={'width': 1280, 'height': 900}, reduced_motion='reduce', service_workers='block', locale='bg-BG', timezone_id='Europe/Sofia')
        idle = 0
        while True:
            if not self.queue:
                if self.busy == 0 and idle > 2:
                    break
                idle += 1
                await asyncio.sleep(0.2)
                continue
            idle = 0
            path = self.queue.popleft()
            self.busy += 1
            info = await self.visit(ctx, path)
            self.busy -= 1
            if info is None:
                continue
            self.pages[path] = info
            for h in info['links']:
                self.add(norm_path(h))
            done = len(self.pages)
            if done % 25 == 0:
                print(f'  {done} screens built, {len(self.queue)} waiting', flush=True)
        await ctx.close()

    async def run(self, seeds):
        for s in seeds:
            self.add(s)
        self.busy = 0
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            await asyncio.gather(*(self.worker(browser) for _ in range(self.jobs)))
            nf_ctx = await browser.new_context(viewport={'width': 1280, 'height': 900}, reduced_motion='reduce', service_workers='block')
            self.not_found = await self.visit(nf_ctx, NOT_FOUND_PROBE)
            await nf_ctx.close()
            await browser.close()


def check_page(path, info, built, origin):
    """the checks of one prerendered screen: list of (level, message)"""
    out = []
    F = lambda m: out.append(('fail', m))   # noqa: E731
    W = lambda m: out.append(('warn', m))   # noqa: E731
    if info['view'] not in ('ready',):
        F(f'the screen is in the state "{info["view"]}"')
    if info['route'] == 'S30':
        F('the link leads to the 404 screen')
    for e in info['errors']:
        F(e)
    if info['hashLinks']:
        F('old #/ links in the DOM: ' + ', '.join(info['hashLinks']))
    if not info['desc']:
        F('no meta description')
    elif len(info['desc']) < 50:
        W(f'short meta description ({len(info["desc"])} characters)')
    want = origin + ('/' if path == '/' else path)
    if info['canonical'] != want:
        F(f'canonical {info["canonical"]!r}, expected {want!r}')
    if not info['h1']:
        F('no h1')
    if 'noindex' in info['robots']:
        F('robots: ' + info['robots'])
    try:
        ld = json.loads(info['ld'] or '{}')
        if not ld.get('@graph'):
            F('no JSON-LD graph')
    except ValueError as e:
        F(f'JSON-LD does not parse: {e}')
    for h in info['links']:
        p = norm_path(h)
        if p and p not in built:
            F(f'links to {h}, which was not built')
    return out


def clean_text(t, cap):
    """the screen's text for llms-full.txt: without the button labels, single blank lines, at most `cap` characters"""
    lines, prev = [], ''
    for ln in (x.strip() for x in t.splitlines()):
        if ln in UI_NOISE or (len(ln) < 2 and ln):
            continue
        if not ln and not prev:
            continue
        lines.append(ln)
        prev = ln
    s = '\n'.join(lines).strip()
    return s if len(s) <= cap else s[:cap].rsplit('\n', 1)[0] + '\n…'


# The Content-Security-Policy of site/index.html as an HTTP header, plus what a <meta> cannot carry: frame-ancestors (no framing of the
# site by others; worker/index.js lifts it for /embed/*, which is made to be framed). Every file is same-origin: HSTS keeps it on https.
CSP = ("default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; "
       "base-uri 'self'; form-action 'none'; object-src 'none'; frame-ancestors 'self'")


def write_extras(out, pages, origin, lastmod, routes, noindex=False):
    """sitemap.xml, robots.txt, llms.txt, llms-full.txt, _headers"""
    idx = {p: i for p, i in pages.items() if 'noindex' not in i['robots']}
    order = {r['id']: n for n, r in enumerate(routes)}
    paths = sorted(idx, key=lambda p: (order.get(idx[p]['route'], 99), p.count('/'), p))
    url = lambda p: origin + ('/' if p == '/' else p)   # noqa: E731

    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for p in paths:
        sm.append(f'  <url><loc>{html.escape(url(p))}</loc>' + (f'<lastmod>{lastmod}</lastmod>' if lastmod else '') + '</url>')
    sm.append('</urlset>')
    (out / 'sitemap.xml').write_text('\n'.join(sm) + '\n', encoding='utf-8')

    (out / 'robots.txt').write_text(
        '# Тестова среда: не за индексиране.\nUser-agent: *\nDisallow: /\n' if noindex else
        '# Бюджет на светло: всички страници са отворени за търсачки и езикови модели.\n'
        'User-agent: *\nAllow: /\nDisallow: /embed/\n\n'
        f'Sitemap: {origin}/sitemap.xml\n', encoding='utf-8')

    title = lambda i: re.sub(r'\s+·\s+Бюджет на светло$', '', re.sub(r'^Бюджет на светло\s+·\s+', '', i['title']))   # noqa: E731
    by_route = collections.defaultdict(list)
    for p in paths:
        by_route[idx[p]['route']].append(p)
    rmeta = {r['id']: r for r in routes}
    main = [p for p in paths if rmeta.get(idx[p]['route'], {}).get('pattern') and rmeta[idx[p]['route']].get('nav') and p.count('/') <= 1
            and not (rmeta[idx[p]['route']]['pattern'].count(':') and p != '/' + rmeta[idx[p]['route']]['pattern'].strip('/').split('/')[0])]
    # (route, heading, with the description): the long lists (ministries, municipalities, terms) keep llms.txt an index, one line per page
    child_groups = [('S08', 'Разходи по функции', True), ('S06', 'Приходи по източници', True), ('S12', 'Мерки в бюджета', False),
                    ('S11', 'Ведомства', False), ('S21', 'Общини', False), ('S03', 'Речник', False), ('S24', 'Набори с данни', False)]
    L = ['# Бюджет на светло', '',
         '> Държавният бюджет на България за 2026 г. на разбираем език, по официални данни: откъде идват парите, къде отиват, изпълнява ли се планът, '
         'колко дължим и колко плаща всеки. Източниците са Министерството на финансите (месечни отчети по КФП, Закон за държавния бюджет, '
         'средносрочна прогноза), „Държавен вестник“, БНБ, НАП и Евростат. До всяко число стоят източникът, обхватът, статусът (проект, закон, отчет, прогноза) и датата.', '',
         'Сумите са в евро (България използва еврото от 1 януари 2026 г.). Примерните стойности, където ги има, са означени като „примерни данни“ и не бива да се цитират като официални.'
         + (f' Данните са към {lastmod}.' if lastmod else ''), '',
         '## Основни страници', '']
    for p in main:
        L.append(f'- [{title(idx[p])}]({url(p)}): {idx[p]["desc"]}')
    for rid, label, with_desc in child_groups:
        ps = [p for p in by_route.get(rid, []) if p not in main]
        if not ps:
            continue
        L += ['', f'## {label}', '']
        L += [f'- [{title(idx[p])}]({url(p)})' + (f': {idx[p]["desc"]}' if with_desc else '') for p in ps]
    L += ['', '## Данни', '',
          f'- [Каталог на наборите (JSON)]({origin}/data/catalog.json): всички файлове с данни, с източник, период, обхват и статус',
          f'- [Отворени данни и API]({url("/api")}): как се четат файловете с код',
          f'- [Какво ново (RSS)]({origin}/data/feed.xml): последните отчети, решения и данни',
          '', '## Optional', '', f'- [Пълният текст на основните страници]({origin}/llms-full.txt)', '']
    (out / 'llms.txt').write_text('\n'.join(L), encoding='utf-8')

    full = ['# Бюджет на светло: пълният текст на основните страници', '',
            f'Източник: {origin}/ · данни към {lastmod or "—"} · всяка страница по-долу има адрес, кратък отговор (където има) и текста си, с таблиците.', '']
    for p in main + [q for q in by_route.get('S08', []) if q not in main]:
        i = idx[p]
        full += ['---', '', f'## {title(i)}', '', f'Адрес: {url(p)}', '']
        if i['answer']:
            full += [f'Накратко: {i["answer"]}', '']
        if i['lede']:
            full += [i['lede'], '']
        full += [clean_text(i['text'], 6000), '']
    (out / 'llms-full.txt').write_text('\n'.join(full), encoding='utf-8')

    (out / '_headers').write_text(
        '# Cloudflare Workers Static Assets: headers of the static files (wrangler.jsonc)\n'
        '/*\n'
        f'  Content-Security-Policy: {CSP}\n'
        '  X-Frame-Options: SAMEORIGIN\n'
        '  X-Content-Type-Options: nosniff\n'
        '  Referrer-Policy: strict-origin-when-cross-origin\n'
        '  Strict-Transport-Security: max-age=31536000\n'
        '  Cross-Origin-Opener-Policy: same-origin\n'
        '  Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()\n'
        + ('  X-Robots-Tag: noindex\n' if noindex else '') +
        '/vendor/*\n'
        '  Cache-Control: public, max-age=604800\n'
        '/data/*\n'
        '  Cache-Control: public, max-age=300, must-revalidate\n'
        '  Access-Control-Allow-Origin: *\n'
        '/data/releases/current.json\n'                                    # the pointer to the current release (spec, section 9.2)
        '  ! Cache-Control\n'
        '  Cache-Control: no-store\n'
        '/llms*.txt\n'
        '  Content-Type: text/plain; charset=utf-8\n', encoding='utf-8')
    return paths


def gz_size(raw):
    """as gz_size in tools/mock/catalog_refresh_v5.py, which wrote the sizes of the catalog"""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode='wb', mtime=0, compresslevel=9) as fh:
        fh.write(raw)
    return len(buf.getvalue())


def stamp_files(out, origin, data_version):
    """what in the copied files depends on this build: the RSS links (data/feed.xml was generated with a placeholder host and hash addresses)
    and the cache name of the service worker (a new name per build: the worker of the previous build drops its copies on activate).
    Runs before the crawl: the new links change the size of feed.xml, and data/catalog.json (and the catalog screen built from it) must give
    the size of the file that is served"""
    feed = out / 'data' / 'feed.xml'
    if feed.is_file():
        x = feed.read_text(encoding='utf-8')
        x = re.sub(r'https?://budget-na-svetlo\.example/(?:#/)?', origin + '/', x).replace(origin + '/#/', origin + '/')
        feed.write_text(x, encoding='utf-8')
        cat_file = out / 'data' / 'catalog.json'
        cat = json.loads(cat_file.read_text(encoding='utf-8'))
        raw = feed.read_bytes()
        for d in cat['datasets']:
            if d.get('file') == 'data/feed.xml':
                d['bytes'], d['gzipBytes'] = len(raw), gz_size(raw)
        cat_file.write_text(json.dumps(cat, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    sw = out / 'sw.js'
    try:
        rev = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        rev = 'local'
    s, n = re.subn(r"const CACHE = '[^']*';", f"const CACHE = 'bns-{data_version or 'data'}-{rev}';", sw.read_text(encoding='utf-8'), count=1)
    if n:
        sw.write_text(s, encoding='utf-8')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--out', default=str(ROOT / 'dist'))
    ap.add_argument('--origin', help='production address (default: <meta name="site-origin"> in site/index.html)')
    ap.add_argument('--sigma-url', help='address of the original СИГМА for the menu and the footer (default: <meta name="sigma-url"> in site/index.html)')
    ap.add_argument('--jobs', type=int, default=6, help='pages built at the same time')
    ap.add_argument('--limit', type=int, default=0, help='build at most N screens (a quick try; links to the others then fail the check)')
    ap.add_argument('--noindex', action='store_true', help='a staging build: robots.txt disallows everything and every response says X-Robots-Tag: noindex')
    a = ap.parse_args()

    template = (SITE / 'index.html').read_text(encoding='utf-8')
    origin = a.origin or re.search(r'<meta name="site-origin" content="([^"]+)"', template).group(1)
    origin = origin.rstrip('/')
    out = pathlib.Path(a.out).resolve()
    if out == SITE.resolve() or out == ROOT:
        sys.exit('refusing to build into the source folder')
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(SITE, out, ignore=shutil.ignore_patterns('sebra.json'))     # СЕБРА: on disk for phase 2, used by no screen and not in the catalog
    template = template.replace('<meta name="site-origin" content="https://sigma-budget.my-data.bg">', f'<meta name="site-origin" content="{origin}">')
    if a.sigma_url:
        if not re.fullmatch(r'https://[^\s"<>]+', a.sigma_url):
            sys.exit('--sigma-url must be an https address')
        template = re.sub(r'<meta name="sigma-url" content="[^"]*">', f'<meta name="sigma-url" content="{html.escape(a.sigma_url)}">', template)
    (out / 'index.html').write_text(template, encoding='utf-8')
    (out / 'app.html').write_text(template, encoding='utf-8')         # the bare app shell: the host serves it for /embed/* (worker/index.js)

    core = json.loads((SITE / 'data' / 'core.json').read_text(encoding='utf-8'))
    dv = (core.get('build') or {}).get('dataVersion') or ''
    lastmod = dv[:10] if re.match(r'\d{4}-\d{2}-\d{2}', dv) else datetime.date.today().isoformat()
    routes_js = (SITE / 'js' / 'routes.js').read_text(encoding='utf-8')
    seeds = ['/'] + sorted({norm_path(urllib.parse.unquote(s.lstrip('#')).split('?')[0]) or '/' for s in re.findall(r"'(#/[^']*)'", routes_js)} - {None})

    stamp_files(out, origin, dv)
    t0 = time.time()
    srv, base = serve.start(out, shell=template.encode('utf-8'))
    print(f'build: {base} -> {out} · origin {origin} · {a.jobs} pages at a time')
    crawl = Crawl(base, a.jobs, a.limit)
    asyncio.run(crawl.run(seeds))
    srv.shutdown()

    routes = (crawl.pages.get('/') or {}).get('routes') or []          # window.__ROUTES__ (js/routes.js)

    built = set(crawl.pages)
    fails, warns = list(crawl.fails), list(crawl.warns)
    loc = lambda p: origin + ('/' if p == '/' else p)   # noqa: E731
    for path, info in sorted(crawl.pages.items()):
        for level, msg in check_page(path, info, built if not a.limit else built | {norm_path(h) for i in crawl.pages.values() for h in i['links']}, origin):
            (fails if level == 'fail' else warns).append((path, msg))
        f = out_file(out, path)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(info['html'].replace(base, origin + '/'), encoding='utf-8')
    titles = collections.Counter(i['title'] for i in crawl.pages.values())
    for path, info in crawl.pages.items():
        if titles[info['title']] > 1:
            warns.append((path, f'the title is shared by {titles[info["title"]]} screens: {info["title"]}'))
    nf = crawl.not_found
    if not nf or nf['route'] != 'S30':
        fails.append((NOT_FOUND_PROBE, 'the 404 screen was not built'))
    else:
        (out / '404.html').write_text(nf['html'].replace(base, origin + '/').replace(f'<link rel="canonical" href="{loc(NOT_FOUND_PROBE)}">', '')
                                      .replace(f'data-prerendered="{NOT_FOUND_PROBE}"', 'data-prerendered="404"'), encoding='utf-8')   # served for any unknown path

    paths = write_extras(out, crawl.pages, origin, lastmod, routes, a.noindex)
    dt = time.time() - t0
    print(f'\n{len(crawl.pages)} screens prerendered ({len(paths)} in the sitemap) in {dt:.0f} s → {out}')
    for path, msg in warns[:40]:
        print(f'  warn {path}: {msg}')
    if len(warns) > 40:
        print(f'  … {len(warns) - 40} more warnings')
    for path, msg in fails[:80]:
        print(f'  FAIL {path}: {msg}')
    print(f'RESULT: {"FAIL" if fails else "PASS"} · failures {len(fails)} · warnings {len(warns)}')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
