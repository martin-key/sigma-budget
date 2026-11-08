"""Regression: local release builds must see the same staged inputs as Docker."""
import tempfile
import unittest
from pathlib import Path

from budget_pipeline import cli as budget


class LocalInputsTest(unittest.TestCase):
    def test_staged_view_replaces_exported_raw_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src, view = root / 'src', root / 'inputs'
            raw = 'data/originals'
            (src / raw).mkdir(parents=True)
            (view / raw).mkdir(parents=True)
            (src / raw / 'tracked.txt').write_text('exported')
            (view / raw / 'staged.txt').write_text('verified input')
            code = ("from pathlib import Path; p=Path('data/originals'); "
                    "assert not (p/'tracked.txt').exists(); "
                    "assert (p/'staged.txt').read_text() == 'verified input'")
            for _ in range(2):
                rc, output = budget.run_in_env('local', src, view, ['-c', code])
                self.assertEqual(rc, 0, output)
            self.assertEqual((view / raw / 'staged.txt').read_text(), 'verified input')


if __name__ == '__main__':
    unittest.main()
