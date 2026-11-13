"""Strict envelopes for the additional published monthly and quarterly budget contracts."""
import math
import re


def valid_budget_tables(doc, filename=None):
    if not isinstance(doc, dict) or doc.get('sourceIntegerScale') != 10000000 or doc.get('conversionRate') != 1.95583 or doc.get('unit') != 'млн. €':
        return False
    monthly = doc.get('schema') == 'state-budget/1'
    if not monthly and doc.get('schema') != 'kfp-subsectors/1':
        return False
    if doc.get('scope') != ('държавен бюджет' if monthly else 'КФП по подсектори') or doc.get('frequency') != ('monthly-cumulative' if monthly else 'quarterly-flows'):
        return False
    if doc.get('sourcePage') != 'https://www.minfin.bg/bg/statistics/%d' % (18 if monthly else 6):
        return False
    if filename is not None and doc.get('schema') != {'state-budget.json': 'state-budget/1', 'kfp-subsectors.json': 'kfp-subsectors/1'}.get(filename):
        return False
    meta = doc.get('meta')
    if not isinstance(meta, dict) or meta.get('id') != ('D36' if monthly else 'D37') or meta.get('status') != 'real' or meta.get('mock') is not False:
        return False
    tables = doc.get('tables')
    if not isinstance(tables, list) or len(tables) != (21 if monthly else 11):
        return False
    seen = set()
    for t in tables:
        if not isinstance(t, dict) or not re.fullmatch('[a-f0-9]{64}', str(t.get('sha256', ''))):
            return False
        year, period, scope = t.get('year'), t.get('period'), t.get('scope')
        if type(year) is not int or type(period) is not int:
            return False
        if monthly:
            if scope != 'state' or year not in (2025, 2026) or not 1 <= period <= (12 if year == 2025 else 9):
                return False
        elif scope not in ('consolidated', 'central', 'social', 'local') or year not in (2024, 2025, 2026) or period != (2 if year == 2026 else 4) or (scope == 'central' and year == 2025):
            return False
        key = (year, period, scope)
        if key in seen:
            return False
        seen.add(key)
        columns, rows = t.get('columns'), t.get('rows')
        if not isinstance(columns, list) or len(columns) != (2 if monthly else period) or not isinstance(rows, list) or not rows:
            return False
        if any(not isinstance(c, dict) or c.get('unit') not in ('BGN', 'EUR') for c in columns):
            return False
        required = set(range(9, 20 if year == 2025 else 19)) if monthly else {8,10,11,12,13,14,15,16,17,18,19,21,23,26,28,30,31,32,35,38,40,41,42,47,49,50,51,52}
        if not monthly and scope != 'consolidated':
            required.add(44)
        row_ids = [r.get('row') for r in rows if isinstance(r, dict)]
        if len(set(row_ids)) != len(rows) or not required.issubset(row_ids):
            return False
        for index, col in enumerate(columns):
            expected_id = ('law', 'execution')[index] if monthly else 'Q%d' % (index+1)
            unit = 'BGN' if year < 2026 or (monthly and index == 0 and period <= 6) else 'EUR'
            if col.get('id') != expected_id or col.get('unit') != unit:
                return False
        for row in rows:
            if not isinstance(row, dict) or type(row.get('row')) is not int or not isinstance(row.get('label'), str):
                return False
            source, eur = row.get('source'), row.get('eur')
            if not isinstance(source, list) or not isinstance(eur, list) or len(source) != len(columns) or len(eur) != len(columns):
                return False
            for index, (a, b) in enumerate(zip(source, eur)):
                if a is None:
                    if b is not None:
                        return False
                elif type(a) is not int or abs(a) > 2**53 - 1 or type(b) not in (int, float) or not math.isfinite(b):
                    return False
                elif b != float(format(a / 10000000 / (1.95583 if columns[index]['unit'] == 'BGN' else 1), '.6f')):
                    return False
        if not isinstance(t.get('checks'), dict) or any(type(v) is not int for v in t['checks'].values()):
            return False
    if not monthly:
        missing = doc.get('missing')
        if not isinstance(missing, list) or len(missing) != 1 or not isinstance(missing[0], dict) or missing[0].get('year') != 2025 or missing[0].get('scope') != 'central' or not missing[0].get('reason'):
            return False
    return True


def has_tax_contracts(ctx):
    try:
        return all(valid_budget_tables(ctx.get(name), name) for name in ('state-budget.json', 'kfp-subsectors.json'))
    except FileNotFoundError:
        return False
