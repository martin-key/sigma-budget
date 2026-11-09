"""Active additive annual contract, pointer, lineage and printed identity checks."""

from decimal import Decimal
from itertools import chain

from budget_pipeline.build.annual_periods import (
    AMOUNT_TABLE,
    ANNUAL_COLUMNS,
    BALANCE_ROW,
    DOCUMENT_NAMES,
    EXPENDITURE_TOTAL_ROW,
    EXPENDITURE_WITHOUT_EU_ROW,
    FINANCING_ROW,
    FUNCTION_AMOUNT_COLUMN_OFFSET,
    FUNCTION_ROWS,
    FUNCTION_TABLE,
    PERIODS,
    REVENUE_GROUP_ROWS,
    REVENUE_TOTAL_ROW,
    Lineage,
    annual,
    pointer,
)
from budget_pipeline.build.budget_2027 import BILLION_EURO_AMOUNT, BUDGET_VARIANTS, MUNICIPAL_SECTIONS, budget

from .annual_oracles import check_law_identities, check_output_oracles
from .checks import Check

PRINTED_HALF_UNIT = Decimal("0.05")  # Half the final decimal in printed million/thousand-euro cells.
REVENUE_TOTAL_PARTS = tuple(chain.from_iterable(REVENUE_GROUP_ROWS.values()))  # Annex 3: the eight revenue groups.
FUNCTION_IDENTITY_CELL_COUNT = (
    len(FUNCTION_ROWS) + 1
)  # III-1 functions and Annex 3 expenditure without EU contribution.
STATE_BUDGET_ARTICLE = "1"  # Article 1 records outgoing transfers; institutional budgets record incoming transfers.
BUDGET_ARTICLES = range(1, 49)  # Bill articles 1–48: the state budget and 47 institutional budgets.
MC_ALTERNATIVE_ARTICLES = {"1", "2"}  # MC alternatives for the state budget and judiciary.
PROJECT_COUNT = 226  # Annex 2: unique investment projects.
MUNICIPALITY_COUNT = 265  # Art. 52/53: unique region/municipality identities.
BILL_BALANCE_CELL_COUNT = 5  # Revenue, expenditure, transfers, EU contribution and printed balance.
POLICY_IDENTITY_CELL_COUNT = 2  # Printed policy total and budget expenditure.
MUNICIPAL_TOTAL_COLUMN = 0  # Art. 52: total transfers; remaining columns are its four parts.
MUNICIPAL_FIRST_PART_COLUMN = 1  # Art. 52: delegated, equalizing, winter roads and capital transfers.
MUNICIPAL_IDENTITY_CELL_COUNT = 5  # Art. 52: total plus its four parts.


def output_value(ctx, entry):
    filename, path = entry["output"].split("#")
    return pointer(ctx.get(filename), path)


def source_value(lineage, documents, entry):
    document_name = entry["document"]
    document = documents[document_name]
    kind = next(kind for kind, name in DOCUMENT_NAMES.items() if name == document_name)
    if document["input"] != lineage.documents[document_name]["input"]:
        raise ValueError(f"Wrong extraction input for {document_name}")
    return pointer(lineage.inputs[kind], entry["extraction"])


def calculated_value(ctx, lineage, documents, entries, entry):
    if entry.get("operation") == "parse-billion-euro":
        text = source_value(lineage, documents, entry)
        amount = BILLION_EURO_AMOUNT.findall(text)[0]
        return Decimal(amount.replace(",", "."))
    if "operation" in entry:
        values = []
        for provenance_id in entry["operands"]:
            operand = output_value(ctx, entries[provenance_id])
            values.append(Decimal(str(operand["value"])))
        return sum(values) if entry["operation"] == "sum" else values[0] - values[1]
    return Decimal(str(source_value(lineage, documents, entry)))


def check_lineage(check, ctx, lineage):
    index = ctx.get("budget2027-provenance.json")
    documents = index["documents"]
    entries = index["entries"]
    check.ok(documents == lineage.documents, "provenance: exact documents and checksums")
    check.ok(entries == lineage.entries, "provenance: exact index, physical cells and operand coverage")
    for provenance_id, entry in entries.items():
        if not check.ok(entry.get("document") in documents, provenance_id + ": document reference"):
            continue
        try:
            cell = output_value(ctx, entry)
        except (KeyError, IndexError, TypeError):
            check.fail(provenance_id + ": unresolved output pointer")
            continue
        check.ok(
            cell["provenance"] == provenance_id and cell["unit"] == entry["unit"], provenance_id + ": output pointer"
        )
        result = calculated_value(ctx, lineage, documents, entries, entry)
        check.ok(Decimal(str(cell["value"])) == result, provenance_id + ": extraction/operation value")


def printed_identity(check, tables, table, column, total, parts, signs=None):
    rows = tables[table]["rows"]
    values = [Decimal(str(rows[row]["values"][column])) for row in [total] + list(parts)]
    signs = signs or [1] * len(parts)
    components = Decimal(0)
    for value, sign in zip(values[1:], signs):
        components += value * sign
    error = values[0] - components
    check.ok(
        abs(error) <= PRINTED_HALF_UNIT * len(values),
        f"{table} c{column}: {total} = {list(parts)}, Decimal printed intervals",
    )


