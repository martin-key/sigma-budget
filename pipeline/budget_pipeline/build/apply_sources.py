#!/usr/bin/env python3
"""Apply the source records and shared metadata needed by the budget 2027 screen. Repeated application is idempotent; existing client and stylesheet markers are preserved."""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import json
import pathlib
import re
import sys

W = pathlib.Path(__file__).resolve().parents[3]       # repository root
S = W / 'apps/web/public'                                         # the site


def target(rel):
    group, name = rel.split('/', 1)
    base = {'js': W / 'apps/web/client', 'data': W / 'data/release'}.get(group)
    return base / name if base else S / rel


def rd(rel):
    return target(rel).read_text(encoding='utf-8')


def wr(rel, text):
    target(rel).write_text(text, encoding='utf-8')


def sub_once(rel, old, new, marker):
    """Replace `old` by `new` exactly once; skip when `marker` is already present."""
    t = rd(rel)
    if marker in t:
        print('  skip (already)  ', rel)
        return
    if t.count(old) != 1:
        sys.exit('FAIL %s: anchor found %d times: %r' % (rel, t.count(old), old[:80]))
    wr(rel, t.replace(old, new))
    print('  edited          ', rel)


def main():
    # ---------------------------------------------------------------------------------------------- 1. route
    ROUTE = ("  R('S34', 'byudzhet-2027', '/byudzhet-2027', 's34-byudzhet-2027', 'Бюджет 2027 (проект)', 'budget', 'fileText', "
             "{ short: 'Бюджет 2027 (проект)', next: ['S13'], periods: 'none', samples: ['#/byudzhet-2027'], "
             "desc: 'Проектът на бюджетен план за 2027 г., изпратен от Министерството на финансите до Европейската комисия: дефицит, приходи, разходи, дълг и процедурата при прекомерен дефицит. Не е приет.' }),\n")
    t = rd('js/routes.js')
    m = re.search(r"^  R\('S31',.*\n", t, re.M)
    if not m:
        sys.exit('FAIL routes.js: S31 row not found')
    if "R('S34'" not in t:
        wr('js/routes.js', t[:m.end()] + ROUTE + t[m.end():])
        print('  edited           js/routes.js')
    else:
        print('  skip (already)   js/routes.js')

    # ---------------------------------------------------------------------------------------------- 2. nav
    sub_once('js/shell.js', "order: ['S07', 'S06', 'S10', 'S12', 'S13', 'S14', 'S20', 'S05']",
             "order: ['S07', 'S06', 'S10', 'S12', 'S13', 'S34', 'S14', 'S20', 'S05']", "'S13', 'S34'")

    # ---------------------------------------------------------------------------------------------- 3. scope
    sub_once('js/store.js',
             "  maastricht: { label: 'Маастрихт', long: 'Дълг на сектор „Държавно управление“ по методиката на Маастрихт', gl: 'sektor-darzhavno-upravlenie' }\n};",
             "  maastricht: { label: 'Маастрихт', long: 'Дълг на сектор „Държавно управление“ по методиката на Маастрихт', gl: 'sektor-darzhavno-upravlenie' },\n"
             "  esa: { label: 'ЕСС · начислено', long: 'ЕСС 2010: начислена основа, сектор „Държавно управление“ (не е КФП, не е касова основа)', gl: 'ess-2010', variant: 'esa' }\n};",
             "esa: {")

    sub_once('js/ui/scope.js',
             "  return gl\n    ? html`<a class=\"scope\" href=\"#/rechnik/${gl}\" data-gl=\"${gl}\" title=\"${long}\">${inner}</a>`\n    : html`<span class=\"scope\" title=\"${long}\">${inner}</span>`;",
             "  const kind = s?.variant ? html` data-scope=\"${s.variant}\"` : '';           // a scope with its own look (esa) says so; the others render exactly as before\n"
             "  return gl\n    ? html`<a class=\"scope\"${kind} href=\"#/rechnik/${gl}\" data-gl=\"${gl}\" title=\"${long}\">${inner}</a>`\n    : html`<span class=\"scope\"${kind} title=\"${long}\">${inner}</span>`;",
             "const kind =")

    # ---------------------------------------------------------------------------------------------- 5. css
    sub_once('css/tokens.css', "  --series-5:#2E4E6E;", "  --esa:#2E4E6E; --esa-soft:#E4EBF2;\n  --series-5:#2E4E6E;", "--esa:")
    sub_once('css/components.css', ".scope-note{font-weight:400;color:var(--ink-mid);text-transform:none;letter-spacing:.02em}\n",
             ".scope-note{font-weight:400;color:var(--ink-mid);text-transform:none;letter-spacing:.02em}\n"
             ".scope[data-scope=\"esa\"]{border-color:var(--esa);background:var(--esa-soft);color:var(--esa)}\n"
             "a.scope[data-scope=\"esa\"]:hover{border-color:var(--crimson);color:var(--crimson)}\n",
             "data-scope=\"esa\"")

    # ---------------------------------------------------------------------------------------------- 6. glossary
    CAT = {'id': 'byudzhet-2027', 'title': 'Бюджет 2027 и правилата на ЕС', 'short': 'Бюджет 2027 и ЕС', 'from': 65, 'to': 69}
    SEE = [{'label': 'Виж в бюджета', 'href': '#/byudzhet-2027'}]
    NOTE_BASIS = 'Различната основа дава различни числа за един и същи разход.'
    TERMS = [
        {'n': 65, 'slug': 'ess-2010', 'title': 'Европейска система от сметки - ЕСС 2010', 'name': 'Европейска система от сметки', 'abbr': 'ЕСС 2010',
         'cat': CAT['id'],
         'def': 'Общата за ЕС методика за отчитане на публичните финанси. Записва приходите и разходите, когато възникват, а не когато парите минат през сметката (начислена основа), и обхваща целия сектор „Държавно управление“. Проектът на бюджетен план за 2027 г. е по тази методика, а не по КФП.',
         'example': 'Ремонт, който е свършен през декември, но е платен през януари, е разход за декември по ЕСС. По КФП (касова основа) същият разход е за януари.',
         'aliases': ['ЕСС', 'ЕСС 2010', 'ESA 2010', 'Европейска система от сметки'],
         'related': [{'slug': 'nachislena-osnova', 'note': NOTE_BASIS}, {'slug': 'kasova-osnova', 'note': NOTE_BASIS},
                     {'slug': 'kfp', 'note': 'ЕСС и КФП не се слагат на една графика.'}, {'slug': 'sektor-darzhavno-upravlenie', 'note': 'ЕСС 2010 обхваща този сектор.'}],
         'see': SEE},
        {'n': 66, 'slug': 'proekt-na-byudzheten-plan', 'title': 'Проект на бюджетен план - ПБП', 'name': 'Проект на бюджетен план', 'abbr': 'ПБП',
         'cat': CAT['id'],
         'def': 'Документ, който държава от еврозоната изпраща всяка година до 15 октомври до Европейската комисия и Еврогрупата. В него показва какви приходи, разходи, дефицит и дълг планира за следващата година. Комисията го оценява до 30 ноември. Той не е законът за бюджета.',
         'example': 'Проектът на бюджетен план за 2027 г. е изпратен на 15 октомври 2026 г. Неговите числа са прогноза, не са приети.',
         'aliases': ['ПБП', 'бюджетен план', 'DBP'],
         'related': [{'slug': 'proektobyudzhet', 'note': 'Проектът на бюджетен план не е проектът на закона за бюджета.'}, {'slug': 'ess-2010', 'note': 'Числата в него са по ЕСС 2010.'}],
         'see': SEE},
        {'n': 67, 'slug': 'protsedura-pri-prekomeren-defitsit', 'title': 'Процедура при прекомерен дефицит - ППД', 'name': 'Процедура при прекомерен дефицит', 'abbr': 'ППД',
         'cat': CAT['id'],
         'def': 'Мярка на ЕС за държава, чийто дефицит е над 3% от БВП (или чийто дълг е над 60% от БВП и не намалява достатъчно бързо). Съветът на ЕС ѝ препоръчва какво да направи и до кога. България е в такава процедура от 10 юли 2026 г.',
         'example': 'Когато дефицитът надхвърли 3% от БВП, Комисията може да предложи процедура, а Съветът на ЕС да реши дали да я открие и какви стъпки да препоръча.',
         'aliases': ['ППД', 'прекомерен дефицит', 'EDP', 'excessive deficit procedure'],
         'related': [{'slug': 'byudzheten-defitsit', 'note': 'Процедурата се отнася до дефицита на целия сектор „Държавно управление“.'}, {'slug': 'netni-razhodi', 'note': 'Препоръката на Съвета се измерва с ръста на нетните разходи.'}],
         'see': SEE},
        {'n': 68, 'slug': 'netni-razhodi', 'title': 'Нетни разходи', 'name': 'Нетни разходи',
         'cat': CAT['id'],
         'def': 'Показател на ЕС, с който се следи дали държавата спазва фискалните правила. Опростено: разходите, финансирани със собствени (национални) средства, без лихвите, без съфинансирането на програми на ЕС, без еднократните разходи и без цикличната част на помощите при безработица. Проектът на плана ги показва „преди приходни мерки“ (Табл. 4, ред 29). ЕС задава таван за годишния им ръст. Това е опростено обяснение, не е цитат от плана; точното определение е в правилата на ЕС.',
         'example': 'Ако таванът за ръста на нетните разходите е 3,4%, държавата може да ги увеличи най-много с толкова за годината.',
         'aliases': ['нетните разходи', 'нетни разходи на държавата', 'таван на разходите'],
         'related': [{'slug': 'protsedura-pri-prekomeren-defitsit', 'note': 'Препоръката на Съвета задава таван за ръста им.'}],
         'see': SEE},
        {'n': 69, 'slug': 'ednokraten-danak-svrahpechalba', 'title': 'Еднократен данък върху свръхпечалбата', 'name': 'Еднократен данък върху свръхпечалбата',
         'cat': CAT['id'],
         'def': 'Данък върху печалбата, която надхвърля обичайната, налаган за ограничен период и за избрани отрасли. Проектът на бюджетен план за 2027 г. предвижда такъв данък за една година. Той още не е приет.',
         'example': 'Ако законът го въведе за една година, само фирмите от избраните отрасли го плащат и само за тази година.',
         'aliases': ['свръхпечалба', 'данък върху свръхпечалбата', 'windfall tax'],
         'related': [{'slug': 'danak', 'note': 'Налага се върху печалбата, не върху оборота.'}],
         'see': SEE},
    ]
    g = json.loads(rd('data/glossary.json'))
    if not any(t['slug'] == 'ess-2010' for t in g['terms']):
        slugs = {t['slug'] for t in g['terms']}
        for t in TERMS:
            assert t['slug'] not in slugs, t['slug']
            for r in t['related']:
                assert r['slug'] in slugs | {x['slug'] for x in TERMS}, ('related', t['slug'], r['slug'])
        g['categories'].append(CAT)
        g['terms'].extend(TERMS)
        n = len(g['terms'])
        assert n == 69 and [t['n'] for t in g['terms']] == list(range(1, 70)), n
        g['subtitle'] = '%d основни термина с обяснения и практически примери' % n
        g['meta']['sourceNote'] = ('Речник с 64 термина на работна група „Бюджет на светло“: определенията, примерите и свързаните понятия са дословно от документа; '
                                   'връзките „Виж в бюджета“ са към екраните на този сайт. Числата в примерите са условни. '
                                   'Още 5 термина (от 65 до 69) са добавени за екрана „Бюджет 2027 (проект)“ и не са от този документ.')
        g['meta']['retrieved'] = '2026-10-16'
        wr('data/glossary.json', json.dumps(g, ensure_ascii=False, separators=(',', ':')) + '\n')
        print('  edited           data/glossary.json (%d terms)' % n)
    else:
        print('  skip (already)   data/glossary.json')

    # ---------------------------------------------------------------------------------------------- search index (same row rule as tools search._terms)
    def _clean(x):
        return re.sub(r'[ \t\r\n]+', ' ', str(x if x is not None else '')).strip()


    def _first_sentence(text):
        t = _clean(text)
        m = re.match(r'^(.{20,160}?[.!?])(\s|$)', t)
        return m.group(1) if m else t[:160]


    def _words(*parts):
        seen, out = set(), []
        for p in parts:
            for w in _clean(p).split(' '):
                if w and w.lower() not in seen:
                    seen.add(w.lower())
                    out.append(w)
        return ' '.join(out)


    si = json.loads(rd('data/search-index.json'))
    if not any(r[6] == '#/rechnik/ess-2010' for r in si['items']):
        last = max(i for i, r in enumerate(si['items']) if r[0] == 4)
        rows = []
        for t in TERMS:
            title = '%s – %s' % (t['name'], t['abbr']) if t.get('abbr') else t['title']
            rows.append([4, _clean(title), _first_sentence(t['def']), '', '', 'real', '#/rechnik/%s' % t['slug'],
                         _words(' '.join(t['aliases']), t.get('abbr', ''), t['name'])])
        si['items'][last + 1:last + 1] = rows
        wr('data/search-index.json', json.dumps(si, ensure_ascii=False, separators=(',', ':')))
        print('  edited           data/search-index.json (+%d rows)' % len(rows))
    else:
        print('  skip (already)   data/search-index.json')

    # ---------------------------------------------------------------------------------------------- 7. core
    raw_core = rd('data/core.json')
    core = json.loads(raw_core)
    if 'dbp2027' not in core['sources']:
        core['sources']['dbp2027'] = {
            'title': 'Проект на бюджетен план на Република България за 2027 г. (55 стр.)',
            'publisher': 'Министерство на финансите',
            'url': 'https://economy-finance.ec.europa.eu/document/download/efafab61-9647-40f6-8912-6cda9c96964b_bg?filename=2027_dbp_bg_bg.pdf&prefLang=en',
            'kind': 'pdf', 'access': 'open',
            'note': 'Документ от 15.10.2026 г. за Европейската комисия и Еврогрупата по Регламент (ЕС) № 473/2013, публикуван на страницата на Комисията. Числата са по ЕСС 2010 (начислена основа), не по КФП, и са прогноза или проект, не са приети. В „Данни“ са номерата на страниците и контролната сума (sha256).'}
        core['sources']['ec-edp-bg'] = {
            'title': 'Европейска комисия: процедури при прекомерен дефицит, България',
            'publisher': 'Европейска комисия',
            'url': 'https://economy-finance.ec.europa.eu/economic-governance-framework/stability-and-growth-pact/corrective-arm-excessive-deficit-procedure/excessive-deficit-procedures-overview/bulgaria_en',
            'kind': 'html', 'access': 'open',
            'note': 'Таблица със стъпките на текущата процедура (страницата е прегледана от Комисията на 3 септември 2026 г.). Датите на екрана „Бюджет 2027 (проект)“ са от нея.'}
        core['sources']['ec-fiscal-bg'] = {
            'title': 'Европейска комисия: фискален надзор, България',
            'publisher': 'Европейска комисия',
            'url': 'https://economy-finance.ec.europa.eu/economic-surveillance-eu-member-states/country-pages-including-country-reports/bulgaria/fiscal-surveillance-bulgaria_en',
            'kind': 'html', 'access': 'open',
            'note': 'Сроковете за проекта на бюджетен план: подаване до 15 октомври, становище на Комисията до 30 ноември.'}
        core['sources']['ec-dbp'] = {
            'title': 'Европейска комисия: годишни проекти на бюджетни планове на страните от еврозоната',
            'publisher': 'Европейска комисия',
            'url': 'https://economy-finance.ec.europa.eu/economic-governance-framework/stability-and-growth-pact/annual-draft-budgetary-plans-dbps-euro-area-countries/draft-budgetary-plans-2027_en',
            'kind': 'html', 'access': 'open',
            'note': 'Списък на проектите на бюджетни планове за 2027 г. (там е и проектът на България). Комисията ги оценява като съответстващи, съответстващи до голяма степен или с риск от несъответствие (описание на страницата за годишните проекти на бюджетни планове).'}
        # 64 on the previous tree; 69 when datasets.py rebuilt core.json and already counted the current glossary on disk
        assert core['counts']['terms'] in (64, 69)
        core['counts']['terms'] = 69
        wr('data/core.json', json.dumps(core, ensure_ascii=False, separators=(',', ':')) + ('\n' if raw_core.endswith('\n') else ''))
        print('  edited           data/core.json (+4 sources, counts.terms 69)')
    else:
        print('  skip (already)   data/core.json')
    print('glue done')


if __name__ == '__main__':
    main()
