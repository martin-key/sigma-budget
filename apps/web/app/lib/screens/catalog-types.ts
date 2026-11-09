import type { EditorialScreenModel } from '../screen-state';
import type { FileMeta } from './metadata-types';
/** S24 · Откъде са данните?: the catalogue, and for the passport of one set its file's meta block and the names of the ministries of its parts */
export interface CatalogModel extends Omit<EditorialScreenModel, 'screen'> {
  screen: 'S24';
  catalog?: unknown;
  fileMeta?: { meta: FileMeta | null; state: string };
  ministries?: { items?: { id?: string | number; short?: string; name?: string }[] };
}
