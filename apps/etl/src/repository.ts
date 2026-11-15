import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/etl/src or apps/etl/dist -> the root of this checkout, whichever folder the command is started from. */
export const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

/** Release operator receipts of a checkout: its ignored /work/ folder. */
export const operatorReceipts = (root: string) => join(root, 'work/ts-operator-receipts');
