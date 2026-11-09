#!/usr/bin/env python3
"""Extract the pinned 2027 draft PDF directly from its ZIP (never the DOCX).

Run with python -m budget_pipeline.extract.budget_bill_2027. Output is an intermediate, not site data.
Amounts are thousand EUR; null preserves an empty cell / printed dash.
Checks use Decimal, allowing 0.05 per independently rounded printed cell
(including the total). Partial lists explicitly marked 'в т.ч.' are not sums.
Physical tables, raw cells and page references accompany the law_bill-shaped
budget records so downstream users can audit every printed row.
"""
import argparse
from collections import Counter
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile
import tempfile

import pymupdf
from budget_pipeline.extract import budget_law_parser as L

from budget_pipeline.build.data_io import ROOT, RAW as ORIGINALS, SRC, jload, sha256_file
INPUT = ORIGINALS / 'budget_2027/ZDBRB-2027.zip'
MEMBER = 'ZDBRB-2027/3-PZDBRB-2027.pdf'
OUTPUT = SRC / 'budget_bill_2027.json'
NUMBER = re.compile(r'-?\d+(?:[\s\u00a0]\d+)*,\d+')
HEAD = re.compile(r'Чл\.\s*(\d+)\.\s*(?:\(1\)\s*)?Приема\s+(?:бюджета на (.*?) за 2027 г\.|държавния бюджет)', re.S)
ARTICLE = re.compile(r'^Чл\.\s*(\d+)\.')


def number(s):
    """Parse a whole monetary cell, including line-wrapped thousands."""
    t = re.sub(r'\s+', '', s).replace('−', '-').replace('–', '-')
    if t in ('', '-'):
        return None
    if not re.fullmatch(r'-?\d+(?:,\d+)?', t):
        raise ValueError(f'unparsed amount: {s!r}')
    return float(Decimal(t.replace(',', '.')))


def dec(v):
    return Decimal(str(v or 0))


def require(ok, message):
    if not ok:
        raise ValueError(message)


class Checks:
    def __init__(self):
        self.results = []

    def equal(self, label, parts, total):
        require(total is not None and all(v is not None for v in parts), f'{label}: missing amount')
        delta = sum(map(dec, parts), Decimal(0)) - dec(total)
        tolerance = Decimal('0.05') * (len(parts) + 1)
        require(abs(delta) <= tolerance, f'{label}: delta {delta}, tolerance {tolerance}')
        self.results.append({'check': label, 'delta': float(delta), 'tolerance': float(tolerance)})


def read_pdf(path=INPUT):
    acquisition = jload(path.parent / 'acquisition.json')
    pin = next(a for a in acquisition if a['file'] == path.name)
    require(sha256_file(path) == pin['sha256'], 'ZIP pin mismatch')
    with zipfile.ZipFile(path) as archive:
        pdf = archive.read(MEMBER)
    member_pin = next(m for m in pin['members'] if m['name'] == MEMBER)
    require(hashlib.sha256(pdf).hexdigest() == member_pin['sha256'], 'PDF member pin mismatch')
    doc = pymupdf.open(stream=pdf, filetype='pdf')
    require(len(doc) == 159, 'PDF page count changed')
    return doc, {'archive': str(path.relative_to(ROOT)), 'sha256': pin['sha256'],
                 'member': MEMBER, 'memberSha256': member_pin['sha256'], 'pages': len(doc)}


