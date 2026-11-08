"""Check the incremental roots against a built Worker (legacy navigation owns history).

    python -m apps.web.scripts.react_bridge_check --url http://127.0.0.1:8893/
"""
import argparse
from urllib.parse import urlsplit, parse_qs
from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    base = parser.parse_args().url.rstrip('/')
    with sync_playwright() as p:
        browser = p.chromium.launch()
        errors, requests = [], []
        def new_page(**options):
            page = browser.new_page(**options)
            page.on('pageerror', lambda error: errors.append(str(error)))
            def console(message):
                expected_404 = message.location.get('url') == base + '/nyama-takava-stranitsa' and 'status of 404' in message.text
                if message.type == 'error' and not expected_404:
                    errors.append(message.text)
            page.on('console', console)
            return page

        # Delay the bridge at its network boundary, as on a slow first visit.
        # Focus an actual SSR control before React loads, then exercise a refresh.
        for root_id, selector in [('mockbar', 'button'), ('topbar', '.brand'), ('footer', 'a'), ('tabbar', 'a')]:
            probe = new_page(viewport={'width': 390 if root_id == 'tabbar' else 1280, 'height': 900}, service_workers='block')
            def focus_before_bridge(route):
                probe.evaluate("""({root, selector}) => {
                    window.chromeFocus = document.querySelector(`#${root} ${selector}`);
                    window.chromeNodes = [...document.querySelectorAll(`#${root} *`)];
                    window.chromeFocus.focus();
                    if (document.activeElement !== window.chromeFocus) throw new Error('SSR control did not receive focus');
                }""", {'root': root_id, 'selector': selector})
                route.continue_()
            probe.route('**/js/react-bridge.js', focus_before_bridge)
            probe.goto(base + '/prihodi')
            probe.wait_for_selector('article.page[data-ready="1"]')
            assert probe.evaluate('window.chromeFocus?.isConnected && document.activeElement === window.chromeFocus'), root_id + ': focus lost during adoption'
            probe.evaluate("import('/js/shell.js').then(module => module.shell.refreshFooter())")
            probe.wait_for_timeout(100)
            assert probe.evaluate('window.chromeFocus?.isConnected && document.activeElement === window.chromeFocus'), root_id + ': focus lost on refresh'
            assert probe.evaluate("""root => {
                const nodes = [...document.querySelectorAll(`#${root} *`)];
                return nodes.length === window.chromeNodes.length && nodes.every((node, i) => node === window.chromeNodes[i]);
            }""", root_id), root_id + ': chrome elements replaced'
            probe.close()

        page = new_page(service_workers='block')
        page.on('request', lambda request: requests.append(request.url))
        page.add_init_script("""document.addEventListener('readystatechange', () => {
          if(document.readyState === 'interactive') window.initialHeading = document.querySelector('h1');
        });""")
        response = page.goto(base + '/za-proekta')
        assert response.status == 200
        page.wait_for_selector('article.page[data-ready="1"]')
        assert page.evaluate('window.initialHeading === document.querySelector("h1")'), 'SSR heading was replaced'
        assert not any('/data/core.json' in url or '/data/glossary.json' in url for url in requests), 'editorial seed refetched'
        page.select_option('#s26-demo-screen', 'razhodi')
        assert page.locator('[data-s26-demo="empty"]').get_attribute('href') == '/razhodi?demo=empty'
        anchors = page.locator('nav.s26-toc a[href]').evaluate_all('(links) => links.map(link => link.getAttribute("href"))')
        assert len(anchors) == 9
        for address in anchors:
            target = parse_qs(urlsplit(address).query)['to'][0]
            page.locator('nav.s26-toc a[href="' + address + '"]').click()
            page.wait_for_function("""id => {
                const heading = document.getElementById(id);
                if (!heading || document.activeElement !== heading) return false;
                const rect = heading.getBoundingClientRect();
                return rect.top >= 0 && rect.top < innerHeight && heading.classList.contains('hl');
            }""", arg=target)
        page.locator('a[href="/prihodi"]').first.click()
        page.wait_for_selector('article[data-route="S06"][data-ready="1"]')
        page.go_back()
        page.wait_for_selector('article[data-route="S26"][data-ready="1"]')
        response = page.goto(base + '/nyama-takava-stranitsa')
        assert response.status == 404
        page.wait_for_selector('article[data-route="S30"][data-ready="1"]')
        assert page.evaluate('window.initialHeading === document.querySelector("h1")')
        page.fill('#s30-q', '  ДДС   бюджет  ')
        page.locator('.s30-go').click()
        page.wait_for_selector('article[data-route="S28"][data-ready="1"]')
        assert 'q=%D0%94%D0%94%D0%A1+' in page.url
        assert not errors, errors
        browser.close()
    print('React bridge: 9 screen checks, 4 chrome focus cases, 9 S26 anchor transitions passed; 0 browser/hydration errors')


if __name__ == '__main__':
    main()
