import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CachedSummaryResolver } from '../../src/modules/customer-summary/cached-summary-resolver.js';
import type {
  Narration,
  SummaryRecord,
} from '../../src/modules/customer-summary/customer-summary.js';
import { summaryCacheKey } from '../../src/modules/customer-summary/domain/index.js';
import { RedisSummaryCacheStore } from '../../src/modules/customer-summary/redis-summary-cache.store.js';
import { newSummaryMemory } from '../../src/modules/customer-summary/testing/unbounded-summary-memory.js';
import type { SummaryCacheOptions } from '../../src/modules/customer-summary/summary-cache.options.js';
import { createAppRedisClient } from '../../src/shared/redis/app-redis-client.js';

const options: SummaryCacheOptions = {
  ttlSeconds: 600,
  fallbackTtlSeconds: 30,
  lockSeconds: 20,
  waitMs: 3000,
  promptVersion: 'v1',
  model: 'fake-llm',
  pollMs: 20,
};

const record: SummaryRecord = {
  source: 'llm',
  promptVersion: 'v1',
  generatedAt: new Date('2026-06-01T00:00:00.000Z'),
  output: {
    summary: 'Pays on time.',
    paymentBehavior: 'on_time',
    riskLevel: 'low',
    suggestedAction: 'No action needed.',
  },
};

const narration = (source: SummaryRecord['source']): Narration => ({
  record: { ...record, source },
  usage: null,
  failure: null,
});

const unusedPort = async (): Promise<number> => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

describe('Redis summary cache (integration)', () => {
  const clients: Redis[] = [];
  let redis: Redis;
  let store: RedisSummaryCacheStore;
  let customerId: string;
  let key: string;

  beforeAll(async () => {
    redis = await createAppRedisClient({
      host: process.env['REDIS_HOST']!,
      port: Number(process.env['REDIS_PORT']),
    });
    clients.push(redis);
    store = new RedisSummaryCacheStore(redis);
  });

  beforeEach(() => {
    customerId = `cus_${randomUUID()}`;
    key = summaryCacheKey(customerId, 'evt_1', options);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
  });

  describe('store', () => {
    it('round-trips a record and sets its TTL', async () => {
      await store.save(key, record, 120);

      await expect(store.find(key)).resolves.toEqual(record);
      expect(await redis.ttl(key)).toBeGreaterThan(110);
      expect(await redis.ttl(key)).toBeLessThanOrEqual(120);
    });

    it('finds nothing for an unknown key', async () => {
      await expect(store.find(key)).resolves.toBeNull();
    });

    it.each([
      ['not JSON', 'oops{'],
      [
        'out of schema',
        JSON.stringify({ ...record, output: { summary: 'x' } }),
      ],
    ])('treats a stored value that is %s as a miss', async (_case, raw) => {
      await redis.set(key, raw);

      await expect(store.find(key)).resolves.toBeNull();
    });

    it('lets exactly one of many parallel lock attempts win', async () => {
      const tokens = await Promise.all(
        Array.from({ length: 20 }, () => store.acquireLock(key, 20)),
      );

      expect(tokens.filter((token) => token !== null)).toHaveLength(1);
    });

    it('releases a lock only for its owner', async () => {
      const token = await store.acquireLock(key, 20);

      await store.releaseLock(key, 'someone-else');
      await expect(store.acquireLock(key, 20)).resolves.toBeNull();
      await store.releaseLock(key, token!);

      await expect(store.acquireLock(key, 20)).resolves.not.toBeNull();
    });

    it('expires the lock by itself', async () => {
      await store.acquireLock(key, 1);

      await vi.waitFor(
        async () => {
          await expect(store.acquireLock(key, 20)).resolves.not.toBeNull();
        },
        { timeout: 3000, interval: 100 },
      );
    });
  });

  describe('resolver', () => {
    it('makes one generation for simultaneous requests from several instances', async () => {
      const instances = Array.from(
        { length: 3 },
        () => new CachedSummaryResolver(store, options, newSummaryMemory()),
      );
      const generate = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return narration('llm');
      });

      const results = await Promise.all(
        instances.flatMap((instance) =>
          Array.from({ length: 4 }, () =>
            instance.resolve(customerId, 'evt_1', generate),
          ),
        ),
      );

      expect(generate).toHaveBeenCalledTimes(1);
      expect(results.filter(({ cache }) => cache === 'miss')).toHaveLength(1);
      expect(
        results.every(
          ({ narration: { record: found } }) =>
            found.output.summary === 'Pays on time.',
        ),
      ).toBe(true);
    });

    it('serves later requests from the cache and regenerates for a new event', async () => {
      const resolver = new CachedSummaryResolver(
        store,
        options,
        newSummaryMemory(),
      );
      const generate = vi.fn(async () => narration('llm'));

      await resolver.resolve(customerId, 'evt_1', generate);
      const second = await resolver.resolve(customerId, 'evt_1', generate);
      const third = await resolver.resolve(customerId, 'evt_2', generate);

      expect(second.cache).toBe('hit');
      expect(third.cache).toBe('miss');
      expect(generate).toHaveBeenCalledTimes(2);
    });

    it('shares a fallback among waiters and expires it after the short TTL', async () => {
      const resolver = new CachedSummaryResolver(
        store,
        options,
        newSummaryMemory(),
      );
      const other = new CachedSummaryResolver(
        store,
        options,
        newSummaryMemory(),
      );
      const generate = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return narration('fallback');
      });

      const [first, second] = await Promise.all([
        resolver.resolve(customerId, 'evt_1', generate),
        other.resolve(customerId, 'evt_1', generate),
      ]);

      expect(generate).toHaveBeenCalledTimes(1);
      expect([first.cache, second.cache].sort()).toEqual(['coalesced', 'miss']);
      expect(await redis.ttl(key)).toBeLessThanOrEqual(30);
    });

    it('releases the lock after generating', async () => {
      const resolver = new CachedSummaryResolver(
        store,
        options,
        newSummaryMemory(),
      );

      await resolver.resolve(customerId, 'evt_1', async () => narration('llm'));

      expect(await redis.exists(`${key}:lock`)).toBe(0);
    });

    it('generates without cache and without throwing while Redis is down', async () => {
      const downRedis = await createAppRedisClient(
        { host: '127.0.0.1', port: await unusedPort() },
        50,
      );
      clients.push(downRedis);
      const resolver = new CachedSummaryResolver(
        new RedisSummaryCacheStore(downRedis),
        options,
        newSummaryMemory(),
      );
      const generate = vi.fn(async () => narration('llm'));

      const result = await resolver.resolve(customerId, 'evt_1', generate);

      expect(result.cache).toBe('bypass');
      expect(generate).toHaveBeenCalledTimes(1);
    });
  });
});
