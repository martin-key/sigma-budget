"""Extract dated indirect-tax parameters from pinned official evidence, offline."""
import datetime as dt
import re
import zipfile
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from decimal import Decimal, ROUND_HALF_UP
import fitz
from docx import Document
from budget_pipeline.build.data_io import RAW, EUR, BUILD_DATE, meta

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def require(condition, message):
    if not condition:
        raise ValueError(message)


def sheet(path, name):
    """Resolve a named sheet through workbook relationships, never a positional sheet index."""
    with zipfile.ZipFile(path) as z:
        workbook = ET.fromstring(z.read('xl/workbook.xml'))
        sheets = [s for s in workbook.findall('m:sheets/m:sheet', NS) if s.attrib['name'] == name]
        require(len(sheets) == 1, 'missing or ambiguous worksheet: ' + name)
        rid = sheets[0].attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
        relations = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        targets = [r.attrib['Target'] for r in relations if r.attrib['Id'] == rid and r.attrib['Type'].endswith('/worksheet')]
        require(len(targets) == 1, 'invalid worksheet relationship: ' + name)
        target = targets[0]
        target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        strings = [''.join(t.itertext()) for t in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)]
        cells = ET.fromstring(z.read(target))
        return {c.attrib['r']: strings[int(v.text)] if c.attrib.get('t') == 's' else v.text
                for c in cells.findall('.//m:c', NS) if (v := c.find('m:v', NS)) is not None}


def excel_date(value):
    serial = Decimal(value)
    require(serial.is_finite() and serial == serial.to_integral_value(), 'invalid Excel date')
    return (dt.date(1899, 12, 30) + dt.timedelta(days=int(serial))).isoformat()


def check_ec_tables(prices, duty, vat, expected_date):
    normal = lambda value: ' '.join(value.split())
    petrol = 'Euro-super 95 (I)'
    diesel = 'Gas oil automobile Automotive gas oil Dieselkraftstoff (I)'
    require(normal(prices.get('A1', '')) == 'in EUR', 'fuel price currency must be EUR')
    require(prices.get('A5') == 'Bulgaria' and duty.get('A7') == vat.get('A7') == 'BG_', 'wrong country in EC tables')
    require(normal(prices.get('B1', '')) == petrol and normal(prices.get('C1', '')) == diesel, 'wrong price product columns')
    for table in (duty, vat):
        require(normal(table.get('C3', '')) == petrol and normal(table.get('D3', '')) == diesel, 'wrong tax product columns')
        require(table.get('C4') == table.get('D4') == '1000 l', 'wrong EC tax units')
    require(prices.get('B2') == prices.get('C2') == '1000 l', 'wrong EC price units')
    require(duty.get('C1') == 'Excises - in national currency per unit (L or t)', 'wrong excise table or currency basis')
    require(vat.get('C1') == 'VAT (Value added tax), %', 'wrong VAT table')
    observed = excel_date(prices['A2'])
    require(observed == expected_date and observed <= BUILD_DATE, 'wrong fuel observation date')
    # The excise workbook names the national currency, rather than an ISO code. Its EUR
    # interpretation is checked below against the statutory BGN amounts and conversion rule.
    require(excel_date(duty['B7']) <= observed, 'excise snapshot is newer than the price observation')
    require(Decimal(vat['C7']) == Decimal(vat['D7']), 'inconsistent petrol/diesel VAT')


