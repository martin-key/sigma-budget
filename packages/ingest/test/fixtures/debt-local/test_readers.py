"""Regression tests for the retained raw BNB Python adapter."""
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'python'))
from budget_pipeline.build import debt

class BnbReaderTests(unittest.TestCase):
    def test_rejects_changed_units_status_indicator_and_nonfinite_values(self):
        raw = (HERE / 'inputs/data/originals/bnb_sdmx/ggd.xml').read_text(encoding='utf-8')
        mutations = [
            ('UNIT_MULT="6"', 'UNIT_MULT="3"'),
            ('OBS_STATUS="A"', 'OBS_STATUS="P"'),
            ('INDICATOR="GGALN_G01_XDC"', 'INDICATOR="OTHER"'),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'bnb_sdmx').mkdir()
            old = debt.RAW
            debt.RAW = root
            try:
                for before, after in mutations:
                    self.assertIn(before, raw)
                    (root / 'bnb_sdmx/ggd.xml').write_text(raw.replace(before, after, 1), encoding='utf-8')
                    with self.subTest(before=before), self.assertRaises(ValueError):
                        debt._bnb(*debt.BNB_GG)
                import re
                broken = re.sub(r'OBS_VALUE="[^"]+"', 'OBS_VALUE="NaN"', raw, count=1)
                self.assertNotEqual(raw, broken)
                (root / 'bnb_sdmx/ggd.xml').write_text(broken, encoding='utf-8')
                with self.assertRaises(ValueError):
                    debt._bnb(*debt.BNB_GG)
            finally:
                debt.RAW = old

if __name__ == '__main__':
    unittest.main()
