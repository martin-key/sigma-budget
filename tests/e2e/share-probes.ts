export const VIEWS = [
  '#/izpalnenie?g1=2024&g2=2025&obhvat=eu&rez=mesec&mesec=5',
  '#/izpalnenie?g1=2025&g2=2026&obhvat=nat',
  '#/razhodi?po=vid&izgled=tablica',
  '#/razhodi?po=funkcii&izgled=godini',
  '#/prihodi',
  '#/vedomstvo/0100',
  '#/dalg',
  '#/merki',
  '#/bvp?sy=2019',
  '#/5-minuti',
  '#/izpalnenie',
];
export const readControls = () => ({
  h1: document.querySelector('h1')?.textContent ?? '',
  fields: [
    ...document.querySelectorAll<HTMLInputElement>(
      'main select, main input[type=radio]:checked, main input[type=checkbox]:checked, main input[type=text]',
    ),
  ]
    .map((e) => (e.id || e.name || e.tagName) + '=' + (e.value || ''))
    .sort()
    .join(';'),
  pressed: [
    ...document.querySelectorAll(
      'main [aria-pressed="true"], main [role=tab][aria-selected="true"]',
    ),
  ]
    .map((e) => e.textContent!.trim().slice(0, 30))
    .sort()
    .join(';'),
});
export const visibleShareIds = () => [
  ...new Set(
    [...document.querySelectorAll<HTMLElement>('[data-share]')]
      .filter((b) => b.getClientRects().length && !b.closest('[hidden], details:not([open])'))
      .map((b) => b.dataset.share!),
  ),
];
