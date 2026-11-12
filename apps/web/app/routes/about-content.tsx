import type { EditorialCore } from '../lib/editorial-types';
import { glossaryTree } from '../components/GlossaryText';
import { callout } from '../components/Cards';
import { chips } from '../components/Chips';
import { SECTIONS, to, block } from './za-proekta/shared';
import { Mission } from './za-proekta/Mission';
import { Pillars } from './za-proekta/Pillars';
import { OpenData } from './za-proekta/OpenData';
import { Versions } from './za-proekta/Versions';
import { Legend } from './za-proekta/Legend';
import { Credits } from './za-proekta/Credits';

export const needs = [];
export const styles = ['s26-za-proekta'];

// Pure section factories are evaluated before glossaryTree so its term limits and
// deduplication still apply to the complete page, without mutating React's DOM.
export function AboutContent({
  core = {},
  glossary,
  onTerm,
  announce = (_message) => {},
}: {
  core?: EditorialCore;
  glossary: unknown;
  onTerm?: (anchor: HTMLElement, slug: string) => void;
  announce?: (message: string) => void;
}) {
  return glossaryTree(
    <>
      {callout({
        kind: 'info',
        title: 'Официални източници',
        body: (
          <>
            <p>
              Бюджетните числа са от официални източници. Законопроектите, прогнозите и отчетите са
              обозначени със своя период и дата. Липсващите данни не се заменят с измислени
              стойности.
            </p>
          </>
        ),
      })}
      <nav className="s26-toc" aria-label="На тази страница">
        {chips({ items: SECTIONS.map((s) => ({ label: s.label, href: to(s.id) })) })}
      </nav>
      {block('s26-mission', Mission(), { scan: true })}
      {block('s26-pillars', Pillars(), { scan: true })}
      {block('s26-open', OpenData(), { scan: true })}
      {block('s26-versions', Versions({ core }), { scan: true })}
      {block('s26-legend', Legend())}
      {block('s26-credits', Credits())}
    </>,
    glossary,
    onTerm,
  );
}
