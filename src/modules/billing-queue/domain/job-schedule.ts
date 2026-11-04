import type { RetryIntervalUnit } from '../../charges/domain/retry-schedule.js';

const MILLISECONDS_PER_SECOND = 1000;

const RENEWAL_DEFAULT_SECONDS: Record<RetryIntervalUnit, number> = {
  days: 3600,
  minutes: 30,
};

const RECONCILIATION_DEFAULT_SECONDS: Record<RetryIntervalUnit, number> = {
  days: 300,
  minutes: 30,
};

function intervalMs(
  configuredSeconds: number | undefined,
  defaultSeconds: number,
): number {
  return (configuredSeconds ?? defaultSeconds) * MILLISECONDS_PER_SECOND;
}

export function renewalIntervalMs(
  unit: RetryIntervalUnit,
  configuredSeconds?: number,
): number {
  return intervalMs(configuredSeconds, RENEWAL_DEFAULT_SECONDS[unit]);
}

export function reconciliationIntervalMs(
  unit: RetryIntervalUnit,
  configuredSeconds?: number,
): number {
  return intervalMs(configuredSeconds, RECONCILIATION_DEFAULT_SECONDS[unit]);
}
