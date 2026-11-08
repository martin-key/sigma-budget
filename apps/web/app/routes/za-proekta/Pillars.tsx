import { chips } from '../../components/Chips';
import { byKey, href } from '../../lib/legacy';
import { link, to } from './shared';

function pillar(n: number, title: string, text: string, keys: string[]) {
  return (
    <>
      <article className="s26-pillar">
        <p className="s26-kicker">Стълб {n}</p>
        <h3 className="s26-h3">{title}</h3>
        <p>{text}</p>
        {chips({
          label: `Екрани от стълб ${n}`,
          items: keys.map((k) => ({ label: byKey[k].title, href: href(k) })),
        })}
      </article>
    </>
  );
}

export const Pillars = () => (
  <>
    <p>Основата са два стълба. Около тях има още три слоя.</p>
    <div className="s26-pillars">
      {pillar(
        1,
        'Бюджетът за годината',
        'Проектът и законът за 2026 г., в средносрочен хоризонт 2024–2028. Разходите са по функции, по вид разход и по ведомства и програми. Към тях има и мерките в бюджета: какво се променя.',
        ['prihodi', 'razhodi', 'vedomstva', 'merki'],
      )}
      {pillar(
        2,
        'Изпълнението по месеци',
        'Колко е събрано и изразходвано по месечните отчети, в сравнение със същия период на миналата година.',
        ['izpalnenie', 'novo'],
      )}
    </div>
    <h3 className="s26-h3">Още три слоя</h3>
    <ul className="s26-layers">
      <li>
        <strong>Учебен слой.</strong> {link('5-minuti')} с връзки към подробностите,{' '}
        {link('rechnik', 'речникът')} и пояснения на място, при самите числа.
      </li>
      <li>
        <strong>Слой на доверието.</strong> До всяко число стоят източникът, обхватът, статусът
        (проект, закон, отчет, прогноза) и датата. Наборите са описани в „{link('danni')}“.
      </li>
      <li>
        <strong>Следващи стъпки.</strong> Какво още предстои, пише в{' '}
        <a href={to('s26-roadmap')}>пътната карта</a>.
      </li>
    </ul>
  </>
);