def physical(doc):
    """Order outside paragraphs and ruled tables; retain all cells, including blanks.

    Word's borderless layout generates many spurious empty columns. Keep those
    in rawCells; only the semantic three-column budget view collapses them.
    """
    stream, tables = [], []
    for page_no, page in enumerate(doc, 1):
        found = page.find_tables().tables
        events = []
        for table in found:
            cells = [[L.ws(c) for c in row] for row in table.extract()]
            # The right border of the delegated table is clipped by the PDF
            # media box. MuPDF loses the total's final merged cell. Recover
            # uncovered text from the row geometry, never from a typed value.
            for raw, row in zip(cells, table.rows):
                boxes = [c for c in row.cells if c]
                if not boxes:
                    continue
                right = max(c[2] for c in boxes)
                if right < table.bbox[2] - 5 and any(NUMBER.fullmatch(c) for c in raw):
                    tail = L.ws(page.get_textbox(pymupdf.Rect(right, row.bbox[1], page.rect.width, row.bbox[3])))
                    if NUMBER.fullmatch(tail):
                        raw[-1] = tail
            if not any(NUMBER.search(c) or 'Показатели' in c for row in cells for c in row):
                continue
            rec = {'id': len(tables), 'page': page_no, 'bbox': list(table.bbox), 'rawCells': cells}
            tables.append(rec)
            events.append((table.bbox[1], 't', rec))
        # Read original line order within blocks; footers are outside the body.
        for block in page.get_text('dict')['blocks']:
            if 'lines' not in block:
                continue
            lines = []
            first_y = None
            for line in block['lines']:
                box = line['bbox']
                x, y = (box[0] + box[2])/2, (box[1] + box[3])/2
                if y > 550 or any(t['bbox'][0]-1 <= x <= t['bbox'][2]+1 and
                                  t['bbox'][1]-1 <= y <= t['bbox'][3]+1
                                  for _, k, t in events if k == 't'):
                    continue
                if first_y is None:
                    first_y = box[1]
                lines.append(''.join(s['text'] for s in line['spans']))
            text = L.ws(' '.join(lines))
            if text and text != str(page_no):
                events.append((first_y, 'p', text))
        for _, kind, value in sorted(events, key=lambda e: e[0]):
            if kind == 'p':
                stream.append((page_no, kind, value))
                continue
            chunk = []
            for raw in value['rawCells']:
                occupied = [c for c in raw if c]
                if occupied and re.match(r'(?:\(\d+\)|Чл\.)', occupied[0]):
                    if chunk:
                        stream.append((page_no, 't', dict(value, rawCells=chunk)))
                        chunk = []
                    stream.append((page_no, 'p', occupied[0]))
                else:
                    chunk.append(raw)
            if chunk:
                stream.append((page_no, 't', dict(value, rawCells=chunk)))
    return stream, tables


def budget_rows(table):
    out = []
    for raw in table['rawCells']:
        cells = [c for c in raw if c]
        if not cells:
            continue
        # A semantic amount is always the last occupied cell in these tables.
        if not NUMBER.fullmatch(cells[-1]):
            require(not any(NUMBER.fullmatch(c) for c in cells),
                    f"page {table['page']}: amount before unexpected cell: {cells}")
            if len(cells) == 1 and re.fullmatch(r'в\s*т\.\s*ч\.[,:]?', cells[0], re.I):
                out.append({'no': '', 'text': cells[0], 'value': None, 'page': table['page'], 'table': table['id']})
                continue
            if len(cells) >= 2 and (L.roman(cells[0]) or re.fullmatch(r'\d+(?:\.\d+)*\.', cells[0])):
                out.append({'no': cells[0], 'text': L.ws(' '.join(cells[1:])), 'value': None,
                            'page': table['page'], 'table': table['id']})
                continue
            continue
        value = number(cells[-1])
        prefix = cells[:-1]
        no = prefix.pop(0) if prefix and re.fullmatch(r'(?:[IVXІХ]+\.|\d+(?:\.\d+)*\.?)', prefix[0]) else ''
        if prefix and prefix[0] == no:
            prefix.pop(0)
        out.append({'no': no, 'text': L.ws(' '.join(prefix)), 'value': value,
                    'page': table['page'], 'table': table['id']})
    return out


