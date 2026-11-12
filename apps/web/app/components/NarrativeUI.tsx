import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Navigation } from '../lib/screen-state';
export const NarrativeNavigation = createContext<Navigation | null>(null);
import { icon } from './Icon';
import { statusPill } from './Status';
import { date, href, num } from '../lib/legacy';
import { monthName, NBSP, moneyParts, pct } from '../../client/format.js';
import { SCOPES } from '../../client/store.js';
import { toHref } from '../../client/loc.js';
import * as share from '../../client/share.js';
import { openSource } from '../../client/ui/source.js';
import { compactText } from './ScreenTree';
import { dataTable as baseTable, type TableOptions } from './MetadataTable';
import type { NarrativeCore } from '../lib/screens/narrative-types';
export const gl = (slug: string, text: ReactNode) => (
  <a className="gl" data-gl={slug} href={href('rechnik', { term: slug })} aria-haspopup="dialog">
    {text ?? slug}
  </a>
);
export const ext = (url: string, label: ReactNode) => (
  <a className="ext" href={url} target="_blank" rel="noopener noreferrer">
    {label}
    {icon('external', { size: 14 })}
    <span className="sr-only"> (в нов раздел)</span>
  </a>
);
export function plain(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(plain).join('');
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (typeof node === 'object' && 'props' in node)
    return plain((node.props as { children?: ReactNode }).children);
  return '';
}
export interface Scope {
  key: string;
  label?: string;
  note?: string;
  gl?: string;
}
function scopeChip(scope: string | Scope) {
  const o = typeof scope === 'string' ? { key: scope } : scope;
  const s = SCOPES[o.key as keyof typeof SCOPES] as
    | { label?: string; long?: string; gl?: string }
    | undefined;
  const label = o.label || s?.label || o.key,
    term = o.gl === undefined ? s?.gl : o.gl;
  const inner = (
    <>
      <span className="sr-only">Обхват: </span>
      {label}
      {o.note ? (
        <>
          {' '}
          <span className="scope-note">· {o.note}</span>
        </>
      ) : null}
    </>
  );
  return term ? (
    <a className="scope" href={href('rechnik', { term })} data-gl={term} title={s?.long || label}>
      {inner}
    </a>
  ) : (
    <span className="scope" title={s?.long || label}>
      {inner}
    </span>
  );
}
interface BlockOptions {
  id: string;
  title: ReactNode;
  level?: number;
  status?: string;
  source?: string[];
  asOf?: string;
  scope?: string | Scope;
  sub?: ReactNode;
  body: ReactNode;
  foot?: ReactNode;
  share?: false | { text: string };
}
export const block = (o: BlockOptions) => <NarrativeBlock {...o} />;
function NarrativeBlock(o: BlockOptions) {
  const src = o.source || [],
    status = o.status || 'real',
    wantShare = o.share !== false && src.length > 0 && status !== 'pending';
  const report = href(
    'vrazka',
    {},
    {
      type: 'error',
      from: o.id.startsWith('s16') ? 'novo' : 'zakon',
      block: o.id,
      src: src.join(',') || null,
    },
  );
  useEffect(() => {
    if (wantShare)
      share.register(o.id, {
        title: plain(o.title),
        sub: plain(o.sub),
        text: o.share ? o.share.text : o.sub ? plain(o.sub) : undefined,
        source: src,
        asOf: o.asOf,
        status,
        scope: o.scope,
        report,
      });
  }, [o]);
  const tags = !!o.scope || !!status || !!o.asOf || src.length > 0;
  const tools = wantShare ? (
    <div className="block-tools">
      <button
        type="button"
        className="btn btn-sm btn-quiet share-btn"
        data-share={o.id}
        aria-label={`Сподели: ${plain(o.title)}`}
        aria-haspopup="dialog"
        aria-expanded="false"
        onClick={(e) => {
          e.stopPropagation();
          share.openMenu(e.currentTarget, o.id);
        }}
      >
        {icon('share', { size: 16 })}
        <span>Сподели</span>
      </button>
    </div>
  ) : null;
  const title = (
    <h2 className="block-title" id={`${o.id}-t`}>
      {o.title}
    </h2>
  );
  return compactText(
    <section className="block" id={o.id} aria-labelledby={`${o.id}-t`} data-block-status={status}>
      <div className="block-head">
        {title}
        {tags ? (
          <div className="block-tags">
            {o.scope ? scopeChip(o.scope) : null}
            {statusPill(status)}
            {o.asOf ? <span className="block-asof">Данни към {date(o.asOf)}</span> : null}
            {src.length ? (
              <button
                type="button"
                className="src-btn"
                data-src={src.join(',')}
                data-asof={o.asOf}
                aria-haspopup="dialog"
                aria-expanded="false"
                onClick={(e) => {
                  e.stopPropagation();
                  openSource(e.currentTarget, src, { asOf: o.asOf });
                }}
              >
                {icon('info', { size: 14 })}
                <span>Източник</span>
              </button>
            ) : null}
          </div>
        ) : null}
        {tools}
      </div>
      {o.sub ? <p className="block-sub">{o.sub}</p> : null}
      <div className="block-body">{o.body}</div>
      {o.foot || (!wantShare && status !== 'pending') ? (
        <div className="block-foot">
          {typeof o.foot === 'string' ? <p>{o.foot}</p> : o.foot}
          {!wantShare && status !== 'pending' ? (
            <a className="report-link" href={report}>
              {icon('flag', { size: 14 })}
              <span>Намерих грешка</span>
            </a>
          ) : null}
        </div>
      ) : null}
    </section>,
  );
}
export interface KpiOptions {
  label: ReactNode;
  value?: ReactNode;
  mln?: number | null;
  pctGdp?: number | null;
  sub?: ReactNode;
  gl?: string;
}
export function amountParts(unit: string, o: { mln?: number | null; pctGdp?: number | null }) {
  if (unit === 'pct' && typeof o.pctGdp === 'number') return { v: pct(o.pctGdp, 1), u: 'от БВП' };
  return typeof o.mln === 'number' ? moneyParts(o.mln) : { v: '—', u: '' };
}
export const amount = (ctx: { unit: string }, o: { mln: number }) => {
  const p = amountParts(ctx.unit, o);
  return `${p.v}${p.u ? NBSP + p.u : ''}`;
};
export function kpi(o: KpiOptions, unit = 'eur') {
  const p = o.mln !== undefined ? amountParts(unit, o) : { v: o.value ?? '—', u: '' },
    pending = p.v === '—';
  return (
    <div className="kpi" data-status={pending ? 'pending' : undefined}>
      <p className="kpi-label">
        {o.gl ? (
          <a className="gl" data-gl={o.gl} href={href('rechnik', { term: o.gl })}>
            {o.label}
          </a>
        ) : (
          o.label
        )}
      </p>
      <p className="kpi-value">
        <span className="kpi-num">{pending ? 'Няма данни' : p.v}</span>
        {!pending && p.u ? <span className="kpi-unit">{p.u}</span> : null}
      </p>
      {o.sub ? <p className="kpi-sub">{o.sub}</p> : null}
    </div>
  );
}
export const kpiGrid = (items: ReactNode[], o: { label: string }) => (
  <div className="kpi-grid" role="group" aria-label={o.label}>
    {items}
  </div>
);
export function timeline(o: {
  label: string;
  items: {
    id?: string;
    kind?: string;
    date?: string;
    title: ReactNode;
    text?: ReactNode;
    href?: string | null;
  }[];
}) {
  return o.items.length ? (
    <ol className="tl" aria-label={o.label}>
      {o.items.map((it) => {
        const expected = it.kind === 'expected',
          d = it.date || '';
        const when = /^\d{4}-\d{2}-\d{2}$/.test(d) ? (
          <time dateTime={d}>{date(d)}</time>
        ) : /^\d{4}-\d{2}$/.test(d) ? (
          <time dateTime={d}>
            {monthName(+d.slice(5))}
            {NBSP}
            {d.slice(0, 4)}
          </time>
        ) : /^\d{4}$/.test(d) ? (
          <time dateTime={d}>{d}</time>
        ) : (
          d
        );
        return (
          <li
            key={it.id || plain(it.title) + d}
            className="tl-item"
            data-kind={it.kind || 'event'}
            id={it.id}
          >
            {when || expected ? (
              <span className="tl-date">
                {when} {expected ? <span className="tl-flag">очаквано</span> : null}
              </span>
            ) : null}
            <span className="tl-title">
              {it.href ? (
                <a href={it.href.startsWith('#/') ? toHref(it.href) : it.href}>{it.title}</a>
              ) : (
                it.title
              )}
            </span>
            {it.text ? <div className="tl-text">{it.text}</div> : null}
          </li>
        );
      })}
    </ol>
  ) : null;
}
export function pendingState(
  o: { id?: string; title?: string; text?: string; expected?: string; source?: string[] },
  core: NarrativeCore = {},
) {
  const p = core.pending?.[o.id || ''] as
    | { title?: string; reason?: string; expected?: string; source?: string[] }
    | undefined;
  return (
    <div className="state state-pending" data-state="pending" data-pending-id={o.id}>
      <span className="state-ic">{icon('dashed', { size: 28 })}</span>
      <div className="state-main">
        <p className="state-kicker">Няма данни</p>
        {o.title || p?.title ? <p className="state-title">{o.title || p?.title}</p> : null}
        <p className="state-text">
          Не показваме число без налични официални данни за този показател.
        </p>
      </div>
    </div>
  );
}
export const emptyState = (o: { title: string; text: string; actions?: ReactNode }) => (
  <div className="state state-empty" data-state="empty">
    <span className="state-ic">{icon('search', { size: 28 })}</span>
    <div className="state-main">
      <p className="state-title">{o.title}</p>
      <p className="state-text">{o.text}</p>
      {o.actions}
    </div>
  </div>
);
export function unitSwitch(ctx: { unit: string }, o: { name: string; note: string }) {
  return (
    <div className="unit-switch">
      <span className="unit-switch-label" aria-hidden="true">
        Покажи сумите в:
      </span>
      <div className="seg" role="radiogroup" aria-label="Покажи сумите в">
        {[
          ['eur', 'В евро'],
          ['pct', '% от БВП'],
        ].map(([value, label]) => (
          <span className="seg-opt" key={value}>
            <input
              type="radio"
              id={`${o.name}-${value}`}
              name={o.name}
              value={value}
              data-fk={`${o.name}-${value}`}
              checked={ctx.unit === value}
              readOnly
            />
            <label htmlFor={`${o.name}-${value}`}>
              <span>{label}</span>
            </label>
          </span>
        ))}
      </div>
      <p className="unit-switch-note small muted">{o.note} Изборът остава и на другите екрани.</p>
    </div>
  );
}
export const chips = (o: {
  label: string;
  cls: string;
  items: { label: string; count: number; query: string; pressed: boolean }[];
}) => (
  <div className={`chips ${o.cls}`} role="group" aria-label={o.label}>
    {o.items.map((it) => (
      <button
        key={it.query}
        type="button"
        className="chip"
        data-query={it.query}
        data-fk={`chip:${it.query}`}
        aria-pressed={it.pressed}
      >
        <span className="chip-label">{it.label}</span>
        <span className="chip-count">{num(it.count, 0)}</span>
      </button>
    ))}
  </div>
);
export const dataTable = <R extends object>(o: TableOptions<R>) => <NarrativeTable {...o} />;
function NarrativeTable<R extends object>(o: TableOptions<R>) {
  const navigation = useContext(NarrativeNavigation);
  const [sort, setSort] = useState({ key: o.sortBy, dir: 'asc' as 'asc' | 'desc' });
  const rows = sort.key
    ? [...o.rows].sort((a, b) => {
        const x = a[sort.key as keyof R],
          y = b[sort.key as keyof R];
        if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
        const d =
          typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y), 'bg');
        return sort.dir === 'desc' ? -d : d;
      })
    : o.rows;
  useEffect(() => {
    share.attach(o.id, {
      table: () => ({
        columns: o.columns.map((c) => (c.unit ? `${c.label}, ${c.unit}` : c.label)),
        rows: rows.map((r) =>
          o.columns.map((c) => {
            const v = r[c.key];
            return typeof v === 'object' && v !== null
              ? plain(v as unknown as ReactNode)
              : (v ?? '');
          }),
        ),
        statuses: rows.map(() => undefined),
      }),
    });
  }, [o, sort]);
  return (
    <>
      {compactText(
        baseTable({
          ...o,
          rows,
          sortBy: sort.key,
          dir: sort.dir,
          onSort: (key) => {
            const dir = sort.key === key && sort.dir === 'asc' ? 'desc' : 'asc';
            setSort({ key, dir });
            navigation?.announce(
              `Сортирано по „${o.columns.find((c) => c.key === key)!.label}“, ${dir === 'desc' ? 'низходящо' : 'възходящо'}`,
            );
          },
        }),
      )}
    </>
  );
}
