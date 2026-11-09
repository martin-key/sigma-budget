"""Compact adapters for the bill, its MC alternatives and forecast context.

budget2027.json holds the budgets by article, municipalities, projects, debt
limits and the forecast tables the screens read since 06.11.2026.
budget2027-tables.json is a separate lazy file with the rest of the printed
tables: the bill's captioned tables (judiciary bodies, arts. 6, 11, 16, 49 and
50), the 2027–2029 ceilings by budget organisation (Annexes 4–8) and further
АСБП tables. Both share one provenance index, budget2027-provenance.json.
"""

import hashlib
import re

from .annual_periods import PUBLICATION, pointer
from .data_io import meta

BUDGET_FILE = "budget2027.json"
TABLES_FILE = "budget2027-tables.json"
BUDGET_VARIANTS = ("bill", "billMc")
BUDGET_SECTIONS = ("rows", "policiesRows", "commitmentRows")
# Judiciary bodies (art. 2) and the named lists of arts. 6, 11 and 16 print a
# caption paragraph above their rows; the caption travels with the rows.
CAPTIONED_SECTIONS = ("bodiesRows", "extraRows")
# Art. 49: relations of БНР, БНТ and БТА with the central budget.
# Art. 50: maximum liabilities to suppliers at 31.12.2027.
ARTICLE_TABLES = ("49", "50")
MUNICIPAL_SECTIONS = ("art52", "art53")
PROJECT_PERIODS = ("2027.draft", "2028.forecast", "2029.forecast")
FORECAST_PERIODS = {
    2026: "2026.expected",
    2027: "2027.draft",
    2028: "2028.forecast",
    2029: "2029.forecast",
}
LAW_PERIOD = "2026.law"  # A 2026 column printed as „Програма“ is the adopted 2026 law.
LAW_VINTAGE = "програма"
REPORT_PERIOD = "2025.report"
REPORT_VINTAGE = "отчет"
FORECAST_TABLES = ("II_5", "II_7", "II_8", "VI_1", "VI_2", "annex9")  # In budget2027.json.
# In budget2027-tables.json. Table II-1 (КФП totals) is not repeated: the site
# takes the same КФП totals, row by row, from Annex 3.
TABLES_FORECAST = (
    "II_2",  # КФП: national budget.
    "II_3",  # КФП: accounts for EU funds.
    "III_2",  # Defence expenditure, NATO classification.
    "V_1",  # Agricultural policy: EU funds and national co-financing.
    "V_2",  # Fisheries policy: EU funds and national co-financing.
    "annex4",  # Expenditure ceilings by budget organisation.
    "annex5",  # Recommended ceilings: National Assembly and judiciary.
    "annex6",  # Transfers to БНТ, БНР, БТА, БАН and state universities.
    "annex7",  # EU funds accounts: net, expenditure and transfers.
    "annex8",  # Other entities in КФП: net, expenditure and transfers.
    "annex10",  # Tax expenditures.
)
# The 2025 report column is the printed base of comparison in these tables only.
# The tables of budget2027.json (VI_1, VI_2) keep their 2026–2029 cells.
REPORT_TABLES = ("II_2", "II_3", "annex10")
# Ceilings by budget organisation, matched to the bill's institutional budgets.
CEILING_TABLES = ("annex4", "annex5")
# The Supreme Judicial Council manages the judiciary budget of art. 2; the
# printed names differ, so the identity is stated, not inferred.
CEILING_ALIASES = {"Висш съдебен съвет": "2"}
STATE_BUDGET_ARTICLE = "1"
MUNICIPAL_FIRST_VALUE_COLUMN = 1  # Art. 52/53: first numeric ordinal after the municipality name.
PROJECT_FIRST_VALUE_COLUMN = 3  # Annex 2: raw columns 3/4/5 contain 2027/2028/2029 capital expenditure.
DEBT_LIMIT_ARTICLES = ("66", "67", "68")  # Fiscal reserve, year-end debt ceiling, new borrowing ceiling.
DEBT_LIMIT_PARAGRAPH = 0  # Each ceiling is printed in the first paragraph of its article.
BILL_COLUMN_LABEL = "Сума (хил. евро)"
BILL_UNIT = "хил. €"
DEFAULT_PERIOD = "2027.draft"
BILL_VARIANT = "bill"
BILL_ROW_NUMBER = re.compile(r"/(?:rows|policiesRows|commitmentRows|bodiesRows|extraRows|otherTables/\d+)/(\d+)/")
BILLION_EURO_AMOUNT = re.compile(r"(\d+(?:,\d+)?)\s+млрд\. евро")
SOURCE_NOTE = "МФ, публикация от 06.11.2026."
TABLES_SCHEMA = "budget2027-tables/1"


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


