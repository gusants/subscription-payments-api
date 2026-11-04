import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { SummaryRecord } from './customer-summary.js';
import { summaryOutputSchema } from './domain/index.js';
import { SummaryCacheStore } from './summary-cache.store.js';

const LOCK_SUFFIX = ':lock';

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

const cachedRecordSchema = z.object({
  source: z.enum(['llm', 'fallback']),
  promptVersion: z.string(),
  output: summaryOutputSchema,
  generatedAt: z.coerce.date(),
});

export class RedisSummaryCacheStore extends SummaryCacheStore {
  constructor(private readonly redis: Redis) {
    super();
  }

  async find(key: string): Promise<SummaryRecord | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    try {
      const parsed = cachedRecordSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async save(
    key: string,
    record: SummaryRecord,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(key, JSON.stringify(record), 'EX', ttlSeconds);
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    const token = randomUUID();
    const acquired = await this.redis.set(
      `${key}${LOCK_SUFFIX}`,
      token,
      'EX',
      ttlSeconds,
      'NX',
    );
    return acquired === 'OK' ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    await this.redis.eval(
      RELEASE_LOCK_SCRIPT,
      1,
      `${key}${LOCK_SUFFIX}`,
      token,
    );
  }
}
