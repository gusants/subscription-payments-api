import { Controller, Get, UseFilters } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database.health-indicator.js';
import { HealthCheckExceptionFilter } from './health-check.exception-filter.js';
import { RedisHealthIndicator } from './redis.health-indicator.js';

@Controller('health')
@UseFilters(HealthCheckExceptionFilter)
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.database.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
