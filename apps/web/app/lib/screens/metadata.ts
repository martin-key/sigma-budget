import type { ReleaseReader } from '../release-types';
import type { MetadataModel, Catalogue } from './metadata-types';
import { textModel } from './text';
import * as C from '../../../client/catalog.js';
export async function metadataModel(
  screen: MetadataModel['screen'],
  params: Record<string, string>,
  query: Record<string, string>,
  reader: ReleaseReader,
): Promise<MetadataModel> {
  const editorial = await textModel('S26', params, query, reader);
  const model: MetadataModel = {
    ...editorial,
    screen,
    documents: {},
    failed: [],
    registry: reader.release.dataBase.startsWith('/data/releases/'),
  };
  const load = async <T>(name: string, required = false): Promise<T | undefined> => {
    try {
      return await reader.load<T>(name);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      const pending = (e as Error).name === 'PendingError';
      if (!pending) model.failed.push(name);
      if (required) model.view = pending ? 'pending' : 'error';
      return undefined;
    }
  };
  if (model.view !== 'ready') return model;
  if (screen === 'S25') {
    model.documents.catalog = await load('catalog', true);
    const catalogue: Catalogue = C.model(model.documents.catalog, undefined);
    const requested = catalogue.find(query.set || '');
    const set =
      requested && (requested.file || requested.parts.length)
        ? requested
        : catalogue.sets.find((s) => s.file || s.parts.length);
    const part = set?.parts[0],
      stem = part && !set?.file ? C.stemOf(part.file) : set?.stem;
    const bytes = part && !set?.file ? part.bytes : set?.bytes;
    model.fileMeta = { meta: null, state: 'skip' };
    const cached = stem
      ? reader.get?.<{ meta?: import('./metadata-types').FileMeta }>(stem)
      : undefined;
    if (stem && (cached || bytes == null || bytes <= 120000)) {
      const document = cached || (await load<{ meta?: import('./metadata-types').FileMeta }>(stem));
      model.fileMeta = { meta: document?.meta || null, state: document ? 'ok' : 'error' };
    }
  } else {
    model.documents['releases/current'] = await load('releases/current', true);
    model.documents['release/manifest'] = await load('release/manifest', true);
    model.documents['release/validation'] = await load('release/validation');
    if (model.registry) model.documents['release/journal'] = await load('release/journal');
    if (
      model.view === 'ready' &&
      !/^[0-9a-f]{64}$/.test(model.documents['releases/current']?.release_id || '')
    )
      model.view = 'error';
  }
  return model;
}
