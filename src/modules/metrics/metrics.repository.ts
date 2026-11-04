import type { MetricsSnapshot, Period } from './domain/index.js';

export abstract class MetricsRepository {
  abstract loadSnapshot(period: Period): Promise<MetricsSnapshot>;
}
