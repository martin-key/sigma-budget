// Narrow boundaries for legacy JS during the incremental migration.
import { data as legacyData } from '../../client/data.js';
import { store as legacyStore } from '../../client/store.js';
import {
  byId as legacyById,
  byKey as legacyByKey,
  href as legacyHref,
} from '../../client/routes.js';
import {
  date as legacyDate,
  num as legacyNum,
  plural as legacyPlural,
} from '../../client/format.js';
import { serverScope as legacyScope } from '../../client/env.js';
import {
  index as legacyIndex,
  patterns as legacyPatterns,
  find as legacyFind,
} from '../../client/glossary-scan.js';
import type { EditorialCore } from './editorial-types';
import type { WebRoute } from './routes';
export { ROUTES, GROUPS } from './routes';
export type QueryValues = Record<string, string | number | boolean | null | undefined>;
export type PathValues = Record<string, string | number>;
export const byId: Readonly<Record<string, WebRoute>> = legacyById;
export const byKey: Readonly<Record<string, WebRoute>> = legacyByKey;
export const href = legacyHref as (key: string, params?: PathValues, query?: QueryValues) => string;
export const date = legacyDate as (iso: string | undefined, long?: boolean) => string;
export const num = legacyNum as (value: number | undefined, decimals?: number) => string;
export const plural = legacyPlural as (
  value: number | undefined,
  one: string,
  many: string,
) => string;
export interface Period {
  label: string;
}
export const store = legacyStore as { readonly period: Period; periodParam(): string | null };
interface LegacyData {
  get(name: 'core'): EditorialCore | undefined;
  get(name: string): unknown;
  load<T = unknown>(name: string, options?: { signal?: AbortSignal }): Promise<T>;
}
export const data: LegacyData = legacyData;
export const serverScope = legacyScope as () => { sigmaUrl?: string } | null;
interface GlossaryIndex {
  by: ReadonlyMap<string, unknown>;
}
export interface GlossaryPattern {
  slug: string;
  re: RegExp;
}
export const index = legacyIndex as (document: unknown) => GlossaryIndex;
export const patterns = legacyPatterns as (index: GlossaryIndex) => GlossaryPattern[];
export const find = legacyFind as (
  pattern: GlossaryPattern,
  text: string,
) => RegExpExecArray | null;
