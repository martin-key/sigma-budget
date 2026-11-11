"""Light-only chart, placeholder and field-boundary contrast regressions.

The probe and thresholds come from the retired TH_CONTRAST_JS: small chart
labels and placeholders 4.5:1, large chart labels 3:1, field boundaries 3:1.
Called by visual_audit in CI over the same non-embed routes and two widths.
"""
import json
from pathlib import Path

from tests.e2e.screens import deep_pass

COLOR_LIB_JS = r"""
const parse = s => {
  let m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(s || '');
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : (m[5] ? +m[4] / 100 : +m[4])];
  m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(s || '');
  if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : +m[4]];
  return null;
};
const col = s => {
  s = (s || '').trim().toLowerCase();
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) / 255 : 1]; }
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return [parseInt(m[1] + m[1], 16), parseInt(m[2] + m[2], 16), parseInt(m[3] + m[3], 16), 1];
  return parse(s);
};
const over = (f, b) => { const a = f[3]; return [f[0] * a + b[0] * (1 - a), f[1] * a + b[1] * (1 - a), f[2] * a + b[2] * (1 - a), 1]; };
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hex = c => '#' + [0, 1, 2].map(i => Math.round(c[i]).toString(16).padStart(2, '0')).join('');
const vis = el => { const r = el.getBoundingClientRect(); return (r.width > 0 || r.height > 0) && getComputedStyle(el).visibility !== 'hidden'; };
// background colour under an element: the composited stack of its own and its ancestors' backgrounds (null = a gradient / image is in the way)
const effBg = el => {
  const layers = [];
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    const cs = getComputedStyle(e), b = parse(cs.backgroundColor);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
    if (b && b[3] > 0) { layers.push(b); if (b[3] >= 0.99) break; }
  }
  let c = [255, 255, 255, 1];
  for (const l of layers.reverse()) c = over(l, c);
  return c;
};
"""

CONTRAST_JS = r"""() => {
  /*LIB*/
  const out = { texts: 0, low: [], ph: [], fields: 0, placeholders: 0, boundaries: 0, border: [] };
  const charts = [...document.querySelectorAll('#view .chart[data-ready="1"]')].filter(vis);
  charts.forEach((c, ci) => {
    const svg = c.querySelector('svg'); if (!svg) return;
    const surf = effBg(c) || [255, 255, 255, 1];
    const shapes = [...svg.querySelectorAll('path,rect,circle,ellipse,polygon')].filter(s => { const f = (s.getAttribute('fill') || '').toLowerCase(); return f && f !== 'none' && f !== 'transparent' && !f.startsWith('url('); });
    let texts = [...svg.querySelectorAll('text')].filter(t => (t.textContent || '').trim());
    if (texts.length > 70) { const k = Math.ceil(texts.length / 70); texts = texts.filter((_, i) => i % k === 0); }
    for (const t of texts) {
      const fg = col(t.getAttribute('fill')); if (!fg) continue;
      const r = t.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
      const pt = svg.createSVGPoint(); pt.x = r.left + r.width / 2; pt.y = r.top + r.height / 2;
      let bg = surf;
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (!(t.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_PRECEDING)) continue;
        const m = s.getScreenCTM(); if (!m) continue;
        let inside = false;
        try { inside = s.isPointInFill(pt.matrixTransform(m.inverse())); } catch (e) { inside = false; }
        if (!inside) continue;
        const f = col(s.getAttribute('fill')), a = parseFloat(s.getAttribute('fill-opacity') || s.getAttribute('opacity') || '1');
        if (!f || a < 0.3) continue;
        bg = over([f[0], f[1], f[2], f[3] * a], surf); break;
      }
      const cs = getComputedStyle(t), size = parseFloat(cs.fontSize) || 12, bold = parseInt(cs.fontWeight, 10) >= 700 || cs.fontWeight === 'bold';
      const large = size >= 24 || (size >= 18.66 && bold), rt = ratio(over(fg, bg), bg);
      out.texts++;
      if (rt < (large ? 3 : 4.5)) out.low.push({ i: ci, txt: (t.textContent || '').trim().slice(0, 24), fg: hex(fg), bg: hex(bg), ratio: +rt.toFixed(2), size, bold });
    }
  });
  const fields = [...document.querySelectorAll('input:not([type=radio]):not([type=checkbox]):not([type=hidden]):not([type=range]), textarea')].filter(vis);
  for (const el of fields) {
    out.fields++;
    const bg = effBg(el); if (!bg) continue;
    if (el.placeholder) {
      out.placeholders++;
      const ps = getComputedStyle(el, '::placeholder'), pc = col(ps.color), op = parseFloat(ps.opacity);
      if (pc) {
        const fg = over([pc[0], pc[1], pc[2], pc[3] * (isNaN(op) ? 1 : op)], bg), rt = ratio(fg, bg);
        if (rt < 4.5) out.ph.push({ who: el.id || el.name || (typeof el.className === 'string' ? el.className.split(/\s+/)[0] : '') || el.tagName.toLowerCase(), ph: el.placeholder.slice(0, 30), fg: hex(fg), bg: hex(bg), ratio: +rt.toFixed(2) });
      }
    }
    // the boundary of a field: its own border (any side) or fill; a borderless field (the palette's search box) borrows the one of its wrapper (up to two levels)
    const edge = n => {
      const st = getComputedStyle(n), par = effBg(n.parentElement || document.body), me = effBg(n);
      let best = par && me ? ratio(me, par) : 1, bw = 0;
      for (const sd of ['Top', 'Right', 'Bottom', 'Left']) {
        const w = parseFloat(st['border' + sd + 'Width']) || 0, c = col(st['border' + sd + 'Color']);
        if (w > 0 && c && par) { bw = Math.max(bw, w); best = Math.max(best, ratio(over(c, par), par)); }
      }
      return { best, bw };
    };
    if (getComputedStyle(el).outlineStyle === 'none') {
      out.boundaries++;
      let e = edge(el), best = e.best, bw = e.bw;
      for (let n = el.parentElement, k = 0; n && best < 3 && k < 2 && n !== document.body && !n.matches('dialog, #view, main'); n = n.parentElement, k++) { const w = edge(n); best = Math.max(best, w.best); bw = Math.max(bw, w.bw); }
      if (best < 3) out.border.push({ who: el.id || el.name || el.tagName.toLowerCase(), ratio: +best.toFixed(2), bw });
    }
  }
  return out;
}""".replace('/*LIB*/', COLOR_LIB_JS)


