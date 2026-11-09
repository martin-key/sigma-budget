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
from budget_pipeline.build.budget_2027 import tables as budget_tables

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
PAIR_CELL_COUNT = 2  # Two independently rounded printed cells.
CEILING_2027_COLUMN = "0"  # Annexes 4–6: the first column is 2027.
JUDICIARY_ARTICLE = "2"  # Annex 5 prints the MF-recommended judiciary ceiling, not the judiciary's own budget.
EU_POLICY_TABLES = ("V_1", "V_2")  # Rows: EU funds, national co-financing, total.
EU_POLICY_TOTAL_ROW = 2
DEFENCE_TABLE = "III_2"  # Row 0: NATO-classified total of rows 1–4.
DEFENCE_PARTS = (1, 2, 3, 4)
TAX_EXPENDITURE_TABLE = "annex10"  # Rows 0–3: ДДС, акцизи, корпоративни, ДДФЛ; 4: total; 5: GDP; 6: % of GDP.
TAX_EXPENDITURE_TOTAL_ROW = 4
TAX_EXPENDITURE_GDP_ROW = 5
TAX_EXPENDITURE_RATIO_ROW = 6
WHOLE_THOUSAND_HALF_UNIT = Decimal("0.5")  # Annex 10 prints whole thousand euro.
RATIO_HALF_UNIT = Decimal("0.005")  # Annex 10 prints the ratio with two decimals.
NATIONAL_TABLE, EU_ACCOUNTS_TABLE = "II_2", "II_3"  # Row 0: revenue, grants and donations; columns 2025–2029.
KFP_REVENUE_ROW = 0
# Annex 6 rows printed again, by the same institution, in bill arts. 49, 16 and 11.
TRANSFER_ANNEX = "annex6"
# Annex 6 row -> published art. 49 row: БНТ, its чл. 70 part, БНР, its чл. 70 part, БТА.
ANNEX6_ART49 = {0: 2, 1: 3, 2: 0, 3: 1, 4: 4}
ANNEX6_ACADEMY_TOTAL, ANNEX6_ACADEMY, ANNEX6_UNIVERSITIES, ANNEX6_MILITARY = 5, 6, 7, 9
EDUCATION_ARTICLE, DEFENCE_ARTICLE = "16", "11"


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


def amount(cell):
    return Decimal(str(cell["value"]))


def close(check, actual, expected, cells, label, half=PRINTED_HALF_UNIT):
    check.ok(abs(actual - expected) <= half * cells, label)


def forecast_cell(output, table, row, column):
    return amount(output["forecast"][table][row]["cells"][str(column)])


def total_row(rows):
    totals = [row for row in rows if row["label"].upper().startswith("ВСИЧКО")]
    return totals[0] if len(totals) == 1 else None


def check_printed_table_totals(check, bill_output, output):
    """Each captioned bill table and art. 50: the numbered first-level rows sum to the printed „Всичко“."""
    printed = []
    for variant in BUDGET_VARIANTS:
        for article, item in output["budgets"][variant].items():
            for caption in item["captions"]:
                rows = item[caption["section"]][caption["first"] : caption["first"] + caption["count"]]
                budget_rows = bill_output["budgets"][variant][article]["rows"]
                printed.append((f"{variant}/{article}/{caption['section']}", rows, budget_rows))
    printed.append(("art. 50", output["articleTables"]["50"]["rows"], None))
    for label, rows, budget_rows in printed:
        total = total_row(rows)
        if not check.ok(total is not None, label + ": one printed total"):
            continue
        parts = [row for row in rows if row is not total and (row["no"] == "unprinted" or row["no"].count(".") <= 1)]
        parts = [row for row in parts if not row["label"].startswith(("А)", "Б)"))]  # art. 50 subgroups of row 5
        close(check, sum(amount(row["cell"]) for row in parts), amount(total["cell"]), len(parts) + 1,
              label + ": rows sum to the printed total")
        if budget_rows is not None and label.endswith("bodiesRows"):
            expenditure = next(row for row in budget_rows if row["no"] == "II.")
            close(check, amount(total["cell"]), amount(expenditure["cell"]), PAIR_CELL_COUNT,
                  label + ": judiciary bodies equal the budget's expenditure")


def check_ceiling_identities(check, bill_output, output):
    """Annexes 4 and 5 of the motives print, for 2027, the expenditure of each budget in the bill."""
    for article, ref in output["ceilingArticles"].items():
        if article == JUDICIARY_ARTICLE:
            continue
        ceiling = forecast_cell(output, ref["table"], ref["row"], CEILING_2027_COLUMN)
        expenditure = next(row for row in bill_output["budgets"]["bill"][article]["rows"] if row["no"] == "II.")
        close(check, ceiling, amount(expenditure["cell"]), PAIR_CELL_COUNT,
              f"art. {article}: 2027 ceiling ({ref['table']}) equals the bill's expenditure")


