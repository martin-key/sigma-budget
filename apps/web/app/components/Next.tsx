// The „Следва“ card at the end of every screen (F09). The router builds it from the route table (route.next),
// a page can override it with its own export next(ctx) -> ['S12'] | [{href, title, text, kicker}].

import { icon } from './Icon';

/** nextCard({kicker, title, text, href, more:[{label, href}]}) */
export function nextCard(o: {
  href: string;
  heading?: string;
  kicker?: string;
  title: string;
  text?: string;
  more?: { label: string; href: string }[];
}) {
  return (
    <>
      <aside className="next" aria-labelledby="next-h" data-ui="next">
        <a className="next-main" href={o.href}>
          <span className="next-body">
            <span className="next-kicker" id="next-h">
              {o.heading || 'Следва'} · {o.kicker}
            </span>{' '}
            <span className="next-title">{o.title}</span>{' '}
            {o.text ? (
              <>
                <span className="next-text">{o.text}</span>
              </>
            ) : (
              ''
            )}
          </span>
          <span className="next-go" aria-hidden="true">
            {icon('arrowRight', { size: 22 })}
          </span>
        </a>
        {o.more?.length ? (
          <>
            <p className="next-more">
              Или:{' '}
              {o.more.map((m, i) => (
                <>
                  {i ? ' · ' : ''}
                  <a href={m.href}>{m.label}</a>
                </>
              ))}
            </p>
          </>
        ) : (
          ''
        )}
      </aside>
    </>
  );
}
