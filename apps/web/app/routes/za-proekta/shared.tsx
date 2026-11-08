import type { ReactNode } from 'react';
import type { PathValues, QueryValues } from '../../lib/legacy';
import { byId, byKey, href } from '../../lib/legacy';
import { linkCard } from '../../components/Cards';

/** the blocks of the page: one source for the headings and for the „На тази страница“ links (id = target of ?to=) */
export const SECTIONS = [
  { id: 's26-mission', label: 'Мисия', title: 'Мисия' },
  { id: 's26-pillars', label: 'Два стълба', title: 'Двата стълба' },
  { id: 's26-open', label: 'Отворен код', title: 'Отворен код и данни' },
  { id: 's26-roadmap', label: 'Пътна карта', title: 'Пътна карта' },
  { id: 's26-versions', label: 'Версии', title: 'Версии на прототипа' },
  { id: 's26-questions', label: 'Въпроси', title: 'Въпроси към работната група' },
  { id: 's26-demo', label: 'Демо', title: 'Демо на състоянията' },
  { id: 's26-legend', label: 'Легенда', title: 'Легенда на статусите' },
  { id: 's26-credits', label: 'Авторите', title: 'Кой стои зад проекта' },
];
const TITLE = Object.fromEntries(SECTIONS.map((s) => [s.id, s.title]));
export const to = (id: string) => href('za-proekta', {}, { to: id }); // same-screen jump: the router scrolls, highlights and focuses the heading, no re-render

export const link = (key: string, label?: string, params?: PathValues, query?: QueryValues) => (
  <>
    <a href={href(key, params, query)}>{label ?? byKey[key]?.title ?? byId[key]?.title}</a>
  </>
);

/** the screen a nav-less child belongs to in the menu („Ведомство“ -> „Кой харчи?“) */
export function menuTitle(id: string) {
  let r = byId[id];
  while (r && !r.nav && r.parent) r = byId[r.parent];
  return r?.title || '';
}

export function block(id: string, body: ReactNode, o: { scan?: boolean } = {}) {
  return (
    <>
      <section className="s26-block" data-gl-scan={o.scan ? '' : undefined}>
        <h2 id={id} tabIndex={-1}>
          {TITLE[id]}
        </h2>
        {body}
      </section>
    </>
  );
}

export const cardOf = (id: string) => {
  const r = byId[id];
  return linkCard({ href: href(r.key), title: r.title, text: r.desc, icon: r.icon });
};
