import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/etl/src or apps/etl/dist -> the root of this checkout, whichever folder the command is started from. */
export const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
