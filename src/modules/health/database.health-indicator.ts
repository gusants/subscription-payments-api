import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../../shared/database/prisma.service.js';
import { describeError } from './describe-error.js';
import { withTimeout } from '../../shared/async/with-timeout.js';
import { HEALTH_CHECK_TIMEOUT_MS } from './health-check-timeout.js';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await withTimeout(
        this.prisma.$queryRaw`SELECT 1`,
        HEALTH_CHECK_TIMEOUT_MS,
      );
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: describeError(error) });
    }
  }
}
