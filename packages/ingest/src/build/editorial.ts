import { createHash } from 'node:crypto';

// These are the SHA-256 values registered for the described editorial inputs.
export const EDITORIAL_HASHES = {
  'guide.json': '9a808bca21b3817350f1032d469e9dc242f397012be93a4b09d976557be05b09',
  'glossary.json': '0d88665ab18f66da040adfe6ee525d5a7aacfcc72223df5ccfc7b4276c888a77',
} as const;

import type {
  EditorialRoute,
  GlossarySource,
  GlossarySourceTerm,
  GlossaryDataset,
  GlossaryTerm,
  GuideDataset,
  GuideStep,
} from './editorial-types.js';
export type * from './editorial-types.js';

function need<T>(value: T | null | undefined, field: string): T {
  if (value === undefined || value === null) throw new Error(`Missing ${field}`);
  return value;
}
export function loadEditorialRoutes(catalogue: { routes: unknown[][] }): EditorialRoute[] {
  if (!Array.isArray(catalogue.routes)) throw new Error('Invalid route catalogue');
  const routes = catalogue.routes.map((record) => {
    if (!Array.isArray(record) || ![7, 8].includes(record.length))
      throw new Error('Invalid route record');
    const [id, key, pattern, , title, , , options] = record;
    if (
      typeof id !== 'string' ||
      typeof key !== 'string' ||
      (pattern !== null && typeof pattern !== 'string') ||
      typeof title !== 'string'
    )
      throw new Error('Invalid route fields');
    return {
      id,
      key,
      pattern,
      title,
      step: (options as { step?: number } | undefined)?.step ?? null,
    };
  });
  if (!routes.length || new Set(routes.map((r) => r.id)).size !== routes.length)
    throw new Error('Duplicate or empty route catalogue');
  return routes;
}
export function matchEditorialHref(
  routes: EditorialRoute[],
  href: string,
): { route: EditorialRoute; params: Record<string, string> } | null {
  if (!href.startsWith('#/')) return null;
  const path = href.slice(1).split('?')[0]!;
  const segs = path.split('/').filter(Boolean);
  const ordered = routes
    .filter((r) => r.pattern)
    .map((r) => ({ r, parts: r.pattern!.split('/').filter(Boolean) }))
    .sort((a, b) => b.parts.length - a.parts.length);
  for (const { r, parts } of ordered) {
    const parsed = parts.map((p) => {
      const m = /^:(\w+)(?:\(([^)]+)\))?(\?)?$/.exec(p);
      return m
        ? { name: m[1]!, re: m[2] ? new RegExp(`^(?:${m[2]})$`) : null, opt: !!m[3] }
        : { lit: p };
    });
    const required = parsed.filter((p) => 'lit' in p || !p.opt).length;
    if (segs.length < required || segs.length > parsed.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i]!,
        v = segs[i];
      if (v === undefined) {
        if ('lit' in p || !p.opt) ok = false;
      } else if ('lit' in p) {
        if (p.lit !== v.toLowerCase()) ok = false;
      } else if (!p.re || p.re.test(v)) params[p.name] = v;
      else if (p.re.test(v.toLowerCase())) params[p.name] = v.toLowerCase();
      else ok = false;
      if (!ok) break;
    }
    if (ok) return { route: r, params };
  }
  return null;
}
const revenue = new Set([
  'dds',
  'osiguritelni',
  'nedanachni',
  'pomoshti',
  'ddfl',
  'akcizi',
  'korporativen',
  'drugi',
]);
export function requireEditorialHref(routes: EditorialRoute[], href: string): void {
  const hit = matchEditorialHref(routes, href);
  if (
    !hit ||
    (hit.route.key === 'prihodi' &&
      hit.params.source !== undefined &&
      !revenue.has(hit.params.source))
  )
    throw new Error(`Unresolved editorial href: ${href}`);
}
const SEE: Record<string, string> = {
  'darzhaven-byudzhet': '#/izpalnenie/byudzheti',
  kfp: '#/izpalnenie/byudzheti',
  konsolidirane: '#/izpalnenie/byudzheti',
  'byudzheten-transfer': '#/izpalnenie/byudzheti',
  'obshtinski-byudzhet': '#/obshtini',
  subsidiya: '#/obshtini',
  'sektor-darzhavno-upravlenie': '#/dalg',
  'priet-byudzhet': '#/vedomstva',
  'byudzhetna-programa': '#/vedomstva',
  'parvostepenen-razporeditel-s-byudzhet': '#/vedomstva',
  proektobyudzhet: '#/merki',
  'prihodna-myarka': '#/merki',
  'razhodna-myarka': '#/merki',
  'fiskalen-efekt': '#/merki',
  'byudzhetna-prognoza': '#/prognoza',
  'byudzhetno-saldo': '#/dalg',
  'byudzheten-defitsit': '#/dalg',
  'darzhaven-dalg': '#/dalg',
  lihva: '#/dalg',
  'dyal-ot-bvp': '#/dalg',
  'izpalnenie-na-byudzheta': '#/izpalnenie',
  'otchet-za-byudzheta': '#/izpalnenie',
  sezonnost: '#/izpalnenie',
  'fiskalen-rezerv': '#/izpalnenie',
  'byudzhetni-prihodi': '#/prihodi',
  'danachni-prihodi': '#/prihodi',
  'nedanachni-prihodi': '#/prihodi/nedanachni',
  'bezvazmezdno-finansirane': '#/prihodi/pomoshti',
  dds: '#/prihodi/dds',
  aktsiz: '#/prihodi/akcizi',
  'danak-varhu-dohodite': '#/prihodi/ddfl',
  'korporativen-danak': '#/prihodi/korporativen',
  'osiguritelni-vnoski': '#/prihodi/osiguritelni',
  'osiguritelen-dohod': '#/danaci',
  'danachna-stavka': '#/danaci',
  'brutna-zaplata': '#/danaci',
  'netna-zaplata': '#/danaci',
  'obsht-razhod-na-rabotodatelya-za-zaplata': '#/danaci',
  'byudzhetni-razhodi': '#/razhodi',
  'byudzhetna-funktsiya': '#/razhodi',
  'razhod-na-chovek': '#/razhodi',
  'kapitalovi-razhodi': '#/',
  bvp: '#/',
};
const meta = (id: string, title: string, sourceNote: string, buildDate: string) => ({
  id,
  title,
  status: 'real',
  source: ['wg'],
  sourceNote,
  asOf: '2026-10-01',
  retrieved: buildDate,
  mock: false,
});

