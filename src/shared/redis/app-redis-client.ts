import { Logger } from '@nestjs/common';
import type { Redis, RedisOptions } from 'ioredis';
import { createRedisConnection } from './create-redis-connection.js';

export const APP_REDIS_COMMAND_TIMEOUT_MS = 1000;
export const APP_REDIS_CONNECT_TIMEOUT_MS = 2000;
export const APP_REDIS_STARTUP_WAIT_MS = 3000;

export const FAIL_FAST_REDIS_OPTIONS: RedisOptions = {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  commandTimeout: APP_REDIS_COMMAND_TIMEOUT_MS,
  connectTimeout: APP_REDIS_CONNECT_TIMEOUT_MS,
};

export interface RedisEndpoint {
  host: string;
  port: number;
}

function whenReady(redis: Redis, timeoutMs: number): Promise<boolean> {
  if (redis.status === 'ready') return Promise.resolve(true);
  return new Promise((resolve) => {
    const settle = (ready: boolean) => {
      clearTimeout(timer);
      redis.off('ready', onReady);
      resolve(ready);
    };
    const onReady = () => settle(true);
    const timer = setTimeout(() => settle(false), timeoutMs);
    redis.once('ready', onReady);
  });
}

export async function createAppRedisClient(
  endpoint: RedisEndpoint,
  startupWaitMs = APP_REDIS_STARTUP_WAIT_MS,
): Promise<Redis> {
  const redis = createRedisConnection({
    ...endpoint,
    ...FAIL_FAST_REDIS_OPTIONS,
  });
  if (!(await whenReady(redis, startupWaitMs))) {
    new Logger('Redis').warn(
      `Redis not ready after ${startupWaitMs}ms; continuing, requests fail fast until it connects`,
    );
  }
  return redis;
}
