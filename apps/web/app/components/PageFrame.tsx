import { useEffect, useState, type ReactNode } from 'react';
import type { TextScreenModel } from '../lib/screen-state';
import { byId, GROUPS, href } from '../lib/legacy';
import { breadcrumbs } from './Breadcrumbs';
import { nextCard } from './Next';
export function PageFrame({
  model,
  children,
  lede,
}: {
  model: TextScreenModel;
  children: ReactNode;
  lede?: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const r = byId[model.screen],
    accent = model.screen === 'S26' ? 'проекта' : 'страница',
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
        {r.title.slice(0, i)}
        <em>{accent}</em>
        {r.title.slice(i + accent.length)}
      </h1>
      <p className="lede">{lede ?? r.desc}</p>
      <div className="page-body" data-fk="body">
        {children}
      </div>
      {first
        ? nextCard({
            href: href(first.id),
            title: first.title,
            kicker: GROUPS.find((g) => g.id === first.group)?.label,
            text: first.desc,
            more: targets.slice(1).map((t: typeof r) => ({
              href: href(t.id),
              label: t.id === 'S01' ? 'Към началото' : t.title,
            })),
          })
        : null}
    </article>
  );
}
