import { narrativeModel } from './narrative';
import { metadata as lawMetadata, question as lawQuestion } from '../../routes/zakon-content';
import { lede as feedLede } from '../../routes/novo-content';
import { href } from '../legacy';
import { metadataModel } from './metadata';
import { render as apiContent } from '../../routes/api-content';
import { render as proofContent } from '../../routes/proverka-content';
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
  if (screen === 'S14' || screen === 'S16') return narrativeModel(screen, params, query, reader);
  if (screen === 'S25' || screen === 'S35') return metadataModel(screen, params, query, reader);
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
export function textMetadata(model: TextScreenModel) {
  const route = byId[model.screen],
    title = route.title,
    view = model.view || 'ready';
  const shown = String(model.params.path || '').trim(),
    path = shown.length > 80 ? shown.slice(0, 79) + '…' : shown;
  const lede =
    model.screen === 'S30' && view === 'ready'
      ? html`${path
          ? html`Адресът <code class="s30-path">${toHref('/' + path)}</code>`
          : 'Този адрес'}
        не води до екран от сайта. Може да е изписан грешно или страницата да е преместена.`
      : route.desc;
  const narrative =
    'content' in model && view === 'ready'
      ? model.screen === 'S14'
        ? lawMetadata({
            data: model.content,
            core: model.core,
            query: model.query,
            unit: 'eur',
            origin: model.release.origin,
            href,
          })
        : {
            lede: feedLede({
              data: model.content,
              core: model.core,
              query: model.query,
              unit: 'eur',
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
    question: narrative && model.screen === 'S14' ? lawQuestion : undefined,
    lede:
      narrative?.lede ??
      ('documents' in model && view === 'ready'
        ? (model.screen === 'S25' ? apiContent : proofContent)({
            data: model.documents,
            core: model.core,
            query: model.query,
            failed: model.failed,
            fileMeta: model.fileMeta,
          }).lede
        : lede),
    answer:
      'documents' in model && model.screen === 'S35' && view === 'ready'
        ? proofContent({
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
