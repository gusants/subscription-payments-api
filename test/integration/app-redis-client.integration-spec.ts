import type { Redis } from 'ioredis';
import {
  createAppRedisClient,
  FAIL_FAST_REDIS_OPTIONS,
} from '../../src/shared/redis/app-redis-client.js';
import { createRedisConnection } from '../../src/shared/redis/create-redis-connection.js';

const liveEndpoint = () => ({
  host: process.env['REDIS_HOST']!,
  port: Number(process.env['REDIS_PORT']),
});

const whenReady = (redis: Redis) =>
  new Promise<void>((resolve) => redis.once('ready', () => resolve()));

describe('app Redis client (integration)', () => {
  const clients: Redis[] = [];

  afterEach(() => {
    for (const client of clients.splice(0)) client.disconnect();
  });

  const track = <T extends Redis>(client: T): T => {
    clients.push(client);
    return client;
  };

  it('is ready when Redis is reachable at startup', async () => {
    const redis = track(await createAppRedisClient(liveEndpoint()));

    expect(redis.status).toBe('ready');
    await expect(redis.ping()).resolves.toBe('PONG');
  });

  it('reconnects by itself after the connection drops', async () => {
    const redis = track(await createAppRedisClient(liveEndpoint()));
    const reconnected = whenReady(redis);

    redis.stream.destroy();
    await reconnected;

    await expect(redis.ping()).resolves.toBe('PONG');
  });

  it('leaves room for connections with their own options through the shared factory', async () => {
    const queueing = track(
      createRedisConnection({
        ...liveEndpoint(),
        maxRetriesPerRequest: null,
      }),
    );

    expect(queueing.options.maxRetriesPerRequest).toBeNull();
    expect(queueing.options.enableOfflineQueue).toBe(true);
    expect(FAIL_FAST_REDIS_OPTIONS).toMatchObject({
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    await expect(queueing.ping()).resolves.toBe('PONG');
  });
});