def check_transfer_identities(check, output):
    """Annex 6 of the motives against the bill tables of arts. 49, 16 and 11 (2027)."""
    art49 = output["articleTables"]["49"]["rows"]
    for row, published in ANNEX6_ART49.items():
        close(check, forecast_cell(output, TRANSFER_ANNEX, row, CEILING_2027_COLUMN), amount(art49[published]["cell"]),
              PAIR_CELL_COUNT, f"annex6 r{row}: equals art. 49 row {published}")
    education = output["budgets"]["bill"][EDUCATION_ARTICLE]["extraRows"]
    academy, total = education[0], total_row(education)
    close(check, forecast_cell(output, TRANSFER_ANNEX, ANNEX6_ACADEMY_TOTAL, CEILING_2027_COLUMN), amount(total["cell"]),
          PAIR_CELL_COUNT, "annex6: БАН and universities equal art. 16 total")
    close(check, forecast_cell(output, TRANSFER_ANNEX, ANNEX6_ACADEMY, CEILING_2027_COLUMN), amount(academy["cell"]),
          PAIR_CELL_COUNT, "annex6: БАН equals art. 16 row 1")
    close(check, forecast_cell(output, TRANSFER_ANNEX, ANNEX6_UNIVERSITIES, CEILING_2027_COLUMN),
          amount(total["cell"]) - amount(academy["cell"]), PAIR_CELL_COUNT + 1,
          "annex6: universities equal art. 16 total less БАН")
    military = total_row(output["budgets"]["bill"][DEFENCE_ARTICLE]["extraRows"])
    close(check, forecast_cell(output, TRANSFER_ANNEX, ANNEX6_MILITARY, CEILING_2027_COLUMN), amount(military["cell"]),
          PAIR_CELL_COUNT, "annex6: military universities equal art. 11 total")


def check_forecast_tables(check, output, tables):
    """Printed totals of the newly published АСБП tables, on the published cells."""
    for table in EU_POLICY_TABLES:
        for column in output["forecast"][table][EU_POLICY_TOTAL_ROW]["cells"]:
            parts = [forecast_cell(output, table, row, column) for row in range(EU_POLICY_TOTAL_ROW)]
            close(check, sum(parts), forecast_cell(output, table, EU_POLICY_TOTAL_ROW, column), len(parts) + 1,
                  f"{table} c{column}: EU funds plus co-financing equal the total")
    for column in output["forecast"][DEFENCE_TABLE][0]["cells"]:
        parts = [tables[DEFENCE_TABLE]["rows"][row]["values"][int(column)] for row in DEFENCE_PARTS]
        printed = [Decimal(str(value)) for value in parts if value is not None]
        close(check, sum(printed), forecast_cell(output, DEFENCE_TABLE, 0, column), len(parts) + 1,
              f"{DEFENCE_TABLE} c{column}: NATO total equals its printed parts")
    for column in output["forecast"][TAX_EXPENDITURE_TABLE][TAX_EXPENDITURE_TOTAL_ROW]["cells"]:
        parts = [forecast_cell(output, TAX_EXPENDITURE_TABLE, row, column) for row in range(TAX_EXPENDITURE_TOTAL_ROW)]
        total = forecast_cell(output, TAX_EXPENDITURE_TABLE, TAX_EXPENDITURE_TOTAL_ROW, column)
        close(check, sum(parts), total, len(parts) + 1, f"annex10 c{column}: tax expenditures total",
              half=WHOLE_THOUSAND_HALF_UNIT)
        ratio = total / forecast_cell(output, TAX_EXPENDITURE_TABLE, TAX_EXPENDITURE_GDP_ROW, column) * 100
        close(check, ratio, forecast_cell(output, TAX_EXPENDITURE_TABLE, TAX_EXPENDITURE_RATIO_ROW, column), 1,
              f"annex10 c{column}: printed share of GDP", half=RATIO_HALF_UNIT)
    for column in output["forecast"][NATIONAL_TABLE][KFP_REVENUE_ROW]["cells"]:
        kfp = Decimal(str(tables[AMOUNT_TABLE]["rows"][REVENUE_TOTAL_ROW]["values"][int(column)]))
        parts = forecast_cell(output, NATIONAL_TABLE, KFP_REVENUE_ROW, column) + forecast_cell(
            output, EU_ACCOUNTS_TABLE, KFP_REVENUE_ROW, column
        )
        close(check, parts, kfp, PAIR_CELL_COUNT + 1,
              f"{NATIONAL_TABLE}+{EU_ACCOUNTS_TABLE} c{column}: national budget plus EU accounts revenue equals Annex 3 КФП")


def g_budget_2027(ctx):
    check = Check("BUDGET2027")
    lineage = Lineage()
    expected = annual(lineage)
    built_bill = budget(lineage)
    built_tables = budget_tables(lineage)
    for name, records in expected.items():
        actual = ctx.get(name + ".json").get("byPeriod")
        check.ok(actual is not None, name + ": byPeriod required in the current release")
        for period in PERIODS:
            check.ok(
                actual is not None and actual.get(period) == records[period],
                name + " " + period + ": exact cells, metadata and sparse coverage",
            )
    check.ok(ctx.get("budget2027.json") == built_bill, "bill: exact source variants, periods, units and coverage")
    check.ok(ctx.get("budget2027-tables.json") == built_tables, "tables: exact captioned rows, annex tables and ceilings")
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
    # The printed identities run on the published files: they check what the site serves.
    published_bill, published_tables = ctx.get("budget2027.json"), ctx.get("budget2027-tables.json")
    try:
        check.ok(
            set(published_tables["ceilingArticles"])
            == {str(article) for article in BUDGET_ARTICLES} - {STATE_BUDGET_ARTICLE},
            "every institutional budget has one 2027–2029 ceiling row",
        )
        check_printed_table_totals(check, published_bill, published_tables)
        check_ceiling_identities(check, published_bill, published_tables)
        check_transfer_identities(check, published_tables)
        check_forecast_tables(check, published_tables, lineage.inputs["F"]["tables"])
    except (KeyError, IndexError, TypeError, StopIteration) as error:
        check.fail("tables: printed identities cannot resolve: " + repr(error))
    return check


GROUPS = [("BUDGET2027", g_budget_2027, "2027 annual periods, frozen pointers and printed totals")]
