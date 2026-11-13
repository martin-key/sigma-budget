import unittest
from budget_pipeline.validate.registry import script

class BudgetTaxRegistryCommands(unittest.TestCase):
    def test_explicit_typescript_producers(self):
        for path in ('packages/ingest/src/production/taxes.ts', 'packages/ingest/src/production/taxes-reader.ts'):
            self.assertEqual(script(path), path)

    def test_other_commands_rejected(self):
        for path in ('packages/ingest/src/production/other.ts', '../taxes.ts', 'node packages/ingest/src/production/taxes.ts'):
            with self.assertRaises(ValueError):
                script(path)

class BudgetTableContracts(unittest.TestCase):
    def test_published_contracts_and_corruptions(self):
        import copy
        import json
        from pathlib import Path
        from budget_pipeline.validate.budget_tables import valid_budget_tables
        root = Path(__file__).resolve().parents[2]
        for name in ('state-budget', 'kfp-subsectors'):
            original = json.loads((root / 'data/release' / (name + '.json')).read_text())
            self.assertTrue(valid_budget_tables(original))
            mutations = (
                lambda d: d['tables'].pop(),
                lambda d: d['tables'].append(d['tables'][0]),
                lambda d: d['tables'][0].update(sha256='bad'),
                lambda d: d['tables'][0].update(scope='unknown'),
                lambda d: d['tables'][0]['columns'][0].update(unit='USD'),
                lambda d: d['tables'][0]['rows'][0]['source'].__setitem__(0, '1'),
                lambda d: d['tables'][0]['rows'][0]['eur'].pop(),
                lambda d: d.update(sourceIntegerScale=1),
                lambda d: d.update(sourcePage='https://example.invalid/'),
                lambda d: d['tables'][0]['columns'][0].update(id='unknown'),
            )
            for change in mutations:
                doc = copy.deepcopy(original)
                change(doc)
                self.assertFalse(valid_budget_tables(doc))
            if name == 'kfp-subsectors':
                doc = copy.deepcopy(original)
                doc['missing'] = [False]
                self.assertFalse(valid_budget_tables(doc))

    def test_null_permission_is_limited_to_valid_contract_cells(self):
        import copy
        import json
        from pathlib import Path
        from types import SimpleNamespace
        from unittest.mock import patch
        from budget_pipeline.validate.foundations import g_numbers
        root = Path(__file__).resolve().parents[2]
        for name in ('state-budget.json', 'kfp-subsectors.json'):
            doc = json.loads((root / 'data/release' / name).read_text())
            with patch('budget_pipeline.validate.foundations.L.json_files', return_value=[name]):
                self.assertEqual(g_numbers(SimpleNamespace(get=lambda _: doc)).problems, [])
                bad = copy.deepcopy(doc)
                bad['unexpected'] = None
                self.assertTrue(g_numbers(SimpleNamespace(get=lambda _: bad)).problems)
                bad = copy.deepcopy(doc)
                bad['schema'] = 'unknown'
                self.assertTrue(g_numbers(SimpleNamespace(get=lambda _: bad)).problems)
