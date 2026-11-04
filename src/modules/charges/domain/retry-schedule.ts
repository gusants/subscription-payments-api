export type RetryIntervalUnit = 'days' | 'minutes';

export const MAX_DUNNING_RETRIES = 3;

const RETRY_OFFSETS_IN_UNITS: readonly number[] = [1, 3, 7];

const MILLISECONDS_PER_UNIT: Record<RetryIntervalUnit, number> = {
  days: 24 * 60 * 60 * 1000,
  minutes: 60 * 1000,
};

export function nextRetryAt(
  firstFailedAt: Date,
  attemptsMade: number,
  unit: RetryIntervalUnit,
): Date | null {
  if (!Number.isInteger(attemptsMade) || attemptsMade < 0) {
    throw new RangeError(
      `attemptsMade must be a non-negative integer, received ${attemptsMade}`,
    );
  }
  const offset = RETRY_OFFSETS_IN_UNITS[attemptsMade];
  if (offset === undefined) return null;
  return new Date(
    firstFailedAt.getTime() + offset * MILLISECONDS_PER_UNIT[unit],
  );
}

export function retryDelayMs(now: Date, retryAt: Date): number {
  return Math.max(0, retryAt.getTime() - now.getTime());
}
