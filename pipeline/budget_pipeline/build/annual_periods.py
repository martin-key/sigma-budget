"""Additive annual contract from the frozen MF 2027 publication; no network or fallback."""

import hashlib
import zipfile
from decimal import Decimal

from .data_io import ROOT, SRC, jload, sha256_file

PERIODS = {
    "2026.law": ("law", "plan", "програма"),
    "2026.expected": ("expected", "expected", "очаквано"),
    "2027.draft": ("draft", "plan", "проект"),
    "2028.forecast": ("forecast", "forecast", "прогноза"),
    "2029.forecast": ("forecast", "forecast", "прогноза"),
}
# Report columns printed beside the forecast in a few АСБП tables. They are not
# annual periods of outlook/revenue/expenditure, only cells of budget2027.json.
SOURCE_VINTAGES = {"2025.report": "отчет"}
PUBLICATION = "2026-11-06"
ANNUAL_FILES = ("outlook", "revenue", "expenditure")
DOCUMENT_NAMES = {"F": "forecast", "B": "bill"}

LAW_TABLE = "annex1_execution2026"
AMOUNT_TABLE = "annex3_mln"
RATIO_TABLE = "annex3_pct_gdp"
MACRO_TABLE = "I_2"
FUNCTION_TABLE = "III_1"

LAW_COLUMN = 0  # Annex 1: КФП, Програма 2026.
ANNUAL_COLUMNS = {  # Annex 3: Очаквано 2026, Проект 2027, Прогноза 2028/2029.
    "2026.expected": 1,
    "2027.draft": 2,
    "2028.forecast": 3,
    "2029.forecast": 4,
}
MACRO_COLUMN_OFFSET = 1  # I-2 has 2024/2025 actual columns before the 2026 forecast.
FUNCTION_AMOUNT_COLUMN_OFFSET = -1  # III-1 amount columns start with Очаквано 2026 at c0.
FUNCTION_RATIO_COLUMN_OFFSET = 3  # III-1 GDP-share columns start with Очаквано 2026 at c4.

REVENUE_TOTAL_ROW = 0  # Annex 1 / Annex 3: Приходи, помощи и дарения.
LAW_EXPENDITURE_ROW = 8  # Annex 1: Разходи и вноска в бюджета на ЕС.
EXPENDITURE_TOTAL_ROW = 31  # Annex 3: Разходи и вноска в бюджета на ЕС.
EXPENDITURE_WITHOUT_EU_ROW = 32  # Annex 3: Разходи, без вноската в бюджета на ЕС.
LAW_BALANCE_ROW = 17  # Annex 1: Бюджетно салдо.
BALANCE_ROW = 61  # Annex 3: Бюджетно салдо (+/-).
LAW_INTEREST_ROW = 14  # Annex 1: Лихви.
INTEREST_ROW = 57  # Annex 3: Лихви.
FINANCING_ROW = 62  # Annex 3: Финансиране.
GDP_ROW = 63  # Annex 3 (% table): БВП, млн. евро.
LAW_REVENUE_ROWS = range(REVENUE_TOTAL_ROW, LAW_EXPENDITURE_ROW)  # Annex 1: revenue block r0–7.
REVENUE_ROWS = range(REVENUE_TOTAL_ROW, EXPENDITURE_TOTAL_ROW)  # Annex 3: revenue block r0–30.
LAW_EXPENDITURE_ROWS = range(LAW_EXPENDITURE_ROW, 16)  # Annex 1: expenditure and EU contribution r8–15.
EXPENDITURE_ROWS = range(EXPENDITURE_TOTAL_ROW, BALANCE_ROW)  # Annex 3: economic expenditure r31–60.
MACRO_ROWS = range(16)  # I-2: the sixteen printed macroeconomic indicators.

REVENUE_GROUP_ROWS = {
    "dds": (11,),  # Annex 3: ДДС.
    "osiguritelni": (7,),  # Annex 3: Социални и здравноосигурителни вноски.
    "nedanachni": (19,),  # Annex 3: Неданъчни приходи.
    "pomoshti": (28,),  # Annex 3: Помощи и дарения.
    "ddfl": (6,),  # Annex 3: Данъци върху доходите на физически лица.
    "akcizi": (12,),  # Annex 3: Акцизи.
    "korporativen": (3,),  # Annex 3: Корпоративни данъци.
    "drugi": (13, 14, 15),  # Annex 3: мита, данък върху застрахователни премии, други данъци.
}
FUNCTION_ROWS = (  # III-1: the nine main printed function rows.
    0,  # Общи държавни служби.
    4,  # Отбрана и сигурност.
    10,  # Образование.
    11,  # Здравеопазване.
    12,  # Социално осигуряване, подпомагане и грижи.
    16,  # Жилищно строителство, благоустройство, комунално стопанство и околна среда.
    19,  # Култура, спорт, почивни дейности и религиозно дело.
    24,  # Икономически дейности и услуги.
    31,  # Разходи, некласифицирани в другите функции.
)
# Measures, ceilings by budget organisation, EU accounts and agricultural/fishery
# policy tables print years but no vintage header.
HEADERLESS_TABLES = ("II_7", "II_8", "annex9", "annex4", "annex5", "annex6", "annex7", "annex8", "V_1", "V_2")


