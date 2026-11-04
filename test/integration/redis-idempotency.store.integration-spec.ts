import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { RedisIdempotencyStore } from '../../src/shared/idempotency/redis-idempotency.store.js';

describe('RedisIdempotencyStore (integration)', () => {
  const COMPLETED_TTL_SECONDS = 600;
  const LOCK_TTL_SECONDS = 30;
  const response = { statusCode: 201, body: { id: 'sub_1', nested: [1, {}] } };
  let redis: Redis;
  let store: RedisIdempotencyStore;
  let key: string;

  beforeAll(() => {
    redis = new Redis({
      host: process.env['REDIS_HOST'],
      port: Number(process.env['REDIS_PORT']),
    });
    store = new RedisIdempotencyStore(redis, {
      completedSeconds: COMPLETED_TTL_SECONDS,
      lockSeconds: LOCK_TTL_SECONDS,
    });
  });

  beforeEach(() => {
    key = `idempotency:POST:/test:${randomUUID()}`;
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('lets exactly one of many parallel acquires win', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => store.acquire(key, 'fp')),
    );

    const winners = results.filter((result) => result.acquired);
    const losers = results.filter((result) => !result.acquired);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(24);
    for (const loser of losers) {
      expect(loser).toEqual({
        acquired: false,
        existing: { state: 'in_progress', fingerprint: 'fp' },
      });
    }
  });

  it('sets the lock TTL on acquire', async () => {
    await store.acquire(key, 'fp');

    expect(await redis.ttl(key)).toBeGreaterThan(LOCK_TTL_SECONDS - 5);
    expect(await redis.ttl(key)).toBeLessThanOrEqual(LOCK_TTL_SECONDS);
  });

  it('replaces the lock with the completed record under the completed TTL', async () => {
    const acquired = await store.acquire(key, 'fp');
    if (!acquired.acquired) throw new Error('expected the lock');

    await store.complete(key, acquired.lockToken, 'fp', response);

    expect(await store.acquire(key, 'fp')).toEqual({
      acquired: false,
      existing: { state: 'completed', fingerprint: 'fp', response },
    });
    expect(await redis.ttl(key)).toBeGreaterThan(COMPLETED_TTL_SECONDS - 5);
  });

  it('frees the key on release', async () => {
    const acquired = await store.acquire(key, 'fp');
    if (!acquired.acquired) throw new Error('expected the lock');

    await store.release(key, acquired.lockToken);

    expect((await store.acquire(key, 'fp')).acquired).toBe(true);
  });

  it('ignores complete and release from a holder that lost the lock', async () => {
    const stale = await store.acquire(key, 'fp');
    if (!stale.acquired) throw new Error('expected the lock');
    await redis.del(key);
    const current = await store.acquire(key, 'fp');
    if (!current.acquired) throw new Error('expected the lock');

    await store.complete(key, stale.lockToken, 'fp', response);
    await store.release(key, stale.lockToken);

    expect(await store.acquire(key, 'fp')).toEqual({
      acquired: false,
      existing: { state: 'in_progress', fingerprint: 'fp' },
    });
  });

  it('never overwrites a completed record', async () => {
    const acquired = await store.acquire(key, 'fp');
    if (!acquired.acquired) throw new Error('expected the lock');
    await store.complete(key, acquired.lockToken, 'fp', response);

    await store.complete(key, acquired.lockToken, 'fp', {
      statusCode: 500,
      body: null,
    });
    await store.release(key, acquired.lockToken);

    expect(await store.acquire(key, 'fp')).toMatchObject({
      existing: { state: 'completed', response },
    });
  });

  describe('with a tiny lock TTL', () => {
    const TINY_LOCK_TTL_SECONDS = 2;
    const WAIT_FOR_EXPIRY_MS = 6000;

    it('lets a new request acquire a key whose in-flight lock was abandoned', async () => {
      const impatientStore = new RedisIdempotencyStore(redis, {
        completedSeconds: COMPLETED_TTL_SECONDS,
        lockSeconds: TINY_LOCK_TTL_SECONDS,
      });
      await impatientStore.acquire(key, 'fp');
      const whileHeld = await impatientStore.acquire(key, 'fp');

      await vi.waitFor(
        async () => {
          expect((await impatientStore.acquire(key, 'fp')).acquired).toBe(true);
        },
        { timeout: WAIT_FOR_EXPIRY_MS, interval: 100 },
      );

      expect(whileHeld.acquired).toBe(false);
    });
  });
});
