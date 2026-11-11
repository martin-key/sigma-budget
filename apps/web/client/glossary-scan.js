// The glossary scanner (PLAN 6.3), without a browser (docs/adr/0002-react-router-ssr.md): js/glossary.js runs it on the page, the server
// (apps/web/app/lib/screen.server.ts) on the screen it draws, with the same rules, so a crawler reads the same links as a visitor.
//   link(root, g) -> number linked      root: an element of any DOM (the page's, or linkedom's on the server); g: index(glossary.json)
//   index(doc) -> {terms, by: Map(slug -> term)}
// The first mention of a term on the screen becomes a link, at most 3 per paragraph, never inside headings, numbers (the word right after
// „5,7% от“), tables, buttons or other links. Only the curated forms below are linked (with articles and plurals); common words alone
// („бюджет“, „приходи“, „разходи“) never are. A term the screen already linked by hand with gl() counts as done.
export const HREF = (slug) => `#/rechnik/${slug}`;
let ix = null;
export function index(doc) {
  if (ix && ix.doc === doc) return ix;
  const terms = Array.isArray(doc?.terms) ? doc.terms.filter((t) => t && t.slug) : [];
  ix = { doc, terms, by: new Map(terms.map((t) => [t.slug, t])) };
  return ix;
}

// [slug, forms] — forms are regular-expression source: Bulgarian articles and plurals; matched case-insensitively between non-letters.
const LINKS = [
  ['kfp', 'КФП|консолидиран(?:ата|а)\\s+фискалн(?:ата|а)\\s+програм(?:ата|а)'],
  ['bvp', 'БВП|брут(?:ен|ния|ният)\\s+вътрешен\\s+продукт'],
  ['dds', 'ДДС|данък(?:а|ът)?\\s+върху\\s+добавената\\s+стойност'],
  [
    'nov-dalg-novo-zaemane',
    'нов(?:ия|ият)?\\s+дълг|новопоет(?:ия|ият)?\\s+дълг|ново(?:то)?\\s+заемане',
  ],
  [
    'darzhaven-dalg',
    'държав(?:ен|ния|ният)\\s+дълг(?:ът|а)?|(?<!общинския\\s|общински\\s|нов\\s|новия\\s|новият\\s|новопоет\\s|новопоетия\\s|новопоетият\\s)дълг(?:ът|а)?',
  ],
  ['byudzheten-defitsit', 'дефицит(?:ът|а|и|ите)?'],
  ['byudzheten-izlishak', 'излиш(?:ък|ъкът|ъка|ъци|ъците)'],
  ['byudzhetno-saldo', 'салдо(?:то)?'],
  ['balansiran-byudzhet', 'балансиран(?:ия|ият)?\\s+бюджет(?:ът|а)?'],
  ['lihva', 'лихв(?:а|ата|и|ите)'],
  ['glavnitsa', 'главниц(?:а|ата)'],
  ['refinansirane', 'рефинансиране(?:то)?'],
  ['fiskalen-rezerv', 'фискал(?:ен|ния|ният)\\s+резерв(?:ът|а)?'],
  ['darzhavna-garantsiya', 'държавн(?:а|ата|и|ите)\\s+гаранци(?:я|ята|и|ите)'],
  ['kapitalovi-razhodi', 'капиталов(?:и|ите)\\s+разход(?:и|ите)|капиталов\\s+разход'],
  ['tekushti-razhodi', 'текущ(?:и|ите)\\s+разход(?:и|ите)|текущ\\s+разход'],
  ['nedanachni-prihodi', 'неданъчн(?:и|ите)\\s+приход(?:и|ите)'],
  ['danachni-prihodi', 'данъчн(?:и|ите)\\s+приход(?:и|ите)'],
  ['bezvazmezdno-finansirane', 'безвъзмездно(?:то)?\\s+финансиране'],
  ['aktsiz', 'акциз(?:ът|а|и|ите)?'],
  ['osiguritelni-vnoski', 'осигурителн(?:и|ите)\\s+вноск(?:и|ите)|осигуровк(?:и|ите)'],
  ['osiguritelen-dohod', 'осигурител(?:ен|ния|ният)\\s+доход(?:ът|а)?'],
  ['brutna-zaplata', 'брутн(?:а|ата)(?:\\s+си)?(?:\\s+месечн(?:а|ата))?\\s+заплат(?:а|ата)'],
  ['netna-zaplata', 'нетн(?:а|ата)\\s+заплат(?:а|ата)'],
  ['danak-varhu-dohodite', 'данък(?:ът|а)?\\s+върху\\s+доход(?:а|ите)'],
  ['korporativen-danak', 'корпоратив(?:ен|ния|ният)\\s+данък'],
  ['danachna-osnova', 'данъчн(?:а|ата)\\s+основ(?:а|ата)'],
  ['danachna-stavka', 'данъчн(?:а|ата|и|ите)\\s+ставк(?:а|ата|и|ите)'],
  ['byudzhetna-funktsiya', '(?:бюджетн(?:а|ата|и|ите)\\s+)?функци(?:я|ята|и|ите)'],
  [
    'byudzhetna-programa',
    'бюджетн(?:а|ата|и|ите)\\s+програм(?:а|ата|и|ите)|(?<=политики\\s+и\\s+)програм(?:и|ите)',
  ],
  [
    'parvostepenen-razporeditel-s-byudzhet',
    '(?:първостепен(?:ен|ния|ният|ни|ните)\\s+)?разпоредител(?:и|ите|я|ят)?(?:\\s+с\\s+бюджет)?',
  ],
  ['prihodna-myarka', 'приходн(?:а|ата)\\s+мярк(?:а|ата)|приходн(?:и|ите)\\s+мерк(?:и|ите)'],
  ['razhodna-myarka', 'разходн(?:а|ата)\\s+мярк(?:а|ата)|разходн(?:и|ите)\\s+мерк(?:и|ите)'],
  ['fiskalen-efekt', '(?:фискал|бюджет)(?:ен|ния|ният)\\s+ефект(?:ът|а)?'],
  ['bazov-stsenariy', '(?:базов(?:ия|ият)?\\s+)?сценари(?:й|я|ят)'],
  ['nachislena-osnova', 'начислен(?:а|ата)\\s+основ(?:а|ата)'],
  ['kasova-osnova', 'касов(?:а|ата)\\s+основ(?:а|ата)'],
  ['sezonnost', 'сезонност(?:та)?'],
  ['inflatsiya', 'инфлаци(?:я|ята)'],
  [
    'protsenten-punkt',
    'процент(?:ен|ния|ният)\\s+пункт(?:ът|а)?|процентни(?:те)?\\s+пункт(?:а|ове|овете)',
  ],
  ['nominalen-rast', 'номинал(?:ен|ния|ният)\\s+ръст(?:ът|а)?'],
  ['realen-rast', 'реал(?:ен|ния|ният)\\s+ръст(?:ът|а)?'],
  ['dyal-ot-bvp', '(?:дял|дела|делът)\\s+от\\s+БВП'],
  ['sektor-darzhavno-upravlenie', 'сектор(?:а|ът)?\\s+„Държавно\\s+управление“'],
  ['konsolidirane', 'консолидиране(?:то)?|консолидаци(?:я|ята)'],
  ['byudzheten-transfer', '(?:бюджет(?:ен|ния|ният)\\s+)?трансфер(?:ът|а|и|ите)?'],
  ['subsidiya', 'субсиди(?:я|ята|и|ите)'],
  ['obshtestvena-porachka', 'обществен(?:а|ата|и|ите)\\s+поръчк(?:а|ата|и|ите)'],
  ['priet-byudzhet', 'прие(?:т|тия|тият)\\s+бюджет(?:ът|а)?'],
  ['proektobyudzhet', 'проектобюджет(?:ът|а)?'],
  ['aktualizatsiya-na-byudzheta', 'актуализаци(?:я|ята)\\s+на\\s+бюджета'],
  ['byudzhetna-prognoza', '(?:бюджетн(?:а|ата|и|ите)\\s+)?прогноз(?:а|ата|и|ите)'],
  ['darzhaven-byudzhet', 'държав(?:ен|ния|ният)\\s+бюджет(?:ът|а)?'],
  ['obshtinski-byudzhet', 'общинск(?:и|ия|ият|ите)\\s+бюджет(?:и|ите|ът|а)?'],
  [
    'obsht-razhod-na-rabotodatelya-za-zaplata',
    'общ(?:ия|ият)?\\s+разход(?:ът|а)?\\s+на\\s+работодателя(?:\\s+за\\s+заплат(?:а|ата))?|разход(?:ът|а)?\\s+на\\s+работодателя',
  ],
  ['razhod-na-chovek', 'разход(?:ът|а)?\\s+на\\s+(?:един\\s+)?човек'],
  [
    'otchet-za-byudzheta',
    'отчет(?:ът|а)?\\s+за\\s+(?:изпълнението\\s+на\\s+)?(?:държавния\\s+)?бюджет(?:а|ът)?',
  ],
  ['izpalnenie-na-byudzheta', 'изпълнение(?:то)?\\s+на\\s+(?:държавния\\s+)?бюджет(?:а|ът)?'],
  ['byudzhetna-godina', 'бюджетн(?:а|ата)\\s+годин(?:а|ата)'],
];
// the same word after a number is a quantity, not a lesson („5,7% от БВП“, „70 млн. евро дълг“)
const NUM = /\d[\d\s.,]*(?:\s*(?:%|€|евро|лв\.|лева|млрд\.|млн\.|хил\.|пр\.п\.))*\s*(?:от\s+)?$/u;
// a bare „дълг“ in a sentence about municipalities is municipal debt, not „Държавен дълг“
const GUARD = { 'darzhaven-dalg': (m, s) => /^държав/i.test(m[0]) || !/общин/i.test(s) };
const IN = 'p, li, dd, blockquote, figcaption';
const SKIP =
  'a, button, summary, label, select, option, textarea, input, h1, h2, h3, h4, h5, h6, table, svg, code, kbd, mark, nav, [data-gl-skip], .sr-only, .kpi, .chip, .eyebrow, .fig-legend';
