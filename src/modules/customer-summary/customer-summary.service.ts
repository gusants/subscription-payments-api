import { Injectable } from '@nestjs/common';
import { Clock } from '../../shared/clock/clock.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { CachedSummaryResolver } from './cached-summary-resolver.js';
import type { CustomerPaymentRecord } from './customer-payment-record.js';
import type { SummaryRecord } from './customer-summary.js';
import { CustomerSummaryRepository } from './customer-summary.repository.js';
import {
  buildAnonymizedContext,
  computePaymentMetrics,
  lastEventId,
  type PaymentMetrics,
} from './domain/index.js';
import { logSummaryServed, SUMMARY_EVENTS } from './summary-events.js';
import { SummaryNarrator } from './summary-narrator.js';

export interface CustomerSummary {
  customerId: string;
  metrics: PaymentMetrics;
  record: SummaryRecord;
}

@Injectable()
export class CustomerSummaryService {
  constructor(
    private readonly records: CustomerSummaryRepository,
    private readonly narrator: SummaryNarrator,
    private readonly resolver: CachedSummaryResolver,
    private readonly clock: Clock,
  ) {}

  async getSummary(customerId: string): Promise<CustomerSummary> {
    const payments = await this.records.findPaymentRecord(customerId);
    if (!payments) {
      throw new NotFoundError(`Customer ${customerId} not found`);
    }
    const metrics = computePaymentMetrics(payments, this.clock.now());
    const { narration, cache } = await this.resolver.resolve(
      customerId,
      lastEventId(payments.activity),
      () => this.narrator.narrate(contextOf(payments, metrics)),
    );
    const { record, usage, failure } = narration;
    logSummaryServed({
      event: SUMMARY_EVENTS.served,
      customerId,
      source: record.source,
      promptVersion: record.promptVersion,
      cache,
      model: usage?.model ?? null,
      latencyMs: usage?.latencyMs ?? null,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      failure,
    });
    return { customerId, metrics, record };
  }
}

function contextOf(payments: CustomerPaymentRecord, metrics: PaymentMetrics) {
  return buildAnonymizedContext({
    customerId: payments.customerId,
    plan: payments.plan,
    charges: payments.charges,
    metrics,
  });
}