def pointer(obj, path):
    for key in path.split("/")[1:]:
        key = key.replace("~1", "/").replace("~0", "~")
        obj = obj[int(key)] if isinstance(obj, list) else obj[key]
    return obj


class Lineage:
    def __init__(self):
        self.inputs = {}
        self.documents = {}
        self.entries = {}
        for kind, name in DOCUMENT_NAMES.items():
            filename = f"budget_{name}_2027.json"
            extraction = jload(SRC / filename)
            self.inputs[kind] = extraction
            source = extraction["source"]
            document = {
                "source": "budget2027",
                "archive": source["archive"],
                "archiveSha256": source.get("archive_sha256", source.get("sha256")),
                "member": source["member"],
                "memberSha256": source.get("pdf_sha256", source.get("memberSha256")),
                "input": filename,
            }
            self._verify_document(document)
            self.documents[name] = document

    @staticmethod
    def _verify_document(document):
        archive = ROOT / document["archive"]
        if sha256_file(archive) != document["archiveSha256"]:
            raise ValueError(f"Archive checksum mismatch: {document['archive']}")
        with zipfile.ZipFile(archive) as source_zip:
            member_hash = hashlib.sha256(source_zip.read(document["member"])).hexdigest()
        if member_hash != document["memberSha256"]:
            raise ValueError(f"PDF member checksum mismatch: {document['member']}")

    def leaf(self, kind, extraction, output, unit, period, **location):
        value = pointer(self.inputs[kind], extraction)
        if not isinstance(value, (float, int)) or isinstance(value, bool):
            raise ValueError(f"Non-numeric extraction cell: {kind}{extraction}")
        provenance_id = hashlib.sha256(output.encode()).hexdigest()[:24]
        self.entries[provenance_id] = dict(
            output=output,
            document=DOCUMENT_NAMES[kind],
            extraction=extraction,
            period=period,
            unit=unit,
            **location,
        )
        return dict(value=value, unit=unit, provenance=provenance_id)

    def f(self, table, row_index, column_index, output, period):
        source_table = self.inputs["F"]["tables"][table]
        row = source_table["rows"][row_index]
        column = source_table["columns"][column_index]
        if column["year"] != int(period[:4]):
            raise ValueError(f"Wrong year in {table} column {column_index}: {period}")
        expected_vintage = (
            "прогноза" if table == MACRO_TABLE else PERIODS[period][2] if period in PERIODS else SOURCE_VINTAGES[period]
        )
        headerless = table in HEADERLESS_TABLES and "vintage" not in column
        if not headerless and column.get("vintage") != expected_vintage:
            raise ValueError(f"Wrong vintage in {table} column {column_index}: {period}")
        return self.leaf(
            "F",
            f"/tables/{table}/rows/{row_index}/values/{column_index}",
            output,
            row["units"][column_index],
            period,
            table=table,
            row=row_index,
            label=row["label"],
            column=column,
            page=row["page"],
            printed=row["printed"][column_index],
        )

    def derived(self, output, period, operation, operands, unit="млн. €"):
        values = [Decimal(str(operand["value"])) for operand in operands]
        value = sum(values) if operation == "sum" else values[0] - values[1]
        provenance_id = hashlib.sha256(output.encode()).hexdigest()[:24]
        document = self.entries[operands[0]["provenance"]]["document"]
        self.entries[provenance_id] = dict(
            output=output,
            document=document,
            period=period,
            unit=unit,
            operation=operation,
            operands=[operand["provenance"] for operand in operands],
        )
        return dict(value=float(value), unit=unit, provenance=provenance_id)


def annual_cell(lineage, filename, period, table, row, column, path):
    output = f"{filename}.json#/byPeriod/{period}/{path}"
    return lineage.f(table, row, column, output, period)


def period_record(period):
    status, vintage, _ = PERIODS[period]
    return dict(
        periodKey=period,
        year=int(period[:4]),
        status=status,
        vintage=vintage,
        publication=PUBLICATION,
        sourceRefs=["budget2027"],
        series={},
        rows=[],
        gaps={},
    )


