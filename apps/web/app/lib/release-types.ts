export type * from '@sigma-budget/dataset-schema';
export interface ReleaseIdentity {
  id: string;
  dataBase: string;
  origin: string;
  sigmaUrl: string;
  feedbackEmail: string;
}
export interface ReleaseReader {
  get?<T = unknown>(name: string): T | undefined;
  release: ReleaseIdentity;
  load<T = unknown>(name: string, options?: { signal?: AbortSignal }): Promise<T>;
}