def check_forecast_identities(check, tables):
    for column in ANNUAL_COLUMNS.values():
        printed_identity(
            check, tables, AMOUNT_TABLE, column, BALANCE_ROW, [REVENUE_TOTAL_ROW, EXPENDITURE_TOTAL_ROW], [1, -1]
        )
        printed_identity(check, tables, AMOUNT_TABLE, column, FINANCING_ROW, [BALANCE_ROW], [-1])
        printed_identity(check, tables, AMOUNT_TABLE, column, REVENUE_TOTAL_ROW, REVENUE_TOTAL_PARTS)
        values = []
        for row in FUNCTION_ROWS:
            amount = tables[FUNCTION_TABLE]["rows"][row]["values"][column + FUNCTION_AMOUNT_COLUMN_OFFSET]
            values.append(Decimal(str(amount)))
        total = Decimal(str(tables[AMOUNT_TABLE]["rows"][EXPENDITURE_WITHOUT_EU_ROW]["values"][column]))
        check.ok(
            abs(sum(values) - total) <= PRINTED_HALF_UNIT * FUNCTION_IDENTITY_CELL_COUNT,
            f"functions c{column}: sum equals expenditure excluding EU contribution",
        )


def check_bill_identities(check, bill):
    for variant in BUDGET_VARIANTS:
        for article, item in bill[variant].items():
            headline = item["headline"]
            if all(headline.get(key) is not None for key in ("rev", "exp", "transfers", "balance")):
                revenue = Decimal(str(headline["rev"]))
                expenditure = Decimal(str(headline["exp"]))
                transfers = Decimal(str(headline["transfers"]))
                eu_contribution = Decimal(str(headline.get("eucontrib") or 0))
                signed_transfers = -transfers if article == STATE_BUDGET_ARTICLE else transfers
                balance = Decimal(str(headline["balance"]))
                error = revenue - expenditure + signed_transfers - eu_contribution - balance
                check.ok(
                    abs(error) <= PRINTED_HALF_UNIT * BILL_BALANCE_CELL_COUNT,
                    variant + "/" + article + ": printed budget balance",
                )
            if item.get("policyTotal") is not None and headline.get("exp") is not None:
                error = Decimal(str(item["policyTotal"])) - Decimal(str(headline["exp"]))
                check.ok(
                    abs(error) <= PRINTED_HALF_UNIT * POLICY_IDENTITY_CELL_COUNT,
                    variant + "/" + article + ": policies equal expenditure",
                )


def check_municipal_identities(check, bill):
    for section in MUNICIPAL_SECTIONS:
        rows = bill["municipal"][section]["rows"]
        identities = {(row["region"], row["name"]) for row in rows}
        check.ok(
            len(rows) == MUNICIPALITY_COUNT and len(identities) == MUNICIPALITY_COUNT,
            section + ": 265 unique identities",
        )
        for column, total in enumerate(bill["municipal"][section]["total"]):
            actual = sum(Decimal(str(row["values"][column])) for row in rows)
            check.ok(
                abs(actual - Decimal(str(total))) <= PRINTED_HALF_UNIT * (len(rows) + 1),
                section + ": printed column sum " + str(column),
            )
    for row in bill["municipal"]["art52"]["rows"]:
        total = Decimal(str(row["values"][MUNICIPAL_TOTAL_COLUMN]))
        parts = sum(Decimal(str(value)) for value in row["values"][MUNICIPAL_FIRST_PART_COLUMN:])
        check.ok(
            abs(total - parts) <= PRINTED_HALF_UNIT * MUNICIPAL_IDENTITY_CELL_COUNT,
            row["name"] + ": transfer parts",
        )


def g_budget_2027(ctx):
    check = Check("BUDGET2027")
    lineage = Lineage()
    expected = annual(lineage)
    built_bill = budget(lineage)
    for name, records in expected.items():
        actual = ctx.get(name + ".json").get("byPeriod")
        check.ok(actual is not None, name + ": byPeriod required in the current release")
        for period in PERIODS:
            check.ok(
                actual is not None and actual.get(period) == records[period],
                name + " " + period + ": exact cells, metadata and sparse coverage",
            )
    check.ok(ctx.get("budget2027.json") == built_bill, "bill: exact source variants, periods, units and coverage")
    check_output_oracles(check, ctx)
    check_law_identities(check, ctx)
    check_lineage(check, ctx, lineage)
    check_forecast_identities(check, lineage.inputs["F"]["tables"])
    bill = lineage.inputs["B"]
    check.ok(
        set(built_bill["budgets"]["bill"]) == {str(article) for article in BUDGET_ARTICLES},
        "48 articles, including 47 institutional budgets",
    )
    check.ok(set(built_bill["budgets"]["billMc"]) == MC_ALTERNATIVE_ARTICLES, "two MC alternatives remain separate")
    check.ok(
        len(built_bill["projects"]) == PROJECT_COUNT
        and len({project["id"] for project in built_bill["projects"]}) == PROJECT_COUNT,
        "226 unique projects",
    )
    check_bill_identities(check, bill)
    check_municipal_identities(check, bill)
    return check


GROUPS = [("BUDGET2027", g_budget_2027, "2027 annual periods, frozen pointers and printed totals")]
