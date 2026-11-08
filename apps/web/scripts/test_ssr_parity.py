"""The parity parser must retain text and links after native React void elements."""
import unittest
from apps.web.scripts.ssr_parity import parse


class VoidElementParity(unittest.TestCase):
    def test_self_closing_input_keeps_article_text_and_links(self):
        legacy = parse('<article><h1>Търсене</h1><input><p>След полето</p><a href="/prihodi">Приходи</a></article>')
        react = parse('<article><h1>Търсене</h1><input/><p>След полето</p><a href="/prihodi">Приходи</a></article>')
        self.assertEqual(react.text, legacy.text)
        self.assertEqual(react.links, {'/prihodi'})


if __name__ == '__main__':
    unittest.main()
