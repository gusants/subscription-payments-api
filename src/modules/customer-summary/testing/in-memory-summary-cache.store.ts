import { randomUUID } from 'node:crypto';
import type { SummaryRecord } from '../customer-summary.js';
import { SummaryCacheStore } from '../summary-cache.store.js';

export class InMemorySummaryCacheStore extends SummaryCacheStore {
  readonly records = new Map<
    string,
    { record: SummaryRecord; ttlSeconds: number }
  >();
  private readonly locks = new Map<string, string>();
  private outage: Error | null = null;

  failWith(error: Error | null): void {
    this.outage = error;
  }

  find(key: string): Promise<SummaryRecord | null> {
    return this.guarded(() => this.records.get(key)?.record ?? null);
  }

  save(key: string, record: SummaryRecord, ttlSeconds: number): Promise<void> {
    return this.guarded(() => {
      this.records.set(key, { record, ttlSeconds });
    });
  }

  acquireLock(key: string): Promise<string | null> {
    return this.guarded(() => {
      if (this.locks.has(key)) return null;
      const token = randomUUID();
      this.locks.set(key, token);
      return token;
    });
  }

  releaseLock(key: string, token: string): Promise<void> {
    return this.guarded(() => {
      if (this.locks.get(key) === token) this.locks.delete(key);
    });
  }

  holdsLock(key: string): boolean {
    return this.locks.has(key);
  }

  private guarded<T>(operation: () => T): Promise<T> {
    return this.outage
      ? Promise.reject(this.outage)
      : Promise.resolve(operation());
  }
}
