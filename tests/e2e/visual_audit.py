"""Visual audit regressions against the built Worker.

python -m tests.e2e.visual_audit --url http://127.0.0.1:8950 --axe /path/to/axe.min.js
"""
import argparse
import csv
import io
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from tests.e2e.light_contrast import check_light_contrast


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--axe', default='node_modules/axe-core/axe.min.js')
    args = parser.parse_args()
    checks = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for theme in ('light',):
            context = browser.new_context(viewport={'width': 390, 'height': 844},
                                          color_scheme=theme, reduced_motion='reduce', bypass_csp=True)
            page = context.new_page()

            def go(route):
                page.goto(args.url.rstrip('/') + route)
                page.locator('article[data-ready="1"]').wait_for()

            go('/merki')
            cards = page.locator('.measure-card')
            assert cards.count() > 0
            expect(page.locator('.measures-desktop').first).to_be_hidden()
            # Every visible container fits; no values require a sideways gesture.
            assert page.evaluate('''() => [...document.querySelectorAll('article *')].filter(e =>
                e.getClientRects().length && getComputedStyle(e).overflowX === 'auto')
                .every(e => e.scrollWidth <= e.clientWidth + 1)''')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            desktop_rows = page.locator('.measures-desktop tbody tr').count()
            assert cards.count() * 3 == desktop_rows
            for card in cards.all():
                values = card.locator('.measure-value')
                assert values.count() == 3
                for year, row in zip(('2027', '2028', '2029'), values.all()):
                    expect(row.locator('dt')).to_contain_text(year)
                    expect(row.locator('dd')).to_be_visible()
                    assert row.locator('dd').inner_text().strip()
                    box = row.bounding_box()
                    assert box['x'] >= 0 and box['x'] + box['width'] <= 390
                expect(card.locator('.measure-origin dl')).to_be_hidden()
            cards.first.locator('summary').click()
            expect(cards.first.locator('.measure-origin dl')).to_be_visible()
            checks += 1

            # Export still has all three original rows and all provenance columns.
            page.locator('[data-share="s12-II_7"]').click()
            with page.expect_download() as download:
                page.locator('[data-act="csv"]').click()
            rows = list(csv.reader(io.StringIO(Path(download.value.path()).read_text(encoding='utf-8-sig')), delimiter=';'))
            assert len(rows) == page.locator('#s12-II_7-table tbody tr').count() + 1
            assert 'Произход' in rows[0] and 'Връзка към произхода' in rows[0]
            checks += 1

            page.set_viewport_size({'width': 820, 'height': 1180})
            expect(page.locator('.measure-cards').first).to_be_hidden()
            expect(page.locator('#s12-II_7-table')).to_be_visible()
            # Provenance hashes and links are CSV-only: period, indicator, value, missing value.
            assert page.locator('#s12-II_7-table th[scope="col"]').count() == 4
            assert page.locator('#s12-II_7-table').get_by_text('budget2027-provenance.json').count() == 0
            checks += 1
            go('/byudzhet-2027')
            # Investment projects: three year totals, a chart by institution, the top ten (project + three years) and a searchable full list.
            assert page.locator('#s34-projects .kpi').count() == 3
            expect(page.locator('#s34-projects-by-institution-fig')).to_be_visible()
            projects = page.locator('#s34-projects-table')
            expect(projects).to_be_visible()
            assert projects.locator('thead th').count() == 4
            assert projects.locator('tbody tr').count() == 10
            assert projects.get_by_text('budget2027-provenance.json').count() == 0
            page.locator('#s34-all-projects > summary').click()
            page.fill('#s34-q', 'струма')
            expect(page.locator('#s34-count')).to_have_text(re.compile(r'^Намерени проекти: [1-9]\d?\.$'))
            assert 0 < page.locator('#s34-project-details tbody tr').count() < 226
            checks += 1
            page.set_viewport_size({'width': 412, 'height': 900})
            go('/byudzhet-2027')
            assert page.evaluate('document.documentElement.scrollWidth') <= 412
            assert page.locator('#s34-projects-table thead').evaluate('(e)=>e.getBoundingClientRect().height') <= 1
            page.set_viewport_size({'width': 820, 'height': 1180})
            checks += 1
            go('/prognoza?per=2027.draft')
            assert page.locator('.fig-table table').count() > 0
            assert page.locator('.fig-table thead th', has_text='произход').count() == 0
            checks += 1
            go('/merki/kr1?per=2026.law')
            expect(page.locator('h1')).not_to_be_empty()
            assert page.locator('.measure-cards').count() == 0
            checks += 1

            go('/prihodi')
            page.emulate_media(media='print')
            assert page.locator('h1').evaluate('(e)=>getComputedStyle(e).color') == 'rgb(21, 17, 12)'
            assert page.evaluate('getComputedStyle(document.documentElement).colorScheme') == 'light'
            # Hex letter case is serialization only (CSS formatting may change it).
            assert page.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--series-1").trim()').lower() == '#15110C'.lower()
            assert page.locator('.block-tools:visible, .seg:visible, .unit-switch:visible, .explorer:visible, .foot-nav:visible, .footer .link-btn:visible').count() == 0
            chart = page.locator('.chart').first
            expect(chart).to_be_visible()
            expect(chart).to_have_attribute('data-ready', '1')
            expect(chart.locator('text').first).to_have_attribute('fill', re.compile(r'^#15110C$', re.IGNORECASE))
            page.emulate_media(media='screen')
            checks += 1

            go('/5-minuti?per=2026.law')
            # Unavailable scenes have no link group; the axe test must inspect real groups.
            expect(page.locator('.s04-deep h3').first).to_have_text('Влез по-дълбоко')
            page.add_script_tag(path=args.axe)
            violations = page.evaluate('''async () => (await axe.run(document,
                {runOnly: ['landmark-unique']})).violations''')
            assert violations == [], violations
            checks += 1
            go('/5-minuti')
            page.add_script_tag(path=args.axe)
            assert page.evaluate('''async () => (await axe.run(document,
                {runOnly: ['landmark-unique']})).violations''') == []
            checks += 1
            context.close()
        # Old saved values and dark OS preference cannot select the retained dark CSS.
        for stored in ('dark', 'system', 'invalid'):
            context = browser.new_context(color_scheme='dark', reduced_motion='reduce')
            context.add_init_script(f"localStorage.setItem('bns.theme', {stored!r})")
            page = context.new_page()
            page.goto(args.url.rstrip('/') + '/prihodi')
            page.locator('article[data-ready="1"]').wait_for()
            expect(page.locator('html')).to_have_attribute('data-theme', 'light')
            assert page.evaluate('getComputedStyle(document.documentElement).colorScheme') == 'light'
            assert page.locator('body').evaluate('(e)=>getComputedStyle(e).backgroundColor') == 'rgb(253, 250, 244)'
            assert page.locator('h1').evaluate('(e)=>getComputedStyle(e).color') == 'rgb(21, 17, 12)'
            assert page.locator('[data-theme-pick], .theme-pick, [aria-label="Тема на сайта"]').count() == 0
            assert page.locator('script[src*="theme-boot"]').count() == 0
            chart = page.locator('.chart').first
            chart.scroll_into_view_if_needed()
            expect(chart).to_have_attribute('data-ready', '1')
            expect(chart.locator('text').first).to_have_attribute('fill', re.compile(r'^#15110C$', re.IGNORECASE))
            page.reload()
            page.locator('article[data-ready="1"]').wait_for()
            expect(page.locator('html')).to_have_attribute('data-theme', 'light')
            checks += 1
            context.close()
        context = browser.new_context(color_scheme='dark', java_script_enabled=False)
        page = context.new_page()
        page.goto(args.url.rstrip('/') + '/merki')
        expect(page.locator('html')).to_have_attribute('data-theme', 'light')
        assert page.locator('body').evaluate('(e)=>getComputedStyle(e).backgroundColor') == 'rgb(253, 250, 244)'
        assert page.locator('[data-theme-pick], .theme-pick').count() == 0
        checks += 1
        context.close()
        checks += check_light_contrast(browser, args.url)
        browser.close()
    print(f'visual-audit: {checks} checks passed (Chromium, light palette and dark OS with legacy storage)')


if __name__ == '__main__':
    main()