/** The historical glossary transformation; the release uses the frozen snapshot. */
export function buildGlossary(
  src: GlossarySource,
  routes: EditorialRoute[],
  buildDate = '2026-11-08',
): GlossaryDataset {
  const terms = need(src.terms, 'terms'),
    cats = need(src.categories, 'categories'),
    rows = need(src.related?.items, 'related.items');
  if (terms.length !== 64) throw new Error('Expected 64 terms');
  const byN = new Map<number, GlossarySourceTerm>(),
    bySlug = new Map<string, GlossarySourceTerm>();
  for (const t of terms) {
    for (const field of ['n', 'slug', 'title', 'name', 'cat', 'def', 'example', 'aliases'] as const)
      need(t[field], `term.${field}`);
    if (byN.has(t.n) || bySlug.has(t.slug)) throw new Error('Duplicate term number or slug');
    byN.set(t.n, t);
    bySlug.set(t.slug, t);
  }
  for (let n = 1; n <= 64; n++) if (!byN.has(n)) throw new Error('Term numbers are not 1..64');
  const categories = cats.map((c) => ({
    id: need(c.id, 'category.id'),
    title: need(c.title, 'category.title'),
    short: need(c.short, 'category.short'),
    from: need(c.from, 'category.from'),
    to: need(c.to, 'category.to'),
  }));
  for (const t of terms) {
    if (!cats.some((c) => c.id === t.cat)) throw new Error('Unknown category');
    for (const c of cats)
      if (c.from <= t.n && t.n <= c.to && t.cat !== c.id) throw new Error('Term outside category');
  }
  for (const row of rows)
    for (const n of row.terms) if (!byN.has(n)) throw new Error('Unknown related term');
  const related = new Map<string, GlossaryTerm['related']>();
  for (const t of terms) {
    const list: GlossaryTerm['related'] = [];
    for (const row of rows)
      if (row.terms.includes(t.n))
        for (const n of row.terms)
          if (n !== t.n && byN.has(n)) {
            const slug = byN.get(n)!.slug;
            if (list.some((item) => item.slug === slug)) throw new Error('Duplicate related term');
            list.push({ slug, note: need(row.note, 'related.note') });
          }
    related.set(t.slug, list);
  }
  for (const [slug, href] of Object.entries(SEE)) {
    if (!bySlug.has(slug)) throw new Error('Unknown SEE slug');
    requireEditorialHref(routes, href);
  }
  const resultTerms = terms.map((t) => ({
    n: t.n,
    slug: t.slug,
    title: t.title,
    name: t.name,
    ...(t.abbr ? { abbr: t.abbr } : {}),
    cat: t.cat,
    def: t.def,
    example: t.example,
    aliases: t.aliases.map((a) => need(a.text, 'alias.text')),
    related: need(related.get(t.slug), `related.${t.slug}`),
    see: SEE[t.slug] ? [{ label: 'Виж в бюджета', href: SEE[t.slug]! }] : [],
  }));
  const relations = rows.map((r) => ({
    text: need(r.text, 'relation.text'),
    from: need(r.from, 'relation.from'),
    to: [...need(r.to, 'relation.to')],
    note: need(r.note, 'relation.note'),
    terms: r.terms.map((n: number) => byN.get(n)!.slug),
  }));
  const intro = need(src.intro, 'intro'),
    source = need(src.sources, 'sources');
  return {
    meta: meta(
      'D22',
      need(src.title, 'title'),
      'Речник с 64 термина на работна група „Бюджет на светло“: определенията, примерите и свързаните понятия са дословно от документа; връзките „Виж в бюджета“ са към екраните на този сайт. Числата в примерите са условни.',
      buildDate,
    ),
    title: src.title,
    subtitle: need(src.subtitle, 'subtitle'),
    intro: {
      lead: need(intro.lead, 'intro.lead'),
      text: need(intro.text, 'intro.text'),
      disclaimer: {
        bold: need(intro.disclaimer?.bold, 'disclaimer.bold'),
        text: need(intro.disclaimer?.text, 'disclaimer.text'),
      },
    },
    categories,
    terms: resultTerms,
    relationsTitle: need(src.related.title, 'related.title'),
    relations,
    sourcesTitle: need(source.title, 'sources.title'),
    sourcesIntro: need(source.intro, 'sources.intro'),
    sources: source.items.map((s) => ({
      name: need(s.name, 'source.name'),
      url: need(s.url, 'source.url'),
    })),
  };
}

