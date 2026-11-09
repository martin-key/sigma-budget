"""Independent, manually transcribed PDF cells bound to published JSON addresses."""

import json
import re
from collections import Counter
from decimal import Decimal
from pathlib import Path

ORACLE_PATH = Path(__file__).with_name("fixtures") / "budget_2027_cells.json"


def load_oracles():
    return json.loads(ORACLE_PATH.read_text(encoding="utf-8"))["cells"]


def resolve(obj, path):
    for key in path.split("/")[1:]:
        key = key.replace("~1", "/").replace("~0", "~")
        obj = obj[int(key)] if isinstance(obj, list) else obj[key]
    return obj


def printed_decimal(text):
    match = re.match(r"[−-]?\s*\d[\d\s\u00a0]*(?:[,.]\d+)?", text.strip())
    if match is None:
        raise ValueError("Not a printed number: " + text)
    normalized = re.sub(r"\s", "", match.group()).replace("−", "-").replace(",", ".")
    return Decimal(normalized)


def leaf_records(entries, identifier, ancestors=()):
    if identifier in ancestors:
        raise ValueError("Cyclic provenance operands: " + identifier)
    entry = entries[identifier]
    if "operands" not in entry:
        return [entry]
    leaves = []
    for operand in entry["operands"]:
        leaves.extend(leaf_records(entries, operand, ancestors + (identifier,)))
    return leaves


def check_output_oracles(check, ctx):
    """Check published cells without invoking a builder or importing its row/column constants."""
    index = ctx.get("budget2027-provenance.json")
    for oracle in load_oracles():
        address = oracle["output"]
        filename, path = address.split("#")
        try:
            cell = resolve(ctx.get(filename), path)
            entry = index["entries"][cell["provenance"]]
            leaves = leaf_records(index["entries"], cell["provenance"])
            check.ok(Decimal(str(cell["value"])) == Decimal(oracle["value"]), address + ": independent PDF value")
            check.ok(cell["unit"] == oracle["unit"], address + ": independent PDF unit")
            check.ok(entry["output"] == address, address + ": independent output address")
            check.ok(entry["period"] == oracle["period"], address + ": independent period")
            check.ok(entry["document"] == oracle["document"], address + ": independent document")
            expected = Counter()
            for source in oracle["sources"]:
                expected[(oracle["document"], source["page"], printed_decimal(source["printed"]))] += 1
            actual = Counter()
            for leaf in leaves:
                actual[(leaf["document"], leaf["page"], printed_decimal(leaf["printed"]))] += 1
            check.ok(actual == expected, address + ": independent PDF pages and printed operands")
        except (KeyError, IndexError, TypeError, ValueError) as error:
            check.fail(address + ": independent PDF oracle cannot resolve: " + str(error))


def check_law_identities(check, ctx):
    series = ctx.get("outlook.json")["byPeriod"]["2026.law"]["series"]
    revenue = Decimal(str(series["revenue"]["value"]))
    expenditure = Decimal(str(series["expenditure"]["value"]))
    balance = Decimal(str(series["balance"]["value"]))
    interest = Decimal(str(series["interest"]["value"]))
    primary = Decimal(str(series["primaryBalance"]["value"]))
    # Three independently rounded printed cells, each with half a final decimal unit.
    check.ok(
        abs(revenue - expenditure - balance) <= Decimal("0.05") * 3,
        "2026.law: published revenue - expenditure = balance",
    )
    # Primary balance is derived, so this identity is exact rather than another printed rounding interval.
    check.ok(
        balance + interest == primary,
        "2026.law: published balance + interest = primary balance",
    )
