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
