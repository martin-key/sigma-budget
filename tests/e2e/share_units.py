"""Shared EUR/GDP views across fresh browsers, SSR, navigation and embeds."""
import argparse
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--evidence', required=True, type=Path)
    args = parser.parse_args()
    args.evidence.mkdir(parents=True, exist_ok=True)
    base, results, errors = args.url.rstrip('/'), [], []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            for width in (1280, 390):
                contexts = []

                def fresh(saved='eur', javascript=True):
                    context = browser.new_context(
                        viewport={'width': width, 'height': 900}, java_script_enabled=javascript,
                        reduced_motion='reduce', service_workers='block',
                    )
                    contexts.append(context)
                    if javascript:
                        context.add_init_script(
                            f"localStorage.setItem('bns.prefs.v1', JSON.stringify({{unit:{json.dumps(saved)}}}))"
                        )
                    page = context.new_page()
                    page.on('pageerror', lambda e: errors.append(str(e)))
                    return page

                def go(page, path):
                    page.goto(path if path.startswith('http') else base + path)
                    page.locator('article[data-ready="1"]').wait_for()

                def chart_unit(page, expected):
                    page.wait_for_function(
                        "async expected => { const spec = (await import('/js/ui/chart.js')).chartSpec('s13-rev-exp'); "
                        "return !!spec && (expected === 'pct' ? spec.sub === '% от БВП' : spec.sub !== '% от БВП'); }",
                        arg=expected,
                    )

                def links(page):
                    return page.evaluate("""async () => {
                        const s = await import('/js/share.js');
                        const spec = s.get('s13-b-rev-exp');
                        return {full:s.linkFor(spec),short:s.shortLink(spec),embed:s.embedHash(spec)};
                    }""")

                try:
                    page = fresh('eur')
                    go(page, '/prognoza?per=2029.forecast&unit=pct')
                    expect(page.locator('input[name="s13-unit"][value="pct"]')).to_be_checked()
                    chart_unit(page, 'pct')
                    ssr = fresh(javascript=False)
                    ssr.goto(page.url)
                    expect(ssr.locator('input[name="s13-unit"][value="pct"]')).to_be_checked()
                    shared = links(page)
                    for url in shared.values():
                        assert parse_qs(urlsplit(url).query)['unit'] == ['pct']
                    twin = fresh('eur')
                    go(twin, shared['full'])
                    expect(twin.locator('input[name="s13-unit"][value="pct"]')).to_be_checked()
                    chart_unit(twin, 'pct')
                    embed = fresh('eur')
                    go(embed, shared['embed'])
                    chart_unit(embed, 'pct')
                    assert parse_qs(urlsplit(embed.locator('.s29-brand').get_attribute('href')).query)['unit'] == ['pct']
                    page.screenshot(path=str(args.evidence / f'{width}-forecast-pct.png'), full_page=True)

                    page.locator('input[name="s13-unit"][value="eur"]').check()
                    page.wait_for_function("new URL(location.href).searchParams.get('unit') === 'eur'")
                    chart_unit(page, 'eur')
                    euros = links(page)
                    opposite = fresh('pct')
                    go(opposite, euros['full'])
                    expect(opposite.locator('input[name="s13-unit"][value="eur"]')).to_be_checked()
                    chart_unit(opposite, 'eur')

                    law = fresh('eur')
                    go(law, '/zakon?unit=pct')
                    expect(law.locator('#s14-unit-pct')).to_be_checked()
                    no_js_law = fresh(javascript=False)
                    no_js_law.goto(law.url)
                    expect(no_js_law.locator('#s14-unit-pct')).to_be_checked()
                    law.locator('#s14-unit-eur').check()
                    law.wait_for_function("new URL(location.href).searchParams.get('unit') === 'eur'")
                    expect(law.locator('#s14-unit-eur')).to_be_checked()
                    go(page, '/pari?unit=pct')
                    page.locator('article a[href^="/prihodi"]').first.click()
                    page.locator('article[data-ready="1"]').wait_for()
                    assert parse_qs(urlsplit(page.url).query)['unit'] == ['pct']
                    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
                    results.append({'width': width, 'pct': shared, 'eur': euros, 'ssr': True,
                                    'react': True, 'navigation': True, 'opposite_saved_preference': True})
                finally:
                    for context in contexts:
                        context.close()
        finally:
            browser.close()
    (args.evidence / 'results.json').write_text(json.dumps({'cases': results, 'errors': errors}, indent=2))
    assert not errors, errors
    print(f'PASS: shared units at 1280/390; {len(results)} complete browser journeys')


if __name__ == '__main__':
    main()
