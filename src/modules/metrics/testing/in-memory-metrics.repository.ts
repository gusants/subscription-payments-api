import type { MetricsSnapshot, Period } from '../domain/index.js';
import { MetricsRepository } from '../metrics.repository.js';

const EMPTY_SNAPSHOT: MetricsSnapshot = {
  statusCounts: [],
  activePlans: [],
  paymentFailedCancellations: 0,
  paidRevenueByMonth: [],
};

export class InMemoryMetricsRepository extends MetricsRepository {
  readonly requestedPeriods: Period[] = [];
  snapshot: MetricsSnapshot = EMPTY_SNAPSHOT;

  loadSnapshot(period: Period): Promise<MetricsSnapshot> {
    this.requestedPeriods.push(period);
    return Promise.resolve(this.snapshot);
  }
}
