import { SearchRows, type SearchRow } from './aggregation-search.js';
import type { buildCore } from './aggregation-core.js';
import type { buildFeed } from './aggregation-feed.js';
import type { buildSearch } from './aggregation-search.js';

interface GlueTerm {
  name: string;
  title: string;
  abbr?: string;
  slug: string;
  def: string;
  aliases: string[];
}
export interface ScopeLayersInput {
  core: ReturnType<typeof buildCore>;
  feed: ReturnType<typeof buildFeed>['feed'];
  rss: string;
  search: ReturnType<typeof buildSearch>;
  wording: Record<string, Record<string, string>>;
  sourceGlue: { sources: Record<string, unknown>; terms: GlueTerm[] };
}
type Aggregation = Pick<ScopeLayersInput, 'core' | 'feed' | 'rss' | 'search'>;
export function aggregationWording(
  input: Aggregation,
  replacements: ScopeLayersInput['wording'],
): Aggregation {
  const wording = (value: unknown, name: string) => {
    let text = JSON.stringify(value);
    for (const [from, to] of Object.entries(replacements[name] ?? {}))
      text = text.replaceAll(JSON.stringify(from).slice(1, -1), JSON.stringify(to).slice(1, -1));
    return JSON.parse(text);
  };
  return {
    core: wording(input.core, 'core.json'),
    search: wording(input.search, 'search-index.json'),
    feed: structuredClone(input.feed),
    rss: input.rss,
  };
}
export function aggregationActive(input: Aggregation): Aggregation {
  const { core, search, feed } = structuredClone(input);
  const gone = new Set(feed.events.filter((e) => e.source.includes('sebra')).map((e) => e.id));
  feed.events = feed.events.filter((e) => !gone.has(e.id));
  feed.meta.source = (feed.meta.source as string[]).filter((s) => s !== 'sebra');
  feed.meta.sourceNote = (feed.meta.sourceNote as string).replace(
    ', Евростат, СЕБРА)',
    ', Евростат)',
  );
  feed.expected = feed.expected.filter((x) => !JSON.stringify(x).includes('СЕБРА'));
  const dynamicFeed = feed as unknown as Record<string, unknown>;
  if (Array.isArray(dynamicFeed.highlights))
    dynamicFeed.highlights = dynamicFeed.highlights.filter(
      (x) => !JSON.stringify(x).includes('СЕБРА'),
    );
  feed.sentences = feed.sentences.filter((x) => !JSON.stringify(x).includes('СЕБРА'));
  let rss = input.rss;
  for (const id of gone) {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rss = rss.replace(
      new RegExp(
        `<item>\\n(?:(?!</item>)[\\s\\S])*?<guid[^>]*>${safe}</guid>(?:(?!</item>)[\\s\\S])*?</item>\\n?`,
        'g',
      ),
      '',
    );
  }
  search.items = search.items.filter(
    (i) =>
      i[5] === 'real' &&
      !['#/plashtania', '#/proekti', '#/moyat-byudzhet'].some((r) => i[6].startsWith(r)) &&
      !i[1].includes('СЕБРА'),
  );
  search.meta.sourceNote = (search.meta.sourceNote as string).replace(
    'Редовете с примерни данни са отбелязани и се скриват при „Само официални данни“. ',
    '',
  );
  delete core.sources.sebra;
  return { core, feed, rss, search };
}
export function aggregationSourceGlue(
  input: Aggregation,
  sourceGlue: ScopeLayersInput['sourceGlue'],
): Aggregation {
  const { core, feed, rss, search } = structuredClone(input);
  if (!Object.hasOwn(core.sources, 'dbp2027')) {
    Object.assign(core.sources, structuredClone(sourceGlue.sources));
    if (![64, 69].includes(core.counts.terms)) throw new Error('unexpected glossary count');
    core.counts.terms = 69;
  }
  if (!search.items.some((r) => r[6] === '#/rechnik/ess-2010')) {
    let last = -1;
    for (let i = 0; i < search.items.length; i++) if (search.items[i]![0] === 4) last = i;
    if (last < 0) throw new Error('no terms group for source glue');
    const added: SearchRow[] = sourceGlue.terms.map((t) => {
      const helper = new SearchRows(),
        title = t.abbr ? `${t.name} – ${t.abbr}` : t.title,
        clean = t.def.replace(/[ \t\r\n]+/g, ' ').trim(),
        m = /^(.{20,160}?[.!?])(\s|$)/u.exec(clean),
        first = m ? m[1]! : Array.from(clean).slice(0, 160).join(''),
        seen = new Set<string>(),
        words: string[] = [];
      for (const part of [t.aliases.join(' '), t.abbr ?? '', t.name])
        for (const w of part
          .replace(/[ \t\r\n]+/g, ' ')
          .trim()
          .split(' ')) {
          const key = w.toLowerCase();
          if (w && !seen.has(key)) {
            seen.add(key);
            words.push(w);
          }
        }
      helper.add('terms', title, first, '', '', 'real', `#/rechnik/${t.slug}`, words.join(' '));
      return helper.rows[0]!;
    });
    search.items.splice(last + 1, 0, ...added);
  }
  return { core, feed, rss, search };
}

/** The ordered, scope-limited parts of wording, active_data and apply_sources. */
export function projectAggregation(input: ScopeLayersInput): Aggregation {
  return aggregationSourceGlue(
    aggregationActive(aggregationWording(input, input.wording)),
    input.sourceGlue,
  );
}

/** The source glue also extends a historical 64-term glossary, when needed. */
export function glossarySourceGlue(glossary: any, terms: readonly any[]): any {
  const result = structuredClone(glossary);
  if (result.terms.some((term: any) => term.slug === 'ess-2010')) return result;
  const existing = new Set<string>(result.terms.map((term: any) => term.slug));
  const added = new Set<string>(terms.map((term) => term.slug));
  for (const term of terms) {
    if (existing.has(term.slug)) throw new Error(`Duplicate glossary term: ${term.slug}`);
    for (const relation of term.related)
      if (!existing.has(relation.slug) && !added.has(relation.slug))
        throw new Error(`Missing related term: ${relation.slug}`);
  }
  result.categories.push({
    id: 'byudzhet-2027',
    title: 'Бюджет 2027 и правилата на ЕС',
    short: 'Бюджет 2027 и ЕС',
    from: 65,
    to: 69,
  });
  result.terms.push(...structuredClone(terms));
  if (result.terms.length !== 69 || result.terms.some((term: any, i: number) => term.n !== i + 1))
    throw new Error('unexpected glossary count or numbering');
  result.subtitle = '69 основни термина с обяснения и практически примери';
  result.meta.sourceNote =
    'Речник с 64 термина на работна група „Бюджет на светло“: определенията, примерите и свързаните понятия са дословно от документа; връзките „Виж в бюджета“ са към екраните на този сайт. Числата в примерите са условни. Още 5 термина (от 65 до 69) са добавени за екрана „Бюджет 2027 (проект)“ и не са от този документ.';
  result.meta.retrieved = '2026-10-16';
  return result;
}
