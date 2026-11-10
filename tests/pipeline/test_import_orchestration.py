"""Focused offline import acceptance; full candidate build is explicitly opt-in.

Set BUDGET_IMPORT_INPUTS to an already acquired input snapshot and
BUDGET_IMPORT_OUT to an owned scratch directory. No fetch or --site operation.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from budget_pipeline import cli
from budget_pipeline.sources import prepare_inputs as prepare


class ImportGateTests(unittest.TestCase):
    def test_validate_uses_the_candidate_build_date(self):
        manifest = {'processing': {'parameters': {'build_date': '2026-11-10'}}}
        result = subprocess.CompletedProcess([], 0, b'RESULT OK: 1 checks, 0 problems, 0 warnings, 0 s', b'')
        with patch.object(cli, 'check_release_dir', return_value=('a'*64, manifest, [])), \
                patch.dict(os.environ, {'BUILD_DATE': '1999-01-01'}), \
                patch.object(cli.subprocess, 'run', return_value=result) as run:
            code, _ = cli.cmd_validate(SimpleNamespace(site=False, release='/unused-candidate'))
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(run.call_args.kwargs['env']['BUILD_DATE'], '2026-11-10')

    def test_missing_is_generated_existing_is_checked_and_evidenced(self):
        with tempfile.TemporaryDirectory() as td, patch.object(prepare, 'ROOT', Path(td)), \
                patch.object(prepare, 'verify_budget_2027_sources'):
            root = Path(td)
            def reader(args, **kwargs):
                producer = args[3]
                path = root / dict(prepare.EXTRACTIONS_2027)[producer]
                if '--check' not in args:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(json.dumps({'source': {'member': producer}}))
            with patch.object(prepare.subprocess, 'run', side_effect=reader) as run:
                prepare.prepare_budget_2027()
                first = json.loads((root / prepare.EVIDENCE_2027).read_text())
                self.assertEqual([x['action'] for x in first], ['generated', 'generated'])
                prepare.prepare_budget_2027()
                self.assertTrue(all('--check' in c.args[0] for c in run.call_args_list[2:]))
                for item in json.loads((root / prepare.EVIDENCE_2027).read_text()):
                    self.assertEqual(item['action'], 'verified')
                    self.assertEqual(item['sha256'], cli.sha256_file(root / item['path']))
                self.assertTrue(all(c.args[0][1:3] == ['-m', 'budget_pipeline.offline']
                                    for c in run.call_args_list))

    def test_reader_failure_cannot_be_accepted(self):
        with tempfile.TemporaryDirectory() as td, patch.object(prepare, 'ROOT', Path(td)), \
                patch.object(prepare, 'verify_budget_2027_sources'):
            with patch.object(prepare.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'reader')):
                with self.assertRaises(subprocess.CalledProcessError):
                    prepare.prepare_budget_2027()
            self.assertFalse((Path(td) / prepare.EVIDENCE_2027).exists())

    def test_acquisition_record_cannot_repin_an_unreviewed_source(self):
        with tempfile.TemporaryDirectory() as td, patch.object(prepare, 'ROOT', Path(td)):
            root = Path(td)
            folder = root / 'data/originals/budget_2027'
            folder.mkdir(parents=True)
            (folder / 'ZDBRB-2027.zip').write_bytes(b'pinned ZIP')
            record = folder / 'acquisition.json'
            record.write_bytes(b'pinned acquisition')
            sums = '\n'.join(cli.sha256_file(p) + '  ' + p.relative_to(root).as_posix() for p in folder.iterdir())
            (root / 'data/originals.sha256').write_text(sums + '\n')
            prepare.verify_budget_2027_sources()
            record.write_bytes(b'repinned acquisition')
            with self.assertRaises(ValueError):
                prepare.verify_budget_2027_sources()

    def test_build_refuses_checkout_or_input_data_as_output_before_removal(self):
        with tempfile.TemporaryDirectory() as td, patch.object(cli, 'git', return_value='a'*40):
            for output in (cli.ROOT, cli.ROOT / 'data/release', cli.ROOT / 'data/inputs',
                           Path(td) / 'data', Path(td)):
                with self.subTest(output=output), self.assertRaises(cli.Fail):
                    cli.build_release('HEAD', Path(td), output, '2026-11-10', 'local')


@unittest.skipUnless(os.environ.get('BUDGET_IMPORT_INPUTS') and os.environ.get('BUDGET_IMPORT_OUT'),
                     'set BUDGET_IMPORT_INPUTS and BUDGET_IMPORT_OUT for real offline acceptance')
class FunctionalImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inputs = Path(os.environ['BUDGET_IMPORT_INPUTS']).resolve()
        cls.scratch = Path(os.environ['BUDGET_IMPORT_OUT']).resolve()
        cls.scratch.mkdir(parents=True, exist_ok=True)
        cls.before = cls.checkout_hashes()
        cls.candidate = cls.scratch / 'candidate'
        cls.rid, cls.manifest = cli.build_release('HEAD', cls.inputs, cls.candidate, '2026-11-10', 'local')

    @classmethod
    def checkout_hashes(cls):
        return {str(p.relative_to(cli.ROOT)): cli.sha256_file(p)
                for folder in ('originals', 'inputs', 'release')
                for p in (cli.ROOT / 'data' / folder).rglob('*') if p.is_file()}

    @classmethod
    def tearDownClass(cls):
        if cls.before != cls.checkout_hashes():
            raise AssertionError('candidate build changed checkout originals, inputs or release')

    def test_candidate_has_real_reader_evidence_and_independent_output_values(self):
        self.assertEqual(cli.check_release_dir(self.candidate)[2], [])
        self.assertEqual(self.manifest['coverage']['missingInputs'], [])
        for item in self.manifest['processing']['extractions']:
            self.assertEqual(item['action'], 'verified')
            self.assertEqual(item['sha256'], cli.sha256_file(cli.ROOT / item['path']))
        validation = json.loads((self.candidate / 'validation.json').read_text())
        self.assertTrue(validation['passed'])
        self.assertTrue(any(g['group'] == 'BUDGET2027' and g['status'] == 'OK' for g in validation['groups']))
        reference = os.environ.get('BUDGET_IMPORT_REFERENCE')
        if reference:
            # Retained independently exercised candidate, not today's builders.
            for output in self.manifest['outputs']:
                if output['path'].startswith('data/'):
                    self.assertEqual((self.candidate / output['path']).read_bytes(),
                                     (Path(reference) / output['path']).read_bytes(), output['path'])

    def test_independent_printed_cell_oracle_rejects_numerical_change(self):
        from budget_pipeline.validate.annual_oracles import check_output_oracles
        from budget_pipeline.validate.checks import Check
        data = {p.name: json.loads(p.read_text()) for p in (self.candidate / 'data').glob('*.json')}
        class Memory:
            def get(self, path):
                return data[path]
        good = Check('PDF_OUTPUTS')
        check_output_oracles(good, Memory())
        self.assertEqual(good.problems, [])
        data['outlook.json']['byPeriod']['2027.draft']['series']['revenue']['value'] += 1
        bad = Check('PDF_OUTPUTS')
        check_output_oracles(bad, Memory())
        self.assertTrue(bad.problems, 'independently transcribed PDF cells must reject +1 revenue')

    def test_corrupted_registered_source_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=self.scratch) as td:
            root = Path(td)
            path = 'data/originals/budget_2027/ZDBRB-2027.zip'
            target = root / path
            target.parent.mkdir(parents=True)
            target.write_bytes((self.inputs / path).read_bytes() + b'corrupt')
            with self.assertRaises(cli.Fail) as error:
                cli.build_release('HEAD', root, root / 'candidate', '2026-11-10', 'local')
            self.assertIn('inputs differ from their pins', str(error.exception))
            self.assertFalse((root / 'candidate/manifest.json').exists())

    def test_missing_extractions_regenerate_and_stale_extraction_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=self.scratch) as td:
            root = Path(td)
            cli.export_commit('HEAD', root)
            for _, path in prepare.EXTRACTIONS_2027:
                (root / path).unlink()
            env = dict(os.environ, PYTHONPATH=str(root / 'pipeline'), PYTHONDONTWRITEBYTECODE='1')
            args = [sys.executable, '-m', 'budget_pipeline.offline',
                    'budget_pipeline.sources.prepare_inputs', '--budget-2027-only']
            result = subprocess.run(args, cwd=root, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            evidence = json.loads((root / prepare.EVIDENCE_2027).read_text())
            self.assertEqual([x['action'] for x in evidence], ['generated', 'generated'])
            for _, path in prepare.EXTRACTIONS_2027:
                self.assertEqual((root / path).read_bytes(), (cli.ROOT / path).read_bytes())
            stale = root / prepare.EXTRACTIONS_2027[0][1]
            blob = json.loads(stale.read_text())
            blob['tables']['annex3_mln']['rows'][0]['values'][2] += 1
            stale.write_text(json.dumps(blob))
            before = stale.read_bytes()
            result = subprocess.run(args, cwd=root, env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('frozen extraction differs', result.stdout + result.stderr)
            self.assertEqual(stale.read_bytes(), before)
            self.assertFalse((root / prepare.EVIDENCE_2027).exists())


if __name__ == '__main__':
    unittest.main()