/** Preserve the exact registered input bytes, as build.frozen_editorial does. */
export function restoreEditorial(
  inputs: Record<keyof typeof EDITORIAL_HASHES, Uint8Array>,
  routes: EditorialRoute[],
): Record<keyof typeof EDITORIAL_HASHES, Uint8Array> {
  for (const name of Object.keys(EDITORIAL_HASHES) as (keyof typeof EDITORIAL_HASHES)[]) {
    if (createHash('sha256').update(inputs[name]).digest('hex') !== EDITORIAL_HASHES[name])
      throw new Error(`Editorial input hash mismatch: ${name}`);
  }
  const glossary = JSON.parse(
    Buffer.from(inputs['glossary.json']).toString('utf8'),
  ) as GlossaryDataset;
  const slugs = new Set<string>();
  for (const t of need(glossary.terms, 'terms')) {
    for (const field of [
      'n',
      'slug',
      'title',
      'name',
      'cat',
      'def',
      'example',
      'aliases',
      'related',
      'see',
    ] as const)
      need(t[field], `term.${field}`);
    if (slugs.has(t.slug)) throw new Error('Duplicate slug');
    slugs.add(t.slug);
    for (const link of t.see) requireEditorialHref(routes, need(link.href, 'see.href'));
  }
  const guide = JSON.parse(Buffer.from(inputs['guide.json']).toString('utf8')) as GuideDataset;
  const errors = checkGuide(guide, routes);
  if (errors.length) throw new Error(errors.join('\n'));
  return inputs;
}

const renamed: Record<number, [string, string | null, string | null]> = {
  1: [
    'Държавният бюджет на достъпен език',
    'Виж колко приходи са събрани и колко средства са изразходвани до последния месечен отчет, и как това се сравнява със същия период на миналата година. Когато разходите надвишават приходите, разликата е дефицит.',
    null,
  ],
  6: [
    'Месечни отчети',
    'Виж към коя дата са данните, колко приходи са събрани и колко средства са изразходвани. Сравни две години един до друг за един и същ период.',
    'Следва: провери колко от годината е събрано и изразходвано.',
  ],
  8: ['Моите данъци', null, null],
};
const NOTE =
  'Текстът на пътеводителя на работна група „Бюджет на светло“ е дословно от оригинала: въведение, осем стъпки и „Преди да използваш или споделиш число“. Препратките към екраните на сайта са добавени. В тази версия имената на екраните в стъпки 1, 6 и 8 следват преименуваните екрани („Държавният бюджет на достъпен език“, „Месечни отчети“, „Моите данъци“), а уводът на стъпки 1 и 6 е съобразен с тях. Пътеводителят вече не е отделен екран: бележките „На какво да внимаваш“ и петте проверки се показват в „Бюджетът за 5 минути“.';
