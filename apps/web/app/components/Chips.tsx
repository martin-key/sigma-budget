import type { ReactNode } from 'react';
export function chips(
  o: {
    cls?: string;
    id?: string;
    label?: string;
    items?: { href: string; label: ReactNode; pressed?: boolean }[];
  } = {},
) {
  return (
    <div
      className={['chips', o.cls].filter(Boolean).join(' ')}
      id={o.id}
      role={o.label ? 'group' : undefined}
      aria-label={o.label}
    >
      {(o.items || []).map((it, i) => (
        <a
          key={it.href + '|' + i}
          className="chip"
          href={it.href}
          aria-current={it.pressed ? 'true' : undefined}
        >
          <span className="chip-label">{it.label}</span>
        </a>
      ))}
    </div>
  );
}
