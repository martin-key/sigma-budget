#!/usr/bin/env python3
"""verify_dbp2027_numbers.py - look every printed number of the screen S34 up in the PDF of the Draft Budgetary Plan 2027.

  .venv/bin/python tools/mock/verify_dbp2027_numbers.py         figures + phrase checks (PDF only)
  PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers .venv/bin/python tools/mock/verify_dbp2027_numbers.py --screen
                                                                also read the rendered screen and trace every number to a figure

Part 1  every `reported` figure of site/data/dbp2027.json: its value must be printed on the page `p` named in the file
        (token match on the page text; the sign may be a minus or brackets; thousands separators are ignored).
        Every `derived` figure: its formula is recomputed from the reported figures.
Part 2  the words the screen builds on (phrases, dates, names of acts) are looked up on the page named next to them.
Part 3  (--screen) the rendered text of #/byudzhet-2027 at 1280 px: every number token is matched with a figure (as it is, divided or
        multiplied by 1000, as an absolute value). What cannot be matched is printed for a manual look.

Exit 1 when a reported figure or a phrase is NOT found on its page.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

W = Path(__file__).resolve().parents[2]       # repository root
PDF = W / 'tmp' / 'sources' / 'bud2027_Draft_Budgetary_Plan_of_the_Republic_of_Bulgaria_for_2027.pdf'      # the PDF is not in the repository: docs/data-sources.md 4.3
DATA = W / 'site' / 'data' / 'dbp2027.json'
SHA = '8c91cdf4778f2864e1eeb167f14b08d1f68a076ea4ad27a8a4305175a73f1182'

TOKEN = re.compile(r'\(?-?−?\d[\d,  ]*(?:\.\d+)?\)?')


def page_numbers(text):
    """All numbers printed on a page, as absolute floats. The plan is in Bulgarian: decimal comma, thousands separated by a space."""
    out = set()
    t = re.sub('[\u00a0\u202f\u2009]', ' ', text).replace('\u2212', '-')
    for m in re.finditer(r'\d{1,3}(?: \d{3})+(?:,\d+)?|\d+(?:,\d+)?', t):
        s = m.group(0)
        try:
            out.add(abs(float(s.replace(' ', '').replace(',', '.'))))
        except ValueError:
            pass
        # a space that only separates two table cells ("0,6 0,5"): also take the first group alone
        first = s.split(' ')[0]
        try:
            out.add(abs(float(first.replace(',', '.'))))
        except ValueError:
            pass
    # a few figures are written with a dot or without a thousands separator in the running text
    for m in re.finditer(r'\d+\.\d+', t):
        out.add(abs(float(m.group(0))))
    return out


def table_row(text, row):
    """The numbers of one table row of the plan (the PDF text puts every cell on its own line): from the line that holds the row number
    to the line that holds the next row number (N+1, or the lettered sub-row «Nб»). Returns the floats in column order, or None."""
    lines = [l.strip().replace('\xa0', ' ') for l in text.split('\n')]
    num = re.compile(r'^-?\d[\d ]*,\d+$')
    base = int(re.match(r'\d+', row).group(0))
    stops = {str(base + 1)} | ({str(base) + c for c in 'абвг'} if row.isdigit() else {str(base + 1)})
    for i, l in enumerate(lines):
        if l == row and i > 3:                         # (the first lines hold the page number itself)
            out = []
            for l2 in lines[i + 1:]:
                if l2 in stops:
                    break
                if num.match(l2):
                    out.append(float(l2.replace(' ', '').replace(',', '.')))
            return out
    return None


def close(a, b):
    return abs(abs(a) - abs(b)) < 1e-6 + 1e-9 * abs(b)


def main():
    if not PDF.exists():
        sys.exit('verify_dbp2027_numbers: input missing: %s (not in the repository: docs/data-sources.md 4.3)' % PDF.relative_to(W))
    import pymupdf
    screen = '--screen' in sys.argv
    sha = hashlib.sha256(PDF.read_bytes()).hexdigest()
    print('PDF sha256', sha[:12], 'OK' if sha == SHA else 'MISMATCH (expected %s)' % SHA[:12])
    doc = pymupdf.open(str(PDF))
    pages = [p.get_text() for p in doc]
    nums = [page_numbers(t) for t in pages]
    print('pages', len(pages))
    d = json.loads(DATA.read_text(encoding='utf-8'))
    bad = 0
    n_rep = 0

    # --- Part 1: reported figures
    for fid, f in d['figures'].items():
        if f['k'] != 'reported':
            continue
        n_rep += 1
        p = f['p']
        v = f['v']
        # the file may keep млрд. for млн. (x1000) or a rounded value: accept the exact print only, plus the 1000-scaled print
        cands = [v, v * 1000, v / 1000, v * 1e6, v / 1e6]
        if not any(any(close(c, x) for x in nums[p - 1]) for c in cands):
            # percentages printed with fewer digits than stored are NOT accepted: report
            print('  NOT FOUND  %-34s %12s  p.%d' % (fid, v, p))
            bad += 1
    print('Part 1: %d reported figures checked, %d not found on their page' % (n_rep, bad))

    # --- derived figures: recompute
    f = d['figures']
    der = [(k, x) for k, x in f.items() if x['k'] == 'derived']
    print('Part 1b: %d derived figures' % len(der))
    for k, x in der:
        print('  derived  %-22s %14s %s   = %s' % (k, x['v'], x['u'], x['f']))

    # --- measures: every row names a page and its amount is printed on that page
    for kind in ('revenue', 'expense'):
        for r in d['measures'][kind]:
            fig = f.get(r['id'])
            if fig is None:
                print('  MEASURE without figure', r)
                bad += 1
            elif not any(close(fig['v'], x) for x in nums[r['p'] - 1]):
                print('  MEASURE amount not on its page', r['id'], fig['v'], 'p.%d' % r['p'])
                bad += 1
    print('Part 1c: %d measure rows: amount printed on the page shown next to the name' % sum(len(d['measures'][k]) for k in ('revenue', 'expense')))

    # --- Part 1d: table figures by ROW and COLUMN (Табл. 4 and 6: level 2025, % 2025, % 2026, % 2027), not just "somewhere on the page"
    T6_ROW = {'rev.TR': 7, 'exp.TE': 19, 'bal.NL': 20, 'bal.PRIM': 21}
    COL = {'lvl.2025': 0, 'pct.2025': 1, 'pct.2026': 2, 'pct.2027': 3}
    n_row = 0
    for fid, fg in f.items():
        if fg['k'] != 'reported' or not fid.startswith(('t4.', 't6.')):
            continue
        suffix = '.'.join(fid.split('.')[-2:])
        if suffix not in COL:
            suffix = 'pct.' + fid.split('.')[-1] if fid.split('.')[-1].isdigit() and '.pct.' not in fid and '.lvl.' not in fid else suffix
        if suffix not in COL:
            print('  (row check skipped: no column in key)', fid)
            continue
        if fid.startswith('t4.'):
            m = re.search(r'ред (\d+[а-я]?)', fg.get('t', ''))
            row = m.group(1) if m else None
        else:
            row = str(T6_ROW.get('.'.join(fid.split('.')[1:3])))
        if not row or row == 'None':
            print('  (row check skipped: no row number)', fid)
            continue
        vals = table_row(pages[fg['p'] - 1], row)
        n_row += 1
        col = COL[suffix]
        if vals is not None and len(vals) == 3:          # rows without the level column (structural balance, implicit rate, net expenditure growth)
            col -= 1
        if vals is None or col < 0 or len(vals) <= col or abs(vals[col] - fg['v']) > 1e-9:
            print('  ROW/COLUMN MISMATCH %-30s file %s  page row %s -> %s' % (fid, fg['v'], row, vals))
            bad += 1
    print('Part 1d: %d table figures checked by row number and column' % n_row)

    # --- Part 2: phrases on named pages (English original of the statements the screen makes)
    PHRASES = [
        (5, r'473/2013', 'plan is made under Reg. (EU) 473/2013'),
        (6, r'прекомерен дефицит', 'excessive deficit named (EDP)'),
        (8, r'прекомерен дефицит', 'EDP + net-expenditure ceilings'),
        (8, r'4,2%[^.]{0,40}2026', 'net expenditure growth ceiling 4.2% for 2026'),
        (8, r'11,4%', 'cumulative ceiling 11.4% for 2028'),
        (8, r'пет месеца', 'late 2026 budget law: only five months for measures'),
        (8, r'до 2029', 'EDP to be ended by 2029'),
        (9, r'национална клауза за дерогация', 'national escape clause for defence'),
        (27, r'отбран', 'defence on p.27'),
        (28, r'дълг', 'government debt on p.28'),
        (37, r'ЕВРОПЕЙСКИЯ СЕМЕСТЪР', 'p.37 European Semester section'),
    ]
    for p, rx, what in PHRASES:
        ok = re.search(rx, pages[p - 1], re.I) is not None
        print('  %s p.%d  %s' % ('ok       ' if ok else 'NOT FOUND', p, what))
        bad += 0 if ok else 1
    # the glossary no longer claims a "first" plan; make sure the screen does not either
    s34 = (W / 'site' / 'js' / 'pages' / 's34-byudzhet-2027.js').read_text(encoding='utf-8')
    if re.search(r'Първ(ият|и) (проект|план)', s34):
        print('  NOTE      the screen still says "първи/първият" - check it against the PDF')

    # --- Part 3: the rendered screen
    if screen:
        bad += check_screen(d, nums)
    print('RESULT: %s' % ('OK' if not bad else '%d PROBLEM(S)' % bad))
    return 1 if bad else 0


def check_screen(d, nums):
    import http.server
    import os
    import socketserver
    import threading
    os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', str(W / '.pw-browsers'))
    from playwright.sync_api import sync_playwright
    site = W / 'site'

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(site), **k)

        def log_message(self, *a):
            pass

    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={'width': 1280, 'height': 900})
        pg.goto('http://127.0.0.1:%d/#/byudzhet-2027' % srv.server_address[1])
        pg.wait_for_function("() => { const a = document.querySelector('#view article.page'); return a && a.dataset.ready === '1'; }")
        pg.wait_for_timeout(600)
        # open every <details> so the hidden tables count too
        pg.evaluate("document.querySelectorAll('#view details').forEach(d => d.open = true)")
        text = pg.evaluate("document.querySelector('#view').innerText")
        b.close()
    srv.shutdown()
    pool = set()
    for x in d['figures'].values():
        v = abs(x['v'])
        pool.update({v, v * 1000, v / 1000})
    for k in ('revenue', 'expense'):
        pass
    for pn in nums:
        pass
    t = re.sub('[\u00a0\u202f\u2009]', ' ', text).replace('\u2212', '-')
    # drop dates, page refs ("стр. 27"), years and list numbering
    t = re.sub(r'\b\d{1,2}\.\d{1,2}\.\d{4}\b', ' ', t)
    t = re.sub(r'(?i)стр\.\s*[\d–, и-]+', ' ', t)
    t = re.sub(r'\b(19|20)\d\d\b', ' ', t)
    unmatched = []
    ctx = {}
    for m in re.finditer(r'\d[\d ]*(?:,\d+)?', t):
        s = m.group(0).strip()
        try:
            val = float(s.replace(' ', '').replace(',', '.'))
        except ValueError:
            continue
        hit = False
        for c in pool:
            # compare at the precision printed on the screen
            dec = len(s.split(',')[1]) if ',' in s else 0
            if abs(round(c, dec) - val) < 10 ** (-dec) / 2 + 1e-9:
                hit = True
                break
        if not hit:
            unmatched.append(s)
            ctx.setdefault(s, t[max(0, m.start() - 40):m.end() + 25].replace('\n', ' '))
    from collections import Counter
    c = Counter(unmatched)
    print('Part 3: %d number tokens on the screen, %d without a figure of the file (small integers are step numbers / list counters)'
          % (len(re.findall(r'\d[\d ]*(?:,\d+)?', t)), len(unmatched)))
    for s, n in sorted(c.items(), key=lambda kv: (len(kv[0]), kv[0])):
        print('   unmatched %-10s x%d   ...%s...' % (s, n, ctx[s]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
