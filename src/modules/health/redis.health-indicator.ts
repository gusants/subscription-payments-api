import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants.js';
import { describeError } from './describe-error.js';
import { HEALTH_CHECK_TIMEOUT_MS, withTimeout } from './with-timeout.js';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await withTimeout(this.redis.ping(), HEALTH_CHECK_TIMEOUT_MS);
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: describeError(error) });
    }
  }
}
