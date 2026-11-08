"""The JSON catalogue serves Python builders without JavaScript or Node."""
import json
from pathlib import Path
import tempfile
import unittest

from budget_pipeline.routes import CATALOGUE, load_routes
from budget_pipeline.build import catalog_refresh, editorial, guide
from budget_pipeline.validate.checks import Routes


class RouteCatalogue(unittest.TestCase):
    def test_defaults_and_explicit_empty_values(self):
        records = [
            ["S01", "home", "/", "home", "Начало", "start", "home"],
            ["S30", "missing", None, "missing", "Няма страница", "util", "help",
             {"next": [], "nav": False, "periods": "none", "bare": True}],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "routes.json"
            path.write_text(json.dumps({"groups": [], "routes": records}))
            home, missing = load_routes(path)
        self.assertEqual(home["samples"], ["#/"])
        self.assertEqual(home["next"], ["S01"])
        self.assertIsNone(home["step"])
        self.assertEqual(home["periods"], "all")
        self.assertEqual(home["query"], [])
        self.assertEqual(missing["samples"], [])
        self.assertEqual(missing["next"], [])
        self.assertFalse(missing["nav"])
        self.assertTrue(missing["bare"])

    def test_all_consumers_see_the_complete_catalogue_in_order(self):
        raw = json.loads(CATALOGUE.read_text())
        ids = [row[0] for row in raw["routes"]]
        self.assertEqual([r["id"] for r in load_routes()], ids)
        self.assertEqual([r["id"] for r in editorial.parse_routes()], ids)
        self.assertEqual(list(Routes().routes), ids)
        self.assertEqual(catalog_refresh.active_routes(), set(ids))

    def test_published_guide_and_links_resolve(self):
        published = json.loads(Path(guide.GUIDE).read_text())
        self.assertEqual(guide.check(published), [])
        matcher = Routes()
        self.assertEqual(matcher.match("#/prihodi/dds?year=2026"), "S06")
        self.assertEqual(matcher.match("#/vedomstvo/0200/0200.01.00"), "S11")
        self.assertEqual(matcher.match("#/za-proekta"), "S26")
        self.assertIsNone(matcher.match("#/nema-takav-ekran"))
        for href in editorial.SEE.values():
            self.assertIsNotNone(editorial.match_href(editorial.parse_routes(), href), href)

    def test_duplicate_ids_fail_instead_of_silently_losing_routes(self):
        record = ["S01", "home", "/", "home", "Начало", "start", "home"]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "routes.json"
            path.write_text(json.dumps({"routes": [record, record]}))
            with self.assertRaisesRegex(ValueError, "unique screen ids"):
                load_routes(path)
