import type { ReactNode } from 'react';
import type {
  NarrativeContext,
  FeedDocument,
  FeedEvent,
  ExpectedEvent,
  Highlights,
} from '../lib/screens/narrative-types';
import { pct, date, monthName, plural, NBSP } from '../../client/format.js';
import {
  block,
  ext,
  chips,
  timeline,
  emptyState,
  pendingState,
  gl,
  amount,
  plain,
} from '../components/NarrativeUI';
type FeedModel = ReturnType<typeof model>;
/* ------------------------------------------------------------------ small helpers */
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** the data text is kept as it is in the file; a doubled full stop after an abbreviation („г..“) is tidied only when it is shown */
const tidy = (s: unknown) =>
  String(s ?? '')
    .replace(/([^.\s])\.\.(?!\.)/g, '$1.')
    .trim();
const monthTitle = (key: string) => {
  const [y, m] = key.split('-');
  return `${cap(monthName(+m))} ${y}`;
};

/* ------------------------------------------------------------------ the model: what the screen prints, derived once */
export function model(ctx: NarrativeContext) {
  const f = ctx.data.feed || {};
  const events = (Array.isArray(f.events) ? f.events : []).filter(
    (e) => e && e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date || ''),
  );
  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first; the file's order stays within one day
  const kinds = (Array.isArray(f.kinds) ? f.kinds : []).filter((k) => k && k.id && k.label);
  const label = new Map(kinds.map((k) => [k.id, k.label]));
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) || 0) + 1);
  const want = ctx.query && ctx.query.vid;
  const vid = counts.has(want || '') ? want : '';
  const shown = vid ? events.filter((e) => e.kind === vid) : events;
  return {
    ctx,
    f,
    meta: f.meta || {},
    h: f.highlights && f.highlights.asOf ? f.highlights : null,
    events,
    kinds,
    label,
    counts,
    vid,
    shown,
  };
}

/* ------------------------------------------------------------------ the five sentences of the latest monthly report */
const yoyText = (yoy: number | undefined) => {
  if (!fin(yoy)) return '';
  if (Math.abs(yoy) < 0.05) return ' — колкото година по-рано';
  return ` — с ${pct(Math.abs(yoy), 1)} ${yoy > 0 ? 'повече' : 'по-малко'} от година по-рано`;
};

export function fiveSentences(M: FeedModel) {
  const { ctx, h } = M;
  if (!h) return [];
  const A = (mln: number) => amount(ctx, { mln });
  const out = [];
  if (fin(h.revenueMln))
    out.push(
      <>
        {'Приходите са '}
        {A(h.revenueMln)}
        {yoyText(h.revenueYoyPct)}
        {'.'}
      </>,
    );
  if (fin(h.expenditureMln))
    out.push(
      <>
        {'Разходите (с вноската в бюджета на ЕС) са '}
        {A(h.expenditureMln)}
        {yoyText(h.expenditureYoyPct)}
        {'.'}
      </>,
    );
  if (fin(h.deficitMln)) {
    const surplus = h.deficitMln < 0;
    const term = surplus
      ? gl('byudzheten-izlishak', 'Излишъкът')
      : gl('byudzheten-defitsit', 'Дефицитът');
    const p = h.deficitPrevYearMln;
    let prev: ReactNode = '';
    if (fin(p))
      prev =
        p < 0 === surplus ? (
          <>
            {', при '}
            {A(Math.abs(p))}
            {' година по-рано'}
          </>
        ) : (
          <>
            {', при '}
            {p < 0 ? 'излишък' : 'дефицит'}
            {' от '}
            {A(Math.abs(p))}
            {' година по-рано'}
          </>
        );
    out.push(
      <>
        {term}
        {' е '}
        {A(Math.abs(h.deficitMln))}
        {prev}
        {'.'}
      </>,
    );
  }
  if (fin(h.capexPctPlan))
    out.push(
      <>
        {gl('kapitalovi-razhodi', 'Капиталовите разходи')}
        {' са '}
        {pct(h.capexPctPlan, 1)}
        {' от годишния план.'}
        {h.planBasis?.citation ? (
          <>
            {' '}
            {h.planBasis.citation}
            {'.'}
          </>
        ) : (
          ''
        )}
      </>,
    );
  if (fin(h.newBorrowingMln)) {
    const p = h.newBorrowingPrevYearMln;
    out.push(
      <>
        {'Новите заеми от международните капиталови пазари (нето) са '}
        {A(h.newBorrowingMln)}
        {fin(p) ? (
          <>
            {', при '}
            {A(p)}
            {' година по-рано'}
          </>
        ) : (
          ''
        )}
        {'.'}
      </>,
    );
  }
  return out;
}