const sample = (pattern: string) =>
  '#/' +
  pattern
    .split('/')
    .filter((x) => x && !x.startsWith(':'))
    .join('/');
export function applyGuide(g: GuideDataset): GuideDataset {
  const result = structuredClone(g),
    steps = new Map<number, GuideStep>(result.steps.map((s) => [s.n, s]));
  for (const [key, [label, intro, prevNext]] of Object.entries(renamed)) {
    const n = Number(key),
      s = need(steps.get(n), `step ${n}`),
      pos = s.title.indexOf('„');
    if (pos < 0) throw new Error('Guide title missing quote');
    s.title = s.title.slice(0, pos) + `„${label}“`;
    s.screen.label = label;
    if (intro) s.intro = intro;
    if (n > 1) {
      const previous = need(steps.get(n - 1), `step ${n - 1}`);
      const next = need(previous.next, 'previous.next');
      next.title = s.title;
      if (prevNext) next.text = prevNext;
    }
  }
  result.meta.sourceNote = NOTE;
  return result;
}
export function checkGuide(g: GuideDataset, routes: EditorialRoute[]): string[] {
  const problems: string[] = [],
    steps = need(g.steps, 'guide.steps');
  if (steps.length !== 8) problems.push(`guide: ${steps.length} steps, expected 8`);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!,
      m = /^(.*?)\s*„(.+)“\s*$/.exec(need(s.title, 'step.title'));
    if (!m) {
      problems.push(`guide step ${s.n}: title has no quoted screen name`);
      continue;
    }
    const label = m[2],
      r = routes.find((x) => x.title === label && x.step === s.n && x.pattern);
    if (!r || !r.pattern) {
      problems.push(`guide step ${s.n}: no matching route`);
      continue;
    }
    if (s.screen.id !== r.id || s.screen.label !== label || s.screen.href !== sample(r.pattern))
      problems.push(`guide step ${s.n}: screen does not match route`);
    const nxt = s.next;
    if (i < steps.length - 1) {
      const n2 = steps[i + 1]!;
      if (!nxt || nxt.n !== n2.n || nxt.title !== n2.title || nxt.href !== n2.screen.href)
        problems.push(`guide step ${s.n}: next link does not name next step`);
    } else if (nxt) problems.push(`guide step ${s.n}: unexpected next`);
    try {
      requireEditorialHref(routes, s.screen.href);
    } catch {
      problems.push(`guide step ${s.n}: unresolved href`);
    }
  }
  return problems;
}

