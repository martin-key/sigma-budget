import type { ReleaseReader } from '../release-types';
import type {
  NarrativeModel,
  NarrativeCore,
  LawDocument,
  MinistryDocument,
} from './narrative-types';
import { textModel } from './text';
import { byId } from '../legacy';
import { PERIODS, DEFAULT_PERIOD } from '../../../client/store.js';
export async function narrativeModel(
  screen: NarrativeModel['screen'],
  params: Record<string, string>,
  query: Record<string, string>,
  reader: ReleaseReader,
): Promise<NarrativeModel> {
  const editorial = await textModel('S26', params, query, reader);
  const period =
    PERIODS.find((p) => p.key === query.per) || PERIODS.find((p) => p.key === DEFAULT_PERIOD)!;
  const model: NarrativeModel = { ...editorial, screen, content: {}, period, failed: [] };
  if (model.view !== 'ready') return model;
  const load = async <T>(name: string, required = false): Promise<T | undefined> => {
    try {
      return await reader.load<T>(name);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      const pending = (e as Error).name === 'PendingError';
      if (!pending) model.failed.push(name);
      if (required && model.view !== 'error') model.view = pending ? 'pending' : 'error';
      return undefined;
    }
  };
  model.core = (await load<NarrativeCore>('core', true)) || model.core;
  if (screen === 'S14') {
    [model.content.law, model.content.ministries] = await Promise.all([
      load<LawDocument>('law', true),
      load<MinistryDocument>('ministries'),
    ]);
    if (!(byId.S14.periods as string[]).includes(period.key)) {
      model.unsupported = true;
      model.view = 'empty';
    }
  } else model.content.feed = await load('feed', true);
  return model;
}
