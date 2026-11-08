import type { ReactNode } from 'react';
import type { EditorialScreenModel } from '../screen-state';
export interface CatalogueSet {
  id: string;
  slug: string;
  title: string;
  file: string;
  stem: string | null;
  ext: string;
  template: string;
  desc: string;
  status: string;
  mock: boolean;
  bytes: number | null;
  gz: number | null;
  format: string;
  mediaType: string;
  asOf: string;
  period: string;
  unit: string;
  parts: { file: string; bytes: number | null }[];
  schema: { key: string; type: string; length: number | null }[];
}
export interface Catalogue {
  sets: CatalogueSet[];
  groups: { label: string; sets: CatalogueSet[] }[];
  counts: { files: number };
  meta: { asOf?: string };
  bySlug: Map<string, CatalogueSet>;
  find(key: string): CatalogueSet | null;
}
export interface FileMeta {
  realFields?: string[];
  modelFields?: string[];
  constrainedBy?: string[];
  seed?: number;
  [key: string]: unknown;
}
export interface Manifest {
  processing?: {
    parameters?: { build_date?: string };
    command?: string;
    code?: { repository?: string; commit?: string };
    environment?: {
      dockerfile?: string;
      dockerfile_sha256?: string;
      lock?: string;
      lock_sha256?: string;
    };
    registries?: Record<string, string>;
  };
  coverage?: {
    latest?: string | Record<string, string>;
    datasets?: {
      dataset: string;
      status: string;
      period: string;
      unit: string;
      rebuiltByThisRelease?: boolean;
      scope?: string;
      limitations?: string[];
    }[];
    missingInputs?: { path: string; datasets?: string[] }[];
  };
  inputs?: ReleaseFile[];
  outputs?: ReleaseFile[];
  data_schema?: Record<string, string>;
}
export interface ReleaseFile {
  path: string;
  mime: string;
  bytes: number;
  sha256: string;
}
export interface JournalEntry {
  release_id: string;
  revision: number;
  kind: string;
  at: string;
  role: string;
  by: string;
}
export interface Validation {
  passed?: boolean;
  groups?: { group: string; status: string; summary: string }[];
}
export interface MetadataModel extends Omit<EditorialScreenModel, 'screen'> {
  screen: 'S25' | 'S35';
  documents: {
    catalog?: unknown;
    'releases/current'?: { release_id?: string };
    'release/manifest'?: Manifest;
    'release/validation'?: Validation;
    'release/journal'?: { items: JournalEntry[] } | null;
  };
  fileMeta?: { meta: FileMeta | null; state: string };
  failed: string[];
  registry: boolean;
}
export interface MetadataContext {
  newer?: string;
  origin?: string;
  dataBase?: string;
  data: MetadataModel['documents'];
  core: MetadataModel['core'];
  query: Record<string, string>;
  failed: string[];
  fileMeta?: MetadataModel['fileMeta'];
}
export type Cell = ReactNode;
