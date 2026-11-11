"""Release postprocessing, independent of the browser crawl."""
import pathlib
import tempfile
import unittest
from apps.web.scripts.build import write_extras, stamp_files, check_artifact

class ArtifactTest(unittest.TestCase):
    def test_production_and_noindex(self):
        with tempfile.TemporaryDirectory() as directory:
            out = pathlib.Path(directory)
            pages = {'/': dict(robots='', route='S01', title='Начало', desc='Описание', answer='', lede='', text='Текст')}
            routes = [dict(id='S01', pattern='/', nav=True)]
            write_extras(out, pages, 'https://example.test', '2026-11-11', routes)
            (out / 'sw.js').write_text("const CACHE = 'bns-source';")
            stamp_files(out, 'https://example.test', 'v1')
            check_artifact(out)
            self.assertIn('Allow: /', (out / 'robots.txt').read_text())
            self.assertIn('https://example.test/', (out / 'sitemap.xml').read_text())
            self.assertTrue((out / 'llms.txt').stat().st_size)
            self.assertIn('max-age=31536000, immutable', (out / '_headers').read_text())
            write_extras(out, pages, 'https://example.test', '', routes, noindex=True)
            check_artifact(out, noindex=True)
            self.assertIn('Disallow: /', (out / 'robots.txt').read_text())
            self.assertIn('x-robots-tag: noindex', (out / '_headers').read_text())

    def test_service_worker_changes_on_each_build(self):
        with tempfile.TemporaryDirectory() as directory:
            out = pathlib.Path(directory)
            (out / 'sw.js').write_text("const CACHE = 'bns-source';")
            stamp_files(out, 'https://example.test', 'v1')
            first = (out / 'sw.js').read_text()
            stamp_files(out, 'https://example.test', 'v1')
            self.assertNotEqual(first, (out / 'sw.js').read_text())

if __name__ == '__main__':
    unittest.main()
