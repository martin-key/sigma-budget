"""Check S14/S16 against the built Worker and independent main HTML/CSV fixtures.

    python -m tests.e2e.narrative_adoption --url http://127.0.0.1:8899
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

FIXTURES = Path(__file__).resolve().parents[2] / 'apps/web/app/routes/__fixtures__'


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--url', required=True)
    base = ap.parse_args().url.rstrip('/')
    checks = []

    def check(name, ok):
        checks.append({'check': name, 'pass': bool(ok)})

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for path in ['/novo', '/novo?vid=law', '/zakon', '/zakon?per=2026.draft']:
            page = browser.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.add_init_script("window.firstArticle=null;window.firstHeading=null;new MutationObserver(()=>{window.firstArticle ||= document.querySelector('article.page');window.firstHeading ||= document.querySelector('article h1');}).observe(document,{subtree:true,childList:true});")
            page.goto(base + path)
            page.wait_for_selector('article[data-ready="1"]')
            check(path + ': server DOM adopted', page.evaluate("window.firstArticle === document.querySelector('article.page') && window.firstHeading === document.querySelector('article h1')"))
            check(path + ': no browser or React errors', not errors)
            for width, margin in [(1280, 48), (400, 32)]:
                page.set_viewport_size({'width': width, 'height': 900})
                margins = page.locator('.page-body > * + *').evaluate_all(
                    'nodes => nodes.map(node => parseFloat(getComputedStyle(node).marginTop))')
                check(f'{path}: section spacing at {width}px',
                      bool(margins) and all(value == margin for value in margins))
            page.close()
        page = browser.new_page()
        page.goto(base + '/novo')
        page.wait_for_selector('article[data-ready="1"]')
        page.evaluate("""() => {
          window.queryCalls = [];
          const replace = history.replaceState.bind(history);
          history.replaceState = (...args) => {
            if (new Error().stack.includes('setQuery')) window.queryCalls.push(args[2]);
            return replace(...args);
          };
        }""")
        page.locator('[data-query="vid=law"]').focus()
        page.locator('[data-query="vid=law"]').click()
        page.wait_for_function("() => location.search.includes('vid=law') && document.querySelector('[data-query=\"vid=law\"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('article')?.dataset.ready === '1'")
        page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        check('feed filter invokes setQuery once', page.evaluate('window.queryCalls.length') == 1)
        check('feed filter retains focus', page.evaluate("document.activeElement?.dataset.query") == 'vid=law')
        page.locator('#s16-b-summary [data-src]').click()
        inputs = json.loads((FIXTURES / 'narrative-inputs.json').read_text())
        plan_sources = inputs['feed']['highlights']['planBasis']['source']
        source_text = page.locator('[role=dialog]').inner_text()
        check('feed source dialog preserves plan basis sources', all(inputs['core']['sources'][key]['title'] in source_text for key in plan_sources))
        page.keyboard.press('Escape')
        check('source dialog restores focus', page.locator('#s16-b-summary [data-src]').evaluate('el => el === document.activeElement'))
        page.locator('#s16-rss-url').focus()
        check('RSS focus selects complete URL', page.locator('#s16-rss-url').evaluate('el => el.selectionStart === 0 && el.selectionEnd === el.value.length'))
        page.goto(base + '/zakon')
        page.wait_for_selector('article[data-ready="1"]')
        page.locator('#s14-bjudzheti [data-share]').click()
        check('law share offers image, link, CSV and report', page.locator('.share-menu [data-act]').evaluate_all('els => els.map(e => e.dataset.act)') == ['png', 'copy-link', 'csv', 'report'])
        with page.expect_download() as downloaded:
            page.locator('[data-act="csv"]').click()
        check('law CSV is byte-identical to main', Path(downloaded.value.path()).read_bytes() == (FIXTURES / 'S14-budgets.csv').read_bytes())
        page.keyboard.press('Escape')
        page.locator('#s14-t-bjudzheti [data-key="law"]').click()
        expected = browser.new_page()
        expected.set_content((FIXTURES / 'S14-sort.browser.html').read_text())
        selector = '#s14-t-bjudzheti tbody tr'
        text = 'els => els.map(e => e.textContent.replace(/\\s+/g, " ").trim())'
        check('sorted law rows equal independent main fixture', page.locator(selector).evaluate_all(text) == expected.locator(selector).evaluate_all(text))
        check('sorting retains focus', page.evaluate("document.activeElement?.dataset.key") == 'law')
        page.locator('#s14-unit-pct').check()
        page.wait_for_function("() => document.querySelector('#s14-nakratko .kpi-unit')?.textContent === 'от БВП' && document.querySelector('article')?.dataset.ready === '1'")
        expected.set_content((FIXTURES / 'S14-pct.browser.html').read_text())
        selector = '#s14-nakratko .kpi-value'
        check('GDP percentages equal independent main fixture', page.locator(selector).evaluate_all(text) == expected.locator(selector).evaluate_all(text))
        check('unit switch retains focus', page.evaluate('document.activeElement.id') == 's14-unit-pct')
        page.goto(base + '/zakon?to=s14-t-chl1-redove')
        page.wait_for_selector('article[data-ready="1"]')
        check('legacy deep target opens disclosure', page.locator('#s14-t-chl1-redove').evaluate('el => el.closest("details").open'))
        page.locator('.nav-main[data-grp="1"]').click()
        page.locator('[role=dialog] a[href="/novo"]').click()
        page.wait_for_selector('article[data-route="S16"][data-ready="1"]')
        check('navigation reaches React feed', page.locator('#view').get_attribute('data-react-owned') is not None)
        page.go_back()
        page.wait_for_selector('article[data-route="S14"][data-ready="1"]')
        check('Back stays owned by legacy navigation', '/zakon' in page.url)
        expected.close()
        page.close()
        browser.close()
    print(json.dumps(checks, ensure_ascii=False, indent=2))
    failed = sum(not c['pass'] for c in checks)
    print(f'RESULT: {len(checks)} checks, {failed} failures')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
