"""New product search values are grounded in the pinned extraction, not the web adapter."""
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from budget_pipeline.build.search import _Rows, _publication_2027, _institutions, _money_khil, GROUPS

ROOT = Path(__file__).resolve().parents[2]

class ProductSearchTest(unittest.TestCase):
    def test_historical_programme_values_keep_bill_publication_status(self):
        rows = _Rows()
        # The Python builder is the frozen reference: exercise its original
        # programme inputs, independently of production-only additions to D09.
        historical = ROOT / 'packages/ingest/test/fixtures/wave13b/oracle'
        inputs = {name: json.loads((historical / name).read_text())
                  for name in ('ministries.json', 'programs.json')}
        _institutions(SimpleNamespace(out=inputs), rows)
        self.assertEqual(len(rows.rows), 272)
        for row in rows.rows:
            self.assertEqual(row[4], 'Проект 2026')
            self.assertIn('per=2026.law', row[6])
        programme = next(row for row in rows.rows if '/0200.01.01?' in row[6])
        self.assertIn('0200.01.01', programme[2])
        self.assertEqual(programme[3].replace('\u00a0', ' '), '6,60 млн. €')

    def test_publication_rows_and_identities(self):
        rows = _Rows()
        _publication_2027(SimpleNamespace(out={}), rows)
        bill = json.loads((ROOT / 'data/inputs/budget_bill_2027.json').read_text())
        institutions = [r for r in rows.rows if GROUPS[r[0]] == 'institutions']
        municipalities = [r for r in rows.rows if GROUPS[r[0]] == 'municipalities']
        self.assertEqual(len(institutions), 47)
        self.assertEqual(len(municipalities), 265)
        self.assertEqual(len({r[6] for r in municipalities}), 265)
        for row in rows.rows:
            self.assertIn('per=2027.draft', row[6]) if row in institutions + municipalities else None
        n = next(r for r in institutions if '/3800?' in r[6])
        self.assertIn('чл. 33', n[2])
        self.assertEqual(n[3], _money_khil(bill['bill']['33']['headline']['exp']))
        for row in municipalities:
            if '/BLG03?' in row[6]:
                original = next(r for r in bill['municipal']['art52']['rows'] if r['name'] == 'Благоевград')
                self.assertEqual(row[3], _money_khil(original['values'][0]))
        for code in ('VAR05', 'RSE04'):
            self.assertTrue(any('/'+code+'?' in r[6] for r in municipalities))
        blagoevgrad = next(r for r in municipalities if '/BLG03?' in r[6])
        self.assertIn('BLG03', blagoevgrad[7])

    def test_annual_search_drops_unaddressable_old_drafts_and_pins_reports(self):
        rows = _Rows()
        for year in ('2026', '2027', '2028'):
            rows.add('indicators', 'Old draft ' + year, 'КФП по видове, 2026', value='12,80 млрд. €', period=year, href='#/prihodi/dds')
        self.assertEqual(rows.rows, [])
        rows.add('indicators', 'Report', value='1 млн. €', period='2025', href='#/prihodi/dds')
        self.assertTrue(rows.rows[0][6].endswith('per=2025.report'))

    def test_historical_search_destinations_are_pinned(self):
        rows = _Rows()
        rows.add('institutions', 'Historical programme', period='2026', href='#/vedomstvo/1300/1300.01.01')
        rows.add('indicators', 'Historic debt', period='2025', href='#/dalg?obhvat=maastricht')
        self.assertTrue(rows.rows[0][6].endswith('per=2026.law'))
        self.assertTrue(rows.rows[1][6].endswith('per=2025.report'))

    def test_current_measures_follow_all_printed_effects_and_blank_cells(self):
        rows = _Rows()
        _publication_2027(SimpleNamespace(out={}), rows)
        current = [r for r in rows.rows if GROUPS[r[0]] == 'measures']
        forecast = json.loads((ROOT / 'data/inputs/budget_forecast_2027.json').read_text())
        expected_count = 3 * sum(len(forecast['tables'][key]['rows']) for key in ('II_7','II_8'))
        self.assertEqual(len(current), expected_count)
        invoice = [r for r in current if 'електронно фактуриране' in r[1]]
        self.assertEqual(len(invoice), 3)
        self.assertEqual([r[4] for r in invoice], ['Проект 2027','Прогноза 2028','Прогноза 2029'])
        self.assertEqual(invoice[0][3], '')
        self.assertIn('Празна печатна клетка.', invoice[0][2])
        for row in invoice[1:]:
            self.assertIn('400,0', row[3])
            self.assertIn('to=s12-II_7-1-', row[6])

    def test_validator_rejects_wrong_current_budget_value_period_and_missing_row(self):
        from budget_pipeline.validate.checks import Ctx as Validation
        from budget_pipeline.validate.search_feed import g_search
        import copy
        # The frozen builder does not emit production-only datasets. Validate the
        # complete published index against its owners, retaining every mutation.
        index = json.loads((ROOT / 'data/release/search-index.json').read_text())
        baseline = Validation()
        baseline._json['search-index.json'] = index
        self.assertEqual(g_search(baseline).problems, [])
        for mutation in ('value', 'period', 'missing'):
            changed = copy.deepcopy(index)
            row = next(r for r in changed['items'] if r[6] == '#/vedomstvo/1300?per=2027.draft')
            if mutation == 'value': row[3] = '999'+chr(160)+'млрд.'+chr(160)+'€'
            elif mutation == 'period': row[6] = '#/vedomstvo/1300?per=2026.law'
            else: changed['items'].remove(row)
            v = Validation()
            v._json['search-index.json'] = changed
            self.assertTrue(g_search(v).problems, mutation)
        for mutation in ('value', 'period', 'missing', 'blank'):
            changed = copy.deepcopy(index)
            row = next(r for r in changed['items'] if r[6] == '#/merki?per=2028.forecast&to=s12-II_7-1-1')
            if mutation == 'value': row[3] = '999 млн. €'
            elif mutation == 'period': row[4] = 'Закон 2028'
            elif mutation == 'missing': changed['items'].remove(row)
            else:
                row = next(r for r in changed['items'] if r[6] == '#/merki?per=2027.draft&to=s12-II_7-1-0')
                row[3] = '0 млн. €'
            v = Validation()
            v._json['search-index.json'] = changed
            self.assertTrue(g_search(v).problems, mutation)

    def test_guide_navigation_follows_live_route_titles_without_changing_editorial_prose(self):
        from budget_pipeline.build.guide import align_links, check
        from budget_pipeline.routes import load_routes
        import copy
        source = ROOT / 'data/inputs/editorial/guide.json'
        before = source.read_bytes()
        original = json.loads(before)
        aligned = align_links(copy.deepcopy(original), load_routes())
        self.assertEqual(check(aligned), [])
        for old, new in zip(original['steps'], aligned['steps']):
            self.assertEqual(old['intro'], new['intro'])
            self.assertEqual(old['blocks'], new['blocks'])
            self.assertEqual(old['screen']['id'], new['screen']['id'])
        self.assertEqual(before, source.read_bytes())

    def test_news_announces_the_published_draft_and_keeps_only_its_legislative_history_pending(self):
        from budget_pipeline.build.law import next_budget
        from budget_pipeline.build.feed import budget_publication_events
        publication = json.loads((ROOT/'data/release/budget2027.json').read_text())
        event = budget_publication_events(SimpleNamespace(get=lambda _: publication))[0]
        self.assertEqual(event['date'], publication['publication'])
        self.assertEqual(event['source'], ['budget2027'])
        self.assertIn('не е приет закон',event['text'])
        current = next_budget(publication)
        self.assertNotIn('ще бъде добавен', current['note'])
        self.assertIn('още не е извлечена', current['note'])
        self.assertEqual(current['status'],'pending')
        self.assertIn('ще бъде добавен', next_budget()['note'])

    def test_eurostat_news_links_keep_the_reported_series_and_period(self):
        from urllib.parse import parse_qs, urlsplit
        from budget_pipeline.build.feed import _eurostat_events
        published = {name: json.loads((ROOT / 'data/release' / name).read_text())
                     for name in ('debt.json', 'expenditure.json')}
        sources = {name: json.loads((ROOT / 'data/inputs' / (name + '.json')).read_text())
                   for name in ('cofog_bg', 'population')}
        population = sources['population']
        # This unit test exercises news destinations, not the raw adapters. Use
        # complete small source envelopes so a clean checkout needs no cache.
        maastricht = published['debt.json']['latest']['maastricht']
        raw = {
            'eurostat/gov_10dd_edpt1_BG_EU.json': {'updated': maastricht['asOf']},
            'eurostat/gov_10q_ggdebt_BG.json': {'updated': maastricht['quarter']['asOf']},
            'eurostat/tps00001_BG.json': {
                'id': ['geo', 'time'], 'size': [1, len(population['years'])],
                'dimension': {
                    'geo': {'category': {'index': {'BG': 0}}},
                    'time': {'category': {'index': {str(y): i for i, y in enumerate(population['years'])}}},
                },
                'value': {str(i): v for i, v in enumerate(population['persons'])},
            },
        }
        ctx = SimpleNamespace(get=published.get, src=sources.__getitem__, raw=raw.__getitem__)
        events = _eurostat_events(ctx)
        annual = next(e for e in events if e['id'].startswith('eurostat-gov_10dd_edpt1-'))
        quarter = next(e for e in events if e['id'].startswith('eurostat-gov_10q_ggdebt-'))
        cofog = next(e for e in events if e['id'].startswith('eurostat-gov_10a_exp-'))
        annual_year = ctx.get('debt.json')['latest']['maastricht']['year']
        # Quarterly observations share the historical debt screen with its
        # latest annual report, and must land on their own dated section.
        for event, anchor in ((annual, 's17-b-maastricht'), (quarter, 's17-b-quarterly')):
            query = parse_qs(urlsplit(event['href'][1:]).query)
            self.assertEqual(query.get('obhvat'), ['maastricht'])
            self.assertEqual(query.get('per'), [f'{annual_year}.report'])
            self.assertEqual(query.get('to'), [anchor])
        cofog_query = parse_qs(urlsplit(cofog['href'][1:]).query)
        self.assertEqual(cofog_query.get('per'), [f"{ctx.get('expenditure.json')['cofog']['years'][-1]}.report"])
