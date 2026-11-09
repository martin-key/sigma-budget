// S24 · Откъде са данните? (/danni/:set?), the React screen of apps/web/client/pages/s24-danni.js (docs/react-shell.md).
// The catalogue of every dataset of the site (data/catalog.json): source, period, date, format and size of each one, the traps of reading
// budget data („Капаните“), the methodology, the primary sources and the primary files with their SHA-256. /danni/<набор> is the passport of
// ONE set: where it comes from, how to download it, how to cite it, which traps and notes belong to it.
// The filters (?status= ?ekran= ?izvor= ?q=) hide rows in place, so typing in the search box never loses the caret. A chip or a select
// writes its filter into the address and the screen is drawn again from it; the search box mirrors ?q= into the address as the visitor types.
// The catalogue logic (model, filters, citation, rich text) stays in apps/web/client/catalog.js, which S25 shares.
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { CatalogueSet, FileMeta } from '../lib/screens/metadata-types';
import type { CatalogModel } from '../lib/screens/catalog-types';
import type { Navigation } from '../lib/screen-state';
import { date, num, plural, href, byKey } from '../lib/legacy';
import { icon } from '../components/Icon';
import { callout, facts } from '../components/Cards';
import { chips } from '../components/Chips';
import { disclosure } from '../components/Disclosure';
import { field, selectInput } from '../components/MetadataFields';
import { STATUS, statusPill } from '../components/Status';
import { PageFrame } from '../components/PageFrame';
import { glossaryTree } from '../components/GlossaryText';
import { compactText, fixFiles } from '../components/ScreenTree';
import { periodHref } from '../../client/routes.js';
import { absolute } from '../../client/loc.js';
import { siteUrl, orgRef } from '../../client/seo.js';
import { srcShort } from '../../client/ui/source.js';
import { openLegend } from '../../client/ui/status.js';
import * as share from '../../client/share.js';
import * as C from '../../client/catalog.js';

/* ---------------------------------------------------------------- the catalogue as apps/web/client/catalog.js models it */
interface Source {
  title: string;
  url?: string;
  publisher: string;
  kind?: string;
  access?: string;
  note?: string;
}
interface Item {
  id: string;
  title: string;
  paras: string[];
  related: Set_[];
  evidence: { url: string; status?: number; checked?: string }[];
}
interface PrimaryFile {
  name: string;
  title: string;
  url?: string;
  page?: string;
  bytes?: number | null;
  retrieved?: string;
  source: string[];
  usedBy: Set_[];
  sha256?: string;
  note?: string;
}
type Set_ = Omit<CatalogueSet, 'parts'> & {
  source: string[];
  screenRoutes: { key: string; title: string }[];
  expected?: string;
  pending: string[];
  group: string;
  parts: { file: string; bytes: number | null; code?: string }[];
};
interface Model {
  sets: Set_[];
  groups: { id: string; label: string; sets: Set_[] }[];
  counts: Record<string, number> & { datasets: number };
  meta: { asOf?: string };
  traps: Item[];
  methods: Item[];
  files: PrimaryFile[];
  screens: { key: string; id: string; title: string }[];
  sourceKeys: string[];
  bySlug: Map<string, Set_>;
  src(k: string): Source;
  find(key: string): Set_ | null;
}
interface Filter {
  status: string;
  ekran: string;
  izvor: string;
  q: string;
  active: boolean;
}
export const modelOf = (model: CatalogModel): Model =>
  C.model(model.catalog, (model.core as { sources?: object } | undefined)?.sources) as Model;
export const slugOf = (model: CatalogModel) =>
  String(model.params?.set ?? '')
    .trim()
    .toLowerCase();

/* ---------------------------------------------------------------- small helpers */
const uniq = <T,>(a: T[]) => [...new Set(a)];
const SEP = (
  <span className="sep" aria-hidden="true">
    |
  </span>
);
const withSep = (parts: ReactNode[]) => (
  <>
    {parts.filter(Boolean).map((p, i) => (
      <>
        {i ? SEP : null}
        {p}
      </>
    ))}
  </>
);
const dot = (parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ');
const joinList = (items: ReactNode[], sep = ', ') => (
  <>
    {items.map((x, i) => (
      <>
        {i ? sep : ''}
        {x}
      </>
    ))}
  </>
);
const metaList = (rows: ({ k: ReactNode; v: ReactNode; wide?: boolean } | null)[]) => (
  <dl className="s24-meta">
    {rows
      .filter(
        (r): r is { k: ReactNode; v: ReactNode; wide?: boolean } =>
          !!r && r.v != null && r.v !== '' && r.v !== false,
      )
      .map((r) => (
        <div className={'s24-m' + (r.wide ? ' s24-m-wide' : '')}>
          <dt>{r.k}</dt>
          <dd>{r.v}</dd>
        </div>
      ))}
  </dl>
);
const httpText = (code?: number) =>
  code === 403
    ? 'отказан достъп (403)'
    : code === 404
      ? 'не е намерен (404)'
      : code === 200
        ? 'отговаря (200)'
        : code
          ? `отговор ${code}`
          : '';
const ext = (url: string, label: ReactNode) => (
  <a className="ext" href={url} target="_blank" rel="noopener noreferrer">
    {label ?? url}
    {icon('external', { size: 14 })}
    <span className="sr-only"> (в нов раздел)</span>
  </a>
);
/** text -> markup: a set named in quotes („outlook“) or by its P0n id links to its passport; `code`, a quoted word that is no set and a table code become <code> */
const rich = (text: string, M: Model): ReactNode => {
  const re =
    /`([^`]+)`|„([A-Za-z][A-Za-z0-9_-]*)“|\b(P0[1-7])\b|\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+|tps\d{5})\b/g;
  const s = String(text ?? '');
  const out: ReactNode[] = [];
  let last = 0,
    m;
  while ((m = re.exec(s))) {
    out.push(s.slice(last, m.index));
    last = re.lastIndex;
    const [, tick, quoted, pid, snake] = m;
    const set = M.bySlug.get((quoted || pid || '').toLowerCase());
    out.push(
      tick != null ? (
        <code>{tick}</code>
      ) : set ? (
        <a
          href={href('danni', { set: set.slug })}
          aria-label={pid ? `${pid}: ${set.title}` : undefined}
        >
          {quoted ? <code>{quoted}</code> : pid}
        </a>
      ) : pid ? (
        pid
      ) : (
        <code>{quoted || snake}</code>
      ),
    );
  }
  out.push(s.slice(last));
  return <>{out}</>;
};

const ADJ: Record<string, [string, string]> = {
  real: ['официален', 'официални'],
  partial: ['частичен', 'частични'],
  forecast: ['прогнозен', 'прогнозни'],
  mock: ['примерен', 'примерни'],
  pending: ['предстоящ', 'предстоящи'],
};
const bgList = (a: string[]) =>
  a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} и ${a[a.length - 1]}`;
