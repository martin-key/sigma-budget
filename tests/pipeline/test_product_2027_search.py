"""New product search values are grounded in the pinned extraction, not the web adapter."""
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from budget_pipeline.build.search import _Rows, _publication_2027, _money_khil, GROUPS

ROOT = Path(__file__).resolve().parents[2]

class ProductSearchTest(unittest.TestCase):
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

    def test_historical_search_destinations_are_pinned(self):
        rows = _Rows()
        rows.add('institutions', 'Historical programme', period='2026', href='#/vedomstvo/1300/1300.01.01')
        rows.add('indicators', 'Historic debt', period='2025', href='#/dalg?obhvat=maastricht')
        self.assertTrue(rows.rows[0][6].endswith('per=2026.law'))
        self.assertTrue(rows.rows[1][6].endswith('per=2025.report'))

    def test_validator_rejects_wrong_current_budget_value_period_and_missing_row(self):
        from budget_pipeline.build.context import Ctx as Build
        from budget_pipeline.build.search import search
        from budget_pipeline.build.definitions import set_kfp_pending
        from budget_pipeline.build.active_data import GONE_ROUTES
        from budget_pipeline.validate.checks import Ctx as Validation
        from budget_pipeline.validate.search_feed import g_search
        import copy
        build = Build()
        set_kfp_pending(build.execution)
        build.texts['feed.xml'] = ''
        search(build)
        index = build.out['search-index.json']
        index['items'] = [r for r in index['items'] if r[5] == 'real' and not r[6].startswith(GONE_ROUTES) and 'СЕБРА' not in r[1]]
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

    def test_guide_navigation_follows_live_route_titles_without_changing_editorial_prose(self):
        from budget_pipeline.build.guide import align_links, check
        import copy
        source = ROOT / 'data/inputs/editorial/guide.json'
        before = source.read_bytes()
        original = json.loads(before)
        aligned = align_links(copy.deepcopy(original))
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
