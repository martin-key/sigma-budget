export const readComparisonGrid = () => {
  const g = document.querySelector('#s15-t-grid') || document.querySelector('table.data');
  if (!g) return null;
  const out: Record<string, string[]> = {};
  g.querySelectorAll('tbody tr, tfoot tr').forEach((tr) => {
    const th = tr.querySelector('th');
    const name = th?.textContent?.trim();
    if (!name) throw new Error('Comparison row has no header text');
    out[name] = [...tr.children].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim());
  });
  return out;
};
export const ROUTES = [
  ['home', '#/', 'S01'],
  ['izpalnenie', '#/izpalnenie', 'S15'],
  ['izp-2024', '#/izpalnenie?g1=2024&g2=2025&obhvat=eu&rez=mesec', 'S15'],
  ['razhodi', '#/razhodi', 'S07'],
  ['prihodi', '#/prihodi', 'S06'],
  ['danaci', '#/danaci', 'S18'],
  ['tarsene', '#/tarsene?q=%D0%94%D0%94%D0%A1', 'S28'],
  ['izp-budzheti', '#/izpalnenie/byudzheti', 'S15'],
  ['vedomstva', '#/vedomstva', 'S10'],
];
export const measureTouchTargets = () => {
  const sel =
    'button, input:not([type=hidden]), select, textarea, summary, [role=tab], [role=button], .btn, a.btn, a.tab, .seg label, a[class*=card], a[class*=link-card]';
  const bad = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('[hidden], details:not([open]) > :not(summary), .sr-only')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (
      cs.visibility === 'hidden' ||
      cs.display === 'none' ||
      (cs.position === 'absolute' && (r.width < 2 || r.height < 2))
    )
      continue;
    // the hit area of a hidden native input is its label
    let box: Pick<DOMRect, 'width' | 'height'> = r;
    if (el.matches('input[type=radio],input[type=checkbox]')) {
      const l =
        el.closest('label') ||
        (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'));
      if (l) box = l.getBoundingClientRect();
    }
    // a link inside a sentence gets its hit area from an ::after box (layout.css, pointer:coarse): measure that box
    const pa = getComputedStyle(el, '::after');
    if (pa.content !== 'none' && pa.position === 'absolute') {
      const pw = parseFloat(pa.width),
        ph = parseFloat(pa.height);
      if (pw > box.width || ph > box.height)
        box = { width: Math.max(pw || 0, box.width), height: Math.max(ph || 0, box.height) };
    }
    if (box.height < 43.5 || box.width < 43.5)
      bad.push({
        n: (
          el.getAttribute('aria-label') ||
          el.textContent ||
          el.getAttribute('name') ||
          el.id ||
          el.tagName
        )
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40),
        w: Math.round(box.width),
        h: Math.round(box.height),
        t: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
      });
  }
  return bad;
};
export const measureOverflow = () => {
  const de = document.documentElement;
  const wide = [];
  for (const el of document.querySelectorAll('main *, #main *')) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    if (
      r.right > de.clientWidth + 1 &&
      !el.closest(
        '.table-wrap, [data-ui="table"], svg, .chart, pre, .map-svg, [data-scroll], .sr-only, .tab-list, [role=tablist]',
      ) &&
      getComputedStyle(el).position !== 'fixed'
    )
      wide.push(
        el.tagName.toLowerCase() +
          (el.id ? '#' + el.id : '') +
          '.' +
          String(el.className).slice(0, 30) +
          ' right=' +
          Math.round(r.right),
      );
  }
  const grid = document.querySelector('#s15-t-grid-wrap, [data-route] .s01-wrap');
  return {
    page: de.scrollWidth - de.clientWidth,
    wide: wide.slice(0, 4),
    gridOver: grid ? grid.scrollWidth - grid.clientWidth : 0,
  };
};
export const inspectFocus = () => {
  const element = document.activeElement;
  if (
    !(element instanceof HTMLElement || element instanceof SVGElement) ||
    element === document.body
  )
    return null;
  const rectangle = element.getBoundingClientRect();
  const candidates = [
    ...new Set(
      [
        element,
        ...['label', '.seg', 'details', '.field'].map((selector) => element.closest(selector)),
        element.id ? document.querySelector('label[for="' + CSS.escape(element.id) + '"]') : null,
        element.matches('input[type=radio], input[type=checkbox]')
          ? element.nextElementSibling
          : null,
      ].filter((candidate): candidate is Element => candidate !== null),
    ),
  ];
  const readStyles = () =>
    candidates.map((candidate) => {
      const style = getComputedStyle(candidate);
      return {
        outline: parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none',
        shadow: style.boxShadow,
      };
    });
  // A slider draws its ring on the thumb, which computed styles cannot read: find the rule that draws it.
  const thumbRing =
    element.matches('input[type=range]') &&
    [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .some(
        (rule) =>
          rule instanceof CSSStyleRule &&
          rule.selectorText.endsWith(':focus-visible::-webkit-slider-thumb') &&
          element.matches(rule.selectorText.replace('::-webkit-slider-thumb', '')) &&
          parseFloat(rule.style.getPropertyValue('outline')) > 0,
      );
  const focused = readStyles();
  let ring: boolean;
  try {
    element.blur();
    const unfocused = readStyles();
    ring =
      thumbRing ||
      focused.some(
        (style, index) =>
          style.outline ||
          (style.shadow !== 'none' &&
            style.shadow !== '' &&
            style.shadow !== unfocused[index]!.shadow),
      );
  } finally {
    element.focus({ preventScroll: true });
  }
  const previous = window.__prevFocus;
  window.__prevFocus = element;
  return {
    back: !!(
      previous &&
      previous !== element &&
      previous.isConnected &&
      !(previous.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
    ),
    n: (
      element.getAttribute('aria-label') ||
      element.textContent ||
      element.getAttribute('name') ||
      element.id ||
      element.tagName
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 36),
    tag: element.tagName.toLowerCase(),
    top: Math.round(rectangle.top + scrollY),
    ring,
  };
};