const MAX = 3; // links per paragraph; the rest wait for their next mention

let compiled = null;
export function patterns(g) {
  if (compiled && compiled.g === g) return compiled.list;
  const list = LINKS.filter(([slug]) => g.by.has(slug)).map(([slug, re]) => ({
    slug,
    re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${re})(?![\\p{L}\\p{N}])`, 'giu'),
  }));
  compiled = { g, list };
  return list;
}

export function find(p, s) {
  p.re.lastIndex = 0;
  for (let m = p.re.exec(s); m; m = p.re.exec(s)) {
    if (
      !NUM.test(s.slice(Math.max(0, m.index - 24), m.index)) &&
      (!GUARD[p.slug] || GUARD[p.slug](m, s))
    )
      return m;
  }
  return null;
}

export function link(root, g) {
  const pats = patterns(g);
  const all = [
    ...(root.matches && root.matches('[data-gl-scan]') ? [root] : []),
    ...root.querySelectorAll('[data-gl-scan]'),
  ];
  const hosts = all.filter((c) => !all.some((o) => o !== c && o.contains(c)));
  if (!hosts.length) return 0;
  const screen = root.closest ? root.closest('article.page') || root : root;
  const done = new Set();
  const per = new Map(); // paragraph -> links in it so far (hand-made ones count)
  const boxOf = (el, host) => {
    const b = el.closest(IN);
    return b && host.contains(b) ? b : host;
  };
  const hostOf = (el) => hosts.find((h) => h.contains(el)) || hosts[0];
  screen.querySelectorAll('a[data-gl]').forEach((a) => {
    done.add(a.getAttribute('data-gl'));
    const h = hostOf(a);
    if (h.contains(a)) per.set(boxOf(a, h), (per.get(boxOf(a, h)) || 0) + 1);
  });

  const nodes = [];
  for (const host of hosts) {
    const w = host.ownerDocument.createTreeWalker(host, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.parentElement;
      if (n.nodeValue.trim().length < 3 || !el || el.closest(SKIP)) continue;
      nodes.push({ n, host, hidden: !!el.closest('details:not([open]), [hidden]') });
    }
  }
  let added = 0;
  for (const { n, host } of [...nodes.filter((x) => !x.hidden), ...nodes.filter((x) => x.hidden)]) {
    // text you can see first, then the folded text
    const box = boxOf(n.parentElement, host);
    let cur = n;
    while (cur && (per.get(box) || 0) < MAX) {
      let best = null;
      for (const p of pats) {
        if (done.has(p.slug)) continue;
        const m = find(p, cur.nodeValue);
        if (m && (!best || m.index < best.i || (m.index === best.i && m[0].length > best.len)))
          best = { i: m.index, len: m[0].length, slug: p.slug };
      }
      if (!best) break;
      const text = cur.nodeValue,
        doc = cur.ownerDocument,
        parent = cur.parentNode;
      const a = doc.createElement('a');
      a.setAttribute('class', 'gl');
      a.setAttribute('href', HREF(best.slug));
      a.setAttribute('data-gl', best.slug);
      a.setAttribute('aria-haspopup', 'dialog');
      a.appendChild(doc.createTextNode(text.slice(best.i, best.i + best.len)));
      const rest = doc.createTextNode(text.slice(best.i + best.len));
      cur.nodeValue = text.slice(0, best.i);
      parent.insertBefore(a, cur.nextSibling);
      parent.insertBefore(rest, a.nextSibling);
      done.add(best.slug);
      per.set(box, (per.get(box) || 0) + 1);
      added++;
      cur = rest;
    }
  }
  return added;
}
