import { expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { index, link } from '../../client/glossary-scan.js';
import glossary from '../../../../data/release/glossary.json';

it('preserves the text, links each term once, respects links and buttons, and is idempotent', () => {
  const { document } = parseHTML(
    '<article data-gl-scan><p>ДДС и БВП.</p><p>ДДС и БВП отново.</p><p><a href="#/pari">КФП</a> <button>акциз</button></p></article>',
  );
  const root = document.querySelector('article')!;
  const text = root.textContent;
  link(root, index(glossary));
  expect(root.textContent).toBe(text);
  expect([...root.querySelectorAll('a[data-gl]')].map((a) => a.getAttribute('href'))).toEqual([
    '#/rechnik/dds',
    '#/rechnik/bvp',
  ]);
  expect(root.querySelector('a[href="#/pari"]')!.innerHTML).toBe('КФП');
  expect(root.querySelector('button')!.innerHTML).toBe('акциз');
  const html = root.innerHTML;
  link(root, index(glossary));
  expect(root.innerHTML).toBe(html);
});
