"""URL/hash/storage and SSR first-paint matrix against the built Worker; never rewrites source data."""
import argparse
import html
import json
import os
import re
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', str(ROOT / 'tmp/pw-browsers'))
CASES = [(None, '2027.draft', ''), ('2026.law', '2026.law', ''),
         ('2026.draft', '2026.law', 'Старият адрес'),
         ('2027.forecast', '2027.draft', 'Прогнозата за 2027'),
         ('2028.forecast', '2028.forecast', 'Прогнозата за 2028'),
         ('2026.expected', '2026.expected', ''), ('2027.draft', '2027.draft', ''),
         ('2029.forecast', '2029.forecast', ''), ('unknown', '2027.draft', 'Непознат период')]


def text(markup):
    return html.unescape(re.sub('<[^>]+>', ' ', markup))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    args = parser.parse_args()
    base = args.url.rstrip('/')
    checks = 0
    errors = []

    def ok(condition, message):
        nonlocal checks
        checks += 1
        if not condition:
            errors.append(message)

    # These requests never execute JavaScript: the notice must already be in the first response.
    first = {}
    for requested, canonical, notice in CASES:
        query = '?per=' + requested if requested else ''
        url = base + '/pari' + query
        with urllib.request.urlopen(url) as response:
            markup = response.read().decode()
            ok(response.status == 200 and response.url == url, 'SSR must not redirect ' + str(requested))
        ok(notice in text(markup), 'SSR notice ' + str(requested))
        ok(('per=' + requested in markup) if requested else True, 'SSR raw per retained ' + str(requested))
        first[requested] = markup
    ok(first['2026.draft'] != first['2026.law'], 'alias and canonical HTML differ')
    ok(first['2027.forecast'] != first['2027.draft'], 'forecast alias and draft HTML differ')

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for hash_mode in (False, True):
            for requested, canonical, notice in CASES:
                ctx = browser.new_context(service_workers='block', reduced_motion='reduce')
                if hash_mode:
                    ctx.add_init_script('window.__HASH_ROUTES__=true')
                page = ctx.new_page()
                console = []
                page.on('pageerror', lambda error: console.append(str(error)))
                q = '?per=' + requested if requested else ''
                address = base + ('/#/pari' if hash_mode else '/pari') + q
                page.goto(address)
                page.wait_for_selector('article.page[data-ready="1"]')
                state = page.evaluate("async () => (await import('/js/store.js')).store.snapshot()")
                ok(state['period'] == canonical, 'client canonical state ' + str(requested))
                ok(page.url == address, 'first client paint keeps the input URL ' + str(requested))
                if notice:
                    ok(notice in page.locator('.period-notice').inner_text(), 'client notice ' + str(requested))
                ok(not console, 'client errors ' + str(requested) + ': ' + str(console))
                ctx.close()
            for old, canonical, notice in (c for c in CASES if c[0] in ('2026.draft', '2027.forecast', '2028.forecast')):
                ctx = browser.new_context(service_workers='block', reduced_motion='reduce')
                ctx.add_init_script("localStorage.setItem('bns.prefs.v1'," + json.dumps(json.dumps({'period': old, 'unit': 'eur'})) + ")")
                if hash_mode:
                    ctx.add_init_script('window.__HASH_ROUTES__=true')
                page = ctx.new_page()
                page.goto(base + ('/#/pari' if hash_mode else '/pari'))
                page.wait_for_function('(p) => location.href.includes("per=" + p)', arg=canonical)
                page.wait_for_function("async p => (await import('/js/store.js')).store.get('period')===p", arg=canonical)
                ok(notice in page.locator('.period-notice').inner_text(), 'storage notice ' + old)
                prefs = page.evaluate("JSON.parse(localStorage.getItem('bns.prefs.v1'))")
                ok('period' not in prefs and prefs['unit'] == 'eur', 'old period removed ' + old)
                ctx.close()
            for variant in ('url-wins', 'corrupt', 'blocked'):
                ctx = browser.new_context(service_workers='block', reduced_motion='reduce')
                if hash_mode:
                    ctx.add_init_script('window.__HASH_ROUTES__=true')
                if variant == 'blocked':
                    ctx.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}})")
                elif variant == 'corrupt':
                    ctx.add_init_script("localStorage.setItem('bns.prefs.v1','broken')")
                else:
                    ctx.add_init_script("localStorage.setItem('bns.prefs.v1',JSON.stringify({period:'2027.forecast',unit:'eur'}))")
                page = ctx.new_page()
                query = '?per=2026.expected' if variant == 'url-wins' else ''
                page.goto(base + ('/#/pari' if hash_mode else '/pari') + query)
                page.wait_for_selector('article.page[data-ready="1"]')
                actual = page.evaluate("async () => (await import('/js/store.js')).store.get('period')")
                ok(actual == ('2026.expected' if variant == 'url-wins' else '2027.draft'), variant + ' state')
                ok(page.locator('.period-notice').count() == 0, variant + ' never shows the stored alias notice')
                ctx.close()
        # Product views: actual built-Worker first paint and client takeover agree.
        product_cases = [
            ('/vedomstva', '47', 's10-bill-table'),
            ('/vedomstvo/3800', 'чл. 33', 's11-bill-rows'),
            ('/obshtini', '5 162 139,3', 's20-bill-table'),
            ('/obshtina/BLG03', '60 265,9', 's21-transfers-2027-table'),
            ('/dalg', '44 343,9', 's17-debt-table'),
            ('/prognoza', '2027–2029', 's13-rev-exp'),
            ('/vedomstva?variant=billMc', 'Вариант на Министерския съвет', 's10-bill-table'),
            ('/obshtini?per=2029.forecast', 'Няма индивидуално общинско разпределение', 's20-framework-table'),
        ]
        ctx = browser.new_context(service_workers='block', reduced_motion='reduce')
        page = ctx.new_page()
        for path, expected, target in product_cases:
            with urllib.request.urlopen(base + path) as response:
                markup = response.read().decode()
            ok(expected in text(markup).replace('\u00a0', ' ').replace('\u202f', ' '), '2027 SSR product ' + path)
            page.goto(base + path)
            page.wait_for_selector('article.page[data-ready="1"]')
            page.wait_for_selector('#' + target)
            actual = page.locator('article.page').inner_text().replace('\u00a0', ' ').replace('\u202f', ' ')
            ok(expected in actual, '2027 client product ' + path)
        page.goto(base + '/vedomstva?variant=billMc')
        page.wait_for_selector('article.page[data-ready="1"]')
        page.click('[data-share="s10-bill-list"]')
        with page.expect_download() as download:
            page.get_by_role('button', name='CSV', exact=False).click()
        csv = Path(download.value.path()).read_text(encoding='utf-8-sig')
        ok('Вариант на Министерския съвет' in csv and '2027.draft' in csv, 'variant and period in real CSV download')
        ok('budget2027-provenance.json#' in csv, 'cell provenance in real CSV download')
        ctx.close()
        # The selector groups law and expected together without losing keyboard-operable radio labels.
        for width in (1280, 390):
            ctx = browser.new_context(viewport={'width': width, 'height': 900}, service_workers='block', reduced_motion='reduce')
            page = ctx.new_page()
            page.goto(base + '/pari')
            page.wait_for_selector('article.page[data-ready="1"]')
            page.click('#btn-period')
            group = page.locator('fieldset.period-year').filter(has=page.locator('input[value="2026.law"]'))
            ok(group.locator('input').evaluate_all('(items)=>items.map(i=>i.value)') == ['2026.law','2026.expected'], '2026 year group')
            ok(page.locator('input[type="radio"][name^="per"]').count() == 7, 'seven ordered options')
            page.screenshot(path=str(ROOT / 'tmp' / f'period-selector-{width}.png'))
            page.keyboard.press('Escape')
            ok(page.locator('#btn-period').evaluate('(b)=>document.activeElement===b'), 'period focus restored')
            ctx.close()
        browser.close()
    for error in errors:
        print('FAIL', error)
    print(f'period matrix: {checks} checks, {len(errors)} failures')
    return bool(errors)


if __name__ == '__main__':
    raise SystemExit(main())
