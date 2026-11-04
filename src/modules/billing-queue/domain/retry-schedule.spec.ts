import {
  MAX_DUNNING_RETRIES,
  nextRetryAt,
  retryDelayMs,
  retryJobId,
} from './retry-schedule.js';

const FAILED_AT = new Date('2026-01-30T10:15:00.000Z');
const addUtcDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86_400_000);
const addMinutes = (date: Date, minutes: number) =>
  new Date(date.getTime() + minutes * 60_000);

describe('nextRetryAt', () => {
  it('allows three retries', () => {
    expect(MAX_DUNNING_RETRIES).toBe(3);
  });

  it.each([
    [0, 1],
    [1, 3],
    [2, 7],
  ])('in days, retry %i falls on D+%i of the first failure', (made, days) => {
    expect(nextRetryAt(FAILED_AT, made, 'days')).toEqual(
      addUtcDays(FAILED_AT, days),
    );
  });

  it.each([
    [0, 1],
    [1, 3],
    [2, 7],
  ])(
    'in minutes, retry %i falls %i minutes after the first failure',
    (made, minutes) => {
      expect(nextRetryAt(FAILED_AT, made, 'minutes')).toEqual(
        addMinutes(FAILED_AT, minutes),
      );
    },
  );

  it('measures every step from the original failure, not from the previous retry', () => {
    const steps = [0, 1, 2].map((made) =>
      nextRetryAt(FAILED_AT, made, 'days')!.getTime(),
    );

    expect(
      steps.map((step) => (step - FAILED_AT.getTime()) / 86_400_000),
    ).toEqual([1, 3, 7]);
  });

  it('crosses month and year boundaries on the UTC calendar', () => {
    const lastDayOfYear = new Date('2026-12-30T23:00:00.000Z');

    expect(nextRetryAt(lastDayOfYear, 2, 'days')).toEqual(
      new Date('2027-01-06T23:00:00.000Z'),
    );
  });

  it('keeps the UTC time of day across a daylight saving change', () => {
    const beforeEuropeanClockChange = new Date('2026-03-28T12:00:00.000Z');

    expect(nextRetryAt(beforeEuropeanClockChange, 0, 'days')).toEqual(
      new Date('2026-03-29T12:00:00.000Z'),
    );
  });

  it('does not mutate the failure date', () => {
    const failedAt = new Date(FAILED_AT);

    nextRetryAt(failedAt, 0, 'days');

    expect(failedAt).toEqual(FAILED_AT);
  });

  it.each([3, 4, 100])('is exhausted after %i retries made', (made) => {
    expect(nextRetryAt(FAILED_AT, made, 'days')).toBeNull();
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects attemptsMade %s',
    (made) => {
      expect(() => nextRetryAt(FAILED_AT, made, 'days')).toThrow(RangeError);
    },
  );
});

describe('retryDelayMs', () => {
  const now = new Date('2026-02-01T00:00:00.000Z');

  it('is the time left until the retry', () => {
    expect(retryDelayMs(now, new Date('2026-02-01T00:00:05.500Z'))).toBe(5500);
  });

  it('is zero when the retry is due exactly now', () => {
    expect(retryDelayMs(now, now)).toBe(0);
  });

  it('is zero when the retry is already overdue', () => {
    expect(retryDelayMs(now, new Date('2026-01-31T00:00:00.000Z'))).toBe(0);
  });
});

describe('retryJobId', () => {
  it('is deterministic for a charge and attempt', () => {
    expect(retryJobId('ch_abc', 2)).toBe('retry:ch_abc:2');
    expect(retryJobId('ch_abc', 2)).toBe(retryJobId('ch_abc', 2));
  });

  it('differs per attempt and per charge', () => {
    expect(retryJobId('ch_abc', 1)).not.toBe(retryJobId('ch_abc', 2));
    expect(retryJobId('ch_abc', 1)).not.toBe(retryJobId('ch_def', 1));
  });
});