def parse_nsi_pack_table(text, year=2025):
    """Bind a product row to the table's year columns; never locate a page by its answer."""
    label = 'Цигари с филтър - кутия'
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    rows = [i for i, line in enumerate(lines) if line == label]
    require(len(rows) == 1, 'missing or ambiguous NSI cigarette row')
    row = rows[0]
    require('(BGN)' in lines[:row] and '(Левове)' in lines[:row], 'wrong NSI currency')
    groups, current = [], []
    for line in lines[:row] + ['END']:
        if re.fullmatch(r'(?:20\d{2})(?:\s+20\d{2})*', line):
            current.extend(int(v) for v in line.split())
        elif current:
            groups.append(current); current = []
    headers = [values for values in groups if year in values and len(values) > 1]
    require(len(headers) == 1, 'missing or ambiguous NSI year headers')
    years = headers[0]
    require(len(years) == len(set(years)) and years == sorted(years), 'invalid NSI year columns')
    cells = []
    for line in lines[row+1:]:
        tokens = line.split()
        numeric = []
        for token in tokens:
            if not re.fullmatch(r'\d+[.,]\d{2}|\.', token):
                break
            numeric.append(token)
        if not numeric:
            break
        cells.extend(numeric)
        if len(numeric) < len(tokens):
            break  # English product name follows the last numeric cell on this PDF line.
    require(len(cells) == len(years), 'NSI row width differs from year header width')
    value = cells[years.index(year)]
    require(value != '.', 'missing NSI observation for target year')
    return float(Decimal(value.replace(',', '.'))), label+'\n'+'\n'.join(cells), years


def statutory_fuel_rates(text):
    text = re.sub(r'\s+', ' ', text)
    section = re.search(r'Чл\.\s*32\..*?\(1\)(.*?)(?=\(2\))', text)
    require(section is not None, 'missing ЗАДС art.32(1)')
    result = {}
    for name, product in [('petrol', 'безоловен бензин'), ('diesel', 'газьол')]:
        matches = list(re.finditer(product+r'.{0,350}?([0-9]+(?:[.,][0-9]+)?) лв\. за 1000 литра', section[1]))
        require(len(matches) == 1, 'missing or ambiguous statutory fuel rate: '+name)
        result[name] = (Decimal(matches[0][1].replace(',', '.')), matches[0][0])
    return result

def checked_euro_excise(amount, statutory_bgn):
    converted = (Decimal(statutory_bgn) / Decimal(str(EUR))).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    require(Decimal(amount) == converted, 'EC national-currency amount is not the statutory EUR rate')
    return converted


class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts = []
    def handle_data(self, text):
        self.parts.append(text)