def records(stream):
    arts, misc, current, mode, article = {}, {}, None, 'main', None
    for page, kind, val in stream:
        if kind == 'p':
            m = ARTICLE.match(val)
            if m:
                article = int(m[1])
                current = None
            h = HEAD.search(val)
            if h:
                article = int(h[1])
                current = {'article': article, 'name': L.ws(h[2]) if h[2] else 'Държавен бюджет',
                           'pages': [], 'rows': [], 'policiesRows': [], 'bodiesRows': [], 'commitmentRows': [], 'extraRows': [], 'amountParagraphs': []}
                arts.setdefault(str(article), []).append(current)
                mode = 'main'
            if current:
                if NUMBER.search(val):
                    current['amountParagraphs'].append({'page': page, 'text': val, 'amounts': [number(m[0]) for m in NUMBER.finditer(val)]})
                if re.search(r'Утвърждава (?:разпределение на )?разходите .*по ал\.\s*1', val):
                    mode = 'policies'
                    current['policiesKind'] = 'policies' if 'политики' in val else 'areas'
                elif 'Определя бюджетните разходи на органите' in val:
                    mode = 'bodies'
                elif 'Утвърждава максималните размери на ангажиментите' in val:
                    mode = 'commit'
                elif not h and re.match(r'^\(\d+\)', val) and article != 1:
                    mode = 'extra'
                if page not in current['pages']:
                    current['pages'].append(page)
            else:
                misc.setdefault(str(article), []).append({'page': page, 'text': val, 'amounts': [number(m[0]) for m in NUMBER.finditer(val)]})
        elif current:
            current['pages'] = sorted(set(current['pages'] + [page]))
            key = {'main': 'rows', 'policies': 'policiesRows', 'bodies': 'bodiesRows', 'commit': 'commitmentRows', 'extra': 'extraRows'}[mode]
            current[key].extend(budget_rows(val))
        else:
            misc.setdefault(str(article), []).append({'page': page, 'table': val['id']})
    for occurrences in arts.values():
        for b in occurrences:
            section = ''
            for row in b['rows']:
                section = L.roman(row['no']) or section
                row['sec'] = section
            b['headline'] = L.headline(b['rows'])
            b['lines'] = [[r['sec'], r['no'].rstrip('.'), r['text'], r['value']] for r in b['rows']]
            b['policies'], b['bodies'] = [], []
            b['policyTotal'] = b['bodiesTotal'] = None
            for key, out, total in [('policiesRows', 'policies', 'policyTotal'), ('bodiesRows', 'bodies', 'bodiesTotal')]:
                for r in b[key]:
                    if L.squash(r['text']).startswith('ВСИЧКО'):
                        b[total] = r['value']
                        continue
                    item = {'n': r['no'].rstrip('.'), 'name': r['text'], 'khil': r['value'], 'page': r['page']}
                    if out == 'policies' and b[out] and not item['n'].isdigit():
                        b[out][-1].setdefault('parts', []).append(item)
                    else:
                        b[out].append(item)
            cm = b['commitmentRows']
            b['commitments'] = {'entered': cm[0]['value'], 'new': cm[1]['value']} if len(cm) == 2 else None
    return arts, misc


def municipal(tables, start, end, cols, checks):
    rows, total, region, pages = [], None, None, []
    for t in tables:
        if not start <= t['page'] <= end:
            continue
        pages.append(t['page'])
        for raw in t['rawCells']:
            cells = [c for c in raw if c]
            if not cells:
                continue
            if cells[0].startswith('ОБЛАСТ'):
                region = cells[0]
                continue
            if len(cells) == 1 and region and cells[0].isupper() and not cells[0].startswith('ВСИЧКО'):
                region = L.ws(region + ' ' + cells[0])
                continue
            if len(cells) != len(cols) + 1 or not all(NUMBER.fullmatch(c) for c in cells[1:]):
                require(not any(NUMBER.fullmatch(c) for c in cells), f"municipal page {t['page']}: {cells}")
                continue
            values = [number(c) for c in cells[1:]]
            if L.squash(cells[0]).startswith('ВСИЧКО'):
                total = values
            else:
                reg = 'ОБЛАСТ СОФИЯ (СТОЛИЦА)' if L.squash(cells[0]) == 'СТОЛИЧНАОБЩИНА' else region
                rows.append({'name': cells[0], 'region': reg, 'values': values, 'page': t['page']})
    require(len(rows) == 265, f'municipal {start}: {len(rows)} rows')
    require(len({(L.fold(r['region']), L.fold(r['name'])) for r in rows}) == 265, 'duplicate municipality')
    require(total is not None, 'missing municipal total')
    for j, col in enumerate(cols):
        checks.equal(f'municipal {start} column {col}', [r['values'][j] for r in rows], total[j])
    for r in rows:
        v = r['values']
        checks.equal(f"municipal {start} {r['region']} {r['name']}", v[1:] if len(v) == 5 else [v[1], *v[4:]], v[0])
        if len(v) == 10:
            checks.equal(f"municipal admin {r['name']}", v[2:4], v[1])
    return {'cols': cols, 'rows': rows, 'total': total, 'pages': sorted(set(pages))}


def projects(tables):
    rows = []
    for t in tables:
        if t['page'] < 126:
            continue
        for raw in t['rawCells']:
            if len(raw) == 8 and raw[0].isdigit():
                rows.append({'n': int(raw[0]), 'id': raw[1], 'name': raw[2],
                             'values': [number(c) for c in raw[3:6]], 'indicator': raw[6],
                             'institution': raw[7], 'pages': [t['page']]})
            elif len(raw) == 8 and not any(raw[:2]) and any(raw[2:]):
                require(bool(rows), 'project continuation without previous row')
                for j, key in [(2, 'name'), (6, 'indicator'), (7, 'institution')]:
                    rows[-1][key] = L.ws(rows[-1][key] + ' ' + raw[j])
                require(not any(raw[3:6]), 'amount in unnumbered project continuation')
                rows[-1]['pages'] = sorted(set(rows[-1]['pages'] + [t['page']]))
            else:
                require(not any(NUMBER.fullmatch(c) for c in raw), f"unparsed project page {t['page']}: {raw}")
    require([r['n'] for r in rows] == list(range(1, 227)), 'project sequence incomplete')
    require(len({r['id'] for r in rows}) == len(rows), 'duplicate project id')
    return {'article': 108, 'annex': 2, 'years': [2027, 2028, 2029], 'unit': 'хил. евро', 'rows': rows,
            'pages': list(range(126, 160))}


