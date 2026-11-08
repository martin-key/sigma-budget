import { useEffect, useState, type ReactNode } from 'react';
import { icon } from './Icon';
import { runAct } from '../../client/share.js';
import { num } from '../lib/legacy';
export interface Column<R> {
  key: keyof R;
  label: string;
  align?: string;
  num?: boolean;
  unit?: string;
  sort?: boolean;
  fmt?(value: NoInfer<R[keyof R]>, row: NoInfer<R>): ReactNode;
}
export interface TableOptions<R> {
  id: string;
  caption: string;
  columns: Column<R>[];
  rows: R[];
  dense?: boolean;
  captionVisible?: boolean;
  image?: boolean;
  sortable?: boolean;
  sortBy?: keyof R;
  dir?: 'asc' | 'desc';
  onSort?(key: keyof R): void;
  note?: string;
  total?: { label: string; values: Partial<R> };
}
export function dataTable<R extends object>(o: TableOptions<R>) {
  const aligns = o.columns.map(
    (c) => c.align || (c.num || o.rows.some((r) => typeof r[c.key] === 'number') ? 'end' : 'start'),
  );
  const linked = (c: Column<R>, r: R, i: number): ReactNode => {
    const value = cell(c, r);
    const link = (r as { _href?: string })._href;
    return i === 0 && link ? <a href={link}>{value}</a> : value;
  };
  const cell = (c: Column<R>, r: R): ReactNode => {
    const v = r[c.key];
    if (c.fmt) return c.fmt(v, r);
    if (v == null)
      return (
        <span className="muted" title="Няма данни">
          —
        </span>
      );
    return typeof v === 'number' ? num(v, Number.isInteger(v) ? 0 : 1) : String(v);
  };
  return (
    <>
      <div
        className={`table-wrap${o.dense ? ' dense' : ''}`}
        id={`${o.id}-wrap`}
        tabIndex={0}
        role="region"
        aria-labelledby={`${o.id}-cap`}
        data-ui="table"
        data-attach={o.id}
        data-png-host={o.image ? `${o.id}-wrap` : undefined}
      >
        <table className="data" id={o.id}>
          <caption id={`${o.id}-cap`} className={o.captionVisible ? 'cap-visible' : 'sr-only'}>
            {o.caption}
          </caption>
          <thead>
            <tr>
              {o.columns.map((c, i) => (
                <th
                  key={String(c.key)}
                  scope="col"
                  className={aligns[i] === 'end' ? 't-end' : ''}
                  aria-sort={
                    o.sortable && c.sort !== false
                      ? o.sortBy === c.key
                        ? o.dir === 'desc'
                          ? 'descending'
                          : 'ascending'
                        : 'none'
                      : undefined
                  }
                >
                  {o.sortable && c.sort !== false ? (
                    <button
                      type="button"
                      className="th-sort"
                      data-key={String(c.key)}
                      onClick={(e) => {
                        e.stopPropagation();
                        o.onSort?.(c.key);
                      }}
                    >
                      <span className="th-lab">
                        {c.label}
                        {c.unit ? <span className="th-unit">, {c.unit}</span> : null}
                      </span>
                      <span className="th-arrow" aria-hidden="true">
                        {icon(
                          o.sortBy === c.key && o.dir === 'desc' ? 'chevronDown' : 'chevronUp',
                          { size: 14 },
                        )}
                      </span>
                      <span className="sr-only"> (сортирай)</span>
                    </button>
                  ) : (
                    <>
                      {c.label}
                      {c.unit ? <span className="th-unit">, {c.unit}</span> : null}
                    </>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {o.rows.length ? (
              o.rows.map((r, i) => (
                <tr key={i}>
                  {o.columns.map((c, j) =>
                    j === 0 ? (
                      <th
                        key={String(c.key)}
                        scope="row"
                        className={aligns[j] === 'end' ? 't-end' : undefined}
                      >
                        {linked(c, r, j)}
                      </th>
                    ) : (
                      <td key={String(c.key)} className={aligns[j] === 'end' ? 't-end' : undefined}>
                        {linked(c, r, j)}
                      </td>
                    ),
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={o.columns.length} className="t-empty">
                  Няма редове за показване.
                </td>
              </tr>
            )}
          </tbody>
          {o.total ? (
            <tfoot>
              <tr>
                <th scope="row">{o.total.label}</th>
                {o.columns.slice(1).map((c, i) => (
                  <td key={String(c.key)} className={aligns[i + 1] === 'end' ? 't-end' : undefined}>
                    {o.total!.values[c.key] != null ? cell(c, o.total!.values as R) : '—'}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
        {o.note ? <p className="table-note small muted">{o.note}</p> : null}
      </div>
      {o.image ? <TableImage id={`${o.id}-wrap`} title={o.caption} /> : null}
    </>
  );
}

// Loose-statistic export is added after adoption, at the same point as the legacy PNG scanner.
function TableImage({ id, title }: { id: string; title: string }) {
  const [mounted, setMounted] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <div className="png-bar">
      <button
        type="button"
        className="btn btn-sm btn-quiet png-btn"
        data-png={id}
        title="Изтегли изображение (PNG)"
        aria-label={`Изтегли изображение: ${title}`}
        aria-busy={busy || undefined}
        onClick={async (e) => {
          e.stopPropagation();
          if (busy) return;
          const el = document.getElementById(id);
          if (!el) return;
          setBusy(true);
          try {
            await runAct('png', { id, el, title, route: 'proverka', period: '' }, e.currentTarget);
          } finally {
            setBusy(false);
          }
        }}
      >
        {icon('image', { size: 16 })}
        <span>Изображение</span>
      </button>
    </div>
  );
}
