import type { EditorialCore } from './editorial-types';
import type { TextView } from '../components/TextState';
import type { ReleaseIdentity } from './release-types';
export interface EditorialScreenModel {
  screen: 'S26' | 'S30';
  view?: TextView;
  params: Record<string, string>;
  query: Record<string, string>;
  core: EditorialCore;
  glossary: unknown;
  release: ReleaseIdentity;
}
export interface Navigation {
  setQuery?(values: Record<string, string>): void;
  go(href: string): void;
  retry?(): void;
  openGlossary?(anchor: HTMLElement, slug: string): void;
  announce(message: string): void;
}

export type TextScreenModel =
  | EditorialScreenModel
  | import('./screens/metadata-types').MetadataModel;