/** '22 официални, 7 примерни и 7 предстоящи' */
const breakdown = (M: Model) =>
  bgList(
    (C.STATUSES as string[])
      .filter((st) => M.counts[st] > 0)
      .map((st) => `${num(M.counts[st], 0)} ${ADJ[st][M.counts[st] === 1 ? 0 : 1]}`),
  );
interface ListState {
  vis: Set<string>;
  groups: { id: string; n: number; total: number }[];
  statusN: Record<string, number>;
  allN: number;
  n: number;
  total: number;
}
const countText = (L: ListState) =>
  `Показани: ${num(L.n, 0)} от ${plural(L.total, 'набор', 'набора')}`;

const pubOf = (s: Source) => s.publisher.replace(/;\s*/g, ', ');
const publishers = (set: Set_, M: Model) =>
  uniq(set.source.map((k) => pubOf(M.src(k))).filter(Boolean)).join(', ');
const isMulti = (set: Set_) => !set.file && set.parts.length > 0;
const fmtOf = (set: Set_) => set.format || set.ext.toUpperCase();
const fileInfo = (set: Set_) =>
  [
    fmtOf(set),
    isMulti(set) ? plural(set.parts.length, 'файл', 'файла') : '',
    C.sizeLabel(set.bytes),
  ]
    .filter(Boolean)
    .join(' · ');
const groupOf = (M: Model, set: Set_) => M.groups.find((g) => g.sets.includes(set));
const srcShortLink = (k: string, M: Model) => {
  const s = M.src(k);
  return s.url ? ext(s.url, srcShort(k)) : srcShort(k);
};
const HISTORICAL_SETS = new Set([
  'ministries',
  'programs',
  'measures',
  'debt',
  'municipalities',
  'ministries-programs',
  'law',
  'geo-obshtini',
]);
const screenHref = (set: Set_, key: string) =>
  periodHref(HISTORICAL_SETS.has(set.slug) ? '2026.law' : null, key);
const screenLinks = (set: Set_) =>
  joinList(set.screenRoutes.map((r) => <a href={screenHref(set, r.key)}>{r.title}</a>));
const reportHref = (o: { block: string; val?: string }) =>
  href(
    'vrazka',
    {},
    { type: 'error', from: 'danni', block: o.block, val: o.val ?? null, src: null },
  );
const reportLink = (o: { block: string; val?: string }) => (
  <a className="report-link" href={reportHref(o)}>
    {icon('flag', { size: 14 })}
    <span>Намерих грешка</span>
  </a>
);
const shareButton = (id: string, title: string) => (
  <button
    type="button"
    className="btn btn-sm btn-quiet share-btn"
    data-share={id}
    aria-label={`Сподели: ${title}`}
    aria-haspopup="dialog"
    aria-expanded="false"
    onClick={(e) => {
      e.stopPropagation();
      share.openMenu(e.currentTarget, id);
    }}
  >
    {icon('share', { size: 16 })}
    <span>Сподели</span>
  </button>
);
const legendButton = (label: string) => (
  <button
    type="button"
    className="link-btn"
    data-action="legend"
    onClick={(e) => {
      e.preventDefault();
      openLegend(e.currentTarget);
    }}
  >
    {label}
  </button>
);
const emptyState = (o: {
  title: string;
  text: string;
  icon?: string;
  action?: { label: string; href: string };
}) => (
  <div className="state state-empty" data-state="empty">
    <span className="state-ic">{icon(o.icon || 'search', { size: 28 })}</span>
    <div className="state-main">
      <p className="state-title">{o.title}</p>
      {o.text ? <p className="state-text">{o.text}</p> : null}
      {o.action ? (
        <p className="state-act">
          <a className="btn btn-primary" href={o.action.href}>
            {o.action.label}
          </a>
        </p>
      ) : null}
    </div>
  </div>
);
const pendingState = (o: { title: string; text: string }) => (
  <div className="state state-pending" data-state="pending">
    <span className="state-ic">{icon('dashed', { size: 28 })}</span>
    <div className="state-main">
      <p className="state-kicker">Предстои</p>
      <p className="state-title">{o.title}</p>
      <p className="state-text">{o.text}</p>
    </div>
  </div>
);

/** a section: the h2 carries the id (the target of ?to= and of the share block), so a jump lands on a heading */
function block(
  id: string,
  title: string,
  build: () => ReactNode,
  o: { scan?: boolean; tools?: ReactNode; foot?: ReactNode } = {},
) {
  let body: ReactNode;
  try {
    body = build();
  } catch (e) {
    console.error(`S24 ${id}`, e);
    body = <p className="muted">Този раздел не може да се покаже.</p>;
  }
  return (
    <section className="s24-block" data-gl-scan={o.scan ? '' : undefined} aria-labelledby={id}>
      <div className="s24-head">
        <h2 id={id} tabIndex={-1}>
          {title}
        </h2>
        {o.tools || null}
      </div>
      {body}
      {o.foot ? <p className="s24-foot">{o.foot}</p> : null}
    </section>
  );
}

/* ---------------------------------------------------------------- the list: which rows are shown */
const FILTER_KEYS = ['status', 'ekran', 'izvor', 'q'] as const;
const filterQuery = (f: Filter) => Object.fromEntries(FILTER_KEYS.map((k) => [k, f[k] || null]));
const tocHref = (id: string, f: Filter) => href('danni', {}, { ...filterQuery(f), to: id });

/** which rows are shown, how many per group, and the counts of the status chips (a chip counts with the other filters on, its own left out) */
function listState(M: Model, f: Filter): ListState {
  const vis = new Set<string>(),
    statusN: Record<string, number> = {};
  let allN = 0;
  for (const s of M.sets) {
    if (C.passes(s, f)) vis.add(s.slug);
    if (C.passes(s, f, ['status'])) {
      allN++;
      statusN[s.status] = (statusN[s.status] || 0) + 1;
    }
  }
  const groups = M.groups.map((g) => ({
    id: g.id,
    n: g.sets.filter((s) => vis.has(s.slug)).length,
    total: g.sets.length,
  }));
  return { vis, groups, statusN, allN, n: vis.size, total: M.sets.length };
}

const SECTIONS = [
  { id: 's24-sets', toc: 'Наборите' },
  { id: 's24-traps', toc: 'Капаните' },
  { id: 's24-method', toc: 'Методиката' },
  { id: 's24-sources', toc: 'Източниците' },
  { id: 's24-files', toc: 'Файловете' },
];

