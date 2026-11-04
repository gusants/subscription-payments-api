import { randomUUID } from 'node:crypto';
import {
  type AcquireResult,
  type IdempotencyRecord,
  IdempotencyStore,
  type StoredResponse,
} from '../idempotency.store.js';

type Operation = 'acquire' | 'complete' | 'release';
type Entry = { record: IdempotencyRecord; lockToken?: string };

export class InMemoryIdempotencyStore extends IdempotencyStore {
  readonly entries = new Map<string, Entry>();
  readonly failingOperations = new Set<Operation>();

  async acquire(key: string, fingerprint: string): Promise<AcquireResult> {
    this.throwIfFailing('acquire');
    const existing = this.entries.get(key);
    if (existing) {
      return { acquired: false, existing: existing.record };
    }
    const lockToken = randomUUID();
    this.entries.set(key, {
      record: { state: 'in_progress', fingerprint },
      lockToken,
    });
    return { acquired: true, lockToken };
  }

  async complete(
    key: string,
    lockToken: string,
    fingerprint: string,
    response: StoredResponse,
  ): Promise<void> {
    this.throwIfFailing('complete');
    if (this.entries.get(key)?.lockToken === lockToken) {
      this.entries.set(key, {
        record: { state: 'completed', fingerprint, response },
      });
    }
  }

  async release(key: string, lockToken: string): Promise<void> {
    this.throwIfFailing('release');
    if (this.entries.get(key)?.lockToken === lockToken) {
      this.entries.delete(key);
    }
  }

  private throwIfFailing(operation: Operation): void {
    if (this.failingOperations.has(operation)) {
      throw new Error(`in-memory store ${operation} failed`);
    }
  }
}
