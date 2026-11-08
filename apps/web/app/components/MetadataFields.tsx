import type { ReactNode } from 'react';
export function field(o: { id: string; label: string; hint: string; control: ReactNode }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={o.id}>
        {o.label}
      </label>
      <p className="field-hint" id={`${o.id}-hint`}>
        {o.hint}
      </p>
      {o.control}
    </div>
  );
}
export function selectInput(o: {
  id: string;
  name: string;
  query: string;
  hint: boolean;
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <span className="select">
      <select
        id={o.id}
        name={o.name}
        data-query={o.query}
        aria-describedby={`${o.id}-hint`}
        defaultValue={o.value}
      >
        {o.options.map((x) => (
          <option key={x.value} value={x.value}>
            {x.label}
          </option>
        ))}
      </select>
    </span>
  );
}
