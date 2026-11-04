import { Injectable } from '@nestjs/common';
import { Clock } from '../../shared/clock/clock.js';
import {
  computeOverview,
  currentMonthPeriod,
  type MetricsOverview,
  type Period,
} from './domain/index.js';
import { MetricsRepository } from './metrics.repository.js';

@Injectable()
export class MetricsService {
  constructor(
    private readonly metrics: MetricsRepository,
    private readonly clock: Clock,
  ) {}

  async getOverview(requested: Period | null): Promise<MetricsOverview> {
    const period = requested ?? currentMonthPeriod(this.clock.now());
    return computeOverview(await this.metrics.loadSnapshot(period), period);
  }
}
