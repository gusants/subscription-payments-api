import { HealthIndicatorService } from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import { RedisHealthIndicator } from './redis.health-indicator.js';

function buildIndicator(ping: () => Promise<string>) {
  const redis = { ping } as unknown as Redis;
  return new RedisHealthIndicator(redis, new HealthIndicatorService());
}

describe('RedisHealthIndicator', () => {
  it('reports up when redis answers the ping', async () => {
    const indicator = buildIndicator(() => Promise.resolve('PONG'));

    await expect(indicator.isHealthy('redis')).resolves.toEqual({
      redis: { status: 'up' },
    });
  });

  it('reports down with the failure reason when redis is unreachable', async () => {
    const indicator = buildIndicator(() =>
      Promise.reject(new Error('ECONNREFUSED')),
    );

    await expect(indicator.isHealthy('redis')).resolves.toEqual({
      redis: { status: 'down', message: 'ECONNREFUSED' },
    });
  });
});
