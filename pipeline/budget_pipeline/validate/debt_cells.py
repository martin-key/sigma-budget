"""Independent PDFMiner/pdfplumber audit of every extracted D38 table cell.

No generator imports or saved expected numbers. External columns come from PDF
rulings, not MuPDF character baselines. Amounts use Decimal at source precision.
"""
import hashlib
import json
import re
import sys
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
import pdfplumber

SOURCE = '8670a89001a46165f55f94ee4d760eedf08e3b69476a4b36cb9f29cacd3360f7'
DEFAULT = Path(__file__).resolve().parents[3] / 'data/originals/debt/Bulletin_GovDebt_09-2026_bg.pdf'

def amount(s, scale=1):
    return int(Decimal(s.replace(' ', '').replace('*', '')) * scale)

def date(s):
    day, month, year = s.split('.')
    return f'{"20" + year if len(year) == 2 else year}-{month}-{day}'

@lru_cache(maxsize=2)
def extract(path, sha):
    if sha != SOURCE:
        raise ValueError('Independent debt source SHA mismatch')
    with pdfplumber.open(path) as pdf:
        text = {n: pdf.pages[n].extract_text() for n in (4,5,6,7)}
        domestic = []
        for line in text[6].splitlines():
            if not re.search(r'BG\d{10} EUR', line):
                continue
            prefix, tail = line.split(' EUR ')
            term, isin = prefix.rsplit(' ', 1)
            issued, maturity, rest = tail.split(' ', 2)
            tokens = re.findall(r'\d[\d ]*\.\d{2}', rest)
            if len(tokens) != 7:
                raise ValueError('Independent domestic columns')
            domestic.append(dict(originalMaturity=term, isin=isin, currency='EUR',
                issueDate=date(issued), maturity=date(maturity),
                **dict(zip(('offered','bids','nominal'), [amount(x,1000) for x in tokens[:3]])),
                **dict(zip(('price','coupon','coverage','yield'), [float(x) for x in tokens[3:]]))))
        auctions = []
        for line in text[7].splitlines():
            if not re.match(r'\d{2}\.\d{2}\.26 ', line):
                continue
            fields = line.split()
            rest = line.split(' г. ', 1)[1]
            tokens = re.findall(r'\d[\d ]*\.\d{2}', rest)
            if len(tokens) != 6:
                raise ValueError('Independent auction columns')
            auctions.append(dict(date=date(fields[0]), settlement=date(fields[1]), isin=fields[2],
                coupon=float(fields[4].rstrip('%')), issueDate=date(fields[5]), maturity=date(fields[6]),
                **dict(zip(('offered','bids','approved'), [amount(x,1000) for x in tokens[:3]])),
                **dict(zip(('price','yield','coverage'), [float(x) for x in tokens[3:]]))))
        external = []
        for n in (13,14):
            page = pdf.pages[n]
            columns = page.find_tables()[0].rows[0].cells[1:]
            for box in columns:
                col = page.crop((box[0],0,box[2],page.height)).extract_text()
                tail = re.split(r'\b(EUR|USD)\b\n', col, maxsplit=1)
                currency, lines = tail[1], tail[2].splitlines()
                # Three consecutive source rows: original, reopening, post-reopening.
                nominal = amount(lines[0] if lines[2] == '-' else lines[2])
                dates = re.findall(r'\d{2}\.\d{2}\.\d{4}', '\n'.join(lines[3:]))
                # Pricing date(s), then settlement date(s), then maturity. The one
                # reopened 2015 issue prints two pricing and two settlement dates.
                count = 2 if '/' in lines[3] else 1
                issued = min(date(x) for x in dates[count:2*count])
                external.append(dict(isins=re.findall(r'XS\d{10}',col), currency=currency,
                    nominal=nominal, issueDate=issued, maturity=date(dates[2*count]), page=n+1))
        maturity = []
        for line in text[5].splitlines():
            m = re.fullmatch(r'(До 1 година|От 1 до 5 години|От 5 до 10 години|Над 10 години) (-|[\d.]+%) ([\d.]+)%',line)
            if m:
                maturity.append(dict(label=m[1], residualTenths=amount(m[3],10),
                    **({} if m[2]=='-' else dict(originalTenths=amount(m[2][:-1],10)))))
        def stock(label):
            line = next(l for l in text[4].splitlines() if l.startswith(label))
            return amount(re.findall(r'\d[\d ]*\.\d',line)[-1],1000000)
        domestic_stock = stock('І. ДЦК, емитирани на вътрешния пазар')
        external_stock = stock('І. ДЦК, емитирани на МКП')
        return dict(domestic=domestic, auctions=auctions, external=external, maturity=maturity,
            stock=dict(domestic=domestic_stock,external=external_stock), differences=dict(
                externalStockComponents=stock('Външен държавен дълг')-external_stock-stock('ІІ. Заеми'),
                domesticStock=sum(r['nominal'] for r in domestic)-domestic_stock,
                originalMaturity=sum(r.get('originalTenths',0) for r in maturity)-1000,
                residualMaturity=sum(r['residualTenths'] for r in maturity)-1000))

def verify_debt_cells(document, path=DEFAULT):
    path = Path(path).resolve()
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    expected = extract(str(path),sha)
    if document.get('sourceSha256') != sha:
        return False
    return all(document.get(k) == v for k,v in expected.items())

if __name__ == '__main__':
    try:
        if sys.argv[1] == '--reference':
            path = DEFAULT
            sha = hashlib.sha256(path.read_bytes()).hexdigest()
            print(json.dumps(dict(sourceSha256=sha, tables=extract(str(path),sha)), ensure_ascii=False, indent=2))
            sys.exit(0)
        if not verify_debt_cells(json.load(sys.stdin),sys.argv[1]):
            raise ValueError('D38 cells differ from independent PDFMiner extraction')
    except (ValueError,KeyError,IndexError,OSError) as error:
        sys.exit(str(error))
