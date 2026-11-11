import { viewUnit } from '../../../client/publication-query.js';
import { href } from '../legacy';
import type { EditorialCore } from '../editorial-types';
import type { ReleaseReader } from '../release-types';
import type { TextScreenModel } from '../screen-state';
import type { TextView } from '../../components/TextState';
import { html } from '../../../client/html.js';
import { byId } from '../legacy';
import { toHref } from '../../../client/loc.js';

export async function textModel(
  screen: TextScreenModel['screen'],
  params: Record<string, string>,
  query: Record<string, string>,
  reader: ReleaseReader,
): Promise<TextScreenModel> {
  if (screen === 'S14' || screen === 'S16')
    return (await import('./narrative')).narrativeModel(screen, params, query, reader);
  if (screen === 'S25' || screen === 'S35')
    return (await import('./metadata')).metadataModel(screen, params, query, reader);
  let core: EditorialCore = {},
    glossary: unknown = {};
  try {
    core = await reader.load<EditorialCore>('core');
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError')
      throw error; /* Editorial content remains usable without core. */
  }
  try {
    glossary = await reader.load('glossary');
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError')
      throw error; /* Plain text remains usable. */
  }
  const view: TextView = ['loading', 'empty', 'error', 'pending'].includes(query.demo)
    ? (query.demo as TextView)
    : 'ready';
  return { screen, params, query, view, core, glossary, release: reader.release };
}
/** Shared by the server and the temporary navigation adapter; no screen renderer. */
export async function textMetadata(model: TextScreenModel) {
  const law = model.screen === 'S14' ? await import('../../routes/zakon-content') : null;
  const feed = model.screen === 'S16' ? await import('../../routes/novo-content') : null;
  const api = model.screen === 'S25' ? await import('../../routes/api-content') : null;
  const proof = model.screen === 'S35' ? await import('../../routes/proverka-content') : null;
  const route = byId[model.screen],
    title = route.title,
    view = model.view || 'ready';
  const shown = String(model.params.path || '').trim(),
    path = shown.length > 80 ? shown.slice(0, 79) + '…' : shown;
  const lede =
    model.screen === 'S30' && view === 'ready'
      ? html`${
          path ? html`Адресът <code class="s30-path">${toHref('/' + path)}</code>` : 'Този адрес'
        }
        не води до екран от сайта. Може да е изписан грешно или страницата да е преместена.`
      : route.desc;
  const narrative =
    'content' in model && view === 'ready'
      ? model.screen === 'S14'
        ? law!.metadata({
            data: model.content,
            core: model.core,
            query: model.query,
            unit: viewUnit(model.query.unit) || 'eur',
            origin: model.release.origin,
            href,
          })
        : {
            lede: feed!.lede({
              data: model.content,
              core: model.core,
              query: model.query,
              unit: viewUnit(model.query.unit) || 'eur',
              origin: model.release.origin,
              href,
            }),
          }
      : undefined;
  return {
    route,
    params: model.params,
    query: model.query,
    demo: model.query.demo,
    view,
    title,
    question: narrative && model.screen === 'S14' ? law!.question : undefined,
    lede:
      narrative?.lede ??
      ('documents' in model && view === 'ready'
        ? (model.screen === 'S25' ? api!.render : proof!.render)({
            data: model.documents,
            core: model.core,
            query: model.query,
            failed: model.failed,
            fileMeta: model.fileMeta,
          }).lede
        : lede),
    answer:
      'documents' in model && model.screen === 'S35' && view === 'ready'
        ? proof!.render({
            data: model.documents,
            core: model.core,
            query: model.query,
            failed: model.failed,
          }).answer
        : '',

    crumbs: [{ label: 'Начало', href: toHref('/') }, { label: title }],
    mod: {
      styles: view === 'ready' || ('content' in model && !model.query.demo) ? [route.file] : [],
    },
  };
}
