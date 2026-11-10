"""Independent, frozen verification extract for D26 (reads originals, never release data).

The validator can use the pinned extract in CI without the large originals. When all
originals are present it re-extracts them and requires byte-equivalent evidence.
"""
import argparse
import datetime
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

from lxml import html
import pdfplumber
from budget_pipeline.build.data_io import EUR

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = 'data/inputs/indirect_tax_evidence.json'
FILES = {
    'prices': 'data/originals/ec-oil/weekly-prices-2026-11-02.xlsx',
    'duties': 'data/originals/ec-oil/duties-and-taxes-2026-11-07.xlsx',
    'gazette': 'data/originals/excise-law/dv-69-2026-budget.html',
    'customs': 'data/originals/excise-law/excise-law-dv54-2025.pdf',
    'nsi': 'data/originals/nsi-pack/statistical-yearbook-2025.pdf',
    'bill': 'data/originals/parliament/52-602-01-19.docx',
}


def ensure(condition, message):
    if not condition:
        raise ValueError(message)


def workbook(path, title):
    """Find the official sheet by name and decode its cells independently of the producer."""
    with zipfile.ZipFile(path) as archive:
        book = ET.fromstring(archive.read('xl/workbook.xml'))
        sheets = [s for s in book.find('{*}sheets') if s.get('name') == title]
        ensure(len(sheets) == 1, 'ambiguous worksheet '+title)
        rel_id = sheets[0].get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        target = [r.get('Target') for r in relationships if r.get('Id') == rel_id and r.get('Type').endswith('/worksheet')]
        ensure(len(target) == 1, 'invalid worksheet link')
        name = target[0].lstrip('/') if target[0].startswith('/') else 'xl/'+target[0]
        shared = [''.join(t.itertext()) for t in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        result = {}
        for cell in ET.fromstring(archive.read(name)).iterfind('.//{*}c'):
            value = cell.find('{*}v')
            if value is not None:
                result[cell.get('r')] = shared[int(value.text)] if cell.get('t') == 's' else value.text
        return result


def day(serial):
    value = Decimal(serial)
    ensure(value.is_finite() and value == value.to_integral_value(), 'invalid source date')
    return (datetime.date(1899, 12, 30)+datetime.timedelta(days=int(value))).isoformat()


def product_column(cells, product):
    term = 'Euro-super 95' if product == 'petrol' else 'Dieselkraftstoff'
    matches = [re.sub(r'\d+$', '', cell) for cell, text in cells.items() if term in text]
    ensure(len(matches) == 1, 'ambiguous EC product '+product)
    return matches[0]


def country_row(cells, country):
    rows = [re.search(r'\d+$', key)[0] for key, text in cells.items() if text == country]
    ensure(len(rows) == 1, 'ambiguous EC country')
    return rows[0]


def legal_fuels(path):
    # Article 32(1) is on PDF page 42. A different PDF text engine/row strategy
    # provides a check independent of the builder's whole-document regex.
    with pdfplumber.open(path) as pdf:
        text = ' '.join(' '.join(page.extract_text() for page in pdf.pages[40:42]).split())
    ensure('Чл. 32.' in text and 'Акцизните' in text, 'missing Customs article 32')
    amounts = {}
    for fuel, words in [('petrol', 'безоловен бензин'), ('diesel', 'газьол')]:
        pattern = words+r'(?:(?!;|за безоловен бензин|за газьол).)*?([0-9]+) лв\. за 1000 литра'
        hits = re.findall(pattern, text)
        ensure(len(hits) == 1, 'ambiguous Customs rate '+fuel)
        amounts[fuel] = Decimal(hits[0])
    return amounts


def cigarette_schedule(path):
    document = html.fromstring(path.read_bytes())
    text = ' '.join(' '.join(document.itertext()).split())
    start = text.index('Чл. 39. (1) Акцизната ставка за цигарите')
    article = re.split(r'§\s*\d+\.', text[start:], maxsplit=1)[0]
    specific_text = article.split('на специфичния акциз:', 1)[1].split('на пропорционалния акциз:', 1)[0]
    proportional_text = article.split('на пропорционалния акциз:', 1)[1].split('(2)', 1)[0]
    minimum_text = article.split('(2)', 1)[1]
    months = {'август': 8, 'март': 3, 'януари': 1}

    def records(text, unit):
        found = {}
        pattern = r'(\d+(?:,\d+)?) '+unit+r' от (\d+) (август|март|януари) (\d{4}) г\.'
        for value, d, m, y in re.findall(pattern, text):
            iso = datetime.date(int(y), months[m], int(d)).isoformat()
            ensure(iso not in found, 'duplicate cigarette source period')
            found[iso] = float(Decimal(value.replace(',', '.')))
        ensure(found, 'missing cigarette source coefficients')
        return found

    specific = records(specific_text, r'евро за 1000 къса')
    proportion = records(proportional_text, r'на сто от продажната цена')
    minimum = records(minimum_text, r'евро (?:на|за) 1000 къса')
    ensure(specific.keys() == proportion.keys() == minimum.keys(), 'inconsistent cigarette source periods')
    dates = sorted(specific)
    result = []
    for i, date in enumerate(dates):
        row = dict(validFrom=date, specificPer1000=specific[date], adValoremPct=proportion[date], minimumPer1000=minimum[date])
        if i+1 < len(dates):
            row['validTo'] = (datetime.date.fromisoformat(dates[i+1])-datetime.timedelta(days=1)).isoformat()
        result.append(row)
    return result


def reduced_vat(path):
    with zipfile.ZipFile(path) as document:
        xml = ET.fromstring(document.read('word/document.xml'))
    rows = []
    ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    for table in xml.iterfind('.//{*}tbl'):
        previous = {}
        for row in table.findall('{*}tr'):
            cells, column = [], 0
            for cell in row.findall('{*}tc'):
                text = ''.join(t.text or '' for paragraph in cell.findall('{*}p') for t in paragraph.iterfind('.//{*}t')).strip()
                merge = cell.find('{*}tcPr/{*}vMerge')
                if merge is not None and merge.get(ns+'val') != 'restart':
                    ensure(column in previous, 'unresolved merged VAT cell')
                    text = previous[column]
                span = cell.find('{*}tcPr/{*}gridSpan')
                width = int(span.get(ns+'val')) if span is not None else 1
                for i in range(width):
                    previous[column+i] = text
                    cells.append(text)
                column += width
            if any('настаняване, предоставяно' in cell for cell in cells):
                unit = cells.index('%')
                rates = [Decimal(v) for v in cells[unit+1:]]
                ensure(rates and len(set(rates)) == 1, 'ambiguous reduced VAT period')
                rows.append(float(rates[0]))
    ensure(len(rows) == 1, 'ambiguous reduced VAT source row')
    return rows[0]


def pack_reference(path, year=2025):
    with pdfplumber.open(path) as pdf:
        words = pdf.pages[230].extract_words(x_tolerance=1, y_tolerance=2)
    phrase = ['Цигари', 'с', 'филтър', '-', 'кутия']
    starts = [i for i in range(len(words)-len(phrase)+1) if [w['text'] for w in words[i:i+len(phrase)]] == phrase]
    ensure(len(starts) == 1, 'ambiguous NSI product row')
    row_y = words[starts[0]]['top']
    groups = {}
    for word in words:
        if re.fullmatch(r'20\d{2}', word['text']) and word['top'] < row_y:
            groups.setdefault(round(word['top']), []).append(word)
    headers = [values for values in groups.values() if len(values) > 1 and str(year) in [v['text'] for v in values]]
    ensure(len(headers) == 1, 'ambiguous NSI year row')
    headers = sorted(headers[0], key=lambda w:w['x0'])
    years = [int(w['text']) for w in headers]
    ensure(len(set(years)) == len(years), 'duplicate NSI year columns')
    values = {}
    for header in headers:
        center = (header['x0']+header['x1'])/2
        cells = [w for w in words if abs(w['top']-row_y)<2 and re.fullmatch(r'\d+[.,]\d{2}', w['text']) and abs((w['x0']+w['x1'])/2-center)<12]
        ensure(len(cells) == 1, 'ambiguous NSI price column '+header['text'])
        values[int(header['text'])] = Decimal(cells[0]['text'].replace(',', '.'))
    value = values[year]
    return dict(originalValue=float(value), priceEur=float((value/Decimal(str(EUR))).quantize(Decimal('0.00000001'), rounding=ROUND_HALF_UP)), conversionRate=EUR, period=str(year), yearHeaders=years)


def extract(root=ROOT):
    paths = {name:Path(root)/rel for name, rel in FILES.items()}
    prices = workbook(paths['prices'], 'Sheet1')
    excises = workbook(paths['duties'], 'Excise duties')
    vat = workbook(paths['duties'], 'VAT')
    ensure(prices.get('A1') == 'in EUR', 'wrong EC price currency')
    ensure(excises.get('C1') == 'Excises - in national currency per unit (L or t)', 'wrong EC duty currency declaration')
    observed = day(prices['A2'])
    ensure(observed in paths['prices'].name, 'observation date differs from pinned filename')
    price_row, tax_row, vat_row = country_row(prices, 'Bulgaria'), country_row(excises, 'BG_'), country_row(vat, 'BG_')
    bgn = legal_fuels(paths['customs'])
    fuels = {}
    for fuel in ('petrol', 'diesel'):
        pc, ec, vc = [product_column(t, fuel) for t in (prices, excises, vat)]
        ensure(prices[pc+'2'] == excises[ec+'4'] == '1000 l', 'wrong EC source units')
        amount = Decimal(excises[ec+tax_row])
        ensure(amount == (bgn[fuel]/Decimal(str(EUR))).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP), 'EC rate differs from Customs conversion')
        fuels[fuel] = dict(excisePerLitre=float(amount/1000), originalExcise=float(amount), pricePerLitre=float(Decimal(prices[pc+price_row])/1000), originalPrice=float(prices[pc+price_row]), priceDate=observed, validFrom=day(excises['B'+tax_row]), originalBgnPer1000=float(bgn[fuel]), conversionRate=EUR)
    standards = {Decimal(vat[product_column(vat, fuel)+vat_row]) for fuel in ('petrol', 'diesel')}
    ensure(len(standards) == 1, 'inconsistent source VAT')
    return dict(schema='indirect-tax-evidence/1', sources={name:dict(path=FILES[name],sha256=hashlib.sha256(path.read_bytes()).hexdigest()) for name,path in paths.items()},
                vat=dict(standardPct=float(standards.pop()), reducedPct=reduced_vat(paths['bill']), standardSince=day(vat['B'+vat_row]), unit='%'),
                fuels=fuels, cigarettes=cigarette_schedule(paths['gazette']), pack=pack_reference(paths['nsi']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    text = json.dumps(extract(), ensure_ascii=False, sort_keys=True, indent=2)+'\n'
    output = ROOT/OUTPUT
    if args.check:
        if not output.is_file() or output.read_text() != text:
            raise SystemExit('independent tax evidence differs from frozen extraction')
        print('independent tax evidence: frozen bytes match (six pinned originals)')
    else:
        output.write_text(text)
        print('wrote '+OUTPUT)


if __name__ == '__main__':
    main()
