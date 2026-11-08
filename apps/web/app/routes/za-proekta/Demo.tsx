import { useState } from 'react';
import { GROUPS, ROUTES, byKey, href } from '../../lib/legacy';

const DEMOS = [
  {
    key: 'loading',
    label: 'Зареждане',
    text: 'Какво вижда посетителят, докато данните още идват.',
  },
  {
    key: 'empty',
    label: 'Празно',
    text: 'Какво вижда, когато избраният изглед няма какво да покаже.',
  },
  {
    key: 'error',
    label: 'Грешка',
    text: 'Какво се случва, когато данните не могат да се заредят. Има бутон „Опитай пак“.',
  },
  {
    key: 'pending',
    label: 'Предстои',
    text: 'За данни, които още не са извлечени. Без измислено число.',
  },
  {
    key: 'offline',
    label: 'Без връзка',
    text: 'Екранът остава, а най-горе пише, че няма връзка и от кога са запазените данни.',
  },
];
const MENU = GROUPS.filter((g) => g.id !== 'util')
  .map((g) => ({ label: g.label, items: ROUTES.filter((r) => r.group === g.id && r.nav) }))
  .filter((g) => g.items.length);
const DEFAULT_SCREEN = 'prihodi';
let lastScreen = DEFAULT_SCREEN; // the choice survives a re-render (a switch in the top bar redraws the page)

export function useDemoScreen() {
  return useState(lastScreen);
}

export function Demo({
  screenKey,
  setScreen,
  announce,
}: {
  screenKey: string;
  setScreen: (key: string) => void;
  announce: (message: string) => void;
}) {
  const r = byKey[screenKey] || byKey[DEFAULT_SCREEN];
  return (
    <>
      <p>
        Всеки екран може да се види и без данни: със зареждане, с грешка, без връзка. Добави{' '}
        <code>?demo=</code> и името на състоянието в края на адреса на кой да е екран или избери
        екран тук.
      </p>
      <div className="field s26-demo-field">
        <label className="field-label" htmlFor="s26-demo-screen">
          На кой екран да се покаже?
        </label>
        <span className="select">
          <select
            id="s26-demo-screen"
            value={screenKey}
            onChange={(e) => {
              lastScreen = e.target.value;
              setScreen(lastScreen);
              announce(`Връзките сочат към „${byKey[lastScreen].title}“.`);
            }}
            aria-describedby="s26-demo-hint"
          >
            {MENU.map((g) => (
              <>
                <optgroup label={g.label}>
                  {g.items.map((x) => (
                    <>
                      <option value={x.key}>{x.title}</option>
                    </>
                  ))}
                </optgroup>
              </>
            ))}
          </select>
        </span>
        <p className="field-hint" id="s26-demo-hint">
          Връзките по-долу се сменят с избора. Връщаш се с бутона „назад“ на браузъра.
        </p>
      </div>
      <ul className="s26-demo-list" role="list">
        {DEMOS.map((d) => (
          <>
            <li className="s26-demo-item">
              <a
                className="btn s26-demo-link"
                href={href(r.key, {}, { demo: d.key })}
                data-s26-demo={d.key}
              >
                {d.label}
                <span className="sr-only">
                  {' '}
                  на „<span data-s26-name>{r.title}</span>“
                </span>
              </a>
              <p className="s26-demo-text">
                {d.text} <code className="s26-demo-code">{'?demo=' + d.key}</code>
              </p>
            </li>
          </>
        ))}
      </ul>
    </>
  );
}
