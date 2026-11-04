import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.schema.js';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import { IDEMPOTENCY_LOCK_HEARTBEAT_MS } from './idempotency.constants.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { IdempotencyStore } from './idempotency.store.js';
import { RedisIdempotencyStore } from './redis-idempotency.store.js';

const MILLISECONDS_PER_SECOND = 1000;
const HEARTBEATS_PER_LOCK_TTL = 3;

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
    {
      provide: IDEMPOTENCY_LOCK_HEARTBEAT_MS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        (config.get('IDEMPOTENCY_LOCK_TTL_SECONDS', { infer: true }) *
          MILLISECONDS_PER_SECOND) /
        HEARTBEATS_PER_LOCK_TTL,
    },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class IdempotencyModule {}