def check_probe_thresholds(browser):
    """Positive and negative controls keep each restored category sensitive."""
    context = browser.new_context(color_scheme='light')
    page = context.new_page()
    page.set_content("""<style>
      body { background:#fff; }
      input { background:#fff; outline:none; border:1px solid; }
      #bad-field { border-color:#969696; }
      #bad-field::placeholder { color:#777; opacity:1; }
      #good-field { border-color:#949494; }
      #good-field::placeholder { color:#767676; opacity:1; }
    </style><div id="view"><div class="chart" data-ready="1">
      <svg width="500" height="150">
        <text x="10" y="20" fill="#777" font-size="12">small-fail</text>
        <text x="10" y="50" fill="#767676" font-size="12">small-pass</text>
        <text x="10" y="90" fill="#969696" font-size="24">large-fail</text>
        <text x="10" y="130" fill="#949494" font-size="24">large-pass</text>
      </svg></div>
      <input id="bad-field" placeholder="Unreadable placeholder">
      <input id="good-field" placeholder="Readable placeholder">
    </div>""")
    result = page.evaluate(CONTRAST_JS)
    assert {item['txt'] for item in result['low']} == {'small-fail', 'large-fail'}, result
    assert [item['who'] for item in result['ph']] == ['bad-field'], result
    assert [item['who'] for item in result['border']] == ['bad-field'], result
    context.close()
    print('light-contrast: positive/negative controls passed (4.5:1 text, 3:1 large text/boundaries)')


def check_light_contrast(browser, base, evidence=Path('tmp/visual-contrast/results.json')):
    check_probe_thresholds(browser)
    records, failures = [], []
    for width, height in ((1280, 900), (400, 800)):
        context = browser.new_context(viewport={'width': width, 'height': height},
                                      color_scheme='light', reduced_motion='reduce',
                                      service_workers='block')
        page = context.new_page()
        page.goto(base.rstrip('/') + '/')
        page.locator('article[data-ready="1"]').wait_for()
        routes = page.evaluate('window.__ROUTES__')
        assert routes, 'Route discovery must not produce an empty contrast run'
        # Matches the old plan_theme/job_theme_view coverage: first sample of
        # every non-bare route, including the genuine not-found screen.
        for route in routes:
            if route.get('bare'):
                continue
            samples = route.get('samples') or ['/nyama-takava']
            path = samples[0].removeprefix('#')
            page.goto(base.rstrip('/') + path)
            page.locator('article[data-ready="1"]').wait_for()
            deep_pass(page)
            result = page.evaluate(CONTRAST_JS)
            record = {'route': route['id'], 'path': path, 'width': width, **result}
            records.append(record)
            for key in ('low', 'ph', 'border'):
                if result[key]:
                    failures.append({'route': route['id'], 'width': width,
                                     'kind': key, 'violations': result[key]})
        context.close()
    totals = {key: sum(record[key] for record in records)
              for key in ('texts', 'fields', 'placeholders', 'boundaries')}
    assert all(totals.values()), f'Contrast categories must not be vacuous: {totals}'
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_text(json.dumps({'visits': records, 'totals': totals,
                                    'failures': failures}, ensure_ascii=False, indent=2) + '\n')
    assert not failures, json.dumps(failures, ensure_ascii=False, indent=2)
    print(f'light-contrast: {len(records)} route/viewport visits passed; {totals}')
    return len(records)