def validate(arts, checks):
    require(sorted(map(int, arts)) == list(range(1, 49)), 'budget-defining article sequence differs')
    for a, occ in arts.items():
        require(len(occ) == (2 if a in ('1', '2') else 1), f'article {a} occurrence count')
        for i, b in enumerate(occ):
            label = f'article {a} occurrence {i+1}'
            h = b['headline']
            require('exp' in h, f'{label}: headline missing')
            if a != '1':
                require(b['policies'] and b['policyTotal'] is not None, f'{label}: missing policies')
                require(b['commitments'], f'{label}: missing commitments')
                checks.equal(label + ' policy total', [p['khil'] for p in b['policies']], b['policyTotal'])
                checks.equal(label + ' expenditure vs policies', [h['exp']], b['policyTotal'])
                for p in b['policies']:
                    if p.get('parts') and all(x['n'] for x in p['parts']):
                        checks.equal(label + ' programme ' + p['n'], [x['khil'] for x in p['parts']], p['khil'])
            extra = b['extraRows']
            totals = [r for r in extra if L.squash(r['text']).startswith('ВСИЧКО')]
            if totals:
                require(len(totals) == 1, label + ': unexpected supplemental totals')
                checks.equal(label + ' supplemental table total',
                             [r['value'] for r in extra if r['no'].rstrip('.').isdigit()], totals[0]['value'])
            if b['bodies']:
                checks.equal(label + ' judiciary bodies', [p['khil'] for p in b['bodies']], b['bodiesTotal'])
            sign = -1 if a == '1' else 1
            checks.equal(label + ' balance', [(h.get('rev') or 0), -h['exp'], sign*h.get('transfers', 0), -h.get('eucontrib', 0)], h['balance'])
            checks.equal(label + ' financing', [h['balance'], h['financing']], 0)
            # Complete first-level revenue/expenditure groups. Deeper 'в т.ч.'
            # breakdowns are subsets, not exhaustive component lists.
            for section in ('I', 'II', 'III', 'V', 'VI'):
                r = [r for r in b['rows'] if r['sec'] == section]
                children = [x['value'] for x in r if re.fullmatch(r'\d+\.', x['no'])]
                if a == '1' and section == 'III' and children:
                    children = [v if j == 0 else -v for j, v in enumerate(children)]
                if children and all(v is not None for v in children):
                    checks.equal(label + ' section ' + section, children, r[0]['value'])
            # Revenue classifications are exhaustive. Expenditure/transfer
            # detail contains selective disclosures even without a 'в т.ч.'
            # marker (e.g. art. 15 III/2.1 only names the DОО component).
            for j, parent in enumerate(b['rows']):
                n = parent['no'].rstrip('.')
                if parent['sec'] != 'I' or not re.fullmatch(r'\d+(?:\.\d+)*', n) or parent['value'] is None:
                    continue
                following = []
                for row in b['rows'][j+1:]:
                    rn = row['no'].rstrip('.')
                    if row['no'] and not rn.startswith(n + '.'):
                        break
                    following.append(row)
                children = [r['value'] for r in following if r['no'].rstrip('.').startswith(n+'.') and
                            r['no'].rstrip('.').count('.') == n.count('.')+1]
                partial = any(re.search(r'в\s*т\.\s*ч', r['text'], re.I) for r in [parent, *following] if not r['no'] or r is parent or r['no'].rstrip('.').count('.') == n.count('.')+1)
                if children and not partial:
                    checks.equal(label + ' components ' + parent['sec'] + '/' + n, children, parent['value'])
    require(arts['1'][0]['headline']['rev'] == 30942719.3, 'article 1 revenue anchor')
    require(arts['1'][0]['headline']['exp'] == 18345717.4, 'article 1 expenditure anchor')


