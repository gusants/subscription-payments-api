export interface Period {
  from: Date;
  to: Date;
}

export interface PeriodQuery {
  from?: string | undefined;
  to?: string | undefined;
}

export type PeriodBound = 'from' | 'to';

export const MAX_PERIOD_DAYS = 366;

const MILLISECONDS_PER_DAY = 86_400_000;
const DATE_ONLY_LENGTH = 10;
const START_OF_DAY = 'T00:00:00.000Z';
const END_OF_DAY = 'T23:59:59.999Z';

export function parsePeriodBound(value: string, bound: PeriodBound): Date {
  if (value.length !== DATE_ONLY_LENGTH) return new Date(value);
  return new Date(value + (bound === 'from' ? START_OF_DAY : END_OF_DAY));
}

export function currentMonthPeriod(now: Date): Period {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    from: new Date(Date.UTC(year, month, 1)),
    to: new Date(Date.UTC(year, month + 1, 1) - 1),
  };
}

export function requestedPeriod({ from, to }: PeriodQuery): Period | null {
  if (!from || !to) return null;
  return {
    from: parsePeriodBound(from, 'from'),
    to: parsePeriodBound(to, 'to'),
  };
}

export function isOrderedPeriod({ from, to }: Period): boolean {
  return from.getTime() <= to.getTime();
}

export function isWithinMaxSpan({ from, to }: Period): boolean {
  return (
    to.getTime() - from.getTime() <= MAX_PERIOD_DAYS * MILLISECONDS_PER_DAY
  );
}
