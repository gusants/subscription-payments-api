import type { PlanInterval } from '../../plans/plan.js';

const MONTHS_PER_INTERVAL: Readonly<Record<PlanInterval, number>> = {
  monthly: 1,
  yearly: 12,
};

export function computePeriodEnd(
  anchor: Date,
  interval: PlanInterval,
  periodsElapsed = 1,
): Date {
  if (!Number.isInteger(periodsElapsed) || periodsElapsed < 1) {
    throw new RangeError('periodsElapsed must be a positive integer');
  }
  const year = anchor.getUTCFullYear();
  const month =
    anchor.getUTCMonth() + MONTHS_PER_INTERVAL[interval] * periodsElapsed;
  const day = Math.min(anchor.getUTCDate(), daysInMonth(year, month));
  return new Date(
    Date.UTC(
      year,
      month,
      day,
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