export function summaryBlock(M: FeedModel) {
  const { ctx, h } = M;
  const items = fiveSentences(M);
  if (!h || !items.length) {
    return block({
      id: 's16-b-summary',
      level: 2,
      title: 'Последният месечен отчет накратко',
      status: 'pending',
      body: pendingState({
        title: 'Обзорът предстои',
        text: 'Още няма достатъчно данни от последния месечен отчет, за да го опишем накратко.',
      }),
    });
  }
  const y = +h.asOf.slice(0, 4),
    m = h.month || +h.asOf.slice(5, 7);
  const title =
    items.length === 5
      ? `${cap(monthName(m))} ${y} в пет изречения`
      : `${cap(monthName(m))} ${y} накратко`;
  const sub = (
    <>
      {'Данните са от 1 януари до '}
      {date(h.asOf, true)}
      {' г. и са за консолидираната фискална програма ('}
      {gl('kfp', 'КФП')}
      {'). Сравнението е със същия период на '}
      {y - 1}
      {' г.'}
    </>
  );
  const body = (
    <>
      <ol className="s16-five">
        {items.map((t) => (
          <>
            <li>{t}</li>
          </>
        ))}
      </ol>
      <p className="s16-more">
        <a href={'' + ctx.href('S15') + ''}>{'Всички числа и графики: „Месечни отчети“'}</a>
      </p>
    </>
  );
  const share = { text: items.map(plain).join(' ') };
  return block({
    id: 's16-b-summary',
    level: 2,
    title,
    sub,
    scope: 'kfp',
    status: 'real',
    source: ['kfp', ...(h.planBasis?.source || [])],
    asOf: h.asOf,
    share,
    body,
  });
}

/* ------------------------------------------------------------------ „Очаква се“ */
function expectedText(M: FeedModel, x: ExpectedEvent) {
  const where = x.expected ? (
    <>
      <p className="s16-where">
        {'Къде да го видиш при издателя: '}
        {tidy(x.expected)}
        {'.'}
      </p>
    </>
  ) : (
    ''
  );
  if (x.id === 'P04') {
    const last = M.h ? ` Най-новият отчет, който показваме, е към ${date(M.h.asOf)} г.` : '';
    return (
      <>
        <p>
          {'Отчетът още не е добавен към портала.'}
          {last}
        </p>
        <p>{'Месечните отчети се добавят, след като Министерството на финансите ги публикува.'}</p>
        {where}
      </>
    );
  }
  return (
    <>
      {x.note ? (
        <>
          <p>{tidy(x.note)}</p>
        </>
      ) : (
        ''
      )}
      {where}
    </>
  );
}

export function expectedBlock(M: FeedModel) {
  const list = (Array.isArray(M.f.expected) ? M.f.expected : []).filter((x) => x && x.title);
  if (!list.length) return '';
  const items = list.map((x, i) => ({
    id: `s16-x-${i + 1}`,
    kind: 'expected',
    title: tidy(x.title),
    text: expectedText(M, x),
  }));
  return block({
    id: 's16-b-expected',
    level: 2,
    title: 'Очаква се',
    status: 'pending',
    sub: 'Данни и документи, които още не са в портала.',
    body: timeline({ label: 'Очаквани данни и документи', items }),
  });
}

/* ------------------------------------------------------------------ the chronology */
function dateLine(M: FeedModel, e: FeedEvent) {
  const kinds = M.f.dateKinds || {};
  const pre =
    e.dateKind && e.dateKind !== 'occurred' && kinds[e.dateKind] ? `${kinds[e.dateKind]} ` : '';
  const span = e.dateTo && e.dateTo !== e.date ? `${NBSP}–${NBSP}${date(e.dateTo)}` : '';
  const kind = M.label.get(e.kind);
  return `${pre}${date(e.date)}${span}${kind ? ` · ${kind}` : ''}`;
}

const eventItem = (M: FeedModel) => (e: FeedEvent) => ({
  id: `s16-e-${e.id}`,
  kind: 'event',
  date: dateLine(M, e),
  title: tidy(e.title),
  href: typeof e.href === 'string' && e.href.startsWith('#/') ? e.href : undefined,
  text: e.text ? tidy(e.text) : undefined,
});

export function shownNote(M: FeedModel) {
  return M.vid
    ? `Показани са ${M.shown.length} от ${plural(M.events.length, 'събитие', 'събития')}. Вид: ${M.label.get(M.vid)}.`
    : '';
}

const GROUP_FROM = 8; // more shown events than this are grouped by month

