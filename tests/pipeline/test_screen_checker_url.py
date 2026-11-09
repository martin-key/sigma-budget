import unittest
from tests.e2e.screens import site_base


class ScreenCheckerUrlTest(unittest.TestCase):
    def test_keeps_the_origin_and_normalizes_only_the_path(self):
        cases = {
            'http://127.0.0.1:43045': 'http://127.0.0.1:43045/',
            'http://127.0.0.1:43045/': 'http://127.0.0.1:43045/',
            'http://[::1]:43045': 'http://[::1]:43045/',
            'https://budget.example.test': 'https://budget.example.test/',
            'https://budget.example.test/preview': 'https://budget.example.test/preview/',
            'https://budget.example.test/preview/index.html?per=2026.law#/pari': 'https://budget.example.test/preview/',
        }
        for address, expected in cases.items():
            with self.subTest(address=address):
                self.assertEqual(site_base(address), expected)
