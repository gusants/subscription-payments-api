export const SUMMARY_CACHE_OPTIONS = Symbol('SUMMARY_CACHE_OPTIONS');

export interface SummaryCacheOptions {
  ttlSeconds: number;
  fallbackTtlSeconds: number;
  lockSeconds: number;
  waitMs: number;
  pollMs: number;
  promptVersion: string;
  model: string;
}
