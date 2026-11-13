/** Node-only client for the existing budget-release/1 Worker protocol. */
export type ExitCode = 2 | 3 | 4 | 5 | 6;
export class ReleaseError extends Error {
  constructor(
    public readonly code: ExitCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ReleaseError';
  }
}
export interface ReleaseFile {
  path: string;
  sha256: string;
  bytes: number;
  mime: string;
  role?: string;
  [key: string]: unknown;
}
export interface ReleaseManifest {
  manifest_schema: 'budget-release/1';
  data_schema: Record<string, unknown>;
  processing: { code: { commit: string }; [key: string]: unknown };
  inputs: ReleaseFile[];
  outputs: ReleaseFile[];
  [key: string]: unknown;
}
export interface ReleaseEnvironment {
  /** Explicit logical name and one origin for every public and admin request. */
  name: string;
  url: string;
}
export type AccessCredentials =
  | { accessToken: string; clientId?: never; clientSecret?: never }
  | { clientId: string; clientSecret: string; accessToken?: never };
export type CredentialProvider = (
  environment: Readonly<ReleaseEnvironment>,
) => AccessCredentials | Promise<AccessCredentials>;
export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  headers: Readonly<Record<string, string>>;
  body?: Uint8Array;
  timeoutMs: number;
  maxResponseBytes: number;
}
export interface HttpResponse {
  status: number;
  body: Uint8Array;
}
/** Injected transports must not follow redirects or log headers/bodies. */
export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;
export interface CurrentRelease {
  release_id: string | null;
  revision: number;
}
export type ChangeKind = 'publish' | 'rollback';
export interface PublishResult {
  release_id: string;
  previous_release_id: string | null;
  revision: number;
  kind: ChangeKind;
  request_id: string;
  at: string;
  replay?: boolean;
}
export interface PackageOptions {
  release: string;
  originals: string;
  /** Match the intended environment. Does not change any Worker setting. */
  maxObjectBytes?: number;
}
export interface UploadOptions extends PackageOptions {
  dryRun?: boolean;
}
export interface PublishOptions extends UploadOptions {
  expectedRevision?: number;
}
export interface RollbackOptions {
  releaseId: string;
  expectedRevision?: number;
  dryRun?: boolean;
}
export interface ClientOptions {
  environment: ReleaseEnvironment;
  receiptDirectory: string;
  credentials?: CredentialProvider;
  transport?: HttpTransport;
  maxObjectBytes?: number;
  timeoutMs?: number;
  /** Retries only idempotent reads, object PUT and seal. Default 3, maximum 5. */
  attempts?: number;
  retryDelay?: (attempt: number) => Promise<void>;
}
export const SHA256 = /^[0-9a-f]{64}$/;
export const REQUEST_ID = /^[A-Za-z0-9-]{16,64}$/;
export const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MANIFEST_LIMIT = 4 * 1024 * 1024;
export const DEFAULT_OBJECT_LIMIT = 50 * 1024 * 1024;
/** R2 multipart: every part but the last has at least 5 MiB, so a server's part_bytes is never smaller */
export const MIN_PART_BYTES = 5 * 1024 * 1024;
export const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const revision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
export function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ReleaseError(2, 'Expected valid UTF-8 JSON');
  }
}
