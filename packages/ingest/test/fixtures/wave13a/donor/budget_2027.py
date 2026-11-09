"""Compact adapters for the bill, its MC alternatives and forecast context."""

import hashlib
import re

from .annual_periods import PUBLICATION, pointer
from .data_io import meta

BUDGET_VARIANTS = ("bill", "billMc")
BUDGET_SECTIONS = ("rows", "policiesRows", "commitmentRows")
MUNICIPAL_SECTIONS = ("art52", "art53")
PROJECT_PERIODS = ("2027.draft", "2028.forecast", "2029.forecast")
FORECAST_PERIODS = {
    2026: "2026.expected",
    2027: "2027.draft",
    2028: "2028.forecast",
    2029: "2029.forecast",
}
FORECAST_TABLES = ("II_5", "II_7", "II_8", "VI_1", "VI_2", "annex9")
MUNICIPAL_FIRST_VALUE_COLUMN = 1  # Art. 52/53: first numeric ordinal after the municipality name.
PROJECT_FIRST_VALUE_COLUMN = 3  # Annex 2: raw columns 3/4/5 contain 2027/2028/2029 capital expenditure.
DEBT_LIMIT_ARTICLES = ("66", "67", "68")  # Fiscal reserve, year-end debt ceiling, new borrowing ceiling.
DEBT_LIMIT_PARAGRAPH = 0  # Each ceiling is printed in the first paragraph of its article.
BILL_COLUMN_LABEL = "Сума (хил. евро)"
BILL_UNIT = "хил. €"
DEFAULT_PERIOD = "2027.draft"
BILL_VARIANT = "bill"
BILL_ROW_NUMBER = re.compile(r"/(?:rows|policiesRows|commitmentRows)/(\d+)/")
BILLION_EURO_AMOUNT = re.compile(r"(\d+(?:,\d+)?)\s+млрд\. евро")
SOURCE_NOTE = "МФ, публикация от 06.11.2026."


def normal(text):
    return re.sub(r"\s+", "", text).replace("–", "-")


def numeric_cell(text):
    normalized = normal(text or "")
    return 0.0 if normalized == "-" else float(normalized.replace(",", "."))


def matching_physical_cells(bill, row, value_path, value, column):
    candidates = []
    pages = row.get("pages", [row.get("page")])
    identity = row.get("id", row.get("name", ""))
    for table in bill["tables"]:
        if table["page"] not in pages:
            continue
        for row_index, raw in enumerate(table["rawCells"]):
            if identity and not any(normal(identity) == normal(text or "") for text in raw):
                continue
            numeric_ordinal = 0
            for column_index, text in enumerate(raw):
                try:
                    parsed = numeric_cell(text)
                except ValueError:
                    continue
                numeric_ordinal += 1
                if "/projects/" in value_path:
                    selected = column_index == column
                else:
                    selected = numeric_ordinal == column
                if parsed == value and (column is None or selected):
                    candidates.append((table["id"], row_index, column_index, text, table["page"]))
    return candidates


def printed_value(table, value):
    """Return the original numeric text from a semantic row's pinned physical table."""
    for raw in table["rawCells"]:
        for text in raw:
            if text and normal(text).replace(",", ".") == str(value):
                return text
    return str(value)


def physical_cell(bill, row, value_path, value, column):
    table_id = row.get("table")
    if table_id is not None:
        table = next(table for table in bill["tables"] if table["id"] == table_id)
        return table_id, row["page"], printed_value(table, value), {}
    candidates = matching_physical_cells(bill, row, value_path, value, column)
    if len(candidates) != 1:
        raise ValueError(f"ambiguous physical cell {value_path}: {candidates}")
    table_id, row_index, column_index, printed, page = candidates[0]
    return table_id, page, printed, dict(rawRow=row_index, rawColumn=column_index)


def row_number(value_path):
    match = BILL_ROW_NUMBER.search(value_path)
    return int(match.group(1)) if match else 0


def bill_leaf(lineage, path, row, value_path, period=DEFAULT_PERIOD, variant=BILL_VARIANT, column=None):
    bill = lineage.inputs["B"]
    value = pointer(bill, value_path)
    table_id, page, printed, physical = physical_cell(bill, row, value_path, value, column)
    column_label = BILL_COLUMN_LABEL if column is None else "column " + str(column)
    return lineage.leaf(
        "B",
        value_path,
        "budget2027.json#/" + path,
        BILL_UNIT,
        period,
        table=table_id,
        page=page,
        label=row.get("text") or row.get("name") or "Без отпечатан етикет",
        no=str(row.get("no") or row.get("n") or row.get("name") or "unprinted"),
        column={"label": column_label, "year": int(period[:4])},
        variant=variant,
        printed=printed,
        rowOrdinal=row_number(value_path),
        **physical,
    )


def add_budgets(lineage, output):
    bill = lineage.inputs["B"]
    for variant in BUDGET_VARIANTS:
        output["budgets"][variant] = {}
        for article, item in bill[variant].items():
            target = dict(name=item["name"], rows=[], policiesRows=[], commitmentRows=[])
            for section in BUDGET_SECTIONS:
                for row_index, row in enumerate(item[section]):
                    if row.get("value") is None:
                        continue
                    index = len(target[section])
                    path = f"budgets/{variant}/{article}/{section}/{index}/cell"
                    value_path = f"/{variant}/{article}/{section}/{row_index}/value"
                    cell = bill_leaf(lineage, path, row, value_path, variant=variant)
                    target[section].append(
                        dict(
                            no=row.get("no") or "unprinted",
                            label=row["text"] or "Без отпечатан етикет",
                            section=row.get("sec") or "unprinted",
                            cell=cell,
                        )
                    )
            output["budgets"][variant][article] = target


