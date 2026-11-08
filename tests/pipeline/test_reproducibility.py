"""Acquisition coverage, immutable snapshots and offline enforcement."""
import copy
import hashlib
import http.server
import os
import threading
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from budget_pipeline import cli
from budget_pipeline.sources.collect import collect
from budget_pipeline.validate.registry import gaps


class ReproducibilityTests(unittest.TestCase):
    def test_described_inputs_are_explicit_leaves(self):
        ds = [{"id": "test", "status": "real", "inputs": ["text", "number"]}]
        inter = [{"path": "text", "category": "described-input", "reproducible": False},
                 {"path": "number", "reproducible": False}]
        self.assertEqual(gaps(ds, inter), {"test": ["number"]})

    def test_missing_source_snapshot_is_not_a_closed_chain(self):
        ds = [{"id": "gva", "status": "real", "inputs": ["eurostat"],
               "rebuild": None, "notRebuilt": "historical snapshot missing"},
              {"id": "consumer", "status": "real", "inputs": ["gva"], "rebuild": "builder"},
              {"id": "closed", "status": "real", "inputs": ["eurostat"], "rebuild": "builder"}]
        result = gaps(ds, [])
        self.assertEqual(result["gva"], ["source-exception:gva"])
        self.assertEqual(result["consumer"], ["source-exception:gva"])
        self.assertEqual(result["closed"], [])
        self.assertEqual(sum(not v for v in result.values()), 1)

    def test_municipal_accounting_recomputes_rows_before_serialization(self):
        from budget_pipeline.extract import legacy_inputs as producer
        columns = ("total", "delegated", "equalizing", "winter_roads", "capital", "other_targeted")
        municipalities = [dict(region="region", name=str(i), name_in_dv=str(i), total=1.0,
                               delegated=1.0, equalizing=None, winter_roads=None,
                               capital=None, other_targeted=None) for i in range(265)]
        sums = dict.fromkeys(columns, 0.0)
        sums.update(total=265.0, delegated=265.0)
        original = {"count": 265, "columns": {}, "sums": sums,
                    "total_rows_in_law": [sums.copy()], "municipalities": municipalities}
        tables = {"annex9": {"rows": [{"label": "Основни бюджетни взаимоотношения - всичко", "values": [265.0]}]}}
        def execute(data):
            dv = {"zdb": {"art51": data, "dv": "law", "url": "https://example.org/law"}}
            with patch.object(producer, "DV", dv), patch.object(producer, "T", tables), patch.object(producer, "save") as save:
                producer.municipal()
                return save
        self.assertEqual(execute(original).call_count, 1)
        for mutation in ("row total", "balanced row", "other targeted", "row count", "stored count", "stored sums"):
            with self.subTest(mutation=mutation):
                data = copy.deepcopy(original)
                if mutation in ("row total", "balanced row"):
                    data["municipalities"][0]["total"] += 100
                if mutation == "balanced row":
                    data["municipalities"][0]["delegated"] += 100
                if mutation == "other targeted":
                    data["municipalities"][0]["other_targeted"] = 100
                if mutation == "row count":
                    data["municipalities"].pop()
                if mutation == "stored count":
                    data["count"] = 264
                if mutation == "stored sums":
                    data["sums"]["total"] += 100
                dv = {"zdb": {"art51": data}}
                with patch.object(producer, "DV", dv), patch.object(producer, "T", tables), patch.object(producer, "save") as save:
                    with self.assertRaises(SystemExit):
                        producer.municipal()
                    save.assert_not_called()

    def test_offline_rejects_socket(self):
        from budget_pipeline.offline import deny_network
        for event in ("socket.connect", "socket.getaddrinfo", "socket.bind"):
            with self.assertRaises(RuntimeError):
                deny_network(event, ())

    def test_guard_blocks_shell_network_and_unguarded_python(self):
        from budget_pipeline.offline import deny_network
        requests = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                self.send_response(200)
                self.end_headers()
            def log_message(self, *args):
                pass
        with http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with tempfile.TemporaryDirectory() as td:
                    url = "http://127.0.0.1:%d/" % server.server_port
                    Path(td, "network_probe.py").write_text(
                        "import subprocess\nsubprocess.run(['/bin/sh', '-c', "
                        + repr("curl --max-time 2 " + url) + "], check=True)\n")
                    env = dict(os.environ, PYTHONPATH=td + os.pathsep + str(cli.ROOT / "pipeline"))
                    result = subprocess.run([sys.executable, "-m", "budget_pipeline.offline", "network_probe"],
                                            env=env, capture_output=True, text=True, timeout=10)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("build subprocess must use guarded Python", result.stderr)
                    self.assertEqual(requests, [])
            finally:
                server.shutdown()
                thread.join()
        for executable, argv in ((sys.executable, [sys.executable, "-c", "pass"]),
                                 ("/bin/sh", ["/bin/sh", "-c", "true"])):
            with self.assertRaises(RuntimeError):
                deny_network("subprocess.Popen", (executable, argv, None, None))
        deny_network("subprocess.Popen", (sys.executable,
                     [sys.executable, "-m", "budget_pipeline.offline", "module"], None, None))

    def test_docker_build_run_has_no_network(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            lock = root / "pipeline/requirements.lock"
            lock.parent.mkdir()
            lock.write_text("locked")
            with patch.object(cli.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, b"", b"")) as run:
                cli.run_in_env("docker", root, root, ["-m", "budget_pipeline.offline", "module"])
            args = run.call_args_list[-1].args[0]
            self.assertEqual(args[args.index("--network") + 1], "none")

    def test_collect_includes_fetch_and_reducers_and_preserves_pins(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "data").mkdir()
            path = "data/originals/sample.json"
            digest = hashlib.sha256(b'{}').hexdigest()
            (root / "data/originals.sha256").write_text(digest + "  " + path + "\n")
            reg = {"sources": [{"id": "s", "acquisition": "fetch", "files": [
                {"path": path, "url": "https://example.org/file"},
                {"path": "data/cache/eurostat_pop_nuts3_bg.json", "url": "https://example.org/pop",
                 "via": "reducer", "sha256": digest}]}]}
            def reducer(refresh):
                from budget_pipeline.sources import boundaries
                boundaries.EUROSTAT_CACHE.parent.mkdir(parents=True, exist_ok=True)
                boundaries.EUROSTAT_CACHE.write_bytes(b'{}')
            with patch('budget_pipeline.sources.boundaries.fetch_eurostat', reducer):
                rows = collect(root, root / "out", root, lambda *a, **k: b'{}', cli.kind_ok,
                               cli.sha256_file, cli.sha256_bytes, lambda p: reg)
            self.assertEqual([r['drift'] for r in rows], ['same', 'same'])
            self.assertEqual((root / "data/originals.sha256").read_text(), digest + "  " + path + "\n")

    def test_success_then_invalid_response_preserves_immutable_receipt(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "data").mkdir()
            path = "data/originals/sample.json"
            digest = hashlib.sha256(b'{}').hexdigest()
            (root / "data/originals.sha256").write_text(digest + "  " + path + "\n")
            reg = {"sources": [{"id": "s", "acquisition": "fetch", "files": [
                {"path": path, "url": "https://example.org/file"}]}]}
            def acquire(blob):
                return collect(root, root / "out", root, lambda *a, **k: blob, cli.kind_ok,
                               cli.sha256_file, cli.sha256_bytes, lambda p: reg)
            acquire(b'{}')
            previous = json.loads((root / "out/snapshot.json").read_text())
            receipt = root / "out" / previous["receipt"]
            original_bytes = receipt.read_bytes()
            good = json.loads(original_bytes)["collected"][0]
            self.assertEqual(good["sha256"], digest)
            self.assertTrue(good["retrieved"])
            acquire(b'invalid json')
            latest = json.loads((root / "out/snapshot.json").read_text())
            self.assertNotEqual(latest["receipt"], previous["receipt"])
            self.assertEqual(latest["collected"][0]["status"], "unavailable")
            self.assertEqual(receipt.read_bytes(), original_bytes)
            self.assertEqual((root / "out" / good["file"]).read_bytes(), b'{}')
            self.assertEqual(len(list((root / "out/receipts").glob("*.json"))), 2)

    def test_failed_acquisition_does_not_retain_seed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            target = root / "data/originals/sample.json"
            target.parent.mkdir(parents=True)
            target.write_bytes(b'{}')
            (root / "data/originals.sha256").write_text("")
            reg = {"sources": [{"id": "s", "acquisition": "fetch", "files": [
                {"path": "data/originals/sample.json", "url": "https://example.org/file"}]}]}
            rows = collect(root, root / "out", root, lambda *a, **k: b'not json', cli.kind_ok,
                           cli.sha256_file, cli.sha256_bytes, lambda p: reg)
            self.assertEqual(rows[0]['status'], 'unavailable')
            self.assertEqual((root / "out/data/originals/sample.json").read_bytes(), b'{}')
            self.assertEqual(target.read_bytes(), b'{}')
