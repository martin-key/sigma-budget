import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AboutContent } from './about-content';
import { legendBody } from '../components/Status';
import { TextState } from '../components/TextState';
import { pendingState } from '../components/NarrativeUI';
import { pendingState as legacyPending } from '../../client/ui/states.js';
import core from './__fixtures__/core.json';

it('removes planning sections and their links from the public about page', () => {
  const html = renderToStaticMarkup(<AboutContent core={core} glossary={{}} />);
  expect(html).not.toMatch(
    /s26-roadmap|s26-questions|data-s26-demo|Пътна карта|работна група|Следващи стъпки|още не е извлечен/,
  );
  expect(html).toContain('Текстовете и данните');
  expect(html).toContain('Още два слоя');
  expect(html).toContain('Официални източници');
});

it('keeps pending identifiers while hiding acquisition notes and supplied future copy', () => {
  const title = 'Тестов показател';
  const internal = 'Вътрешна бележка за извличането';
  const o = { id: 'P01', title, text: internal, reason: internal, expected: internal };
  const states = [
    String(legacyPending(o)),
    renderToStaticMarkup(pendingState(o, { pending: { P01: o } })),
    renderToStaticMarkup(<TextState view="pending" title={title} />),
  ];
  for (const html of states) {
    expect(html).toContain('data-state="pending"');
    expect(html).toContain(title);
    expect(html).toContain('Няма данни');
    expect(html).toContain('Не показваме число без налични официални данни за този показател.');
    expect(html).not.toContain(internal);
    expect(html).not.toContain('Предстои');
  }
  expect(states[0]).toContain('data-pending-id="P01"');
  expect(states[1]).toContain('data-pending-id="P01"');
  const legend = renderToStaticMarkup(legendBody());
  expect(legend).toContain('Няма данни');
  expect(legend).not.toMatch(/Предстои|Примерни данни|не са извлечени/);
});