def coverage(doc, stream, tables):
    results = []
    for page in doc:
        texts = [' '.join(c for r in t['rawCells'] for c in r) for t in tables if t['page'] == page.number+1]
        texts += [v for p, k, v in stream if p == page.number+1 and k == 'p']
        # Compare decimal tokens independently of thousands grouping/line wraps.
        # This covers prose on table pages as well as monetary and indicator cells.
        pattern = r'\d+,\d+'
        printed = Counter(re.findall(pattern, page.get_text()))
        captured = Counter(re.findall(pattern, ' '.join(texts)))
        missing = printed - captured
        require(not missing, f'page {page.number+1}: uncovered decimal tokens {dict(missing)}')
        results.append({'page': page.number+1, 'decimalTokens': sum(printed.values()), 'unparsed': 0})
    return results


def build():
    doc, source = read_pdf()
    stream, tables = physical(doc)
    arts, misc = records(stream)
    other_tables = {}
    for article, items in misc.items():
        if article in ('49', '50'):
            other_tables[article] = [r for item in items if 'table' in item for r in budget_rows(tables[item['table']])]
    coverage_results = coverage(doc, stream, tables)
    checks = Checks()
    validate(arts, checks)
    for variant in ('bill', 'billMc'):
        budgets = [occ[1 if variant == 'billMc' and len(occ) == 2 else 0]
                   for a, occ in arts.items() if a != '1']
        checks.equal(variant + ' spending-unit expenditure aggregate vs printed distribution totals',
                     [b['headline']['exp'] for b in budgets], sum(dec(b['policyTotal']) for b in budgets))
    debt = other_tables['50']
    checks.equal('article 50 total', [r['value'] for r in debt if r['no'].isdigit()], debt[-1]['value'])
    checks.equal('article 50 university subgroups', [r['value'] for r in debt if r['text'].startswith(('А)', 'Б)'))],
                 next(r['value'] for r in debt if r['no'] == '5'))
    checks.equal('article 50 university detail',
                 [r['value'] for r in debt if r['no'].startswith('5.')],
                 next(r['value'] for r in debt if r['no'] == '5'))
    muni = {
        'art52': municipal(tables, 79, 89, ['total', 'delegated', 'equalizing', 'winterRoads', 'capital'], checks),
        'art53': municipal(tables, 90, 100, ['delegated', 'admin', 'mayors', 'adminStaff', 'defence', 'education', 'health', 'social', 'culture', 'economy'], checks),
    }
    for a, b in zip(muni['art52']['rows'], muni['art53']['rows']):
        require((L.fold(a['region']), L.fold(a['name'])) == (L.fold(b['region']), L.fold(b['name'])), 'municipality identity mismatch')
        checks.equal('delegated cross-table ' + a['name'], [a['values'][1]], b['values'][0])
    result = {'year': 2027, 'unit': 'хил. евро', 'source': source,
              'bill': {a: occ[0] for a, occ in arts.items()},
              'billMc': {a: occ[1] for a, occ in arts.items() if len(occ) == 2},
              'municipal': muni, 'projects': projects(tables), 'articles': misc, 'otherTables': other_tables, 'tables': tables,
              'sums': {variant: {'budgets': 47,
                  'expKhil': float(sum(dec((occ[1] if variant == 'billMc' and len(occ) == 2 else occ[0])['headline']['exp']) for a, occ in arts.items() if a != '1')),
                  'revKhil': float(sum(dec((occ[1] if variant == 'billMc' and len(occ) == 2 else occ[0])['headline'].get('rev')) for a, occ in arts.items() if a != '1'))}
                  for variant in ('bill', 'billMc')},
              'checks': checks.results, 'coverage': coverage_results,
              'limitations': ['The PDF prints no standalone aggregate revenue/expenditure total for articles 2–48. Expenditure aggregate is checked against the sum of their printed distribution totals; revenue is checked per budget.',
                              'Annex 2 prints no overall or per-year project total; all 226 numbered rows and three annual cells are checked for completeness.'], 'tolerance': '0.05 thousand EUR per independently rounded printed cell, including total'}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        result = build()
        data = json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + '\n'
        if args.check:
            with tempfile.TemporaryDirectory() as tmp:
                regenerated = Path(tmp) / 'bill.json'
                regenerated.write_text(data, encoding='utf-8')
                require(regenerated.read_bytes() == args.output.read_bytes(), 'frozen extraction differs')
        else:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(data, encoding='utf-8')
        print(f"{args.output}: {len(result['bill'])-1} budgets, {len(result['tables'])} physical tables, "
              f"{len(result['projects']['rows'])} projects; {len(result['checks'])} arithmetic checks passed")
    except (ValueError, KeyError) as exc:
        print(f'extract_bill_2027: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
