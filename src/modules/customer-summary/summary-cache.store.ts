import type { SummaryRecord } from './customer-summary.js';

export abstract class SummaryCacheStore {
  abstract find(key: string): Promise<SummaryRecord | null>;
  abstract save(
    key: string,
    record: SummaryRecord,
    ttlSeconds: number,
  ): Promise<void>;
  abstract acquireLock(key: string, ttlSeconds: number): Promise<string | null>;
  abstract releaseLock(key: string, token: string): Promise<void>;
}