def add_municipalities(lineage, output):
    bill = lineage.inputs["B"]
    for section in MUNICIPAL_SECTIONS:
        target = []
        for row_index, row in enumerate(bill["municipal"][section]["rows"]):
            cells = []
            for column in range(len(row["values"])):
                path = f"municipal/{section}/{row_index}/cells/{column}"
                value_path = f"/municipal/{section}/rows/{row_index}/values/{column}"
                cells.append(bill_leaf(lineage, path, row, value_path, column=column + MUNICIPAL_FIRST_VALUE_COLUMN))
            target.append(dict(name=row["name"], region=row["region"], cells=cells))
        output["municipal"][section] = target
    output["municipalTotals"] = {}
    for section in MUNICIPAL_SECTIONS:
        row = dict(name="ВСИЧКО:", page=max(bill["municipal"][section]["pages"]))
        cells = []
        for column in range(len(bill["municipal"][section]["total"])):
            path = f"municipalTotals/{section}/{column}"
            value_path = f"/municipal/{section}/total/{column}"
            cells.append(bill_leaf(lineage, path, row, value_path, column=column + MUNICIPAL_FIRST_VALUE_COLUMN))
        output["municipalTotals"][section] = cells


def add_projects(lineage, output):
    for row_index, row in enumerate(lineage.inputs["B"]["projects"]["rows"]):
        project = dict(id=row["id"], name=row["name"], institution=row["institution"], gaps={}, cells={})
        for column, value in enumerate(row["values"]):
            if value is None:
                project["gaps"][str(column)] = "Празна печатна клетка."
        for column, period in enumerate(PROJECT_PERIODS):
            if row["values"][column] is None:
                continue
            path = f"projects/{row_index}/cells/{column}"
            value_path = f"/projects/rows/{row_index}/values/{column}"
            project["cells"][str(column)] = bill_leaf(
                lineage, path, row, value_path, period=period, column=column + PROJECT_FIRST_VALUE_COLUMN
            )
        output["projects"].append(project)
    output["projectAnnualSums"] = {}
    for column, period in enumerate(PROJECT_PERIODS):
        operands = []
        for project in output["projects"]:
            if str(column) in project["cells"]:
                operands.append(project["cells"][str(column)])
        path = "budget2027.json#/projectAnnualSums/" + period
        output["projectAnnualSums"][period] = lineage.derived(path, period, "sum", operands, unit=BILL_UNIT)


def add_debt_limits(lineage, output):
    output["debtLimits"] = {}
    for article in DEBT_LIMIT_ARTICLES:
        row = lineage.inputs["B"]["articles"][article][DEBT_LIMIT_PARAGRAPH]
        matches = list(BILLION_EURO_AMOUNT.finditer(row["text"]))
        if len(matches) != 1:
            raise ValueError("Ambiguous debt limit prose: " + article)
        match = matches[0]
        path = "budget2027.json#/debtLimits/" + article
        provenance_id = hashlib.sha256(path.encode()).hexdigest()[:24]
        lineage.entries[provenance_id] = dict(
            output=path,
            document="bill",
            extraction=f"/articles/{article}/{DEBT_LIMIT_PARAGRAPH}/text",
            operation="parse-billion-euro",
            period=DEFAULT_PERIOD,
            variant=BILL_VARIANT,
            page=row["page"],
            unit="млрд. €",
            printed=match.group(0),
            label=row["text"] or "Без отпечатан етикет",
        )
        output["debtLimits"][article] = dict(
            value=float(match.group(1).replace(",", ".")), unit="млрд. €", provenance=provenance_id
        )


def add_forecast(lineage, output):
    for table_id in FORECAST_TABLES:
        table = lineage.inputs["F"]["tables"][table_id]
        rows = []
        for row_index, row in enumerate(table["rows"]):
            cells = {}
            gaps = {}
            for column_index, column in enumerate(table["columns"]):
                period = FORECAST_PERIODS.get(column.get("year"))
                if period is None:
                    continue
                if row["values"][column_index] is None:
                    gaps[str(column_index)] = "Празна печатна клетка."
                    continue
                path = f"budget2027.json#/forecast/{table_id}/{row_index}/cells/{column_index}"
                cells[str(column_index)] = lineage.f(table_id, row_index, column_index, path, period)
            rows.append(dict(label=row["label"], cells=cells, gaps=gaps))
        output["forecast"][table_id] = rows


def budget(lineage):
    output = dict(
        meta=meta(
            "D34", "Бюджет 2027: проект на МФ", source=["budget2027"], source_note=SOURCE_NOTE, as_of=PUBLICATION
        ),
        schema="budget2027/1",
        publication=PUBLICATION,
        defaultVariant=BILL_VARIANT,
        budgets={},
        municipal={},
        projects=[],
        forecast={},
        gaps={
            "programmes": "Няма пълен програмен архив за 2027–2029.",
            "municipalForecast": "Няма индивидуални общински разпределения за 2028–2029.",
            "law": "Публикацията е проект; не е приет закон.",
        },
    )
    add_budgets(lineage, output)
    add_municipalities(lineage, output)
    add_projects(lineage, output)
    add_debt_limits(lineage, output)
    add_forecast(lineage, output)
    return output


def build_budget_2027(ctx):
    lineage = ctx.annual_lineage
    ctx.put("budget2027.json", budget(lineage))
    ctx.put(
        "budget2027-provenance.json",
        dict(
            meta=meta(
                "D35",
                "Произход на бюджетните числа за 2027",
                source=["budget2027"],
                source_note=SOURCE_NOTE,
                as_of=PUBLICATION,
            ),
            schema="budget2027-provenance/1",
            documents=lineage.documents,
            entries=lineage.entries,
        ),
    )