def bill_leaf(lineage, path, row, value_path, period=DEFAULT_PERIOD, variant=BILL_VARIANT, column=None, file=BUDGET_FILE):
    bill = lineage.inputs["B"]
    value = pointer(bill, value_path)
    table_id, page, printed, physical = physical_cell(bill, row, value_path, value, column)
    column_label = BILL_COLUMN_LABEL if column is None else "column " + str(column)
    return lineage.leaf(
        "B",
        value_path,
        file + "#/" + path,
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


def add_captioned_rows(lineage, output):
    """budget2027-tables.json: the captioned tables inside budgets (only budgets that print one)."""
    bill = lineage.inputs["B"]
    output["budgets"] = {}
    for variant in BUDGET_VARIANTS:
        output["budgets"][variant] = {}
        for article, item in bill[variant].items():
            if not any(item[section] for section in CAPTIONED_SECTIONS):
                continue
            target = dict(name=item["name"], captions=[])
            for section in CAPTIONED_SECTIONS:
                if not item[section]:
                    continue
                target[section] = []
                published = {}  # extraction row -> published row; „в т.ч.“ headings carry no amount
                for row_index, row in enumerate(item[section]):
                    if row.get("value") is None:
                        continue
                    index = len(target[section])
                    published[row_index] = index
                    path = f"budgets/{variant}/{article}/{section}/{index}/cell"
                    value_path = f"/{variant}/{article}/{section}/{row_index}/value"
                    cell = bill_leaf(lineage, path, row, value_path, variant=variant, file=TABLES_FILE)
                    target[section].append(
                        dict(no=row.get("no") or "unprinted", label=row["text"] or "Без отпечатан етикет", cell=cell)
                    )
                add_captions(item, section, published, target)
            output["budgets"][variant][article] = target


def add_captions(item, section, published, target):
    """Attach each printed caption paragraph to the published rows below it."""
    for caption in item.get("sectionCaptions", []):
        if caption["section"] != section:
            continue
        rows = [published[i] for i in range(caption["start"], caption["end"]) if i in published]
        if not rows or rows != list(range(rows[0], rows[0] + len(rows))):
            raise ValueError(f"Caption without contiguous rows: {item['name']} {section}")
        target["captions"].append(
            dict(section=section, text=caption["text"], page=caption["page"], first=rows[0], count=len(rows))
        )
    if sum(c["count"] for c in target["captions"] if c["section"] == section) != len(target[section]):
        raise ValueError(f"Rows without a printed caption: {item['name']} {section}")


def add_article_tables(lineage, output):
    """Arts. 49 and 50 print tables outside any budget; the article's first paragraph is the caption."""
    bill = lineage.inputs["B"]
    output["articleTables"] = {}
    for article in ARTICLE_TABLES:
        paragraph = bill["articles"][article][0]
        rows = []
        for row_index, row in enumerate(bill["otherTables"][article]):
            if row.get("value") is None:
                continue
            path = f"articleTables/{article}/rows/{len(rows)}/cell"
            value_path = f"/otherTables/{article}/{row_index}/value"
            rows.append(
                dict(
                    no=row.get("no") or "unprinted",
                    label=row["text"] or "Без отпечатан етикет",
                    cell=bill_leaf(lineage, path, row, value_path, file=TABLES_FILE),
                )
            )
        output["articleTables"][article] = dict(caption=paragraph["text"], page=paragraph["page"], rows=rows)


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


def forecast_period(table_id, column):
    """The period of a printed column, from its year and printed status; None if not published."""
    year, vintage = column.get("year"), column.get("vintage")
    if year == int(REPORT_PERIOD[:4]):
        return REPORT_PERIOD if table_id in REPORT_TABLES and vintage == REPORT_VINTAGE else None
    if year == int(LAW_PERIOD[:4]) and vintage == LAW_VINTAGE:
        return LAW_PERIOD
    return FORECAST_PERIODS.get(year)


def forecast_columns(table_id, table):
    """Printed column metadata; `period` only on published columns (index = cell key)."""
    columns = []
    for column in table["columns"]:
        item = {key: column[key] for key in ("year", "unit", "vintage", "measure") if key in column}
        period = forecast_period(table_id, column)
        if period is not None:
            item["period"] = period
        columns.append(item)
    return columns


def add_forecast(lineage, output, table_ids=FORECAST_TABLES, file=BUDGET_FILE):
    for table_id in table_ids:
        table = lineage.inputs["F"]["tables"][table_id]
        if file != BUDGET_FILE:
            output["forecastColumns"][table_id] = forecast_columns(table_id, table)
        rows = []
        for row_index, row in enumerate(table["rows"]):
            cells = {}
            gaps = {}
            for column_index, column in enumerate(table["columns"]):
                period = forecast_period(table_id, column)
                if period is None:
                    continue
                if row["values"][column_index] is None:
                    gaps[str(column_index)] = "Празна печатна клетка."
                    continue
                path = f"{file}#/forecast/{table_id}/{row_index}/cells/{column_index}"
                cells[str(column_index)] = lineage.f(table_id, row_index, column_index, path, period)
            rows.append(dict(label=row["label"], cells=cells, gaps=gaps))
        output["forecast"][table_id] = rows


def name_words(text):
    return re.sub(r"[^\w\s]", " ", text.lower()).split()


def same_institution(printed, bill_name):
    """Annex nominative vs bill genitive/definite: same words, ignoring the last two letters of each."""
    a, b = name_words(printed), name_words(bill_name)
    return len(a) == len(b) and all(y.startswith(x[: max(3, len(x) - 2)]) for x, y in zip(a, b))


def add_ceilings(lineage, output):
    """Map every institutional budget of the bill to exactly one ceiling row of Annex 4 or 5."""
    names = {a: item["name"] for a, item in lineage.inputs["B"]["bill"].items() if a != STATE_BUDGET_ARTICLE}
    mapping = {}
    for table_id in CEILING_TABLES:
        for row_index, row in enumerate(lineage.inputs["F"]["tables"][table_id]["rows"]):
            label = re.sub(r"^\d+\s+", "", row["label"])
            if label in CEILING_ALIASES:
                matches = [CEILING_ALIASES[label]]
            else:
                matches = [a for a, name in names.items() if same_institution(label, name)]
            if len(matches) > 1:
                raise ValueError(f"Ambiguous ceiling row {table_id}/{row_index}: {matches}")
            if not matches:
                continue  # Social security funds and НЗОК have their own laws, not bill articles.
            if matches[0] in mapping:
                raise ValueError(f"Two ceiling rows for article {matches[0]}")
            mapping[matches[0]] = dict(table=table_id, row=row_index)
    if set(mapping) != set(names):
        raise ValueError(f"Budgets without a ceiling row: {sorted(set(names) - set(mapping), key=int)}")
    output["ceilingArticles"] = {a: mapping[a] for a in sorted(mapping, key=int)}


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


def tables(lineage):
    """budget2027-tables.json: the printed tables of the same publication that budget2027.json leaves out."""
    output = dict(
        meta=meta(
            "D37",
            "Бюджет 2027: тавани по ведомства и още таблици",
            source=["budget2027"],
            source_note=SOURCE_NOTE,
            as_of=PUBLICATION,
        ),
        schema=TABLES_SCHEMA,
        publication=PUBLICATION,
        budgets={},
        articleTables={},
        forecast={},
        forecastColumns={},
        ceilingArticles={},
    )
    add_captioned_rows(lineage, output)
    add_article_tables(lineage, output)
    add_forecast(lineage, output, TABLES_FORECAST, TABLES_FILE)
    add_ceilings(lineage, output)
    return output


def build_budget_2027(ctx):
    lineage = ctx.annual_lineage
    ctx.put(BUDGET_FILE, budget(lineage))
    ctx.put(TABLES_FILE, tables(lineage))
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
