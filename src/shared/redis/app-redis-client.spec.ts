import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { createServer } from 'node:net';
import {
  APP_REDIS_COMMAND_TIMEOUT_MS,
  createAppRedisClient,
} from './app-redis-client.js';
import { createRedisConnection } from './create-redis-connection.js';

const FAIL_FAST_BOUND_MS = APP_REDIS_COMMAND_TIMEOUT_MS + 500;
const RECONNECT_ATTEMPTS_WINDOW_MS = 500;

const unusedPort = async (): Promise<number> => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

describe('Redis connections against an unreachable server', () => {
  const clients: Redis[] = [];
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.disconnect();
    vi.restoreAllMocks();
  });

  it('createAppRedisClient — server not ready within the startup wait — returns anyway and warns', async () => {
    const port = await unusedPort();

    const redis = await createAppRedisClient({ host: '127.0.0.1', port }, 50);
    clients.push(redis);

    expect(redis.status).not.toBe('ready');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not ready'));
  });

  it('createAppRedisClient — commands while unreachable — reject fast without queueing', async () => {
    const port = await unusedPort();
    const redis = await createAppRedisClient({ host: '127.0.0.1', port }, 50);
    clients.push(redis);
    const startedAt = Date.now();

    await expect(redis.ping()).rejects.toThrow();

    expect(Date.now() - startedAt).toBeLessThan(FAIL_FAST_BOUND_MS);
  });

  it('createRedisConnection — repeated connection errors — logs the problem once', async () => {
    const port = await unusedPort();
    clients.push(createRedisConnection({ host: '127.0.0.1', port }));

    await new Promise((resolve) =>
      setTimeout(resolve, RECONNECT_ATTEMPTS_WINDOW_MS),
    );

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/connection problem: .*\S/),
    );
  });
});
