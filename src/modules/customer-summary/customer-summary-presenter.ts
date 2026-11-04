import type { CustomerSummary } from './customer-summary.service.js';
import type { CustomerSummaryResponse } from './dto/customer-summary-response.dto.js';

export function toCustomerSummaryResponse({
  customerId,
  metrics,
  record,
}: CustomerSummary): CustomerSummaryResponse {
  return {
    customerId,
    source: record.source,
    promptVersion: record.promptVersion,
    generatedAt: record.generatedAt.toISOString(),
    metrics,
    ...record.output,
  };
}
