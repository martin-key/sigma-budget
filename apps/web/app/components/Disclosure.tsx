import { type ReactNode } from 'react';
const remembered = new Map<string, boolean>();
export function disclosure(o: { id: string; title: ReactNode; meta?: ReactNode; body: ReactNode }) {
  // Only a visitor toggle is remembered; opening a ?to= ancestor is temporary.
  let armed = false;
  return (
    <details
      className="disc"
      id={o.id}
      data-ui="disclosure"
      open={typeof window !== 'undefined' ? remembered.get(o.id) : undefined}
      onToggle={(e) => {
        if (armed) {
          remembered.set(o.id, e.currentTarget.open);
          armed = false;
        }
      }}
    >
      <summary
        onClick={() => {
          armed = true;
        }}
      >
        <span className="disc-title">{o.title}</span>
        {o.meta ? (
          <>
            {' '}
            <span className="disc-meta">{o.meta}</span>
          </>
        ) : null}
      </summary>
      <div className="disc-body">{o.body}</div>
    </details>
  );
}
