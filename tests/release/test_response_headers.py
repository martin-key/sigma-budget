import io
import unittest
import urllib.error
from email.message import Message
from unittest.mock import MagicMock, patch
from tests.release.release_check import has_sandbox, req


class ResponseHeadersTest(unittest.TestCase):
    def test_success_and_error_headers_are_case_insensitive(self):
        headers = Message()
        headers['content-security-policy'] = "default-src 'self'; sandbox"
        headers['cache-control'] = 'no-store, no-transform'
        headers['content-disposition'] = 'attachment; filename="original.html"'
        response = MagicMock(status=200, headers=headers)
        response.__enter__.return_value = response
        response.read.return_value = b'body'
        error = urllib.error.HTTPError('http://127.0.0.1/test', 400, 'bad', headers, io.BytesIO(b'body'))
        for value in [response, error]:
            with self.subTest(status=getattr(value, 'status', None)):
                with patch('urllib.request.urlopen', side_effect=[value] if isinstance(value, Exception) else None, return_value=value):
                    _, found, _ = req('GET', 'http://127.0.0.1/test')
                self.assertTrue(has_sandbox(found.get('Content-Security-Policy', '')))
                self.assertIn('no-transform', found.get('Cache-Control', ''))
                self.assertIn('attachment', found.get('Content-Disposition', ''))

    def test_sandbox_requires_a_bare_directive_not_a_substring_or_permissions(self):
        self.assertTrue(has_sandbox('sandbox'))
        self.assertTrue(has_sandbox("default-src 'self'; sandbox; object-src 'none'"))
        self.assertTrue(has_sandbox("sandbox, default-src 'self'; sandbox"))
        for policy in [
            'sandbox allow-scripts; sandbox',
            'sandbox allow-scripts allow-same-origin; sandbox',
            'sandbox; sandbox',
            'sandbox, sandbox allow-scripts',
            "sandbox, default-src 'self'", "default-src 'self'", "report-uri /sandbox", 'sandbox allow-scripts', 'sandbox allow-same-origin']:
            self.assertFalse(has_sandbox(policy), policy)