/* ---------------------------------------------------------------- one row of the list */
function srcCell(set: Set_, M: Model, keys: string[]) {
  const shown = keys.slice(0, 2).map((k) => srcShortLink(k, M));
  const more = keys.length - shown.length;
  return (
    <>
      {joinList(shown)}
      {more > 0 ? (
        <>
          {' '}
          <a
            href={href('danni', { set: set.slug })}
            aria-label={`и още ${num(more, 0)}: всички източници на „${set.title}“`}
          >
            и още {num(more, 0)}
          </a>
        </>
      ) : null}
    </>
  );
}

function rowMeta(set: Set_, M: Model) {
  if (set.status === 'pending')
    return [
      { k: 'Откъде ще дойдат', v: set.expected || publishers(set, M) },
      { k: 'Засяга', v: set.screenRoutes.length ? screenLinks(set) : '' },
    ];
  const real = set.source;
  return [
    set.mock
      ? { k: 'Източник', v: 'Няма: стойностите са измислени', wide: true }
      : {
          k: set.source.length > 1 ? 'Източници' : 'Източник',
          v: set.source.length ? srcCell(set, M, set.source) : '',
          wide: true,
        },
    set.mock && real.length
      ? { k: 'Свързан с данни от', v: srcCell(set, M, real), wide: true }
      : null,
    { k: 'Период', v: C.periodLabel(set.period) },
    { k: set.mock ? 'Създадени на' : 'Данни към', v: set.asOf ? date(set.asOf) : '' },
    { k: 'Единица', v: set.unit },
    { k: 'Формат', v: fileInfo(set) },
  ];
}

function rowGet(set: Set_) {
  if (set.status === 'pending') return null;
  if (set.file)
    return (
      <a className="btn btn-sm s24-get" href={set.file} download={C.dlName(set)}>
        {icon('download', { size: 16 })}
        <span>Свали {fmtOf(set)}</span>
        <span className="sr-only"> – {set.title}</span>
      </a>
    );
  if (isMulti(set))
    return (
      <a
        className="btn btn-sm s24-get"
        href={href('danni', { set: set.slug }, { to: 's24-d-get' })}
      >
        {icon('download', { size: 16 })}
        <span>Виж и свали {plural(set.parts.length, 'файл', 'файла')}</span>
        <span className="sr-only"> – {set.title}</span>
      </a>
    );
  return null;
}

const row = (set: Set_, M: Model, shown: boolean) => (
  <li className="s24-row" data-slug={set.slug} data-st={set.status} hidden={!shown}>
    <div className="s24-row-top">
      <a className="s24-link" href={href('danni', { set: set.slug })}>
        {set.title}
      </a>
      {statusPill(set.status)}
    </div>
    {set.desc ? <p className="s24-row-desc">{rich(set.desc, M)}</p> : null}
    {metaList(rowMeta(set, M))}
    {rowGet(set)}
  </li>
);

