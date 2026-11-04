import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.schema.js';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { IdempotencyStore } from './idempotency.store.js';
import { RedisIdempotencyStore } from './redis-idempotency.store.js';

@Module({
  providers: [
    {
      provide: IdempotencyStore,
      inject: [REDIS_CLIENT, ConfigService],
      useFactory: (redis: Redis, config: ConfigService<Env, true>) =>
        new RedisIdempotencyStore(redis, {
          completedSeconds: config.get('IDEMPOTENCY_TTL_SECONDS', {
            infer: true,
          }),
          lockSeconds: config.get('IDEMPOTENCY_LOCK_TTL_SECONDS', {
            infer: true,
          }),
        }),
    },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class IdempotencyModule {}
