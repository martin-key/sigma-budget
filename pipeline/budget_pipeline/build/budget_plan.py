#!/usr/bin/env python3
"""Build data/release/dbp2027.json (the numbers of the screen S34 "Бюджет 2027 (проект)").

Input : data/cache/research/dbp-2027/dbp2027_figures.json  (made by pipeline/budget_pipeline/extract/dbp2027.py from the PDF of the
        Draft Budgetary Plan 2027, 55 pages, МФ, 15.10.2026) + a few figures added by hand below.
Output: data/release/dbp2027.json

Rules (see the task brief):
 * no number without a page: every figure has `p` (page of the PDF) and `b` (basis: ESA_GG, KFP_CASH, ...);
 * a value that is not printed in the document is `k: "derived"` and carries its formula `f`;
 * ESA (начислена основа) and КФП (касова) figures stay apart: `b` says which one a figure is;
 * nothing here is read from the old mock or from the other screens.

The hand-added figures were read from the PDF text on the page named in `p` (checked again by
pipeline/budget_pipeline/build/budget_plan_check.py, which looks every printed value up on its page).

Run: python -m budget_pipeline.build.budget_plan
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import json
import hashlib
import re
import sys
from pathlib import Path

W = Path(__file__).resolve().parents[3]          # repository root
SRC = W / 'data' / 'cache' / 'research' / 'dbp-2027' / 'dbp2027_figures.json'     # not in the repository: made by dbp2027.py
PDF = W / "data" / "originals" / "budget_2027" / "Draft_Budgetary_Plan_of_the_Republic_of_Bulgaria_for_2027.pdf"
OUT = W / 'data' / 'release' / 'dbp2027.json'

# figure-id prefixes that the screen uses (everything else in the research file is left out on purpose:
# macro table, external environment, cash data to 31.08.2026, RRF grants)
USE = ('t4.', 't6.', 'rule.', 'n26.', 'n27.', 'm.', 'm27.', 'd.', 'def.')
# n27.MOD (2400 EUR) and the cash c26.* are not used as numbers of the screen; MOD stays inside the measure text.
SKIP = {'n27.MOD'}

# figures read by hand from the PDF (id -> value, unit, year, page, table/place, basis)
EXTRA = [
    ('d.GROSS.pct.2024', 23.8, '% от БВП', 2024, 28, 'текст, т. 4.3', 'ESA_GG'),
    ('rule.NETEXP_CUM.2026', 4.2, '% кумулативно', 2026, 8, 'текст, т. 2', 'EU_RULE'),
    ('rule.NETEXP_CUM.2028', 11.4, '% кумулативно', 2028, 8, 'текст, т. 2', 'EU_RULE'),
    ('rule.EDP_END', 2029, 'година', 2029, 8, 'текст, т. 2', 'EU_RULE'),
    ('rule.CONTROL_MAX.2027', 0.6, 'пр.п. от БВП', 2027, 9, 'текст под Табл. 1а', 'EU_RULE'),
    ('rule.CONTROL_PRE.2027', 1.0, 'пр.п. от БВП', 2027, 8, 'Табл. 1а, ред 3', 'EU_RULE'),
    ('rule.DEF_FLEX_OLD', 1.5, '% от БВП', 2025, 9, 'текст под Табл. 1а', 'EU_RULE'),
    ('rule.DEF_CLAUSE_YEARS', 4, 'години', 2025, 9, 'текст под Табл. 1а', 'EU_RULE'),
    ('rule.REF_DEFICIT', 3, '% от БВП', 2029, 6, 'текст, т. 1.2', 'EU_RULE'),
    ('rule.REF_DEBT', 60, '% от БВП', 2027, 29, 'текст, т. 4.3', 'EU_RULE'),
    ('n27.D2_GROWTH', 3.2, '% годишна промяна', 2027, 22, 'текст, т. 4.2', 'ESA_GG'),
    ('n27.EXCISE_GROWTH', 3.5, '% годишна промяна', 2027, 22, 'текст, т. 4.2', 'ESA_GG'),
    ('m27.WINDFALL_RATE', 33, '%', 2027, 21, 'текст, т. 4.2', 'ESA_GG'),
    ('m27.WINDFALL_REBATE', 30, '%', 2027, 21, 'текст, т. 4.2', 'ESA_GG'),
    ('m27.PERSONNEL_RATE', 5, '%', 2027, 31, 'текст, т. 4.4', 'ESA_GG'),
    ('m27.TEACHERS_RATE', 7.5, '%', 2027, 31, 'текст, т. 4.4', 'ESA_GG'),
    ('m27.MOD_LEVEL', 2400, 'EUR на месец', 2027, 22, 'текст, т. 4.2', 'ESA_GG'),
    ('m27.NET_IMPROVEMENT', 2015.8, 'млн. EUR', 2027, 32, 'текст пред Табл. 5', 'ESA_GG'),
    ('m27.REV_TOTAL.pct_gdp', 1.39, '% от БВП', 2027, 31, 'текст, т. 4.4', 'ESA_GG'),
    ('m27.EXP_NET.pct_gdp', 0.04, '% от БВП', 2027, 31, 'текст, т. 4.4', 'ESA_GG'),
    ('n27.FALL_REV_TEXT', 2.2, 'пр.п. от БВП', 2027, 19, 'текст, т. 4.2', 'ESA_GG'),
    ('n27.FALL_EXP_TEXT', 3.0, 'пр.п. от БВП', 2027, 19, 'текст, т. 4.2', 'ESA_GG'),
    ('n27.DEF_FALL_TEXT', 0.8, 'пр.п. от БВП', 2027, 19, 'текст, т. 4.2', 'ESA_GG'),
]

# derived values that the screen prints (marked `derived`; the formula is shown in the source note)
DERIVED_KEEP = {'deficit.2027.eur', 'gdp.2026', 'gdp.2027'}

UNIT_FIX = {'EUR': '€'}


def unit(u):
    return None if u is None else u.replace('млн. EUR', 'млн. €').replace('млрд. EUR', 'млрд. €').replace('EUR', '€')


def main():
    for need in (SRC, PDF):
        if not need.exists():
            sys.exit('budget_plan: input missing: %s (not in the repository: docs/data-sources.md 4.3; SRC is made by dbp2027.py)' % need.relative_to(W))
    d = json.loads(SRC.read_text(encoding='utf-8'))
    figs = {}
    for f in d['figures']:
        i = f['id']
        if not i.startswith(USE) or i in SKIP:
            continue
        e = {'v': f['value'], 'u': unit(f.get('unit')), 'p': f['page'], 'b': f['basis']}
        if f.get('year') is not None:
            e['y'] = f['year']
        if f.get('table'):
            e['t'] = f['table']
        e['k'] = 'reported'
        figs[i] = e
    for i, v, u, y, p, t, b in EXTRA:
        if i in figs:
            raise SystemExit(f'duplicate id {i}')
        figs[i] = {'v': v, 'u': u, 'y': y, 'p': p, 't': t, 'b': b, 'k': 'reported'}
    for f in d['derived']:
        if f['id'] in DERIVED_KEEP:
            figs[f['id']] = {'v': f['value'], 'u': unit(f['unit']), 'y': f['year'], 'b': 'DERIVED', 'k': 'derived', 'f': f['formula']}
    # the plan prints no GDP level in euro: say which one the derived deficit used (three ways to the same year, 141,2 / 141,5 / 141,4 млрд. €)
    figs['deficit.2027.eur']['f'] = '−4,3% × ≈141,4 млрд. € (БВП 2027: средно от три оценки – по ръста от Табл. 3, през приходите и през дълга; планът не изписва БВП в евро)'
    figs = dict(sorted(figs.items()))

    # ---- the steps of the excessive deficit procedure (dates: Commission page "Excessive Deficit Procedure and Bulgaria",
    #      last reviewed 03.09.2026, read 16.10.2026; the other items: the plan, page in `p`)
    steps = [
        {'d': 2025, 'kind': 'event', 'src': 'plan', 'p': 9,
         'title': 'Национална клауза за дерогация за разходите за отбрана',
         'text': 'Активирана е за четири години. Позволява отклонение от одобрения път на нетните разходи, до 1,5% от БВП. С препоръката от юли 2026 г. за 2026–2028 г. максимумът пада до 0,9%.'},
        {'d': '2026-06-03', 'kind': 'event', 'src': 'ec-edp-bg',
         'title': 'Доклад на Европейската комисия (чл. 126, ал. 3)',
         'text': 'Първата стъпка на процедурата.'},
        {'d': '2026-06-25', 'kind': 'event', 'src': 'ec-edp-bg',
         'title': 'Комисията: становище, предложение за решение и препоръка',
         'text': 'Становище, че има прекомерен дефицит (чл. 126, ал. 5), предложение за решение на Съвета (ал. 6) и препоръка (ал. 7).'},
        {'d': '2026-07-10', 'kind': 'event', 'src': 'ec-edp-bg',
         'title': 'Съветът на ЕС: решение и препоръка',
         'text': 'Решение за наличие на прекомерен дефицит (ал. 6) и препоръка за прекратяването му (ал. 7). Според проекта на плана е Решение (ЕС) 2026/1758; крайният срок е 2029 г.'},
        {'d': '2026-10-15', 'kind': 'event', 'src': 'plan', 'p': 6,
         'title': 'Срок: мерки за намаляване на дефицита',
         'text': 'Според проекта на плана препоръката на Съвета изисква до тази дата България да представи мерките. Проектът на бюджетен план служи и като доклад за тях.'},
        {'d': '2026-10-15', 'kind': 'event', 'src': 'ec-dbp',
         'title': 'Проектът на плана е публикуван на страницата на Комисията',
         'text': 'Документът е в списъка за 2027 г. на страницата на Комисията, с дата 15.10.2026. Файлът, по който работим, е точно копие на този от страницата на Комисията (съвпада контролната сума).'},
        {'d': '2026-11-30', 'kind': 'expected', 'src': 'plan', 'p': 5,
         'title': 'Оценка на Комисията за проекта на плана',
         'text': 'Според проекта на плана Комисията оценява най-късно до тази дата дали бюджетните политики съответстват на фискалните правила на ЕС и при нужда издава препоръки.'},
        {'d': 2029, 'kind': 'expected', 'src': 'plan', 'p': 8,
         'title': 'Крайна година за преодоляване на прекомерния дефицит',
         'text': 'Според проекта на плана: дефицитът трябва да падне и да остане под 3% от БВП до 2029 г.'},
    ]

    # ---- measures of 2027 (amounts are figure ids; the label repeats the plan's own words in short)
    measures = {
        'revenue': [
            {'id': 'm27.WINDFALL', 'p': 21, 'label': 'Еднократен данък върху свръхпечалбата (33%)'},
            {'id': 'm27.MOD', 'p': 22, 'label': 'По-висок максимален осигурителен доход (2 400 € от 01.01.2027 г.)'},
            {'id': 'm27.EXCISE_CAL', 'p': 31, 'label': 'Акцизният календар за тютюна се изпълнява по-рано (ДДС и акцизи)'},
            {'id': 'm27.MIN_INCOME', 'p': 31, 'label': 'По-високи минимални осигурителни доходи и прагове'},
            {'id': 'm27.VAT_LAND', 'p': 21, 'label': 'Регистрация по ДДС при продажби на земя и нови сгради'},
            {'id': 'm27.FOOD_VOUCHERS', 'p': 21, 'label': 'Ваучери за храна: по-голям лимит и промяна в облагането'},
            {'id': 'm27.TOLL_CO2', 'p': 22, 'label': 'Тол такси според емисиите на CO2'},
            {'id': 'm27.TOLL_UPDATE', 'p': 22, 'label': 'Актуализирани тол такси и електронна винетка'},
            {'id': 'm27.GAMBLING', 'p': 22, 'label': 'По-висок данък върху хазарта'},
            {'id': 'm27.LUXURY_CARS', 'p': 21, 'label': 'Акциз върху луксозни коли над 250 kW'},
            {'id': 'm27.FINES', 'p': 22, 'label': 'Актуализирани глоби и санкции в данъчните закони'},
        ],
        'expense': [
            {'id': 'm27.PERSONNEL_5PCT', 'p': 31, 'label': 'По-високи разходи за персонал (+5%)'},
            {'id': 'm27.TEACHERS_7_5', 'p': 31, 'label': 'По-високи разходи за педагогическия персонал (+7,5%)'},
            {'id': 'm27.SOCIAL_CHILD', 'p': 31, 'label': 'Пакет социални мерки и мерки за деца'},
            {'id': 'm27.TELK', 'p': 31, 'label': 'Реформа в ТЕЛК: оптимизация и контрол на разходите'},
            {'id': 'm27.CUT10_FULL', 'p': 31, 'label': 'Съкращението от 10% на разходите за персонал от 01.09.2026 г. се отразява за цяла година'},
            {'id': 'm27.SECURITY_STAFF', 'p': 31, 'label': 'Оптимизиране на персонала в силовите ведомства'},
        ],
    }

    missing = [
        {'id': 'zdbrb', 'title': 'Законопроектът за държавния бюджет 2027 (ЗДБРБ 2027)',
         'text': 'Проектът на плана казва, че показателите му са по проекта на този закон (стр. 5), но законопроектът не е в документа. Не можем да потвърдим дали е публикуван.'},
        {'id': 'asbp', 'title': 'Актуализираната средносрочна бюджетна прогноза 2027–2029 (АСБП)',
         'text': 'Проектът я посочва като основа (стр. 5–6), но таблиците ѝ не са в документа. Не можем да потвърдим дали е публикувана.'},
        {'id': 'ec', 'title': 'Оценката на Европейската комисия',
         'text': 'Предстои: най-късно до 30.11.2026. Към 16.10.2026 на страницата на Комисията за България има само самият проект, без становище.'},
        {'id': 'pensions', 'title': 'Пенсии и минимална работна заплата',
         'text': 'Документът не дава размера на пенсиите, индексацията им и минималната заплата за 2027 г.'},
        {'id': 'ministries', 'title': 'Разбивка по министерства и по функции',
         'text': 'Няма. Единственото изключение са разходите за отбрана.'},
        {'id': 'kfp', 'title': 'Таблица по КФП (касова основа) за 2027 г.',
         'text': 'Няма. Затова числата тук не се сравняват с екраните по КФП.'},
    ]

    sha = hashlib.sha256(PDF.read_bytes()).hexdigest()
    out = {
        'meta': {
            'id': 'D34',
            'title': 'Проект на бюджетен план на Република България за 2027 г. (ЕСС 2010)',
            'status': 'real',
            'source': ['dbp2027', 'ec-edp-bg', 'ec-fiscal-bg', 'ec-dbp'],
            'sourceNote': ('Министерство на финансите, Проект на бюджетен план за 2027 г. (55 стр., 15.10.2026), числата по номер на страница. '
                           'Документът е публикуван и на страницата на Европейската комисия за проектите на бюджетни планове за 2027 г. (същият файл, съвпада контролната сума). Датите на процедурата при прекомерен дефицит: страницата на Европейската комисия за България (преглед от 03.09.2026, прочетена 16.10.2026). '
                           'Всички числа за 2026 и 2027 г. са прогноза или проект, не са приети. Основа: ЕСС 2010, начислена, сектор „Държавно управление“ (не КФП).'),
            'asOf': '2026-10-15',
            'retrieved': '2026-10-16',
            'unit': '% от БВП и млн. €',
            'mock': False,
        },
        'doc': {
            'issuer': 'Министерство на финансите',
            'date': '2026-10-15',
            'pages': 55,
            'sha256': sha,
        },
        'figures': figs,
        'edp': {'steps': steps},
        'measures': measures,
        'missing': missing,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    n = len(figs)
    print(f'wrote {OUT.relative_to(W)}: {n} figures, {OUT.stat().st_size} bytes, pdf sha256 {sha[:12]}')


if __name__ == '__main__':
    main()