export function feedBlock(M: FeedModel) {
  const { meta, events, shown } = M;
  if (!events.length) {
    return block({
      id: 's16-b-feed',
      level: 2,
      title: 'Хронология на събитията',
      status: 'real',
      body: emptyState({
        title: 'Още няма събития',
        text: 'Когато излезе нов отчет или има промяна в закона, тя ще се покаже тук.',
      }),
    });
  }
  const chipItems = [
    { label: 'Всички', count: events.length, query: 'vid=', pressed: !M.vid },
  ].concat(
    M.kinds
      .filter((k) => M.counts.get(k.id))
      .map((k) => ({
        label: k.label,
        count: M.counts.get(k.id)!,
        query: `vid=${k.id}`,
        pressed: M.vid === k.id,
      })),
  );
  const groups: { key: string; items: FeedEvent[] }[] = [];
  for (const e of shown) {
    const key = e.date.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, items: [] };
      groups.push(g);
    }
    g.items.push(e);
  }
  const note = shownNote(M);
  // many events are told month by month; a short filtered list (one report a month, a handful of votes) reads better as one list
  const list =
    shown.length > GROUP_FROM ? (
      <>
        <div className="s16-groups">
          {groups.map((g) => (
            <>
              <section className="s16-month" aria-labelledby={'s16-m-' + g.key + ''}>
                <h3 className="s16-month-h" id={'s16-m-' + g.key + ''}>
                  {monthTitle(g.key)}{' '}
                  <span className="s16-month-n">
                    {plural(g.items.length, 'събитие', 'събития')}
                  </span>
                </h3>
                {timeline({
                  label: `Събития през ${monthTitle(g.key).toLowerCase()}`,
                  items: g.items.map(eventItem(M)),
                })}
              </section>
            </>
          ))}
        </div>
      </>
    ) : (
      timeline({
        label: M.vid ? `Събития, вид: ${M.label.get(M.vid)}` : 'Всички събития',
        items: shown.map(eventItem(M)),
      })
    );
  const body = (
    <>
      {chips({ label: 'Покажи по вид', items: chipItems, cls: 's16-chips' })}
      {note ? (
        <>
          <p className="s16-shown">{note}</p>
        </>
      ) : (
        ''
      )}
      {list}
    </>
  );
  return block({
    id: 's16-b-feed',
    level: 2,
    title: 'Хронология на събитията',
    sub: `${plural(events.length, 'събитие', 'събития')} от месечните отчети, законодателния път, ставките и Евростат, най-новите първо.`,
    status: 'real',
    source: meta.source,
    asOf: meta.asOf,
    body,
    foot: meta.sourceNote ? tidy(meta.sourceNote) : undefined,
  });
}

/* ------------------------------------------------------------------ RSS: a real static file next to the data */
const FEED_FILE = '/data/feed.xml';
export function rssBlock(M: FeedModel) {
  const body = (
    <>
      <p className="s16-lead">
        {
          'RSS е обикновен файл, който специална програма — RSS четец — проверява сама. Добави адреса му в четеца си и новите събития ще се появяват там, без да отваряш портала.'
        }
      </p>
      <div className="field s16-rss">
        <label className="field-label" htmlFor="s16-rss-url">
          {'Адрес на RSS файла'}
        </label>
        <div className="s16-rss-row">
          <input
            className="input"
            id="s16-rss-url"
            type="text"
            readOnly={true}
            value={'' + new URL(FEED_FILE, M.ctx.origin).href + ''}
            aria-describedby="s16-rss-note"
            spellCheck={false}
          />
          <button type="button" className="btn" data-s16-copy="">
            {'Копирай адреса'}
          </button>
        </div>
      </div>
      <p className="s16-note" id="s16-rss-note">
        {
          'Файлът е един и същ за всички и съдържа събитията от хронологията по-горе. Адресите на събитията в него са примерни, докато порталът няма постоянен адрес.'
        }
      </p>
      <p className="s16-open">{ext(FEED_FILE, 'Отвори RSS файла')}</p>
    </>
  );
  return block({
    id: 's16-b-rss',
    level: 2,
    title: 'Следи новото с RSS',
    status: 'real',
    source: M.meta.source,
    asOf: M.meta.asOf,
    share: false,
    body,
  });
}

/* ------------------------------------------------------------------ the page */
export const needs = ['core', 'feed'];
export const styles = ['s16-novo'];

export function lede(ctx: NarrativeContext) {
  try {
    const h = ctx.data && ctx.data.feed && ctx.data.feed.highlights;
    if (!h || !h.asOf) return undefined;
    return `Най-новият месечен отчет е към ${date(h.asOf, true)} г. Тук са новите данни, стъпките по закона и какво предстои.`;
  } catch (e) {
    return undefined;
  }
}

export function render(ctx: NarrativeContext) {
  const M = model(ctx);
  return (
    <>
      {summaryBlock(M)}
      {expectedBlock(M)}
      {feedBlock(M)}
      {rssBlock(M)}
    </>
  ); // V7: the sample subscription form (subscribeBlock) is out: it sent nothing, and RSS is the real channel
}
