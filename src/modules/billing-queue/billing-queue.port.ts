export interface ChargeRetryRequest {
  chargeId: string;
  attempt: number;
  delayMs: number;
  correlationId: string;
}

export const RETRY_SCHEDULING = {
  enqueued: 'enqueued',
  rerun: 'rerun',
  promoted: 'promoted',
  alreadyScheduled: 'already_scheduled',
} as const;

export type RetryScheduling =
  (typeof RETRY_SCHEDULING)[keyof typeof RETRY_SCHEDULING];

export function changedTheSchedule(scheduling: RetryScheduling): boolean {
  return scheduling !== RETRY_SCHEDULING.alreadyScheduled;
}

export abstract class BillingQueue {
  abstract scheduleRetry(request: ChargeRetryRequest): Promise<RetryScheduling>;
  abstract promoteDelayedRetries(): Promise<number>;
}
