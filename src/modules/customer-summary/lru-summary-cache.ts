import type { Clock } from '../../shared/clock/clock.js';
import type { SummaryRecord } from './customer-summary.js';

const MILLISECONDS_PER_SECOND = 1000;

interface Entry {
  record: SummaryRecord;
  expiresAt: number;
}

export class LruSummaryCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxEntries: number,
    private readonly clock: Clock,
  ) {}

  find(key: string): SummaryRecord | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    if (entry.expiresAt <= this.clock.now().getTime()) return null;
    this.entries.set(key, entry);
    return entry.record;
  }

  save(key: string, record: SummaryRecord, ttlSeconds: number): void {
    this.entries.delete(key);
    this.entries.set(key, {
      record,
      expiresAt:
        this.clock.now().getTime() + ttlSeconds * MILLISECONDS_PER_SECOND,
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }
}
