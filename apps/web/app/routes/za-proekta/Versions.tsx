import type { EditorialCore } from '../../lib/editorial-types';
import { date, num, plural } from '../../lib/legacy';
import { facts } from '../../components/Cards';

const dateG = (iso: string | undefined) =>
  /^\d{4}-\d{2}-\d{2}/.test(iso || '') ? `${date(iso, true)} г.` : '';
function monthsText(n: number | undefined) {
  if (!Number.isFinite(n) || n === undefined || n < 1) return '';
  if (n === 1) return 'януари 2026 г.';
  if (n >= 12) return 'цялата 2026 г.';
  return `първите ${n} месеца на 2026 г.`;
}

export function Versions({ core }: { core: EditorialCore }) {
  const b = core.build || {},
    c = core.counts || {};
  const latest = dateG(b.kfpLatest);
  const inside = [
    Number.isFinite(c.budgets) &&
      plural(c.budgets, 'бюджет', 'бюджета') + ' на ведомства и институции',
    Number.isFinite(c.programs) && plural(c.programs, 'програма', 'програми'),
    Number.isFinite(c.measures) && plural(c.measures, 'мярка', 'мерки'),
    Number.isFinite(c.terms) && plural(c.terms, 'термин', 'термина') + ' в речника',
    Number.isFinite(c.municipalities) &&
      plural(c.municipalities, 'община', 'общини') + ' с годишни трансфери',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <>
      <p>
        Данните са от официални източници; законопроектът и прогнозите са обозначени отделно от
        отчетите. Нищо от въведеното в сайта не напуска браузъра ти: няма бисквитки, проследяване и
        външни заявки.
      </p>
      {facts(
        [
          { k: 'Версия на данните', v: b.dataVersion },
          { k: 'Данните са извлечени на', v: dateG(core.meta?.retrieved) },
          {
            k: 'Последен отчет на КФП',
            v:
              latest &&
              `към ${latest}${monthsText(b.kfpMonths2026) ? ` (${monthsText(b.kfpMonths2026)})` : ''}`,
          },
          {
            k: 'Курс на еврото',
            v: Number.isFinite(b.eurRate) && `1 € = ${num(b.eurRate, 5)} лв. (фиксиран)`,
          },
          { k: 'Какво има вътре', v: inside },
        ],
        { cls: 's26-facts' },
      )}
    </>
  );
}
