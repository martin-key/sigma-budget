"""Pinned-PDF integration, parsing and damaged-input cases."""
import copy
import tempfile
import json
from pathlib import Path
import sys
import unittest

from budget_pipeline.extract import budget_bill_2027 as E


class Cells(unittest.TestCase):
    def test_split_negative_and_empty(self):
        self.assertEqual(E.number('30 942\n719,3'), 30942719.3)
        self.assertEqual(E.number('−20\n451,6'), -20451.6)
        self.assertIsNone(E.number(''))
        self.assertIsNone(E.number('-'))
        with self.assertRaises(ValueError):
            E.number('5 100,2 159 footer')

    def test_reject_amount_before_footer(self):
        with self.assertRaisesRegex(ValueError, 'unexpected cell'):
            E.budget_rows({'page': 2, 'id': 1, 'rawCells': [['II.', 'РАЗХОДИ', '10,0', '2']]})

    def test_rounding_bound(self):
        E.Checks().equal('rounded', [1.1, 1.1], 2.1)
        with self.assertRaises(ValueError):
            E.Checks().equal('corrupt', [1.1, 1.1], 2.0)

    def test_damaged_zip_fails_pin(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/E.INPUT.name
            path.write_bytes(b'damaged archive')
            (path.parent/'acquisition.json').write_bytes((E.INPUT.parent/'acquisition.json').read_bytes())
            with self.assertRaisesRegex(ValueError,'ZIP pin mismatch'):
                E.read_pdf(path)

    def test_missing_amount_fails_sum(self):
        with self.assertRaises(ValueError):
            E.Checks().equal('missing', [None], 0)


class PinnedPDF(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = E.build()

    def test_frozen_extraction_content(self):
        self.assertEqual(self.result,json.loads(E.OUTPUT.read_text()))

    def test_complete_budgets_and_anchors(self):
        x = self.result
        self.assertEqual(set(x['bill']), {str(a) for a in range(1, 49)})
        self.assertEqual(set(x['billMc']), {'1', '2'})
        self.assertEqual(x['bill']['1']['headline']['rev'], 30942719.3)
        self.assertEqual(x['bill']['1']['headline']['exp'], 18345717.4)
        self.assertEqual(x['bill']['1']['pages'], [1, 2, 3])
        self.assertTrue(all(b['commitments'] for a, b in x['bill'].items() if a != '1'))

    def test_municipalities(self):
        for key in ('art52', 'art53'):
            rows = self.result['municipal'][key]['rows']
            self.assertEqual(len(rows), 265)
            self.assertEqual(len({(r['region'], r['name']) for r in rows}), 265)
        self.assertEqual(self.result['municipal']['art53']['total'][-1], 2292.4)

    def test_projects_and_coverage(self):
        self.assertEqual(len(self.result['projects']['rows']), 226)
        self.assertEqual(len(self.result['coverage']), 159)
        self.assertTrue(all(r['unparsed'] == 0 for r in self.result['coverage']))
        self.assertTrue(self.result['bill']['2']['bodies'])
        self.assertTrue(self.result['otherTables']['50'])

    def test_corrupt_policy_fails(self):
        arts = {a: [copy.deepcopy(b)] for a, b in self.result['bill'].items()}
        for a, b in self.result['billMc'].items():
            arts[a].append(copy.deepcopy(b))
        arts['3'][0]['policies'][0]['khil'] += 10
        with self.assertRaisesRegex(ValueError, 'policy total'):
            E.validate(arts, E.Checks())

    def test_corrupt_supplemental_total_fails(self):
        arts = {a: [copy.deepcopy(b)] for a, b in self.result['bill'].items()}
        for a, b in self.result['billMc'].items():
            arts[a].append(copy.deepcopy(b))
        arts['6'][0]['extraRows'][-1]['value'] += 10
        with self.assertRaisesRegex(ValueError, 'supplemental table total'):
            E.validate(arts, E.Checks())

    def test_missing_budget_fails(self):
        with self.assertRaisesRegex(ValueError, 'article sequence'):
            E.validate({}, E.Checks())


if __name__ == '__main__':
    unittest.main()
