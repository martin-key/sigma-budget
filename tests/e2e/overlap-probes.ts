export const measureLayout = () => {
  const out = [];
  const vis = (e: Element) => {
    const r = e.getBoundingClientRect(),
      cs = getComputedStyle(e);
    if (
      r.width < 2 ||
      r.height < 2 ||
      cs.visibility === 'hidden' ||
      cs.display === 'none' ||
      parseFloat(cs.opacity) < 0.05
    )
      return false;
    if (e.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    for (
      let d = e.closest('details');
      d;
      d = d.parentElement && d.parentElement.closest('details')
    ) {
      if (!d.open) {
        const sm = e.closest('summary');
        if (!(sm && sm.parentElement === d)) return false;
      }
    } // nested closed <details>
    if (e.classList.contains('skip-link') || e.closest('.sr-only') || e.closest('svg'))
      return false; // the regions of a map are polygons: their boxes cross by nature
    return true;
  };
  const fixedOf = (e: Element) => {
    for (let x: Element | null = e; x && x !== document.body; x = x.parentElement)
      if (getComputedStyle(x).position === 'fixed') return x;
    return null;
  };
  const name = (e: Element) =>
    (e.id ? '#' + e.id : '') +
    '.' +
    String(typeof e.className === 'string' ? e.className : '').split(' ')[0] +
    '«' +
    (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26) +
    '»';
  const sel =
    'a[href],button,[role=tab],[role=button],input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"])';
  const els = [...document.querySelectorAll(sel)].filter(vis);
  for (let i = 0; i < els.length; i++)
    for (let j = i + 1; j < els.length; j++) {
      const a = els[i]!,
        b = els[j]!;
      if (a.contains(b) || b.contains(a)) continue;
      if (a.matches('.table-wrap,[role=region]') || b.matches('.table-wrap,[role=region]'))
        continue; // a scroll region is a box around other things on purpose
      if (!!fixedOf(a) !== !!fixedOf(b)) continue;
      if (
        (a.matches('input') && b.closest('.field,.s28-field,form') && b.matches('.icon-btn')) ||
        (b.matches('input') && a.closest('.field,.s28-field,form') && a.matches('.icon-btn'))
      )
        continue; // the clear button sits INSIDE the search field on purpose
      let hit: [number, number, number] | null = null; // per LINE box: an inline link that wraps has one box per line, the union of which says nothing
      for (const A of a.getClientRects()) {
        if (A.width < 2 || A.height < 2) continue;
        for (const B of b.getClientRects()) {
          const w = Math.min(A.right, B.right) - Math.max(A.left, B.left),
            h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
          if (w > 4 && h > 4) {
            hit = [w, h, A.top];
            break;
          }
        }
        if (hit) break;
      }
      if (hit)
        out.push({
          k: 'overlap',
          m: `${name(a)} x ${name(b)} (${Math.round(hit[0])}x${Math.round(hit[1])} at y=${Math.round(hit[2] + scrollY)})`,
        });
    }
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth + 1)
    out.push({ k: 'hscroll', m: `scrollWidth ${root.scrollWidth} > ${root.clientWidth}` });
  const inScroller = (e: Element) => {
    for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) {
      const o = getComputedStyle(x).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
    }
    return false;
  };
  for (const e of document.querySelectorAll('#topbar *,#view *,#footer *,#tabbar *')) {
    if (!vis(e) || inScroller(e) || e.closest('svg,canvas,.chart')) continue;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && (r.right > innerWidth + 1.5 || r.left < -1.5)) {
      out.push({
        k: 'outside',
        m: `${name(e)} box ${Math.round(r.left)}..${Math.round(r.right)} in ${innerWidth}px`,
      });
      break;
    }
  }
  for (const e of els) {
    if (e.closest('.table-wrap,.chart') || e.matches('.tab-panel')) continue;
    const cs = getComputedStyle(e);
    if (
      e.scrollWidth > e.clientWidth + 8 &&
      cs.overflowX === 'visible' &&
      cs.display !== 'inline' &&
      e.clientWidth > 0 &&
      !e.matches('input,select,textarea')
    )
      out.push({ k: 'spill', m: `${name(e)} text ${e.scrollWidth}px in a ${e.clientWidth}px box` });
  }
  return out;
};
