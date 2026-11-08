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
}: {
  model: TextScreenModel;
  children: ReactNode;
  lede?: ReactNode;
  context?: ReactNode;
  bodyEvents?: Pick<HTMLAttributes<HTMLDivElement>, 'onClick' | 'onChange' | 'onFocus'>;
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
    }[model.screen],
    i = r.title.lastIndexOf(accent);
  const targets = r.next.map((id: string) => byId[id]);
  const first = targets[0];
  return (
    <article
      className="page"
      data-route={r.id}
      data-key={r.key}
      data-view={model.view || 'ready'}
      data-ready={ready ? '1' : '0'}
      aria-labelledby="page-title"
    >
      {breadcrumbs([{ label: 'Начало', href: href('S01') }, { label: r.title }])}
      {r.group !== 'util' ? (
        <p className="eyebrow">{GROUPS.find((g) => g.id === r.group)?.label}</p>
      ) : null}
      <h1 className="page-title" id="page-title" tabIndex={-1}>
        {i < 0 ? (
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
            href: href(first.id),
            title: first.id === 'S01' ? 'Към началото' : first.title,
            kicker: first.id === 'S01' ? 'Начало' : GROUPS.find((g) => g.id === first.group)?.label,
            text: first.id === 'S01' ? '' : first.desc,
            more: targets.slice(1).map((t: typeof r) => ({
              href: href(t.id),
              label: t.id === 'S01' ? 'Към началото' : t.title,
            })),
          })
        : null}
    </article>
  );
}
