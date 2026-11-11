"""Fresh mobile navigation: the first tap must survive a slow module boot.

Run against the built Worker: python -m tests.e2e.boot --url http://127.0.0.1:8980
"""
import argparse
import asyncio
import re
from datetime import datetime, timedelta, timezone
from playwright.async_api import async_playwright

async def early_preferences(browser, url):
    for choice in ['period', 'default-period', 'same-default-period', 'unit', 'share']:
        context = await browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, service_workers='block')
        page = await context.new_page()
        if choice in ['default-period', 'same-default-period']:
            await page.add_init_script("localStorage.setItem('bns.prefs.v1', JSON.stringify({period:'2026.draft', unit:'eur'}))")
        release = asyncio.Event()
        async def hold(request):
            await release.wait()
            await request.continue_()
        await page.route('**/data/core.json', hold)
        # Freeze the bounded boot timer, so this proves a pre-start interaction
        # even on a busy runner. Network and real DOM events remain available.
        at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        await page.clock.install(time=at)
        await page.clock.pause_at(at + timedelta(seconds=1))
        try:
            await page.goto(url.rstrip('/') + '/razhodi', wait_until='domcontentloaded')
            assert await page.evaluate("import('/js/router.js').then(m => m.router.current === null)")
            if choice == 'period':
                await page.locator('#btn-period').click(force=True)
                await page.get_by_role('dialog').locator('input[value="2024.report"]').click(force=True)
                assert 'per=2024.report' in page.url
            elif choice in ['default-period', 'same-default-period']:
                values = ['2024.report', '2027.draft'] if choice == 'default-period' else ['2027.draft']
                for value in values:
                    await page.locator('#btn-period').click(force=True)
                    await page.get_by_role('dialog').locator(f'input[value="{value}"]').click(force=True)
                    # An unchanged radio has no change event, so its sheet stays open.
                    if value == '2027.draft' and choice == 'same-default-period':
                        await page.keyboard.press('Escape')
                assert await page.evaluate("import('/js/store.js').then(m => m.store.get('period'))") == '2027.draft'
                assert 'per=' not in page.url
            elif choice == 'unit':
                await page.locator('.unit-switch input[value="pct"]').click(force=True)
                assert 'unit=pct' in page.url
            else:
                await page.locator('[data-share]').first.click(force=True)
                assert not await page.get_by_text('Този блок не може да се споделя.').count()
            # Prove this was an early interaction, before startup consumed the URL.
            assert await page.evaluate("import('/js/router.js').then(m => m.router.current === null)")
        finally:
            release.set()
            await page.clock.resume()
        await page.wait_for_selector('article[data-route="S07"][data-ready="1"]')
        if choice == 'period':
            assert await page.evaluate("import('/js/store.js').then(m => m.store.get('period'))") == '2024.report'
            assert 'per=2024.report' in page.url
        elif choice in ['default-period', 'same-default-period']:
            # Wait for the actual migration (including storage cleanup), rather
            # than asserting during the gap between initial render and migration.
            await page.wait_for_function("() => !Object.hasOwn(JSON.parse(localStorage.getItem('bns.prefs.v1')), 'period')")
            await page.wait_for_selector('article[data-route="S07"][data-ready="1"]')
            assert await page.evaluate("import('/js/store.js').then(m => m.store.get('period'))") == '2027.draft'
            assert 'per=' not in page.url
        elif choice == 'unit':
            assert await page.evaluate("import('/js/store.js').then(m => m.store.get('unit'))") == 'pct'
            assert await page.locator('.unit-switch input[value="pct"]').is_checked()
            assert 'unit=pct' in page.url
        else:
            await page.wait_for_selector('dialog[open] .share-menu')
        await context.close()
        print(f'PASS early {choice} with core held')

    context = await browser.new_context(service_workers='block')
    page = await context.new_page()
    release = asyncio.Event()
    async def hold_bridge(request):
        await release.wait()
        await request.continue_()
    await page.route('**/react-bridge.js', hold_bridge)
    try:
        await page.goto(url.rstrip('/') + '/zakon', wait_until='domcontentloaded')
        await page.locator('#btn-period').click()
        assert await page.get_by_role('dialog').locator('input[type=radio]:not(:disabled)').evaluate_all('(nodes) => nodes.map(n => n.value)') == ['2026.law']
        assert await page.evaluate("import('/js/store.js').then(m => m.store.get('period'))") == '2026.law'
    finally:
        release.set()
    await context.close()
    print('PASS initial route period restrictions')

    # Search is a chrome control: it must open before React, and its results
    # remain real anchors, usable before router link interception starts.
    context = await browser.new_context(service_workers='block')
    page = await context.new_page()
    release = asyncio.Event()
    await page.route('**/react-bridge.js', hold_bridge)
    try:
        await page.goto(url.rstrip('/') + '/razhodi', wait_until='domcontentloaded')
        await page.locator('#btn-search').click()
        await page.wait_for_selector('dialog.palette[open] input')
        await page.wait_for_selector('dialog.palette a[href]')
    finally:
        release.set()
    await context.close()
    print('PASS search before React')

