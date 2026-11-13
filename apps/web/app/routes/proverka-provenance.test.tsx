import { afterEach, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { MigratedScreen } from '../migration/registry';
import { textModel } from '../lib/screens/text';
import { build, frameHtml } from '../../client/render.js';
import { byId } from '../lib/legacy';
import { provideScope } from '../../client/env.js';
import { requestState } from '../../client/store.js';
import inputs from './__fixtures__/metadata-inputs.json';
import manifest from './__fixtures__/metadata-manifest.json';

const release = {
  id: manifest.releaseId,
  dataBase: '/data/',
  origin: manifest.origin,
  sigmaUrl: '',
  feedbackEmail: '',
};
afterEach(() => provideScope(() => null));

it('distinguishes preserved intermediates from source inputs without overstating reconstruction', async () => {
  const docs: Record<string, unknown> = structuredClone(inputs);
  const files = [
    { path: 'data/originals/table.pdf', kind: 'source', label: 'източников' },
    { path: 'data/inputs/capture.json', kind: 'intermediate', label: 'междинен' },
    { path: 'data/inputs/older.json', label: 'непосочен' },
    { path: 'data/inputs/other.json', kind: 'future-kind', label: 'future-kind' },
  ];
  docs['release/manifest'] = {
    ...inputs['release/manifest'],
    inputs: files.map(({ path, kind }) => ({
      path,
      kind,
      mime: 'application/octet-stream',
      bytes: 123,
      sha256: 'a'.repeat(64),
    })),
    coverage: {
      datasets: [
        {
          dataset: 'captured',
          status: 'real',
          period: '2026',
          unit: '€',
          rebuiltByThisRelease: true,
          limitations: ['Historical original missing; preserved reader capture used.'],
        },
        {
          dataset: 'p04',
          status: 'pending',
          period: '2026',
          unit: '',
          files: [],
          reason: 'Отчетът не е публикуван от източника.',
        },
      ],
    },
  };
  const load = async <T,>(name: string): Promise<T> => docs[name] as T;
  const url = new URL('/proverka', release.origin);
  const scope = { url, origin: url.origin, data: new Map(), state: requestState(null), load };
  provideScope(() => scope);
  const model = await textModel('S35', {}, {}, { release, load });
  const htmls = [
    renderToString(<MigratedScreen model={model} navigation={{ go() {}, announce() {} }} />),
    String(frameHtml(await build(byId.S35, {}, {}))),
  ];
  for (const html of htmls) {
    const doc = parseHTML(html).document;
    const text = doc.querySelector('article')!.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('4 входни файла');
    expect(text).toContain('Входни файлове (4)');
    expect(text).toContain(
      'Манифестът посочва източникови (1) и междинни (1) файлове, както и 2 с друг или непосочен тип.',
    );
    expect(text).toContain(
      'Пресглобяването с тях не доказва възстановяване от първоначалните източници.',
    );
    expect(text).toContain('Historical original missing; preserved reader capture used.');
    expect(text).toContain('включително запазените междинни данни');
    expect(text).not.toMatch(/4 оригинала|Сглобен от оригиналите|сваля оригиналите му/);
    expect(doc.querySelector('#s35-sets thead th:last-child')!.textContent).toBe(
      'Пресглобен в това издание',
    );
    expect(doc.querySelector('#s35-sets tbody td:last-child')!.textContent).toBe('да');
    const pendingRow = doc.querySelectorAll('#s35-sets tbody tr')[1]!;
    expect(pendingRow.lastElementChild!.textContent).toBe('—');
    expect(pendingRow.textContent).toContain('Отчетът не е публикуван от източника.');
    const rows = [...doc.querySelectorAll('#s35-in tbody tr')];
    expect(rows).toHaveLength(4);
    rows.forEach((row, i) => {
      expect(row.children[1].textContent).toBe(files[i].label);
      const link = row.querySelector('a')!;
      expect(link.getAttribute('href')).toBe(`/data/releases/${release.id}/${files[i].path}`);
      expect(link.getAttribute('download')).toBe(files[i].path.split('/').pop());
      expect(row.querySelector('code')!.getAttribute('title')).toBe('a'.repeat(64));
    });
  }
});
