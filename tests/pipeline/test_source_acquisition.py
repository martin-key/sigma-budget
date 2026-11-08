"""Automatic snapshots must reach the downloader, collect and refetch without live HTTP."""
import argparse
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from budget_pipeline import cli
from budget_pipeline.sources import download, originals

ROOT = Path(__file__).resolve().parents[2]


def evidence():
    reg = cli.yaml_load(ROOT / 'data/sources.yaml')
    ids = {'ec-oil', 'excise-law', 'customs-excise-law', 'nsi-pack'}
    return [(s, f) for s in reg['sources'] if s['id'] in ids and s['acquisition'] == 'auto' for f in s['files']]


class AutomaticSourcesTest(unittest.TestCase):
    def test_existing_downloader_resolves_every_automatic_registry_url(self):
        registered = {f'{folder}/{name}': url for folder, name, url, *_ in download.SOURCES}
        self.assertEqual(len(evidence()), 5)
        for _source, entry in evidence():
            rel = entry['path'].removeprefix('data/originals/')
            self.assertEqual(registered[rel], entry['url'])
            self.assertEqual(originals.how_to_get(rel)[0], 'auto')
            self.assertTrue(entry['url'].isascii())

    def test_collect_downloads_auto_files_and_preserves_previous_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'data').mkdir()
            # Keep the actual registry URLs; isolate the source set from unrelated live endpoints.
            sources = [dict(source, files=[entry]) for source, entry in evidence()]
            (root / 'data/sources.yaml').write_text(json.dumps({'sources': sources}))
            out = root / 'collected'
            first = out / sources[0]['files'][0]['path']
            first.parent.mkdir(parents=True)
            first.write_bytes(b'previous snapshot')
            urls = []

            def fetch(url, **kwargs):
                self.assertEqual(kwargs, {"timeout": 30, "tries": 1})
                urls.append(url)
                return b'%PDF-snapshot' if url.endswith('.pdf') or 'AJPERES' in url else b'PK-snapshot' if 'ec.europa.eu/document/' in url else b'<html>snapshot</html>'

            with patch.object(cli, 'ROOT', root), patch.object(cli, 'fetch', side_effect=fetch):
                code, result = cli.cmd_collect(argparse.Namespace(out=out))
            self.assertEqual(code, 0, result)
            self.assertEqual(result['ok'], 5)
            self.assertEqual(urls, [entry['url'] for _source, entry in evidence()])
            self.assertEqual(first.read_bytes(), b'previous snapshot')
            self.assertTrue(list(first.parent.glob(first.name + '.*')))
            rows = json.loads((out / 'snapshot.json').read_text())['collected']
            for row in rows:
                self.assertEqual(row['status'], 'ok')
                self.assertEqual(hashlib.sha256((out / row['file']).read_bytes()).hexdigest(), row['sha256'])

    def test_refetch_verifies_auto_snapshots_instead_of_marking_them_manual(self):
        rows = []
        payloads = {}
        for source, entry in evidence():
            data = b'PK-snapshot' if entry['path'].endswith('.xlsx') else b'%PDF-snapshot' if entry['path'].endswith('.pdf') else b'<html>snapshot</html>'
            payloads[entry['url']] = data
            rows.append(dict(path=entry['path'], source=source['id'], kind='source', acquisition='auto', url=entry['url'], sha256=hashlib.sha256(data).hexdigest()))
        manifest = json.dumps({'inputs': rows}).encode()
        with patch.object(cli, 'resolve_manifest', return_value=(manifest, None)), patch.object(cli, 'fetch', side_effect=lambda url: payloads[url]) as fetch:
            code, result = cli.cmd_refetch(argparse.Namespace(out=None))
        self.assertEqual(code, 0, result)
        self.assertEqual(fetch.call_count, 5)
        self.assertTrue(all(row['result'] == 'same' for row in result['sources']))


class SiteRetirementTest(unittest.TestCase):
    def test_site_install_removes_retired_files_and_preserves_other_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);site=root/'data/release';out=root/'candidate'
            (site/'mock').mkdir(parents=True)
            for name in ('measure-labels.json','tax-assumptions.json'):
                (site/'mock'/name).write_text('{"meta":{"status":"mock"}}')
            (site/'unrelated.txt').write_text('preserve')
            history=site/'releases/older/manifest.json';history.parent.mkdir(parents=True);history.write_text('preserve history')
            (out/'data').mkdir(parents=True)
            (out/'data/indirect-tax-parameters.json').write_text('{"meta":{"status":"real"}}')
            (out/'manifest.json').write_text('{}')
            (out/'validation.json').write_text('{}')
            (out/'receipt.json').write_text('{"built":"2026-11-08T00:00:00Z"}')
            rid=hashlib.sha256((out/'manifest.json').read_bytes()).hexdigest()
            with patch.object(cli,'ROOT',root):cli.publish_to_site(out,rid)
            self.assertFalse((site/'mock/measure-labels.json').exists())
            self.assertFalse((site/'mock/tax-assumptions.json').exists())
            self.assertTrue((site/'indirect-tax-parameters.json').exists())
            self.assertEqual((site/'unrelated.txt').read_text(),'preserve')
            self.assertEqual(history.read_text(),'preserve history')
            self.assertEqual(json.loads((site/'releases/current.json').read_text())['release_id'],rid)


if __name__ == '__main__':
    unittest.main()
