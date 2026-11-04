import { Logger } from '@nestjs/common';
import type { CacheOutcome } from './cached-summary-resolver.js';
import type { NarrationFailure, SummarySource } from './customer-summary.js';

export const SUMMARY_EVENTS = {
  served: 'customer_summary.served',
} as const;

export interface SummaryServedEvent {
  event: typeof SUMMARY_EVENTS.served;
  customerId: string;
  source: SummarySource;
  promptVersion: string;
  cache: CacheOutcome;
  model: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  failure: NarrationFailure | null;
}

const logger = new Logger('CustomerSummary');

export function logSummaryServed(event: SummaryServedEvent): void {
  const log = event.source === 'fallback' ? 'warn' : 'log';
  logger[log]({
    ...event,
    msg: `Summary for customer ${event.customerId} served from ${event.source} (cache ${event.cache})`,
  });
}
