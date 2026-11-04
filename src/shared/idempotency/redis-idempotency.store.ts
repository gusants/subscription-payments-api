import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import {
  type AcquireResult,
  type IdempotencyRecord,
  IdempotencyStore,
  type StoredResponse,
} from './idempotency.store.js';

const ACQUIRE_SCRIPT = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) then return false end
return redis.call('GET', KEYS[1])
`;

const COMPLETE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
if cjson.decode(current).lockToken ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`;

const RELEASE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
if cjson.decode(current).lockToken ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`;

const storedRecordSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('in_progress'),
    fingerprint: z.string(),
    lockToken: z.string(),
  }),
  z.object({
    state: z.literal('completed'),
    fingerprint: z.string(),
    response: z.object({ statusCode: z.number(), body: z.unknown() }),
  }),
]);

export type RedisIdempotencyTtls = {
  completedSeconds: number;
  lockSeconds: number;
};

export class RedisIdempotencyStore extends IdempotencyStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttls: RedisIdempotencyTtls,
  ) {
    super();
  }

  async acquire(key: string, fingerprint: string): Promise<AcquireResult> {
    const lockToken = randomUUID();
    const lock = JSON.stringify({
      state: 'in_progress',
      fingerprint,
      lockToken,
    });
    const existing = await this.redis.eval(
      ACQUIRE_SCRIPT,
      1,
      key,
      lock,
      this.ttls.lockSeconds,
    );
    if (existing === null) {
      return { acquired: true, lockToken };
    }
    return { acquired: false, existing: parseRecord(existing) };
  }

  async complete(
    key: string,
    lockToken: string,
    fingerprint: string,
    response: StoredResponse,
  ): Promise<void> {
    const completed = JSON.stringify({
      state: 'completed',
      fingerprint,
      response,
    });
    await this.redis.eval(
      COMPLETE_SCRIPT,
      1,
      key,
      lockToken,
      completed,
      this.ttls.completedSeconds,
    );
  }

  async release(key: string, lockToken: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, key, lockToken);
  }
}

function parseRecord(raw: unknown): IdempotencyRecord {
  const record = storedRecordSchema.parse(JSON.parse(String(raw)));
  return record.state === 'in_progress'
    ? { state: 'in_progress', fingerprint: record.fingerprint }
    : record;
}
