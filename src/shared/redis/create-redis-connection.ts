import { Logger } from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';

function describeConnectionError(error: Error): string {
  const { code } = error as NodeJS.ErrnoException;
  return error.message || code || error.name;
}

export function createRedisConnection(options: RedisOptions): Redis {
  const logger = new Logger('Redis');
  const redis = new Redis(options);
  let degraded = false;
  redis.on('error', (error: Error) => {
    if (degraded) return;
    degraded = true;
    logger.warn(`Redis connection problem: ${describeConnectionError(error)}`);
  });
  redis.on('ready', () => {
    if (!degraded) return;
    degraded = false;
    logger.log('Redis connection recovered');
  });
  return redis;
}
