import {
  MAX_DUNNING_RETRIES,
  nextRetryAt,
  type RetryIntervalUnit,
} from '../../billing-queue/domain/retry-schedule.js';

export interface DunningFollowUpCutoff {
  retryCount: number;
  failedBefore: Date;
}

const EPOCH = new Date(0);
const NO_OFFSET_MS = 0;

function retryOffsetMs(retryCount: number, unit: RetryIntervalUnit): number {
  const dueAt = nextRetryAt(EPOCH, retryCount, unit);
  return dueAt ? dueAt.getTime() : NO_OFFSET_MS;
}

export function overdueDunningCutoffs(
  now: Date,
  unit: RetryIntervalUnit,
  graceMs: number,
): DunningFollowUpCutoff[] {
  return Array.from({ length: MAX_DUNNING_RETRIES + 1 }, (_, retryCount) => ({
    retryCount,
    failedBefore: new Date(
      now.getTime() - graceMs - retryOffsetMs(retryCount, unit),
    ),
  }));
}

export function staleAttemptCutoff(now: Date, staleAfterMs: number): Date {
  return new Date(now.getTime() - staleAfterMs);
}
