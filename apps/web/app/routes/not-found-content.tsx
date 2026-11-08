// React screen content; Bulgarian copy retained from main 26f82ea.
import { toHref } from '../../client/loc.js';
import { byId, href as routeHref } from '../lib/legacy';
import { linkCard } from '../components/Cards';
import { MAX_QUERY } from '../../client/searchlib.js';

export const needs = [];
export const styles = ['s30-404'];

const START = ['S01', 'S06', 'S07', 'S10', 'S18', 'S03']; // start, revenue, spending, who spends, my taxes, glossary
const MAX_SHOWN = 80; // characters of the address that are printed

export function notFoundParts(
  params: Record<string, string>,
  navigation: Pick<import('../lib/screen-state').Navigation, 'go'> = { go(_href) {} },
) {
  const path = String(params.path ?? '').trim();
  const shown = path.length > MAX_SHOWN ? `${path.slice(0, MAX_SHOWN - 1)}…` : path;
  // the sentence is the lede (the line under the heading), so it is not repeated in the body
  const lede = (
    <>
      {shown ? (
        <>
          Адресът <code className="s30-path">{toHref('/' + shown)}</code>
        </>
      ) : (
        'Този адрес'
      )}{' '}
      не води до екран от сайта. Може да е изписан грешно или страницата да е преместена.
    </>
  );
  return {
    lede,
    body: (
      <>
        <div className="s30">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get('q');
              const q = (typeof value === 'string' ? value : '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, MAX_QUERY);
              navigation.go(routeHref('tarsene', {}, q ? { q } : {}));
            }}
            className="s30-find"
            role="search"
            aria-label="Търсене в сайта"
          >
            <label className="field-label" htmlFor="s30-q">
              Потърси това, което ти трябва
            </label>
            <div className="s30-bar">
              <input
                className="input s30-q"
                id="s30-q"
                name="q"
                type="search"
                maxLength={MAX_QUERY}
                placeholder="Търси: ДДС, МВР, Пловдив…"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck="false"
                enterKeyHint="search"
                data-search-field
              />
              <button type="submit" className="btn btn-primary s30-go">
                Търси
              </button>
            </div>
          </form>
          <h2 className="s30-h">Или тръгни от някое от тези места</h2>
          <ul className="s30-links">
            {START.map((id) => byId[id])
              .filter(Boolean)
              .map((r) => (
                <>
                  <li>
                    {linkCard({
                      href: routeHref(r.id),
                      title: r.title,
                      text: r.desc,
                      icon: r.icon,
                    })}
                  </li>
                </>
              ))}
          </ul>
        </div>
      </>
    ),
  };
}
