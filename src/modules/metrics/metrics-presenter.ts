import type { MetricsOverviewResponse } from './dto/metrics-overview-response.dto.js';
import type { MetricsOverview } from './domain/index.js';

export function toMetricsOverviewResponse({
  period,
  ...overview
}: MetricsOverview): MetricsOverviewResponse {
  return {
    from: period.from.toISOString(),
    to: period.to.toISOString(),
    ...overview,
  };
}
