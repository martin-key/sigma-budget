import type { ReactNode } from 'react';
import { icon } from './Icon';
export function linkCard(o: {
  href: string;
  title: ReactNode;
  text?: ReactNode;
  kicker?: ReactNode;
  icon?: string;
  meta?: ReactNode;
  cls?: string;
}) {
  return (
    <a className={['link-card', o.cls].filter(Boolean).join(' ')} href={o.href}>
      {o.icon ? <span className="link-card-ic">{icon(o.icon, { size: 22 })}</span> : null}
      <span className="link-card-main">
        {o.kicker ? <span className="link-card-kicker">{o.kicker}</span> : null}
        <span className="link-card-title">{o.title}</span>
        {o.text ? <span className="link-card-text">{o.text}</span> : null}
        {o.meta ? <span className="link-card-meta">{o.meta}</span> : null}
      </span>
      <span className="link-card-go" aria-hidden="true">
        {icon('arrowRight', { size: 18 })}
      </span>
    </a>
  );
}
export function callout(
  o: {
    kind?: 'info' | 'warn' | 'bad' | 'ok';
    cls?: string;
    id?: string;
    title?: ReactNode;
    body?: ReactNode;
    icon?: string;
  } = {},
) {
  const kind = o.kind || 'info';
  return (
    <div
      className={['callout', 'callout-' + kind, o.cls].filter(Boolean).join(' ')}
      role="note"
      id={o.id}
    >
      <span className="callout-ic">
        {icon(o.icon || { info: 'info', warn: 'alert', bad: 'alert', ok: 'checkCircle' }[kind], {
          size: 20,
        })}
      </span>
      <div className="callout-main">
        {o.title ? <p className="callout-title">{o.title}</p> : null}
        <div className="callout-body">{o.body}</div>
      </div>
    </div>
  );
}
export function facts(
  items: ({ k: ReactNode; v: ReactNode } | null)[] = [],
  o: { cls?: string } = {},
) {
  return (
    <dl className={['facts', o.cls].filter(Boolean).join(' ')}>
      {items
        .filter((i): i is { k: ReactNode; v: ReactNode } => !!i && i.v != null && i.v !== '')
        .map((i, index) => (
          <div className="facts-row" key={index}>
            <dt>{i.k}</dt>
            <dd>{i.v}</dd>
          </div>
        ))}
    </dl>
  );
}
