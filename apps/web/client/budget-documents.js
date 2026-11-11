// Section identifiers already shared from the October plan remain addressable.
const PLAN_TARGETS = new Set([
  's34-kratko',
  's34-caps',
  's34-ppd',
  's34-sp1',
  's34-ne-potvardeno',
  's34-deficit',
  's34-merki',
  's34-t-rev',
  's34-t-exp',
  's34-rev',
  's34-prihodi',
  's34-exp',
  's34-razhodi',
  's34-debt',
  's34-dalg',
  's34-esa-kfp',
  's34-kfp-def',
  's34-esa-def',
  's34-lipsva',
]);
export const isBudgetPlan = (query = {}) =>
  query.dokument === 'plan' ||
  (!query.dokument &&
    [...PLAN_TARGETS].some((id) => query.to === id || String(query.to || '').startsWith(id + '-')));

/** The five terms authored for the October plan keep that document as their destination. */
export function glossaryLinks(term) {
  return (term.see || []).map((link) => {
    if (term.cat !== 'byudzhet-2027') return link;
    const [path, search = ''] = String(link.href || '').split('?');
    if (path !== '#/byudzhet-2027' && path !== '/byudzhet-2027') return link;
    const query = new URLSearchParams(search);
    if (query.has('dokument')) return link;
    query.set('dokument', 'plan');
    return { ...link, href: `${path}?${query}` };
  });
}
