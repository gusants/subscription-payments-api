import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Env } from '../../shared/config/env.schema.js';
import { createRedisConnection } from '../../shared/redis/create-redis-connection.js';
import { BULLMQ_PRODUCER_REDIS_OPTIONS } from './billing-queue.options.js';

@Injectable()
export class BillingQueueProducerConnection implements OnApplicationShutdown {
  readonly redis: Redis;

  constructor(config: ConfigService<Env, true>) {
    this.redis = createRedisConnection({
      host: config.get('REDIS_HOST', { infer: true }),
      port: config.get('REDIS_PORT', { infer: true }),
      ...BULLMQ_PRODUCER_REDIS_OPTIONS,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') {
      await this.redis.quit();
    } else {
      this.redis.disconnect();
    }
  }
}
