import type { ReleaseReader } from '../release-types';
import type { EditorialScreenModel, TextScreenModel } from '../screen-state';
import type { CatalogModel } from './catalog-types';
import type { FileMeta } from './metadata-types';
import { textModel } from './text';
import * as C from '../../../client/catalog.js';

const META_LIMIT = 120000; // a set's file is read for its meta block only up to this size (apps/web/client/catalog.js loadMeta)

/** the model of S24: the catalogue (required), and on /danni/<set> what the passport reads besides it. An unknown set is the 404 screen. */
export async function catalogModel(
  params: Record<string, string>,
  query: Record<string, string>,
  reader: ReleaseReader,
): Promise<TextScreenModel> {
  const editorial = (await textModel('S26', params, query, reader)) as EditorialScreenModel;
  const model: CatalogModel = { ...editorial, screen: 'S24' };
  if (model.view !== 'ready') return model;
  try {
    model.catalog = await reader.load('catalog');
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    model.view = (e as Error).name === 'PendingError' ? 'pending' : 'error';
    return model;
  }
  const slug = String(params.set ?? '')
    .trim()
    .toLowerCase();
  if (!slug) return model;
  const M = C.model(model.catalog, (model.core as { sources?: object } | undefined)?.sources);
  const set = M.find(slug) as {
    stem: string | null;
    bytes: number | null;
    file: string;
    parts: unknown[];
  } | null;
  if (!set) return textModel('S30', { path: `danni/${params.set}` }, query, reader);
  model.fileMeta = { meta: null, state: 'skip' };
  if (set.stem) {
    const cached = reader.get?.<{ meta?: FileMeta }>(set.stem);
    if (cached || set.bytes == null || set.bytes <= META_LIMIT) {
      try {
        const document = cached || (await reader.load<{ meta?: FileMeta }>(set.stem));
        model.fileMeta = {
          meta: document?.meta && typeof document.meta === 'object' ? document.meta : null,
          state: 'ok',
        };
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        model.fileMeta = {
          meta: null,
          state: (e as Error).name === 'PendingError' ? 'pending' : 'error',
        };
      }
    }
  }
  if (!set.file && set.parts.length) {
    try {
      model.ministries = await reader.load('ministries');
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
    }
  }
  return model;
}
