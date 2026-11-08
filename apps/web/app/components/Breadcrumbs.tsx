// Breadcrumbs: breadcrumbs([{label, href}, …, {label}]) — the last item is the current page.

export function breadcrumbs(items: { label: string; href?: string }[] = []) {
  if (!items.length) return <></>;
  return (
    <>
      <nav className="crumbs" aria-label="Трохи">
        <ol>
          {items.map((it, i) =>
            i === items.length - 1 || !it.href ? (
              <>
                <li>
                  <span aria-current="page">{it.label}</span>
                </li>
              </>
            ) : (
              <>
                <li>
                  <a href={it.href}>{it.label}</a>
                </li>
              </>
            ),
          )}
        </ol>
      </nav>
    </>
  );
}