def extract():
    price_file = RAW / 'ec-oil/weekly-prices-2026-11-02.xlsx'
    prices = sheet(price_file, 'Sheet1')
    duty = sheet(RAW / 'ec-oil/duties-and-taxes-2026-11-07.xlsx', 'Excise duties')
    vat = sheet(RAW / 'ec-oil/duties-and-taxes-2026-11-07.xlsx', 'VAT')
    expected_date = re.fullmatch(r'weekly-prices-(\d{4}-\d{2}-\d{2})\.xlsx', price_file.name)[1]
    check_ec_tables(prices, duty, vat, expected_date)
    parser = Text(); parser.feed((RAW / 'excise-law/dv-69-2026-budget.html').read_text())
    law = re.sub(r'\s+', ' ', ' '.join(parser.parts))
    start = law.index('77 евро за 1000 къса')
    schedule_text = law[start:start+1100]
    dates = [('2026-08-01', '1 август 2026'), ('2027-03-01', '1 март 2027'), ('2028-01-01', '1 януари 2028')]
    schedule = []
    for i, (iso, words) in enumerate(dates):
        specific = re.search(r'(\d+) евро за 1000 къса от '+words, schedule_text)
        proportion = re.search(r'(\d+(?:,\d+)?) на сто от продажната цена от '+words, schedule_text)
        floor = re.search(r'(\d+) евро (?:на|за) 1000 къса от '+words, schedule_text[schedule_text.index('(2)'):])
        assert specific and proportion and floor
        schedule.append(dict(validFrom=iso, validTo=(dt.date.fromisoformat(dates[i+1][0])-dt.timedelta(days=1)).isoformat() if i+1<len(dates) else None,
                             specificPer1000=float(specific[1]), adValoremPct=float(proportion[1].replace(',', '.')), minimumPer1000=float(floor[1]),
                             unit='EUR/1000 sticks', source='excise-law', basis='ЗАДС, чл. 39; ДВ 69/31.07.2026, §31', quote=schedule_text))
    with fitz.open(RAW / 'nsi-pack/statistical-yearbook-2025.pdf') as pdf:
        pages = [(i+1, p.get_text()) for i, p in enumerate(pdf) if 'Цигари с филтър - кутия' in p.get_text()]
    require(len(pages) == 1, 'missing or ambiguous NSI product page')
    pg, text = pages[0]
    original, pack_quote, pack_years = parse_nsi_pack_table(text)
    # Annex 2 is evidence for the reduced bucket, without inventing consumption weights or category assignments.
    doc = Document(RAW / 'parliament/52-602-01-19.docx')
    reduced = [r for t in doc.tables for r in t.rows if any('настаняване, предоставяно' in c.text for c in r.cells)]
    assert len(reduced) == 1
    reduced_cells = [c.text for c in reduced[0].cells]
    reduced_pct = float(reduced_cells[3])
    with fitz.open(RAW / 'excise-law/excise-law-dv54-2025.pdf') as pdf:
        customs = ' '.join(p.get_text() for p in pdf)
    fuel_basis = {}
    rates = statutory_fuel_rates(customs)
    for name, column in [('petrol', 'C'), ('diesel', 'D')]:
        amount, quote = rates[name]
        checked_euro_excise(duty[column+'7'], amount)
        fuel_basis[name] = dict(source='customs-excise-law', quote=quote, basis='ЗАДС, чл. 32, ал. 1; консолидация ДВ 54/2025',
                                originalBgnPer1000=float(amount), conversionRate=EUR,
                                note='Историческият текст е в BGN. Коефициентът в EUR е сверен по фиксирания курс и закръгляне до цент за 1000 л.')
    for r in schedule:
        if r['validTo'] is None: del r['validTo']
    return {'meta': meta('D26', 'Параметри на косвените данъци', source=['ec-oil','excise-law','customs-excise-law','nsi-pack','bill'], as_of=excel_date(prices['A2']), source_note='Официални ставки и датирани справочни цени. Изчисленията са сценарий.'),
            'vat': {'standardPct':float(vat['C7']), 'standardSince':excel_date(vat['B7']), 'reducedPct':reduced_pct,
                    'untaxed':{'kind':'definition', 'label':'без ДДС / 0 %', 'basis':'ЗДДС — нулева ставка и освободени доставки',
                               'note':'Категория за разходи без начислен ДДС в тази сметка; не е извлечена ставка.'},
                    'source':['ec-oil','bill'], 'basis':'ЗДДС, чл. 66 и 66а; мотиви, Приложение 2', 'reducedQuote':' | '.join(reduced_cells), 'unit':'%'},
            'fuels': {name:dict(excisePerLitre=float(Decimal(duty[col+'7'])/1000), originalExcise=float(duty[col+'7']), originalUnit='EUR/1000 l', unit='EUR/l',
                                 validFrom=excel_date(duty['B7']), legalEvidence=fuel_basis[name], source='ec-oil', basis='ЗАДС, чл. 32; ЕК, Excise duties, '+col+'7',
                                 pricePerLitre=float(Decimal(prices[pcol+'5'])/1000), originalPrice=float(prices[pcol+'5']), priceDate=excel_date(prices['A2']), priceSource='ec-oil')
                      for name,col,pcol in [('petrol','C','B'),('diesel','D','C')]},
            'cigarettes':schedule,
            'references':{'pack':{'originalValue':original,'originalUnit':'BGN/pack','priceEur':round(original/EUR, 8),'conversionRate':EUR,'period':'2025','published':'2026-06-02',
                                  'source':'nsi-pack','page':pg,'printedPage':200,'table':'VIII.8','quote':pack_quote, 'yearHeaders':pack_years, 'unit':'EUR/pack',
                                  'note':'Цигари с филтър, кутия; броят късове се въвежда отделно.'}}}

def build_indirect_taxes(ctx):
    return ctx.put('indirect-tax-parameters.json', extract())
