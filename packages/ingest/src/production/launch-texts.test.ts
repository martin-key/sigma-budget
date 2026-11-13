import { resolve } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { runGraph } from '../build/graph.js';
import { loadWave13bFixture } from '../build/wave13b-fixture.js';
import { wave13bStages } from '../build/wave13b.js';
import { LAUNCH_REVISIONS, reviseLaunchTexts } from './launch-texts.js';

const root = resolve(import.meta.dirname, '../../test/fixtures');
const used = new Set<string>();
let streams: Map<string, Uint8Array>;
const json = (name: string) => JSON.parse(Buffer.from(streams.get(name)!).toString());

// The frozen graph has the historical wording, so it shows that every revision still matches its builder text.
beforeAll(async () => {
  const graph = runGraph(
    reviseLaunchTexts(wave13bStages(await loadWave13bFixture(root)), LAUNCH_REVISIONS, used),
  );
  expect(graph.states.filter((state) => state.status !== 'success')).toEqual([]);
  streams = (graph.outputs.get('publication-layers') as { streams: Map<string, Uint8Array> })
    .streams;
}, 30_000);

it('applies every launch revision to the historical builder wording', () => {
  const expected = Object.entries(LAUNCH_REVISIONS).flatMap(([stage, revisions]) =>
    revisions.map((_, index) => `${stage}#${index}`),
  );
  expect([...used].sort()).toEqual(expected.sort());
});

it('publishes the final texts and derives the RSS feed and search index from them', () => {
  const p04 =
    'Последният месечен отчет в портала е за септември 2026 г. Отчетът за октомври 2026 г. не е включен.';
  expect(json('core.json').pending.P04.reason).toBe(p04);
  expect(json('core.json').meta.title).toBe(
    'Ядро: източници, показатели без данни и основни числа',
  );
  expect(json('feed.json').expected[0].note).toBe(p04);
  expect(
    json('catalog.json').datasets.find((dataset: { id: string }) => dataset.id === 'P04')
      .description,
  ).toBe(p04);
  const rss = Buffer.from(streams.get('feed.xml')!).toString();
  expect(rss).toContain('Данни от официални източници.');
  expect(rss).not.toMatch(/Прототип|отказ 403|още не е/);
  expect(JSON.stringify(json('search-index.json'))).not.toContain('Предстои · ');
  expect(json('debt.json').compare.note).not.toContain('експерт');
  expect(json('law.json').next.note).toContain('не е включена в портала');
  for (const name of ['glossary.json', 'guide.json'])
    expect(Buffer.from(streams.get(name)!).toString()).not.toContain('Бюджет на светло');
  expect(json('guide.json').credit).toBe('СИГМА Бюджет');
});

it('copies stage outputs, keeps bytes and rejects unknown stages', () => {
  const output = { text: 'стар текст', bytes: Buffer.from('стар текст'), list: ['стар'] };
  const [stage] = reviseLaunchTexts([{ id: 'a', requires: [], run: () => output }], {
    a: [['стар', 'нов']],
  });
  expect(stage!.run(() => undefined)).toEqual({
    text: 'нов текст',
    bytes: Buffer.from('стар текст'),
    list: ['нов'],
  });
  expect(output.text).toBe('стар текст');
  expect(() => reviseLaunchTexts([], { a: [] })).toThrow('unknown stage: a');
});
