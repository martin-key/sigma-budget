"""Independent output-address oracles, verified directly against the pinned PDF text."""

import copy
import hashlib
import re
import unittest
import zipfile
from decimal import Decimal
from unittest.mock import patch

import fitz

from budget_pipeline.build import annual_periods
from budget_pipeline.build.budget_2027 import budget
from budget_pipeline.build.data_io import ROOT
from budget_pipeline.validate.annual_oracles import check_output_oracles, load_oracles, printed_decimal
from budget_pipeline.validate.budget_2027 import g_budget_2027
from budget_pipeline.validate.checks import Check

DOCUMENTS = {
    "forecast": (
        "ZDBRB-2027/4-UMTBF-2027-2029-motivi.pdf",
        "8d0c4577efd9ca8805ce785fb5a2144518a30cb285d2a217744322bb646c10ac",
    ),
    "bill": ("ZDBRB-2027/3-PZDBRB-2027.pdf", "7d8dae763e9a69080f1c9a5e98666bd7dd08ca6162f1da9107de121170d5c119"),
}
NUMBER = re.compile(r"(?<![\w.])[−-]?\d+(?:[ \u00a0]\d{3})*(?:[,.]\d+)?%?")


class Memory:
    def __init__(self, data):
        self.data = data

    def get(self, name):
        return self.data[name]


def memory_build():
    lineage = annual_periods.Lineage()
    data = {name + ".json": {"byPeriod": records} for name, records in annual_periods.annual(lineage).items()}
    data["budget2027.json"] = budget(lineage)
    data["budget2027-provenance.json"] = {"documents": lineage.documents, "entries": lineage.entries}
    return Memory(data)


def row_numbers(lines, source):
    label = source["label"]
    mode = source.get("labelMode", "row")
    candidates = []
    for line in lines:
        text = line.strip()
        if mode == "contains":
            if label not in text:
                continue
            tail = text.split(label, 1)[1]
        elif mode == "prose":
            if not text.startswith(label):
                continue
            tail = text[len(label) :]
            if source["unitText"] not in tail:
                continue
        else:
            # Match the full printed row label, not another number on the same page.
            first_number = NUMBER.search(text)
            if not first_number:
                continue
            prefix = text[: first_number.start()].strip()
            prefix = re.sub(r"^(?:I{1,3}|IV|V)\.\s*", "", prefix)
            if re.sub(r"\s+", " ", prefix).casefold() != label.casefold():
                continue
            tail = text[first_number.start() :]
        candidates.append(NUMBER.findall(tail))
    return candidates[source["occurrence"]]


class OutputOraclesTest(unittest.TestCase):
    def test_hand_transcribed_sources_and_explicit_output_addresses(self):
        ctx = memory_build()
        pages = {}
        with zipfile.ZipFile(ROOT / "data/originals/budget_2027/ZDBRB-2027.zip") as archive:
            for name, (member, checksum) in DOCUMENTS.items():
                blob = archive.read(member)
                self.assertEqual(hashlib.sha256(blob).hexdigest(), checksum)
                with fitz.open(stream=blob, filetype="pdf") as pdf:
                    pages[name] = [page.get_text(sort=True).splitlines() for page in pdf]
        for oracle in load_oracles():
            values = []
            for source in oracle["sources"]:
                with self.subTest(output=oracle["output"], page=source["page"]):
                    numbers = row_numbers(pages[oracle["document"]][source["page"] - 1], source)
                    actual = printed_decimal(numbers[source["column"]])
                    self.assertEqual(actual, printed_decimal(source["printed"]))
                    values.append(actual)
            if oracle.get("operation") == "sum":
                self.assertEqual(sum(values), Decimal(oracle["value"]))
            else:
                self.assertEqual(values[0], Decimal(oracle["value"]))
        check = Check("PDF_OUTPUTS")
        check_output_oracles(check, ctx)
        self.assertEqual(check.problems, [])

    def test_builder_row_mutation_fails_active_validator(self):
        # Mutate the producer, rebuild, and let the active validator use that same mutant producer.
        with patch.object(annual_periods, "LAW_EXPENDITURE_ROW", 9):
            ctx = memory_build()
            self.assertEqual(ctx.get("outlook.json")["byPeriod"]["2026.law"]["series"]["expenditure"]["value"], 54465.9)
            check = g_budget_2027(ctx)
        self.assertTrue(
            any("independent PDF value" in error and "/series/expenditure" in error for error in check.problems)
        )
        self.assertIn("2026.law: published revenue - expenditure = balance", check.problems)

    def test_wrong_page_unit_or_period_fails_independent_oracles(self):
        baseline = memory_build().data
        for field, value in (("page", 175), ("period", "2026.expected"), ("unit", "хил. €")):
            ctx = Memory(copy.deepcopy(baseline))
            cell = ctx.get("outlook.json")["byPeriod"]["2026.law"]["series"]["expenditure"]
            entry = ctx.get("budget2027-provenance.json")["entries"][cell["provenance"]]
            if field == "unit":
                cell[field] = value
            else:
                entry[field] = value
            check = Check("PDF_OUTPUTS")
            check_output_oracles(check, ctx)
            self.assertTrue(check.problems, field)
