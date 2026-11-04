import { randomUUID } from 'node:crypto';
import {
  type AcquireResult,
  type IdempotencyRecord,
  IdempotencyStore,
  type StoredResponse,
} from '../idempotency.store.js';

type Operation = 'acquire' | 'complete' | 'release' | 'extendLock';

export type FailedRedisCommand = Error & {
  command: { name: string; args: unknown[] };
};

function failureLikeRedis(
  operation: Operation,
  key: string,
): FailedRedisCommand {
  return Object.assign(new Error(`in-memory store ${operation} failed`), {
    command: { name: 'eval', args: ['<script>', 1, key] },
  });
}
type Entry = { record: IdempotencyRecord; lockToken?: string };

export class InMemoryIdempotencyStore extends IdempotencyStore {
  readonly entries = new Map<string, Entry>();
  readonly failingOperations = new Set<Operation>();
  private readonly transientFailures = new Map<Operation, number>();
  extensions = 0;

  failTimes(operation: Operation, times: number): void {
    this.transientFailures.set(operation, times);
  }

  async acquire(key: string, fingerprint: string): Promise<AcquireResult> {
    this.throwIfFailing('acquire', key);
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
  ): Promise<boolean> {
    this.throwIfFailing('complete', key);
    if (this.entries.get(key)?.lockToken !== lockToken) return false;
    this.entries.set(key, {
      record: { state: 'completed', fingerprint, response },
    });
    return true;
  }

  async release(key: string, lockToken: string): Promise<boolean> {
    this.throwIfFailing('release', key);
    if (this.entries.get(key)?.lockToken !== lockToken) return false;
    this.entries.delete(key);
    return true;
  }

  async extendLock(key: string, lockToken: string): Promise<boolean> {
    this.throwIfFailing('extendLock', key);
    if (this.entries.get(key)?.lockToken !== lockToken) return false;
    this.extensions += 1;
    return true;
  }

  private throwIfFailing(operation: Operation, key: string): void {
    const remaining = this.transientFailures.get(operation) ?? 0;
    if (remaining > 0) {
      this.transientFailures.set(operation, remaining - 1);
      throw failureLikeRedis(operation, key);
    }
    if (this.failingOperations.has(operation)) {
      throw failureLikeRedis(operation, key);
    }
  }
}
