// Tabs (WAI-ARIA tabs pattern), as apps/web/client/ui/tabs.js draws them: one tab list, every panel in the markup, the inactive ones hidden.
//   <Tabs id label active tabs={[{key, label, body}]} onSelect />
// ← → move and activate (wrapping), Home / End go to the ends; only the active tab is in the Tab order. onSelect gets the key of a choice
// the visitor made (the screen mirrors it into the address), never the initial one; the .tabs element then fires a bubbling
// `tabs:change` event ({detail: {id, key}}), as the legacy tabs do.
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

const part = (k: string) => k.replace(/[^\w-]+/g, '_');

export function Tabs(o: {
  id: string;
  label?: string;
  active?: string;
  query?: string;
  tabs: { key: string; label: ReactNode; body: ReactNode }[];
  onSelect?(key: string): void;
}) {
  const keys = o.tabs.map((t) => t.key);
  const [active, setActive] = useState(o.active && keys.includes(o.active) ? o.active : keys[0]);
  const list = useRef<HTMLDivElement>(null),
    root = useRef<HTMLDivElement>(null);
  const tid = (k: string) => `${o.id}-t-${part(k)}`,
    pid = (k: string) => `${o.id}-p-${part(k)}`;
  const select = (key: string, focus: boolean) => {
    setActive(key);
    if (focus) {
      const tab = list.current?.querySelector<HTMLButtonElement>(`#${tid(key)}`);
      tab?.focus();
      tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    o.onSelect?.(key);
    root.current?.dispatchEvent(
      new CustomEvent('tabs:change', { bubbles: true, detail: { id: o.id, key } }),
    );
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = keys.indexOf(e.currentTarget.dataset.key || '');
    const to =
      e.key === 'ArrowRight'
        ? (i + 1) % keys.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + keys.length) % keys.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? keys.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    select(keys[to], true);
  };
  return (
    <div className="tabs" id={o.id} data-ui="tabs" data-qkey={o.query} ref={root}>
      <div className="tab-list" role="tablist" aria-label={o.label} ref={list}>
        {o.tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={tid(t.key)}
            aria-controls={pid(t.key)}
            aria-selected={t.key === active ? 'true' : 'false'}
            tabIndex={t.key === active ? 0 : -1}
            data-key={t.key}
            onClick={() => select(t.key, false)}
            onKeyDown={onKey}
          >
            {t.label}
          </button>
        ))}
      </div>
      {o.tabs.map((t) => (
        <div
          key={t.key}
          className="tab-panel"
          role="tabpanel"
          id={pid(t.key)}
          aria-labelledby={tid(t.key)}
          tabIndex={0}
          data-key={t.key}
          hidden={t.key !== active}
        >
          {t.body}
        </div>
      ))}
    </div>
  );
}