/* ---------------------------------------------------------------- traps, methodology, sources, files */
/** one trap or methodology item (kind 't' | 'm'): its paragraphs, the sets it concerns, and for a trap that has evidence how it was checked */
function item(kind: 't' | 'm', it: Item, M: Model, extra?: ReactNode) {
  const rel = it.related.length ? (
    <div className="s24-rel">
      <p className="s24-rel-l">Засяга</p>
      <ul className="s24-rel-list" role="list">
        {it.related.map((s) => (
          <li>
            <a href={href('danni', { set: s.slug })}>{s.title}</a>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
  const ev = it.evidence.length
    ? disclosure({
        id: `s24-evidence-${C.idPart(it.id)}`,
        title: 'Как го проверихме',
        meta: plural(it.evidence.length, 'адрес', 'адреса'),
        body: (
          <>
            <p className="small muted">
              Опитахме да отворим тези адреси автоматично. Така отговориха сървърите.
            </p>
            <ul className="s24-ev" role="list">
              {it.evidence.map((e) => (
                <li>
                  {ext(e.url, e.url.replace(/^https?:\/\//i, ''))}
                  <span className="s24-ev-s">
                    {dot([httpText(e.status), e.checked ? `проверено на ${date(e.checked)}` : ''])}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ),
      })
    : null;
  return (
    <article className="s24-item" data-id={it.id}>
      <h3 className="s24-h3" id={`s24-${kind}-${C.idPart(it.id)}`} tabIndex={-1}>
        {it.title}
      </h3>
      {it.paras.map((p) => (
        <p>{rich(p, M)}</p>
      ))}
      {extra || null}
      {rel}
      {ev}
    </article>
  );
}

/** where a methodology item can be seen on a screen of the site (by the id the catalogue gives it) */
function seenOn(id: string) {
  const key = (
    { calculator: 'danaci', 'cash-accrual': 'izpalnenie', vintages: 'prognoza' } as Record<
      string,
      string
    >
  )[id];
  if (key && byKey[key])
    return (
      <p className="s24-seen">
        Къде се вижда: <a href={href(key)}>{byKey[key].title}</a>
      </p>
    );
  if (id === 'statuses')
    return <p className="s24-seen">{legendButton('Покажи легендата на статусите')}</p>;
  return null;
}

function srcItem(k: string, M: Model) {
  const s = M.src(k);
  const n = M.sets.filter((x) => x.source.includes(k)).length;
  const meta = dot([pubOf(s), C.kindLabel(s.kind), C.accessLabel(s.access, !!s.url)]);
  return (
    <li className="s24-src">
      <h3 className="s24-h3">{s.url ? ext(s.url, s.title) : s.title}</h3>
      {meta ? <p className="s24-src-m">{meta}</p> : null}
      {s.note ? <p>{rich(s.note, M)}</p> : null}
      <p>
        <a href={href('danni', {}, { izvor: k, to: 's24-sets' })}>
          {plural(n, 'набор', 'набора')} от този източник
        </a>
      </p>
    </li>
  );
}

function fileItem(f: PrimaryFile, M: Model) {
  const title = f.url ? (
    ext(f.url, f.title)
  ) : f.page ? (
    <>
      {f.title} · {ext(f.page, 'страница на издателя')}
    </>
  ) : (
    f.title
  );
  return (
    <li className="s24-file">
      <p className="s24-file-t">{title}</p>
      {metaList([
        {
          k: 'Файл',
          v: (
            <>
              <code>{f.name}</code>
              {f.bytes != null ? ` · ${C.sizeLabel(f.bytes)}` : ''}
            </>
          ),
        },
        { k: 'Изтеглен на', v: f.retrieved ? date(f.retrieved) : '' },
        {
          k: f.source.length > 1 ? 'Източници' : 'Източник',
          v: f.source.length ? joinList(f.source.map((k) => srcShortLink(k, M))) : '',
        },
        {
          k: 'Ползва се в',
          v: f.usedBy.length
            ? joinList(f.usedBy.map((s) => <a href={href('danni', { set: s.slug })}>{s.title}</a>))
            : '',
        },
        {
          k: 'Контролна сума SHA-256',
          v: f.sha256 ? <code className="s24-sha">{f.sha256}</code> : '',
        },
        { k: 'Бележка', v: f.note },
      ])}
    </li>
  );
}

const filesList = (files: PrimaryFile[], M: Model, id: string) =>
  disclosure({
    id,
    title: 'Списък на първичните файлове',
    meta: plural(files.length, 'файл', 'файла'),
    body: (
      <ul className="s24-files" role="list">
        {files.map((f) => fileItem(f, M))}
      </ul>
    ),
  });

/* ---------------------------------------------------------------- the passport of one set */
const srcBlock = (keys: string[], M: Model) => (
  <ul className="s24-srcs" role="list">
    {keys.map((k) => {
      const s = M.src(k);
      const meta = dot([pubOf(s), C.kindLabel(s.kind), C.accessLabel(s.access, !!s.url)]);
      return (
        <li>
          <span className="s24-srcs-t">{s.url ? ext(s.url, s.title) : s.title}</span>
          {meta ? <span className="s24-srcs-m">{meta}</span> : null}
          {s.note ? <span className="s24-srcs-n">{rich(s.note, M)}</span> : null}
        </li>
      );
    })}
  </ul>
);

function passportRows(set: Set_, M: Model) {
  const pend = set.status === 'pending';
  const real = set.source;
  const items = set.screenRoutes.map((r) => ({ label: r.title, href: screenHref(set, r.key) }));
  const screens = set.screenRoutes.length
    ? {
        k: pend ? 'Засяга' : 'Къде се ползва',
        v:
          set.screenRoutes.length > 8
            ? disclosure({
                id: 's24-d-screens',
                title: 'Екрани',
                meta: plural(set.screenRoutes.length, 'екран', 'екрана'),
                body: chips({ items }),
              })
            : chips({ label: 'Екрани, които ползват набора', items }),
      }
    : null;
  const st = STATUS[set.status as keyof typeof STATUS] || STATUS.pending;
  return [
    {
      k: 'Статус',
      v: (
        <span className="s24-st">
          {statusPill(set.status)}
          <span>{st.text}</span>
        </span>
      ),
    },
    set.mock
      ? {
          k: 'Откъде са стойностите',
          v: 'Няма източник: стойностите са примерни, измислени за показване.',
        }
      : null,
    real.length
      ? {
          k: pend
            ? 'Откъде ще дойдат'
            : set.mock
              ? 'Свързан с официални данни от'
              : real.length > 1
                ? 'Източници'
                : 'Източник',
          v: srcBlock(real, M),
        }
      : null,
    pend && set.expected ? { k: 'Къде да ги видиш', v: set.expected } : null,
    { k: 'Период', v: C.periodLabel(set.period) },
    { k: set.mock ? 'Създадени на' : 'Данни към', v: set.asOf ? date(set.asOf) : '' },
    { k: 'Мерна единица', v: set.unit },
    pend ? null : { k: 'Формат', v: fileInfo(set) },
    set.file
      ? { k: 'Файл', v: <code>{set.file}</code> }
      : set.template
        ? { k: 'Файлове', v: <code>{set.template}</code> }
        : null,
    screens,
  ];
}

const FORMAT_HINT: Record<string, string> = {
  json: 'Файлът е JSON: чете се от всеки език за програмиране и от повечето програми за таблици.',
  rss: 'Файлът е RSS: канал за новини, който се чете от програми за следене на новини.',
  geojson:
    'Файлът е GeoJSON: контури за карти, които четат програмите за карти и езиците за програмиране.',
};
const apiTitle = () => byKey.api?.title || 'Отворени данни и API';

/** an address on the site: from the release's origin, which the server and the browser share (<meta name="site-origin">) */
const onSite = (origin: string, path: string, otherwise: (path: string) => string) =>
  origin ? (C.fileUrl(path.replace(/^\//, ''), origin + '/') as string) : otherwise(path);

function getBlock(set: Set_, names: Map<string, string>, origin: string) {
  const api = href('api');
  const common = (
    <p className="small muted">
      Таблица (CSV) от конкретен екран получаваш с „Сподели“ до таблицата, където я има. Условията
      за повторно ползване още не са решени: виж <a href={api}>{apiTitle()}</a>.
    </p>
  );
  if (set.file) {
    const size = C.sizeLabel(set.bytes);
    const hint = FORMAT_HINT[fmtOf(set).toLowerCase()];
    return (
      <>
        <p className="s24-dl">
          <a className="btn btn-primary" href={set.file} download={C.dlName(set)}>
            {icon('download', { size: 18 })}
            <span>
              Свали {fmtOf(set)}
              {size ? ` (${size})` : ''}
            </span>
          </a>{' '}
          <button type="button" className="btn" data-s24-copy-from="s24-addr">
            {icon('copy', { size: 16 })}
            <span>Копирай адреса</span>
          </button>{' '}
          <a className="btn" href={href('api', {}, { set: set.slug, to: 's25-read' })}>
            {icon('code', { size: 16 })}
            <span>Как да го четеш с код</span>
          </a>
        </p>
        <p className="s24-addr">
          <span className="s24-addr-l">Адрес на файла</span>
          <code id="s24-addr">{onSite(origin, set.file, (p) => C.fileUrl(p))}</code>
        </p>
        {hint ? <p className="small muted">{hint}</p> : null}
        {common}
      </>
    );
  }
  if (isMulti(set))
    return (
      <>
        <p>
          Този набор е разделен на {plural(set.parts.length, 'файл', 'файла')}, по един за
          ведомство. Адресът на всеки има вида <code>{set.template || 'data/…'}</code>.
        </p>
        <p className="s24-dl">
          <a className="btn" href={href('api', {}, { set: set.slug, to: 's25-read' })}>
            {icon('code', { size: 16 })}
            <span>Как да го четеш с код</span>
          </a>
        </p>
        {disclosure({
          id: 's24-d-parts',
          title: 'Файловете по ведомства',
          meta: plural(set.parts.length, 'файл', 'файла'),
          body: (
            <ul className="s24-parts" role="list">
              {set.parts.map((p) => {
                const n =
                  names.get(p.code || '') || (p.code ? `Ведомство ${p.code}` : C.dlName(set, p));
                return (
                  <li className="s24-part">
                    <span className="s24-part-n">
                      {p.code ? <a href={href('vedomstvo', { code: p.code })}>{n}</a> : n}
                    </span>
                    <span className="s24-part-s">{C.sizeLabel(p.bytes)}</span>
                    <a className="btn btn-sm" href={p.file} download={C.dlName(set, p)}>
                      {icon('download', { size: 16 })}
                      <span>Свали</span>
                      <span className="sr-only"> {n}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          ),
        })}
        {common}
      </>
    );
  return common;
}

function notesBlock(set: Set_, M: Model, meta: FileMeta | null) {
  const parts: ReactNode[] = [];
  if (meta && typeof meta.sourceNote === 'string' && meta.sourceNote.trim())
    parts.push(<p>{rich(meta.sourceNote.trim(), M)}</p>);
  const waiting = uniq([
    ...set.pending,
    ...(Array.isArray(meta?.pending)
      ? (meta.pending as unknown[]).filter((x): x is string => typeof x === 'string')
      : []),
  ])
    .map((id) => M.find(id))
    .filter((s): s is Set_ => !!s);
  if (waiting.length)
    parts.push(
      <>
        <p>Какво още липсва за този набор:</p>
        <ul className="s24-wait">
          {uniq(waiting).map((w) => (
            <li>
              <a href={href('danni', { set: w.slug })}>{w.title}</a>
            </li>
          ))}
        </ul>
      </>,
    );
  return parts.length ? <>{parts}</> : null;
}

/* ---------------------------------------------------------------- what the frame and the head show (shared with apps/web/app/lib/screens/text.ts) */
export interface NextItem {
  kicker?: string;
  title: string;
  text?: string;
  href: string;
}
export function frame(model: CatalogModel) {
  const M = modelOf(model);
  const slug = slugOf(model);
  const set = slug ? M.find(slug) : null;
  if (!set) return { M, set: null, next: null };
  const grp = groupOf(M, set);
  const all: NextItem = {
    kicker: 'Каталог',
    title: 'Всички набори данни',
    text: 'Върни се към списъка и филтрите.',
    href: href('danni', {}, { to: 's24-sets' }),
  };
  return {
    M,
    set,
    title: set.title,
    eyebrow: dot(['Набор данни', grp?.label]),
    crumbs: [
      { label: 'Начало', href: href('S01') },
      { label: byKey.danni?.title || 'Откъде са данните?', href: href('danni') },
      { label: set.title },
    ],
    // the head's description reads the lede as text: the legacy marked-up lede gives the same text
    ledeText: set.desc
      ? C.rich(set.desc, M)
      : 'Паспорт на набор данни: откъде е, как да го свалиш и как да го цитираш.',
    next:
      set.status === 'pending'
        ? [all, 'S25', 'S01']
        : [
            {
              kicker: 'Справка',
              title: 'Как да ползваш файла',
              text: 'Адрес, схема, пример и готов код за curl, Python и JavaScript.',
              href: href('api', {}, { set: set.slug, to: 's25-read' }),
            },
            all,
            'S01',
          ],
  };
}

/* JSON-LD: the list is a DataCatalog of the sets, a set's page is a Dataset with its files, period and official sources. Left out: sample
   (mock) sets, pending sets, which have no file, and the service files of the site, which are not data about the budget. */
const indexable = (s: Set_) =>
  s.status !== 'mock' &&
  !s.mock &&
  s.status !== 'pending' &&
  s.group !== 'service' &&
  (s.file || s.parts.length);
const setUrl = (s: Set_) => siteUrl(`/danni/${encodeURIComponent(s.slug)}`);
const isoPeriod = (p: string) => {
  const m = String(p || '').match(/\b(?:19|20)\d{2}(?:-\d{2})?\b/g);
  return m ? (m.length > 1 ? `${m[0]}/${m[m.length - 1]}` : m[0]) : undefined;
};
const kb = (b: number | null | undefined) =>
  Number.isFinite(b) ? `${Math.max(1, Math.round((b as number) / 1024))} KB` : undefined;
const downloadNode = (file: string, type: string, bytes: number | null | undefined) => ({
  '@type': 'DataDownload',
  contentUrl: siteUrl('/' + file),
  encodingFormat: type || 'application/json',
  contentSize: kb(bytes),
});
function datasetNode(M: Model, s: Set_) {
  const files = s.file
    ? [downloadNode(s.file, s.mediaType, s.bytes)]
    : s.parts.map((p) => downloadNode(p.file, s.mediaType, p.bytes));
  const sources = uniq(s.source.map((k) => M.src(k).url).filter(Boolean));
  return {
    '@type': 'Dataset',
    '@id': setUrl(s) + '#dataset',
    url: setUrl(s),
    name: s.title,
    identifier: s.id || s.slug,
    description:
      (s.desc || s.title).length >= 50
        ? s.desc
        : `${s.desc || s.title} Отворен набор (${s.format || 'JSON'}) за държавния бюджет на България.`,
    inLanguage: 'bg',
    isAccessibleForFree: true,
    creator: orgRef(),
    publisher: orgRef(),
    keywords: uniq(
      ['държавен бюджет', 'България', M.groups.find((g) => g.id === s.group)?.label].filter(
        Boolean,
      ),
    ),
    spatialCoverage: { '@type': 'Place', name: 'България' },
    temporalCoverage: isoPeriod(s.period),
    dateModified: /^\d{4}-\d{2}-\d{2}/.test(s.asOf) ? s.asOf.slice(0, 10) : undefined,
    isBasedOn: sources.length ? sources : undefined,
    distribution: files,
    includedInDataCatalog: { '@id': siteUrl('/danni') + '#catalog' },
  };
}
export function schema(model: CatalogModel) {
  const M = modelOf(model),
    slug = slugOf(model);
  if (slug) {
    const s = M.find(slug);
    return s && indexable(s) ? [datasetNode(M, s)] : [];
  }
  return [
    {
      '@type': 'DataCatalog',
      '@id': siteUrl('/danni') + '#catalog',
      url: siteUrl('/danni'),
      name: 'Наборите с данни на „Бюджет на светло“',
      description:
        'Отворените файлове на сайта: държавният бюджет на България, месечното му изпълнение, дългът, ведомствата и общините, с източник, период и статус.',
      inLanguage: 'bg',
      publisher: orgRef(),
      dataset: M.sets.filter(indexable).map((s) => ({
        '@type': 'Dataset',
        '@id': setUrl(s) + '#dataset',
        name: s.title,
        url: setUrl(s),
      })),
    },
  ];
}

/* ---------------------------------------------------------------- behaviour shared by both views */
// the id to focus after the next draw (set by „Изчисти филтрите“), and whether to say what is shown after a chip or a select redrew the list
let pendingFocus = '';
let sayCount = false;
const COPIED: Record<string, string> = {
  's24-addr': 'Адресът е копиран.',
  's24-cite-text': 'Цитирането е копирано.',
};

export function CatalogContent({
  model,
  navigation,
}: {
  model: CatalogModel;
  navigation: Navigation;
}) {
  const fr = frame(model);
  const { M, set } = fr;
  const queryFilter = C.readFilter(model.query, M) as Filter;
  const [input, setInput] = useState(queryFilter.q);
  const [q, setQ] = useState(queryFilter.q);
  const f: Filter = {
    ...queryFilter,
    q,
    active: !!(queryFilter.status || queryFilter.ekran || queryFilter.izvor || q),
  };
  const L = listState(M, f);
  const shown = useRef<Set_[]>([]);
  shown.current = M.sets.filter((s) => L.vis.has(s.slug));
  const typing = useRef<ReturnType<typeof setTimeout>>(undefined),
    speaking = useRef<ReturnType<typeof setTimeout>>(undefined),
    lastLive = useRef('');

  const say = (text: string, delay = 0) => {
    clearTimeout(speaking.current);
    const go = () => {
      if (text && text !== lastLive.current) {
        lastLive.current = text;
        navigation.announce(text);
      }
    };
    if (delay) speaking.current = setTimeout(go, delay);
    else go();
  };
  const setQuery = (values: Record<string, string | null>) => {
    if (navigation.setQuery) navigation.setQuery(values);
    else navigation.go(href('danni', {}, { ...model.query, ...values }));
  };
  const apply = (value: string, now: boolean) => {
    clearTimeout(typing.current);
    const nq = C.cleanQ(value) as string;
    if (nq !== q) {
      setQ(nq);
      navigation.setQuery?.({ q: nq || null }, { rerender: false });
      say(countText(listState(M, { ...f, q: nq })), now ? 0 : 700);
    } else if (now) say(countText(L), 0);
  };

  useEffect(() => {
    if (set) {
      if (set.status !== 'pending')
        share.register('s24-d-card', {
          title: set.title,
          text: set.desc || set.title,
          source: set.source,
          asOf: set.asOf || undefined,
          status: set.status,
          mock: set.mock,
        });
    } else
      share.register('s24-sets', {
        title: 'Каталог на наборите данни',
        text: `Каталогът на „Бюджет на светло“ описва ${plural(M.counts.datasets, 'набор данни', 'набора данни')}: ${breakdown(M)}.`,
        source: ['wg'],
        asOf: M.meta.asOf || undefined,
        status: 'real',
        table: () => catalogTable(shown.current),
      });
    if (pendingFocus) {
      document.getElementById(pendingFocus)?.focus();
      pendingFocus = '';
    }
    if (sayCount) {
      sayCount = false;
      say(countText(L), 0);
    }
    return () => {
      clearTimeout(typing.current);
      clearTimeout(speaking.current);
    };
  }, []);

  const onClick = (e: MouseEvent) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const copy = t.closest<HTMLElement>('[data-s24-copy-from]');
    if (copy) {
      const id = copy.dataset.s24CopyFrom!;
      const text = document.getElementById(id)?.textContent?.trim();
      if (text) share.copyOrShow(text, COPIED[id] || 'Копирано.', 'Копирай ръчно', copy);
      return;
    }
    if (t.closest('[data-s24-csv]')) {
      const spec = share.get('s24-sets'),
        text = spec ? share.csvFor(spec) : '';
      const n = shown.current.length;
      if (!text || !n) {
        navigation.announce('Няма показани набори за изтегляне.');
        return;
      }
      share.download(
        new Blob([text], { type: 'text/csv;charset=utf-8' }),
        'bns-danni-s24-sets.csv',
      );
      navigation.announce(`Изтеглен е файл с ${plural(n, 'набор', 'набора')}.`);
      return;
    }
    const chip = t.closest<HTMLButtonElement>('button.chip[data-query^="status="]');
    if (chip) {
      sayCount = true;
      setQuery({ status: chip.dataset.query!.slice('status='.length) || null });
      return;
    }
    const reset = t.closest('[data-s24-reset], .s24-empty a.btn');
    if (reset) {
      e.preventDefault();
      pendingFocus = 's24-q';
      setQuery({ status: null, ekran: null, izvor: null, q: null });
    }
  };
  const onChange = (e: ChangeEvent) => {
    const c = e.target;
    if (c instanceof HTMLSelectElement && c.dataset.query) {
      sayCount = true;
      setQuery({ [c.dataset.query]: c.value || null });
    }
  };

  const content = set
    ? detailView(model, M, set)
    : listView(model, M, f, L, input, {
        onInput: (v) => {
          setInput(v);
          clearTimeout(typing.current);
          typing.current = setTimeout(() => apply(v, false), 140);
        },
        onKey: (e) => {
          if (e.nativeEvent.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            apply(input, true);
          } else if (e.key === 'Escape' && input) {
            e.preventDefault();
            setInput('');
            apply('', true);
          }
        },
        onClear: () => {
          setInput('');
          apply('', true);
          document.getElementById('s24-q')?.focus();
        },
      });

  return (
    <PageFrame
      model={model}
      title={fr.title}
      eyebrow={fr.eyebrow}
      crumbs={fr.crumbs}
      next={fr.next ?? undefined}
      lede={content.lede ? compactText(content.lede) : undefined}
      context={
        content.context ? (
          <div className="context">
            <span className="ctx-part">{compactText(content.context)}</span>
          </div>
        ) : null
      }
      bodyEvents={{ onClick, onChange }}
    >
      {compactText(
        glossaryTree(
          fixFiles(content.body, model.release.dataBase),
          model.glossary,
          navigation.openGlossary,
        ),
      )}
    </PageFrame>
  );
}

/** the rows on screen as a table: the CSV of „Сподели“ and of „Свали показаното“ is the filtered view */
function catalogTable(sets: Set_[]) {
  return {
    columns: ['Набор', 'Мерна единица', 'Период', 'Данни към', 'Файл', 'Първичен източник'],
    rows: sets.map((s) => [
      s.title,
      s.unit,
      C.periodLabel(s.period),
      s.asOf ? date(s.asOf) : '',
      s.file || s.template,
      s.mock ? 'Няма (примерни данни)' : s.source.map(srcShort).join('; '),
    ]),
    statuses: sets.map((s) => s.status),
  };
}

/* ---------------------------------------------------------------- the list view */
interface View {
  lede?: ReactNode;
  context?: ReactNode;
  body: ReactNode;
}
interface SearchEvents {
  onInput(value: string): void;
  onKey(e: KeyboardEvent<HTMLInputElement>): void;
  onClear(): void;
}
function filterBar(M: Model, f: Filter, L: ListState, input: string, ev: SearchEvents) {
  const screens = [
    { value: '', label: 'Всички екрани' },
    ...M.screens.map((s) => ({ value: s.key, label: s.title })),
  ];
  const sources = [
    { value: '', label: 'Всички' },
    ...M.sourceKeys.map((k) => ({ value: k, label: srcShort(k) as string })),
  ];
  const items = [
    { label: 'Всички', count: L.allN, query: 'status=', pressed: !f.status },
    ...(C.STATUSES as string[])
      .filter((st) => M.counts[st] > 0)
      .map((st) => ({
        label: STATUS[st as keyof typeof STATUS].label,
        count: L.statusN[st] || 0,
        query: `status=${st}`,
        pressed: f.status === st,
      })),
  ];
  const search = (
    <div className="s24-wrap">
      <span className="s24-ic" aria-hidden="true">
        {icon('search', { size: 20 })}
      </span>
      <input
        className="input s24-q"
        id="s24-q"
        name="q"
        type="search"
        value={input}
        maxLength={80}
        aria-describedby="s24-q-hint"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck="false"
        enterKeyHint="search"
        onChange={(e) => ev.onInput(e.currentTarget.value)}
        onKeyDown={ev.onKey}
      />
      <button
        type="button"
        className="icon-btn s24-clear"
        aria-label="Изчисти търсенето"
        hidden={!input}
        onClick={ev.onClear}
      >
        {icon('x', { size: 18 })}
      </button>
    </div>
  );
  return (
    <div className="s24-find" role="search" aria-label="Филтри на наборите" data-gl-skip="">
      {field({
        id: 's24-q',
        label: 'Търси набор',
        hint: 'По име, източник, екран, период или формат: например „дълг“, „КФП“ или „JSON“.',
        control: search,
      })}
      <div className="s24-selects">
        {field({
          id: 's24-ekran',
          label: 'Екран',
          hint: 'Наборите, от които екранът взема числата.',
          control: selectInput({
            id: 's24-ekran',
            name: 'ekran',
            query: 'ekran',
            hint: true,
            value: f.ekran,
            options: screens,
          }),
        })}
        {field({
          id: 's24-izvor',
          label: 'Източник',
          hint: 'Кой е издал данните.',
          control: selectInput({
            id: 's24-izvor',
            name: 'izvor',
            query: 'izvor',
            hint: true,
            value: f.izvor,
            options: sources,
          }),
        })}
      </div>
      <div className="s24-status">
        <span className="field-label" aria-hidden="true">
          Статус
        </span>
        <div className="chips" role="group" aria-label="Статус на данните">
          {items.map((it) => (
            <button
              type="button"
              className="chip"
              data-query={it.query}
              data-fk={`chip:${it.query}`}
              aria-pressed={it.pressed ? 'true' : 'false'}
            >
              <span className="chip-label">{it.label}</span>
              <span className="chip-count">{num(it.count, 0)}</span>
            </button>
          ))}
        </div>{' '}
        {legendButton('Какво означават статусите?')}
      </div>
    </div>
  );
}

function listView(
  model: CatalogModel,
  M: Model,
  f: Filter,
  L: ListState,
  input: string,
  ev: SearchEvents,
): View {
  if (!M.sets.length)
    return {
      body: emptyState({
        title: 'Каталогът е празен',
        text: 'Не намерихме нито един набор в каталога. Опитай пак по-късно.',
        icon: 'database',
      }),
    };
  const build =
    (model.core as { build?: { dataVersion?: string; kfpLatest?: string } } | undefined)?.build ||
    {};
  const ctxParts = [
    build.dataVersion && (
      <span>
        Версия на данните <strong>{build.dataVersion}</strong>
      </span>
    ),
    build.kfpLatest && (
      <span>
        Изпълнението на бюджета е към <strong>{date(build.kfpLatest)}</strong>
      </span>
    ),
    M.meta.asOf && (
      <span>
        Каталогът е към <strong>{date(M.meta.asOf)}</strong>
      </span>
    ),
  ].filter(Boolean);
  const present: Record<string, boolean> = {
    's24-sets': true,
    's24-traps': M.traps.length > 0,
    's24-method': M.methods.length > 0,
    's24-sources': M.sourceKeys.length > 0,
    's24-files': M.files.length > 0,
  };
  const toc = (
    <nav className="s24-toc" aria-label="На тази страница">
      <ul className="chips s24-toc-list">
        {SECTIONS.filter((s) => present[s.id]).map((s) => (
          <li>
            <a className="chip" data-to={s.id} href={tocHref(s.id, f)}>
              {s.toc}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
  const how = (
    <div data-gl-scan="">
      {callout({
        kind: 'info',
        title: 'Как да цитираш число от портала',
        body: (
          <>
            <p>Когато цитираш число, посочи:</p>
            <ul>
              <li>набора и първичния източник, не този портал;</li>
              <li>обхвата: какво точно е включено (виж „Капани“ по-долу);</li>
              <li>статуса на данните и датата, към която са.</li>
            </ul>
            <p>
              На страницата на всеки набор има готово цитиране. За число от екран натисни „Сподели“:
              копираният текст носи източника и връзка към числото.
            </p>
          </>
        ),
      })}
    </div>
  );
  const sets = block(
    's24-sets',
    'Наборите данни',
    () => (
      <>
        <p className="s24-lead">
          Каталогът описва{' '}
          <strong>{plural(M.counts.datasets, 'набор данни', 'набора данни')}</strong>:{' '}
          {breakdown(M)}. До всеки набор са източникът, периодът, датата на данните, форматът и
          размерът. Как се четат файловете с код е в <a href={href('api')}>{apiTitle()}</a>.
        </p>
        <p className="s24-dl">
          <a className="btn btn-sm" href="data/catalog.json" download="catalog.json">
            {icon('download', { size: 16 })}
            <span>Свали каталога (JSON)</span>
          </a>{' '}
          <button type="button" className="btn btn-sm" data-s24-csv="">
            {icon('table', { size: 16 })}
            <span>Свали показаното (CSV)</span>
          </button>
        </p>
        {filterBar(M, f, L, input, ev)}
        <p className="s24-count" data-gl-skip="">
          <span data-count="">{countText(L)}</span>
          <button type="button" className="link-btn" data-s24-reset="" hidden={!f.active}>
            Изчисти филтрите
          </button>
        </p>
        <div className="s24-empty" hidden={L.n > 0}>
          {emptyState({
            title: 'Няма набор, който да отговаря на филтрите',
            text: 'Опитай с по-малко филтри или с друга дума.',
            action: { label: 'Изчисти филтрите', href: href('danni', {}, { to: 's24-sets' }) },
          })}
        </div>
        <div className="s24-groups">
          {M.groups.map((g) => {
            const gs = L.groups.find((x) => x.id === g.id) || { n: 0 };
            return (
              <div className="s24-group" data-group={g.id} hidden={!gs.n}>
                <h3 className="s24-gh">
                  <span>{g.label}</span>
                  <span className="s24-n">
                    <span data-n="">{num(gs.n, 0)}</span>
                    <span className="sr-only" data-n-unit="">
                      {' '}
                      {gs.n === 1 ? 'набор' : 'набора'}
                    </span>
                  </span>
                </h3>
                <ul className="s24-list" role="list">
                  {g.sets.map((s) => row(s, M, L.vis.has(s.slug)))}
                </ul>
              </div>
            );
          })}
        </div>
      </>
    ),
    {
      scan: true,
      tools: shareButton('s24-sets', 'Каталог на наборите данни'),
      foot: reportLink({ block: 's24-sets' }),
    },
  );
  const traps = present['s24-traps']
    ? block(
        's24-traps',
        'Капани: на какво да внимаваш',
        () => (
          <>
            <p className="s24-lead2">
              Бюджетните числа лесно се четат погрешно. Ето къде най-често се греши и как да го
              избегнеш.
            </p>
            <div className="s24-items">{M.traps.map((t) => item('t', t, M))}</div>
          </>
        ),
        { scan: true, foot: reportLink({ block: 's24-traps' }) },
      )
    : null;
  const method = present['s24-method']
    ? block(
        's24-method',
        'Методика',
        () => (
          <>
            <p className="s24-lead2">Правилата, по които подреждаме и показваме числата.</p>
            <div className="s24-items">{M.methods.map((t) => item('m', t, M, seenOn(t.id)))}</div>
          </>
        ),
        { scan: true, foot: reportLink({ block: 's24-method' }) },
      )
    : null;
  const sources = present['s24-sources']
    ? block(
        's24-sources',
        'Първични източници',
        () => (
          <>
            <p className="s24-lead2">
              Всяко число идва от първичен източник. Тук са източниците, които ползва поне един
              набор.
            </p>
            <ul className="s24-srclist" role="list">
              {M.sourceKeys.map((k) => srcItem(k, M))}
            </ul>
          </>
        ),
        { foot: reportLink({ block: 's24-sources' }) },
      )
    : null;
  const files = present['s24-files']
    ? block(
        's24-files',
        'Първични файлове и контролни суми',
        () => (
          <>
            <p className="s24-lead2">
              За всеки първичен файл записваме откъде е изтеглен, кога и контролна сума SHA-256
              (отпечатък на файла). Ако свалиш същия файл от издателя и сумата съвпадне, това е
              файлът, от който са прочетени числата.
            </p>
            {filesList(M.files, M, 's24-files-list')}
          </>
        ),
        { foot: reportLink({ block: 's24-files' }) },
      )
    : null;
  return {
    context: ctxParts.length ? withSep(ctxParts) : undefined,
    body: (
      <>
        {toc}
        {how}
        {sets}
        {traps}
        {method}
        {sources}
        {files}
      </>
    ),
  };
}

/* ---------------------------------------------------------------- the detail view */
function detailView(model: CatalogModel, M: Model, set: Set_): View {
  const meta = model.fileMeta?.meta || null;
  const names = new Map(
    (Array.isArray(model.ministries?.items) ? model.ministries!.items : [])
      .filter((x) => x && x.id != null)
      .map((x) => [String(x.id), String(x.short || x.name || x.id)]),
  );
  const pend = set.status === 'pending';
  const notice =
    meta && typeof (meta.notice || meta.why) === 'string'
      ? String(meta.notice || meta.why).trim()
      : '';
  const version = (model.core as { build?: { dataVersion?: string } } | undefined)?.build
    ?.dataVersion;
  const citeText =
    pend || set.mock
      ? ''
      : (C.citation(set, M, {
          url: onSite(model.release.origin, href('danni', { set: set.slug }), absolute),
          version,
        }) as string);
  const traps = C.relatedTo(M.traps, set) as Item[],
    methods = C.relatedTo(M.methods, set) as Item[],
    files = C.filesOf(M, set) as PrimaryFile[];
  const notes = notesBlock(set, M, meta);

  const sections: ReactNode[] = [];
  if (pend)
    sections.push(
      pendingState({
        title: set.title,
        text: `Данните съществуват при ${publishers(set, M) || 'издателя'}, но още не са извлечени. Не показваме число, докато няма официални данни.`,
      }),
    );
  else if (set.mock)
    sections.push(
      callout({
        kind: 'warn',
        title: 'Примерни данни: не ги цитирай',
        body: (
          <p>{notice || 'Стойностите са измислени и показват само как ще изглежда екранът.'}</p>
        ),
      }),
    );
  sections.push(
    block(
      's24-d-card',
      'Паспорт на набора',
      () => facts(passportRows(set, M), { cls: 's24-facts' }),
      {
        scan: true,
        tools: pend ? null : shareButton('s24-d-card', set.title),
        foot: reportLink({ block: 's24-d-card', val: set.slug }),
      },
    ),
  );
  if (!pend)
    sections.push(
      block('s24-d-get', 'Свали и ползвай', () => getBlock(set, names, model.release.origin)),
    );
  if (citeText)
    sections.push(
      block('s24-d-cite', 'Как да го цитираш', () => (
        <>
          <p className="s24-cite" id="s24-cite-text">
            {citeText}
          </p>
          <p className="s24-dl">
            <button type="button" className="btn btn-sm" data-s24-copy-from="s24-cite-text">
              {icon('copy', { size: 16 })}
              <span>Копирай цитирането</span>
            </button>
          </p>
          <p className="small muted">
            Числата са на първичния източник. Порталът ги подрежда и показва статуса и датата им:
            цитирай и двете.
          </p>
        </>
      )),
    );
  if (notes)
    sections.push(block('s24-d-notes', 'Бележки към данните', () => notes, { scan: true }));
  if (traps.length)
    sections.push(
      block(
        's24-d-traps',
        'Капани за този набор',
        () => <div className="s24-items">{traps.map((t) => item('t', t, M))}</div>,
        {
          scan: true,
        },
      ),
    );
  if (methods.length)
    sections.push(
      block(
        's24-d-method',
        'Методика за този набор',
        () => <div className="s24-items">{methods.map((t) => item('m', t, M, seenOn(t.id)))}</div>,
        { scan: true },
      ),
    );
  if (files.length)
    sections.push(
      block('s24-d-files', 'Първични файлове', () =>
        files.length > 5 ? (
          filesList(files, M, 's24-d-files-list')
        ) : (
          <ul className="s24-files" role="list">
            {files.map((f) => fileItem(f, M))}
          </ul>
        ),
      ),
    );
  return {
    lede: set.desc
      ? rich(set.desc, M)
      : 'Паспорт на набор данни: откъде е, как да го свалиш и как да го цитираш.',
    context: withSep([
      statusPill(set.status),
      set.asOf ? (
        <span>
          {set.mock ? 'Създадени на' : 'Данни към'} <strong>{date(set.asOf)}</strong>
        </span>
      ) : (
        ''
      ),
      set.period ? (
        <span>
          Период <strong>{C.periodLabel(set.period)}</strong>
        </span>
      ) : (
        ''
      ),
    ]),
    body: <>{sections}</>,
  };
}
