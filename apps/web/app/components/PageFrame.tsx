import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import type { TextScreenModel } from '../lib/screen-state';
import { byId, GROUPS, href } from '../lib/legacy';
import { breadcrumbs } from './Breadcrumbs';
import { nextCard } from './Next';
export function PageFrame({
  model,
  children,
  lede,
  context,
  bodyEvents,
  title,
  eyebrow,
  crumbs,
  next,
}: {
  model: TextScreenModel;
  children: ReactNode;
  lede?: ReactNode;
  context?: ReactNode;
  bodyEvents?: Pick<HTMLAttributes<HTMLDivElement>, 'onClick' | 'onChange' | 'onFocus'>;
  /** a title the screen sets itself (the passport of one set): plain, without the accent word */
  title?: string;
  eyebrow?: string;
  crumbs?: { label: string; href?: string }[];
  /** the „Следва“ cards when the screen sets them itself: a screen id or a card */
  next?: (string | { href: string; title: string; kicker?: string; text?: string })[];
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const r = byId[model.screen],
    accent = {
      S26: 'проекта',
      S30: 'страница',
      S25: 'данни',
      S35: '',
      S14: 'бюджетът',
      S16: 'ново',
      S27: 'връзка',
      S24: 'данните',
    }[model.screen],
    i = title ? -1 : r.title.lastIndexOf(accent);
  const card = (it: string | { href: string; title: string; kicker?: string; text?: string }) => {
    if (typeof it !== 'string') return it;
    const t = byId[it];
    return {
      href: href(t.id),
      title: t.id === 'S01' ? 'Към началото' : t.title,
      kicker: t.id === 'S01' ? 'Начало' : GROUPS.find((g) => g.id === t.group)?.label,
      text: t.id === 'S01' ? '' : t.desc,
    };
  };
  const cards = (next || r.next).map(card);
  const first = cards[0];
  return (
    <article
      className="page"
      data-route={r.id}
      data-key={r.key}
      data-view={model.view || 'ready'}
      data-ready={ready ? '1' : '0'}
      aria-labelledby="page-title"
    >
      {breadcrumbs(crumbs || [{ label: 'Начало', href: href('S01') }, { label: r.title }])}
      {eyebrow ? (
        <p className="eyebrow">{eyebrow}</p>
      ) : r.group !== 'util' ? (
        <p className="eyebrow">{GROUPS.find((g) => g.id === r.group)?.label}</p>
      ) : null}
      <h1 className="page-title" id="page-title" tabIndex={-1}>
        {title ? (
          title
        ) : i < 0 ? (
          r.title
        ) : (
          <>
            {r.title.slice(0, i)}
            {accent ? <em>{accent}</em> : null}
            {r.title.slice(i + accent.length)}
          </>
        )}
      </h1>
      <p className="lede">{lede ?? r.desc}</p>
      {context}
      <div className="page-body" data-fk="body" {...bodyEvents}>
        {children}
      </div>
      {first
        ? nextCard({
            ...first,
            kicker: first.kicker || '',
            more: cards.slice(1).map((t) => ({ href: t.href, label: t.title })),
          })
        : null}
    </article>
  );
}