/** Parse the supplied raw guide when available. The original is not in this repository. */
export function buildRawGuide(
  raw: string,
  routes: EditorialRoute[],
  buildDate = '2026-11-08',
): GuideDataset {
  const body = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n');
  const blocks: string[] = [],
    pending: string[] = [];
  for (const line of [...body.split('\n'), '']) {
    if (!line.trim()) {
      if (pending.length) {
        blocks.push(pending.map((x) => x.trim()).join(' '));
        pending.length = 0;
      }
    } else pending.push(line);
  }
  const parts: number[] = [],
    steps: { n: number; title: string; paras: string[]; next: string | null }[] = [];
  let title: string | null = null,
    lead: string | null = null,
    checksText: string | null = null,
    current: (typeof steps)[number] | null = null,
    checksHeading = false,
    expectTitle = false;
  for (const b of blocks) {
    const part = /^===== ЧАСТ (\d) · (\d+) =====$/.exec(b);
    if (part) {
      parts.push(Number(part[1]));
      expectTitle = part[1] === '1';
      continue;
    }
    if (expectTitle) {
      title = b;
      expectTitle = false;
      continue;
    }
    if (title !== null && lead === null) {
      lead = b;
      continue;
    }
    const step = /^([1-8])\. (.+)$/.exec(b);
    if (step) {
      current = { n: Number(step[1]), title: step[2]!, paras: [], next: null };
      steps.push(current);
      continue;
    }
    if (b === 'Преди да използваш или споделиш число') {
      checksHeading = true;
      current = null;
      continue;
    }
    if (checksHeading) {
      if (checksText !== null) throw new Error('More than one checks paragraph');
      checksText = b;
      continue;
    }
    if (!current) throw new Error('Paragraph outside a step');
    if (b.startsWith('Следва: ')) current.next = b;
    else current.paras.push(b);
  }
  if (
    parts.join(',') !== '1,2' ||
    steps.map((s) => s.n).join(',') !== '1,2,3,4,5,6,7,8' ||
    title === null ||
    lead === null ||
    checksText === null
  )
    throw new Error('Incomplete guide');
  const out: GuideStep[] = steps.map((s) => {
    const match = /^(.*?)\s*„([^“]+)“\s*$/.exec(s.title);
    if (!match) throw new Error('Guide step title missing screen');
    const label = match[2]!,
      route = routes.find((r) => r.title === label && r.step === s.n && r.pattern);
    if (!route?.pattern) throw new Error('Guide route not found');
    const href = sample(route.pattern),
      hit = matchEditorialHref(routes, href);
    if (!hit || hit.route.id !== route.id || s.paras.length !== 2)
      throw new Error('Invalid guide route or paragraphs');
    return {
      n: s.n,
      title: s.title,
      verb: match[1]!,
      screen: { id: route.id, label, href },
      intro: s.paras[0]!,
      blocks: [{ type: 'p', role: 'note', text: s.paras[1]! }],
    } satisfies GuideStep;
  });
  for (let i = 0; i < out.length; i++) {
    const o = out[i]!,
      next = steps[i]!.next;
    if (i < out.length - 1) {
      if (!next) throw new Error('Missing next line');
      const n = out[i + 1]!;
      o.next = { n: n.n, title: n.title, href: n.screen.href, text: next };
    } else if (next) throw new Error('Unexpected next line');
  }
  const cm = /^(Провери пет неща:) (.+?)\. (Използвай .+)$/.exec(checksText);
  if (!cm) throw new Error('Invalid checks paragraph');
  const items = cm[2]!.split(', '),
    last = items.pop()!,
    separator = last.indexOf(' и ');
  if (separator < 0) throw new Error('Invalid checks enumeration');
  items.push(last.slice(0, separator), last.slice(separator + 3));
  if (
    items.length !== 5 ||
    `${cm[1]} ${items.slice(0, -1).join(', ')} и ${items.at(-1)}. ${cm[3]}` !== checksText
  )
    throw new Error('Invalid checks enumeration');
  const short = ['Период', 'Обхват', 'Единица', 'Статус', 'Източник'];
  const checks = {
    title: 'Петте проверки',
    heading: 'Преди да използваш или споделиш число',
    lead: cm[1]!,
    items: items.map((text, i) => ({ n: i + 1, short: short[i]!, text })),
    end: cm[3]!,
    text: checksText,
  };
  const texts: string[] = [
    title,
    lead,
    ...out.flatMap((s) => [
      s.intro,
      ...s.blocks.map((b) => b.text),
      ...(s.next ? [s.next.text] : []),
    ]),
    checksText,
  ];
  let rest = body;
  for (const text of texts) {
    if (body.split(text).length !== 2) throw new Error('Guide text must occur exactly once');
    rest = rest.replace(text, '');
  }
  for (const s of out) {
    const heading = `${s.n}. ${s.title}`;
    if (!body.includes(heading)) throw new Error('Guide heading missing');
    rest = rest.replace(heading, '');
  }
  if (!body.includes('Преди да използваш или споделиш число\n'))
    throw new Error('Checks heading missing');
  rest = rest
    .replace('Преди да използваш или споделиш число', '')
    .replace(/={5} ЧАСТ \d · \d+ ={5}/g, '');
  if (rest.trim()) throw new Error('Unused guide source text');
  return {
    meta: meta(
      'D23',
      'Пътеводител: разбери бюджета стъпка по стъпка',
      'Текстът на пътеводителя на работна група „Бюджет на светло“ е дословно от оригинала: въведение, осем стъпки и „Преди да използваш или споделиш число“. Препратките към екраните на сайта са добавени.',
      buildDate,
    ),
    title,
    lead,
    steps: out,
    checks,
    credit: 'Работна група „Бюджет на светло“',
  };
}
