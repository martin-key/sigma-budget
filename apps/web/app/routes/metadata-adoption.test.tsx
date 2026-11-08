// @vitest-environment jsdom
import { rejectReactKeyWarnings } from './metadata-test-warnings';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { MigratedScreen } from '../migration/registry';
import { textModel } from '../lib/screens/text';
import type { MetadataModel } from '../lib/screens/metadata-types';
import inputs from './__fixtures__/metadata-inputs.json';
import manifest from './__fixtures__/metadata-manifest.json';
import { headers, handle } from './proverka';
vi.mock('../../client/loc.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toHref: (s: string) => s,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const release = {
  id: manifest.releaseId,
  dataBase: '/data/',
  origin: manifest.origin,
  sigmaUrl: '',
  feedbackEmail: '',
};
const docs: Record<string, unknown> = inputs;
const load = async <T,>(name: string): Promise<T> => {
  if (!(name in docs)) throw Error(name);
  return docs[name] as T;
};
for (const screen of ['S25', 'S35'] as const)
  it(`${screen} adopts server nodes and owns its controls`, async () => {
    const model = await textModel(screen, {}, {}, { release, load });
    const setQuery = vi.fn(),
      go = vi.fn(),
      announce = vi.fn();
    const errors: unknown[] = [];
    const tree = <MigratedScreen model={model} navigation={{ go, announce, setQuery }} />;
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToString(tree);
    const heading = container.querySelector('h1'),
      section = container.querySelector('section');
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError: (e) => errors.push(e) });
    });
    expect(container.querySelector('h1')).toBe(heading);
    expect(container.querySelector('section')).toBe(section);
    expect(errors).toEqual([]);
    if (screen === 'S25') {
      const select = container.querySelector('select')!;
      await act(async () => {
        select.value = 'execution';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(setQuery).toHaveBeenCalledExactlyOnceWith({ set: 'execution' });
      expect(go).not.toHaveBeenCalled();
    } else {
      const button = container.querySelector('.png-btn')!;
      expect(button.getAttribute('aria-label')).toContain(
        'Изтегли изображение: Наборите в изданието',
      );
      expect(button.textContent).toBe('Изображение');
    }
    const details = container.querySelector('details')!;
    details.open = true;
    await act(async () => root!.render(tree));
    expect(details.open).toBe(true);
    await act(async () => root!.unmount());
    container.remove();
  });
it('journal is live metadata with a short route TTL', () => {
  expect(handle.cache.ttl).toBe(60);
  expect(headers()['Cache-Control']).toContain('s-maxage=60');
});
it('registry outage differs from an environment without a registry', async () => {
  const local = (await textModel('S35', {}, {}, { release, load })) as MetadataModel;
  expect(local.registry).toBe(false);
  expect(local.failed).not.toContain('release/journal');
  const registry = (await textModel(
    'S35',
    {},
    {},
    { release: { ...release, dataBase: `/data/releases/${release.id}/data/` }, load },
  )) as MetadataModel;
  expect(registry.registry).toBe(true);
  expect(registry.failed).toContain('release/journal');
  expect(
    renderToString(<MigratedScreen model={registry} navigation={{ go() {}, announce() {} }} />),
  ).toContain('Журналът на публикуванията не може да се зареди');
});
it('an aborted catalogue request cannot render stale data', async () => {
  await expect(
    textModel(
      'S25',
      {},
      {},
      {
        release,
        load: async () => {
          throw new DOMException('cancelled', 'AbortError');
        },
      },
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
});
it('missing required catalogue is an error; missing file metadata preserves the catalogue', async () => {
  const absent = await textModel(
    'S25',
    {},
    {},
    {
      release,
      load: async <T,>(name: string): Promise<T> => {
        if (name === 'catalog') throw Error('offline');
        return load<T>(name);
      },
    },
  );
  expect(absent.view).toBe('error');
  const optional = await textModel('S25', {}, { set: 'revenue' }, { release, load });
  expect(optional.view).toBe('ready');
  expect((optional as MetadataModel).fileMeta?.state).toBe('error');
});

it('already cached metadata remains available for a large selected file', async () => {
  const model = (await textModel(
    'S25',
    {},
    { set: 'search-index' },
    {
      release,
      load,
      get: <T,>(name: string) =>
        name === 'search-index' ? ({ meta: inputs.core.meta } as T) : undefined,
    },
  )) as MetadataModel;
  expect(model.fileMeta?.state).toBe('ok');
  expect(model.fileMeta?.meta).toEqual(inputs.core.meta);
});

it('live release notice keeps its server position, the pinned data and abort cleanup', async () => {
  const current = 'f'.repeat(64);
  let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => {
    signal = options.signal as AbortSignal;
    return new Response(JSON.stringify({ release_id: current, revision: 2 }));
  });
  const model = (await textModel('S35', {}, {}, { release, load })) as MetadataModel;
  model.registry = true;
  const tree = <MigratedScreen model={model} navigation={{ go() {}, announce() {} }} />;
  const container = document.createElement('div');
  document.body.appendChild(container);
  container.innerHTML = renderToString(tree);
  let root: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => {
      root = hydrateRoot(container, tree);
    });
    const notice = container.querySelector<HTMLElement>('[data-s35-newer]')!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain(current.slice(0, 12));
    expect(notice.closest('section')?.getAttribute('aria-labelledby')).toBe('s35-release');
    expect(container.querySelector('.s35-rid')?.textContent).toBe(release.id);
  } finally {
    await act(async () => root!.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
  expect(signal?.aborted).toBe(true);
});

rejectReactKeyWarnings();

for (const [set, file] of [
  ['execution', 'execution.json'],
  ['ministries-programs', 'ministries/0200.json'],
  ['feed-rss', 'feed.xml'],
])
  it(`${set} uses the session's non-current release in downloads, copied address and every code example`, async () => {
    const id = 'a'.repeat(64);
    expect(id).not.toBe(manifest.releaseId);
    const pinned = { ...release, id, dataBase: `/data/releases/${id}/data/` };
    const model = await textModel('S25', {}, { set }, { release: pinned, load });
    const container = document.createElement('div');
    container.innerHTML = renderToString(
      <MigratedScreen model={model} navigation={{ go() {}, announce() {} }} />,
    );
    const path = pinned.dataBase + file,
      url = release.origin + path;
    expect(container.querySelector('#s25-addr')?.textContent).toBe(url);
    expect(container.querySelector('.s25-actions a[download]')?.getAttribute('href')).toBe(path);
    for (const code of ['curl', 'py', 'js'])
      expect(container.querySelector(`#s25-c-${code}`)?.textContent).toContain(url);
    expect(container.querySelector('#s25-read')?.textContent).not.toContain(
      `${release.origin}/data/${file}`,
    );
  });
