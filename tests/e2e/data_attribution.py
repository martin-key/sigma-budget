"""DATA attribution and detail-page regressions against the built Worker."""
import argparse
import html
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    args = parser.parse_args()
    release = lambda name: json.loads((ROOT / 'data/release' / (name + '.json')).read_text())
    expenditure = release('expenditure')
    entries = release('budget2027-provenance')['entries']
    checks = 0
    periods = {
        '2024.report': 'Отчетни данни за 2024 г.',
        '2025.report': 'Отчетни данни за 2025 г.',
        '2026.law': 'Приет закон за 2026 г.',
        '2026.expected': 'Очаквано изпълнение за 2026 г.',
        '2027.draft': 'Проект за 2027 г.',
        '2028.forecast': 'Прогноза за 2028 г.',
        '2029.forecast': 'Прогноза за 2029 г.',
    }
    routes = [('prognoza', 's13-sum', ''), ('prihodi', 's06-notes', ''),
              ('prihodi/dds', 's06-notes', ''), ('razhodi', 's07-notes', ''),
              ('razhodi', 's07-notes', '&po=vid'),
              ('razhodi/obrazovanie', 's08-notes', ''), ('razhodi/drugi', 's08-notes', ''),
              ('vedomstva', None, ''), ('vedomstvo/0200', None, ''),
              ('vedomstvo/0200/0200.01.00', None, ''),
              ('vedomstvo/0200/0200.01.01', None, '')]
    warning = 'Приетият закон може да се различава от проекта'
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for width in (1440, 390):
            ctx = browser.new_context(viewport={'width': width, 'height': 900},
                                      service_workers='block', reduced_motion='reduce')
            page = ctx.new_page()
            for period, attribution in periods.items():
                for route, original_block, extra in routes:
                    block = original_block
                    if period == '2026.law' and route.startswith(('prihodi', 'razhodi')):
                        block = ('s06' if route.startswith('prihodi') else 's08' if '/' in route else 's07') + '-annual-coverage'
                    address = args.url.rstrip('/') + '/' + route + '?per=' + period + extra
                    page.goto(address)
                    page.locator('article[data-ready="1"]').first.wait_for()
                    article = page.locator('article').first
                    expect(article).not_to_contain_text(warning)
                    checks += 1
                    if block:
                        expect(page.locator('#' + block)).to_contain_text(attribution)
                        checks += 1
                    required = []
                    if route.startswith('razhodi') and period in expenditure['byPeriod'] and period != '2026.law':
                        record = expenditure['byPeriod'][period]
                        function = record['functions'][2 if route.endswith('obrazovanie') else -1 if route.endswith('drugi') else 0]
                        location = entries[function['cell']['provenance']]
                        required.append('Табл. III-1, стр. ' + str(location['page']))
                        if route == 'razhodi':
                            location = entries[record['rows'][0]['cell']['provenance']]
                            required.append('По икономически вид: Приложение 3, стр. ' + str(location['page']))
                        for text in required:
                            expect(page.locator('#' + block)).to_contain_text(text)
                            checks += 1
                    if width == 1440:
                        response = page.request.get(address)
                        assert response.status == 200, address
                        ssr = html.unescape(re.sub('<[^>]+>', ' ', response.text()))
                        ssr = re.sub(r'\s+', ' ', ssr)
                        assert warning not in ssr, address
                        checks += 1
                        for text in ([attribution] if block else []) + required:
                            assert text in ssr, (address, text)
                            checks += 1
                page.goto(args.url.rstrip('/') + '/bvp?per=' + period)
                page.locator('article[data-ready="1"]').wait_for()
                sector = page.locator('#s31-b-sectors')
                for text in ['замразена снимка', 'Има по-късни ревизии',
                             'част от историческите оригинали липсват',
                             'Версия на източника: 07.10.2026', 'Придобиване: 09.10.2026']:
                    expect(sector).to_contain_text(text)
                    checks += 1
                expect(sector.get_by_role('link', name='Ограничения на изданието')).to_have_attribute('href', '/proverka?to=s35-coverage')
                checks += 1
            page.goto(args.url.rstrip('/') + '/danni')
            page.locator('article[data-ready="1"]').wait_for()
            for text in ['само за старите масиви към проекта за 2026',
                         '2026.expected е очаквано изпълнение', '2027.draft е проект',
                         '2028.forecast и 2029.forecast са прогнози',
                         'Табл. III-1 (стр. 73)', 'Приложение 3 (стр. 191–192)']:
                expect(page.locator('.s24-item[data-id="two-versions"]')).to_contain_text(text)
                checks += 1
            ctx.close()
        browser.close()
    print(f'DATA attribution: {checks} checks, 0 failures; SSR and hydration; 1440px and 390px')


if __name__ == '__main__':
    main()