async def cancelled_seo(browser, url):
    for pattern in ['**/screen-S26-*.js', '**/text-*.js']:
        context = await browser.new_context(service_workers='block')
        page = await context.new_page()
        requested, release, completed = asyncio.Event(), asyncio.Event(), asyncio.Event()
        async def hold(request):
            requested.set()
            await release.wait()
            await request.continue_()
            completed.set()
        await page.route(pattern, hold)
        try:
            await page.goto(url.rstrip('/') + '/', wait_until='domcontentloaded')
            await page.wait_for_selector('article[data-ready="1"]')
            await page.evaluate("import('/js/router.js').then(m => m.router.go('/za-proekta'))")
            await asyncio.wait_for(requested.wait(), 10)
            await page.evaluate("import('/js/router.js').then(m => m.router.go('/razhodi'))")
            await page.wait_for_selector('article[data-route="S07"][data-ready="1"]')
            snapshot = "Array.from(document.head.querySelectorAll('title, meta[name=description], meta[property], link[rel=canonical], #ld-page'), n => n.outerHTML)"
            before = await page.evaluate(snapshot)
        finally:
            release.set()
        await asyncio.wait_for(completed.wait(), 10)
        # Let the released navigation finish its import/metadata continuations.
        await page.wait_for_timeout(500)
        assert await page.evaluate(snapshot) == before, pattern
        assert await page.locator('article.page').get_attribute('data-route') == 'S07'
        await context.close()
        print(f'PASS cancelled navigation SEO {pattern}')

async def check(url):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for route, phase in [(route, phase) for route in ['/', '/razhodi', '/za-proekta'] for phase in ['domcontentloaded', 'commit']]:
            context = await browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, service_workers='block')
            page = await context.new_page()
            # Keep React unavailable until AFTER the first menu interaction.
            release, requested = asyncio.Event(), asyncio.Event()
            async def hold_bridge(request):
                requested.set()
                await release.wait()
                await request.continue_()
            await page.route('**/react-bridge.js', hold_bridge)
            # Also cover a tap while the main module itself is still in flight.
            async def delay(request):
                await asyncio.sleep(1)
                await request.continue_()
            await page.route('**/js/main.js', delay)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto(url.rstrip('/') + route, wait_until=phase)
            await page.locator('#btn-menu').tap()
            try:
                await page.wait_for_selector('dialog.sheet-drawer[open]', timeout=3000)
                await asyncio.wait_for(requested.wait(), 5)
                assert not release.is_set()
            finally:
                release.set()
            await page.wait_for_selector('article[data-ready="1"]', timeout=30000)
            assert await page.locator('dialog.sheet-drawer').is_visible(), route
            assert await page.locator('#btn-menu').get_attribute('aria-expanded') == 'true', route
            assert not errors, errors
            await context.close()
            print(f'PASS first tap {route} at {phase}')
        for route, screen in [('/za-proekta', 'S26'), ('/nyama-takava', 'S30'), ('/api', 'S25'), ('/proverka', 'S35'), ('/zakon', 'S14'), ('/novo', 'S16')]:
            context = await browser.new_context(service_workers='block')
            page = await context.new_page()
            loaded = set()
            errors = []
            page.on('request', lambda request: loaded.update(re.findall(r'/screen-(S\d+)-', request.url)))
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: errors.append(message.text) if message.type == 'error' and 'React error' in message.text else None)
            await page.goto(url.rstrip('/') + route, wait_until='domcontentloaded')
            await page.wait_for_selector('#view[data-react-owned] article[data-ready="1"]', timeout=30000)
            assert loaded == {screen}, (route, loaded)
            assert not errors, (route, errors)
            await context.close()
            print(f'PASS isolated screen {screen}')
        await early_preferences(browser, url)
        await cancelled_seo(browser, url)
        await browser.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    asyncio.run(check(parser.parse_args().url))