def add_outlook(lineage, period, table, column, law, outlook):
    mapping = {
        "revenue": REVENUE_TOTAL_ROW,
        "expenditure": LAW_EXPENDITURE_ROW if law else EXPENDITURE_TOTAL_ROW,
        "balance": LAW_BALANCE_ROW if law else BALANCE_ROW,
        "interest": LAW_INTEREST_ROW if law else INTEREST_ROW,
    }
    if not law:
        mapping["financing"] = FINANCING_ROW
    for name, row in mapping.items():
        outlook["series"][name] = annual_cell(lineage, "outlook", period, table, row, column, "series/" + name)
    operands = [outlook["series"]["balance"], outlook["series"]["interest"]]
    output = f"outlook.json#/byPeriod/{period}/series/primaryBalance"
    outlook["series"]["primaryBalance"] = lineage.derived(output, period, "sum", operands)
    outlook["primaryBalanceNote"] = "Салдо плюс лихвени разходи; без корекция за лихвени приходи."
    if law:
        outlook["gaps"] = {
            "gdp": "Няма законова макропрогноза в тази публикация.",
            "macro": "Няма законова макропрогноза.",
            "financing": "Не е отпечатано.",
        }
        return
    outlook["series"]["gdp"] = annual_cell(lineage, "outlook", period, RATIO_TABLE, GDP_ROW, column, "series/gdp")
    outlook["macro"] = []
    for row_index in MACRO_ROWS:
        row = lineage.inputs["F"]["tables"][MACRO_TABLE]["rows"][row_index]
        cell = annual_cell(
            lineage, "outlook", period, MACRO_TABLE, row_index, column + MACRO_COLUMN_OFFSET, f"macro/{row_index}/cell"
        )
        outlook["macro"].append(dict(label=row["label"], cell=cell))
    outlook["printedPctGdp"] = {}
    for name, row in mapping.items():
        outlook["printedPctGdp"][name] = annual_cell(
            lineage, "outlook", period, RATIO_TABLE, row, column, "printedPctGdp/" + name
        )


def add_rows(lineage, filename, period, table, column, indices, target, law):
    for row_index in indices:
        source_row = lineage.inputs["F"]["tables"][table]["rows"][row_index]
        if source_row["values"][column] is None:
            target["gaps"][f"{table}.r{row_index}"] = "Празна печатна клетка."
            continue
        index = len(target["rows"])
        row = dict(
            id=f"{table}.r{row_index}",
            label=source_row["label"],
            cell=annual_cell(lineage, filename, period, table, row_index, column, f"rows/{index}/cell"),
        )
        if not law:
            row["printedPctGdp"] = annual_cell(
                lineage, filename, period, RATIO_TABLE, row_index, column, f"rows/{index}/printedPctGdp"
            )
        target["rows"].append(row)


def add_revenue_groups(lineage, period, revenue):
    revenue["groups"] = {}
    by_id = {row["id"]: row["cell"] for row in revenue["rows"]}
    for name, rows in REVENUE_GROUP_ROWS.items():
        operands = [by_id[f"{AMOUNT_TABLE}.r{row}"] for row in rows]
        output = f"revenue.json#/byPeriod/{period}/groups/{name}"
        revenue["groups"][name] = lineage.derived(output, period, "sum", operands)


def add_functions(lineage, period, column, expenditure):
    expenditure["functions"] = []
    for index, row_index in enumerate(FUNCTION_ROWS):
        row = lineage.inputs["F"]["tables"][FUNCTION_TABLE]["rows"][row_index]
        cell = annual_cell(
            lineage,
            "expenditure",
            period,
            FUNCTION_TABLE,
            row_index,
            column + FUNCTION_AMOUNT_COLUMN_OFFSET,
            f"functions/{index}/cell",
        )
        ratio = annual_cell(
            lineage,
            "expenditure",
            period,
            FUNCTION_TABLE,
            row_index,
            column + FUNCTION_RATIO_COLUMN_OFFSET,
            f"functions/{index}/printedPctGdp",
        )
        expenditure["functions"].append(dict(label=row["label"], cell=cell, printedPctGdp=ratio))


def annual(lineage):
    output = {name: {} for name in ANNUAL_FILES}
    for period in PERIODS:
        law = period == "2026.law"
        column = LAW_COLUMN if law else ANNUAL_COLUMNS[period]
        table = LAW_TABLE if law else AMOUNT_TABLE
        for name in output:
            output[name][period] = period_record(period)
        outlook = output["outlook"][period]
        revenue = output["revenue"][period]
        expenditure = output["expenditure"][period]
        add_outlook(lineage, period, table, column, law, outlook)
        if law:
            revenue["gaps"] = {"groups": "Няма отделни ДДС, акцизи, корпоративни и ДДФЛ в законовата колона."}
            expenditure["gaps"] = {
                "functions": "Няма законова функционална разбивка.",
                "economicDetails": "Няма подробни законови икономически редове.",
            }
        revenue_rows = LAW_REVENUE_ROWS if law else REVENUE_ROWS
        expenditure_rows = LAW_EXPENDITURE_ROWS if law else EXPENDITURE_ROWS
        add_rows(lineage, "revenue", period, table, column, revenue_rows, revenue, law)
        add_rows(lineage, "expenditure", period, table, column, expenditure_rows, expenditure, law)
        if not law:
            add_revenue_groups(lineage, period, revenue)
            add_functions(lineage, period, column, expenditure)
    return output


def build_annual_periods(ctx):
    lineage = Lineage()
    for name, records in annual(lineage).items():
        ctx.out[name + ".json"]["byPeriod"] = records
    ctx.annual_lineage = lineage
