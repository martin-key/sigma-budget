"""Sparse adopted-law denominator from the pinned MF annex 1, never annex 3."""
from decimal import Decimal
from .annual_periods import Lineage, LAW_TABLE, PUBLICATION

LAW_ROWS = {'rev': 0, 'rev.tax': 1, 'rev.nontax': 6, 'rev.grants': 7,
            'exp.total': 8, 'exp.interest': 14, 'eucontrib': 15,
            'exp.capex': 11, 'exp.abroad': 12, 'exp.contingency': 13, 'balance': 17}
MISSING = ('exp.personnel', 'exp.maint', 'exp.social', 'exp.subsidies',
           'exp.reserve', 'exp.interest.ext', 'exp.interest.dom')
REASON = 'Приложение 1 не дава отделен законов знаменател за този ред.'
SPLIT_REASON = 'Приложение 1 не дава национална/европейска разбивка на закона; колони 2/3 са отчет.'
COVERAGE = {'kfp': {r: REASON for r in MISSING}, 'nat': SPLIT_REASON, 'eu': SPLIT_REASON}


def law_plan():
    l = Lineage()
    rows = l.inputs['F']['tables'][LAW_TABLE]['rows']
    cells = {}
    for rid, row in LAW_ROWS.items():
        output = 'execution.json#/plan2026/kfp/' + rid
        cell = l.f(LAW_TABLE, row, 0, output, '2026.law')
        cells[rid] = {**l.entries[cell['provenance']], 'row': rows[row]['label'], 'rowIndex': row}
    values = {rid: float(Decimal(str(rows[row]['values'][0]))) for rid, row in LAW_ROWS.items()}
    values['exp'] = float(Decimal(str(values['exp.total'])) - Decimal(str(values['eucontrib'])))
    values['fin'] = -values['balance']
    cells['exp'] = {'operation': 'subtract', 'operands': ['exp.total', 'eucontrib'],
                    'cells': [cells['exp.total'], cells['eucontrib']]}
    cells['fin'] = {'operation': 'negate', 'basis': 'balancing-operation', 'operands': ['balance'],
                    'cells': [cells['balance']]}
    plan = dict(kfp=values, nat={}, eu={}, periodKey='2026.law', basis='adopted-law',
                source=['budget2027'], asOf=PUBLICATION, unit='млн. €', coverage=COVERAGE,
                note='Програма по ЗДБРБ 2026, МФ, приложение 1. Финансирането е балансова операция (-салдо).')
    doc = l.documents['forecast']
    prov = {'kfp': dict(doc, sha256=doc['memberSha256'], periodKey='2026.law', basis='adopted-law',
                        table=LAW_TABLE, column=l.inputs['F']['tables'][LAW_TABLE]['columns'][0], rows=cells),
            'nat': {'rows': {}, 'reason': SPLIT_REASON}, 'eu': {'rows': {}, 'reason': SPLIT_REASON}}
    return plan, prov
