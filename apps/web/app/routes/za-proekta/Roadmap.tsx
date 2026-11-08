import type { EditorialCore } from '../../lib/editorial-types';
import { GROUPS, ROUTES, href } from '../../lib/legacy';
import { statusPill } from '../../components/Status';
import { chips } from '../../components/Chips';
import { menuTitle, link } from './shared';

/** phase 1: every screen of the menu, by menu group (read from the route table) */
const mvpGroups = () =>
  GROUPS.filter((g) => g.id !== 'util')
    .map((g) => ({ g, items: ROUTES.filter((r) => r.group === g.id && r.nav && r.phase === 1) }))
    .filter((x) => x.items.length);

/** phase 2: the screens marked phase 2 in the route table, plus what has no screen of its own yet */
const phaseTwo = () => [
  {
    label: 'Дейности във функцията',
    text: 'По-подробен поглед към дейностите вътре във функцията. Липсва официален набор, затова не е в прототипа.',
  },
  {
    label: 'Индикатори за резултат',
    text: 'Цел и постигнато по програма. Липсва официален набор, затова не е в прототипа.',
  },
  {
    label: 'Финанси на общините',
    text: 'Собствени приходи и разходи на общините. В прототипа има само годишните трансфери от държавния бюджет.',
  },
  {
    label: 'Истински API',
    href: href('S25'),
    text: 'Постоянни адреси за данните, със версии. Засега е само предложение.',
  },
];

function waiting(core: EditorialCore) {
  const items = Object.values(core.pending || {}).filter((p) => p && p.title);
  if (!items.length) return '';
  return (
    <>
      <div className="s26-wait">
        <h3 className="s26-h3">Данни, които още чакаме</h3>
        <p>
          Тези данни съществуват при издателя, но още не са извлечени. Затова на екраните пише{' '}
          {statusPill('pending')}, а не число.
        </p>
        <ul className="s26-wait-list">
          {items.map((p) => {
            const where = [...new Set((p.screens || []).map(menuTitle).filter(Boolean))];
            return (
              <>
                <li>
                  <span className="s26-wait-t">{p.title}</span>
                  {where.length ? (
                    <>
                      <span className="s26-wait-s">Засяга: {where.join(', ')}</span>
                    </>
                  ) : (
                    ''
                  )}
                </li>
              </>
            );
          })}
        </ul>
        <p>Защо всеки набор още липсва, пише в „{link('danni')}“.</p>
      </div>
    </>
  );
}

export const Roadmap = ({ core }: { core: EditorialCore }) => (
  <>
    <p>Разделението по-долу е предложение. Работната група трябва да го потвърди.</p>
    <div className="s26-road">
      <section className="s26-phase" aria-labelledby="s26-mvp-h">
        <h3 className="s26-h3" id="s26-mvp-h">
          Първа версия (MVP)
        </h3>
        <p>
          Екрани, които се строят върху официални данни. Където данните още липсват, пише
          „предстои“.
        </p>
        {mvpGroups().map(({ g, items }) => (
          <>
            <div className="s26-grp">
              <p className="s26-grp-h">{g.label}</p>
              {chips({
                label: g.label,
                items: items.map((r) => ({ label: r.title, href: href(r.key) })),
              })}
            </div>
          </>
        ))}
      </section>
      <section className="s26-phase s26-phase-2" aria-labelledby="s26-ph2-h">
        <h3 className="s26-h3" id="s26-ph2-h">
          Фаза 2
        </h3>
        <p>
          Теми, за които официални данни още няма или са непълни. Прототипът не ги показва, за да не
          измисля числа.
        </p>
        <ul className="s26-ph2">
          {phaseTwo().map((it) => (
            <>
              <li>
                <span className="s26-ph2-t">
                  {it.href ? (
                    <>
                      <a href={it.href}>{it.label}</a>
                    </>
                  ) : (
                    it.label
                  )}
                </span>
                <span className="s26-ph2-s">{it.text}</span>
              </li>
            </>
          ))}
        </ul>
      </section>
    </div>
    {waiting(core)}
  </>
);
