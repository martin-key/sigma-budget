"""Focused current-bill browsing checks against a built local Worker.

python -m tests.e2e.public_bill_lists --url http://127.0.0.1:PORT --evidence /tmp/evidence
The caller owns the finite Worker lifecycle. No source acquisition or remote writes.
"""
import argparse
import csv
import io
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
    base = args.url.rstrip('/')
    results, errors = [], []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            for width in (1280, 390):
                context = browser.new_context(
                    viewport={'width': width, 'height': 900},
                    has_touch=width == 390, reduced_motion='reduce', service_workers='block',
                )
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))

                def go(path):
                    page.goto(base + path)
                    page.locator('article[data-ready="1"]').wait_for()

                def query():
                    return parse_qs(urlsplit(page.url).query)

                def capture(name):
                    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
                    page.screenshot(path=str(args.evidence / f'{width}-{name}.png'), full_page=True)

                def compare_ssr(selector, back_selector=None):
                    static = browser.new_context(java_script_enabled=False, viewport={'width': width, 'height': 900})
                    try:
                        other = static.new_page()
                        other.goto(page.url)
                        assert other.locator(selector).inner_text() == page.locator(selector).inner_text()
                        if back_selector:
                            assert other.locator(back_selector).first.get_attribute('href') == page.locator(back_selector).first.get_attribute('href')
                    finally:
                        static.close()

                go('/vedomstva?variant=billMc')
                expect(page.locator('#s10-bill-table tbody tr')).to_have_count(1)
                expect(page.locator('#s10-bill-table tbody')).to_contain_text('съдебната власт')
                page.locator('#bill-variant').select_option('bill')
                expect(page.locator('#s10-bill-table tbody tr')).to_have_count(47)
                field = page.locator('#bill-q')
                field.fill('  vatreshnite  ')
                expect(page.locator('#s10-bill-table tbody tr')).to_have_count(1)
                expect(page.locator('#s10-bill-table tbody')).to_contain_text('вътрешните работи')
                expect(field).to_be_focused()
                expect(page.locator('#bill-count')).to_have_text('Намерени ведомства: 1.')
                assert query()['q'] == ['vatreshnite']
                field.press('Escape')
                expect(page.locator('#s10-bill-table tbody tr')).to_have_count(47)
                expect(field).to_be_focused()

                sort = page.locator('#s10-bill-table .th-sort[data-key="expenditure"]')
                sort.click()
                sort.click()
                assert query()['sort'] == ['expenditure'] and query()['dir'] == ['desc']
                expect(sort.locator('..')).to_have_attribute('aria-sort', 'descending')
                first = page.locator('#s10-bill-table tbody th').first.inner_text()
                compare_ssr('#s10-bill-table tbody')

                # The actual CSV menu downloads the same sorted, filtered rows.
                field.fill('министерств')
                expect(page.locator('#bill-count')).not_to_have_text('Намерени ведомства: 47.')
                count = page.locator('#s10-bill-table tbody tr').count()
                first = page.locator('#s10-bill-table tbody th').first.inner_text()
                page.locator('[data-share="s10-bill-list"]').click()
                with page.expect_download() as download:
                    page.locator('[data-act="csv"]').click()
                csv_path = args.evidence / f'{width}-institutions.csv'
                download.value.save_as(csv_path)
                rows = list(csv.reader(io.StringIO(csv_path.read_text(encoding='utf-8-sig')), delimiter=';'))
                assert len(rows) == count + 1 and rows[1][0] == first
                assert 'Разходи, хил. €' in rows[0]
                assert all(row[rows[0].index('период')] == '2027.draft' for row in rows[1:])
                assert all(row[rows[0].index('единица')] == 'хил. €' for row in rows[1:])
                assert all(row[rows[0].index('източник')] for row in rows[1:])
                assert all('не е целият бюджет' in row[rows[0].index('обхват')] for row in rows[1:])
                shared = page.evaluate("async () => { const s = await import('/js/share.js'); return s.linkFor(s.get('s10-bill-list')); }")
                fresh = browser.new_context(viewport={'width': width, 'height': 900}, service_workers='block', reduced_motion='reduce')
                try:
                    twin = fresh.new_page()
                    twin.goto(shared)
                    twin.locator('article[data-ready="1"]').wait_for()
                    expect(twin.locator('#s10-bill-table tbody tr')).to_have_count(count)
                    assert twin.locator('#s10-bill-table tbody th').first.inner_text() == first
                    expect(twin.locator('#s10-bill-table th[aria-sort="descending"]')).to_have_count(1)
                finally:
                    fresh.close()
                capture('institution-list')
                page.locator('#s10-bill-table tbody a').first.click()
                page.locator('article[data-route="S11"][data-ready="1"]').wait_for()
                assert query()['q'] == ['министерств'] and query()['dir'] == ['desc']
                back = 'main nav[aria-label="Трохи"] a[href*="/vedomstva"]'
                compare_ssr('#s11-bill-rows tbody', back)
                page.locator(back).click()
                expect(page.locator('#s10-bill-table tbody tr')).to_have_count(count)
                assert page.locator('#s10-bill-table tbody th').first.inner_text() == first
                field.fill('zzzzzzzz')
                expect(page.locator('#bill-count')).to_have_text('Намерени ведомства: 0.')
                expect(page.locator('#s10-bill-table tbody')).to_contain_text('изчисти търсенето')
                page.locator('#s10-bill-table .th-sort[data-key="name"]').click()
                expect(page.locator('#s10-bill-table tbody')).to_contain_text('Няма ведомства')
                page.locator('[data-bill-clear]').click()
                expect(field).to_be_focused()
                expect(page.locator('#s10-bill-table tbody tr')).to_have_count(47)

                go('/obshtini?oblast=unknown&q=%20Благоевград%20')
                expect(page.locator('#bill-oblast')).to_have_value('')
                expect(page.locator('#s20-bill-table tbody tr')).to_have_count(1)
                expect(page.locator('#s20-list-2027')).to_contain_text('Непозната област')
                compare_ssr('#s20-bill-table tbody')
                go('/obshtini?oblast=BLG')
                field = page.locator('#bill-q')
                field.fill('blagoevgrad')
                expect(page.locator('#bill-count')).to_have_text('Намерени общини: 1.')
                expect(field).to_be_focused()
                page.locator('#s20-bill-table .th-sort[data-key="v0"]').click()
                page.locator('#s20-bill-table .th-sort[data-key="v0"]').click()
                capture('municipal-list')
                page.locator('#s20-bill-table tbody a').first.click()
                page.locator('article[data-route="S21"][data-ready="1"]').wait_for()
                assert query()['oblast'] == ['BLG'] and query()['q'] == ['blagoevgrad']
                back = 'main nav[aria-label="Трохи"] a[href*="/obshtini"]'
                compare_ssr('#s21-transfers-2027-table tbody', back)
                capture('municipal-detail')
                page.locator(back).click()
                expect(page.locator('#bill-oblast')).to_have_value('BLG')
                expect(page.locator('#bill-q')).to_have_value('blagoevgrad')
                expect(page.locator('#s20-bill-table th[aria-sort="descending"]')).to_have_count(1)
                field = page.locator('#bill-q')
                field.fill('няматакаваобщина')
                expect(page.locator('#bill-count')).to_have_text('Намерени общини: 0.')
                capture('municipal-empty')
                field.press('Escape')
                expect(page.locator('#bill-count')).not_to_have_text('Намерени общини: 0.')
                expect(page.locator('#bill-oblast')).to_have_value('BLG')

                for path, text in [
                    ('/prihodi?per=2028.forecast', '2028'),
                    ('/razhodi?per=2029.forecast', '2029'),
                    ('/obshtini?per=2028.forecast', '2028'),
                    ('/vedomstva?per=2026.law', '2026'),
                ]:
                    go(path)
                    expect(page.locator('.context')).to_contain_text(text)
                results.append({'width': width, 'result': 'PASS', 'institution_csv_rows': count})
                context.close()
            assert not errors, errors
        finally:
            browser.close()
    (args.evidence / 'results.json').write_text(json.dumps({'results': results, 'page_errors': errors}, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False))


if __name__ == '__main__':
    main()
