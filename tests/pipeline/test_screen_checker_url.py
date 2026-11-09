import unittest
from unittest.mock import patch
from tests.e2e import screens
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


class ScreenCheckerCsvTest(unittest.TestCase):
    def test_checks_the_end_of_large_downloads(self):
        expected = '\ufeffx\r\n' + '1\r\n' * 30000
        actual = expected[:-3] + '2\r\n'
        failures = []
        with patch.object(screens, 'share_menu', return_value={'open': True}), \
                patch.object(screens, 'download_via', return_value=('bns-s20-list.csv', actual.encode('utf-8'), None)):
            screens.share_ui_csv(None, {'id': 's20-list-2027', 'csv': expected},
                                 lambda code, message: failures.append((code, message)), lambda *_: None)
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0][0], 'share-csv')
        self.assertIn('differs from csvFor(spec)', failures[0][1])

    def test_accepts_complete_matching_large_downloads(self):
        expected = '\ufeffx\r\n' + '1\r\n' * 30000
        failures = []
        with patch.object(screens, 'share_menu', return_value={'open': True}), \
                patch.object(screens, 'download_via', return_value=('bns-s20-list.csv', expected.encode('utf-8'), None)):
            screens.share_ui_csv(None, {'id': 's20-list-2027', 'csv': expected},
                                 lambda code, message: failures.append((code, message)), lambda *_: None)
        self.assertEqual(failures, [])
