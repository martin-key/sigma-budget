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
  return {
    route,
    params: model.params,
    query: model.query,
    demo: model.query.demo,
    view,
    title,
    lede,
    crumbs: [{ label: 'Начало', href: toHref('/') }, { label: title }],
    mod: { styles: view === 'ready' ? [route.file] : [] },
  };
}
