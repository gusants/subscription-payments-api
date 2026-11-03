import type { PlanInterval } from '../../plans/plan.js';
import { computePeriodEnd } from './period.js';

const iso = (date: Date) => date.toISOString();

describe('computePeriodEnd', () => {
  describe('monthly', () => {
    it.each([
      ['mid-month day', '2026-11-15T00:00:00.000Z', '2026-12-15T00:00:00.000Z'],
      [
        '31st into a 30-day month',
        '2026-03-31T00:00:00.000Z',
        '2026-04-30T00:00:00.000Z',
      ],
      [
        '31st into a 28-day February',
        '2026-01-31T00:00:00.000Z',
        '2026-02-28T00:00:00.000Z',
      ],
      [
        '31st into a 29-day February',
        '2028-01-31T00:00:00.000Z',
        '2028-02-29T00:00:00.000Z',
      ],
      [
        '30th into a 28-day February',
        '2026-01-30T00:00:00.000Z',
        '2026-02-28T00:00:00.000Z',
      ],
      [
        '29th into a 28-day February',
        '2026-01-29T00:00:00.000Z',
        '2026-02-28T00:00:00.000Z',
      ],
      [
        '29th into a 29-day February',
        '2028-01-29T00:00:00.000Z',
        '2028-02-29T00:00:00.000Z',
      ],
      [
        '30th into a 31-day month',
        '2026-04-30T00:00:00.000Z',
        '2026-05-30T00:00:00.000Z',
      ],
      [
        '31st into a 31-day month',
        '2026-07-31T00:00:00.000Z',
        '2026-08-31T00:00:00.000Z',
      ],
      [
        'December into January',
        '2026-12-15T00:00:00.000Z',
        '2027-01-15T00:00:00.000Z',
      ],
      [
        'December 31st into January',
        '2026-12-31T00:00:00.000Z',
        '2027-01-31T00:00:00.000Z',
      ],
    ])('%s', (_label, anchor, expected) => {
      expect(iso(computePeriodEnd(new Date(anchor), 'monthly'))).toBe(expected);
    });

    it('keeps the time of day in UTC', () => {
      const end = computePeriodEnd(
        new Date('2026-01-31T23:59:58.123Z'),
        'monthly',
      );

      expect(iso(end)).toBe('2026-02-28T23:59:58.123Z');
    });

    it('does not drift the billing day across consecutive periods', () => {
      const anchor = new Date('2026-01-31T10:00:00.000Z');

      const ends = [1, 2, 3, 4, 5].map((n) =>
        iso(computePeriodEnd(anchor, 'monthly', n)),
      );

      expect(ends).toEqual([
        '2026-02-28T10:00:00.000Z',
        '2026-03-31T10:00:00.000Z',
        '2026-04-30T10:00:00.000Z',
        '2026-05-31T10:00:00.000Z',
        '2026-06-30T10:00:00.000Z',
      ]);
    });

    it('uses 29 days for February in a leap-year sequence', () => {
      const anchor = new Date('2028-01-31T00:00:00.000Z');

      expect(iso(computePeriodEnd(anchor, 'monthly', 1))).toBe(
        '2028-02-29T00:00:00.000Z',
      );
      expect(iso(computePeriodEnd(anchor, 'monthly', 2))).toBe(
        '2028-03-31T00:00:00.000Z',
      );
    });

    it('rolls over several years', () => {
      const end = computePeriodEnd(
        new Date('2026-11-30T00:00:00.000Z'),
        'monthly',
        27,
      );

      expect(iso(end)).toBe('2029-02-28T00:00:00.000Z');
    });
  });

  describe('yearly', () => {
    it.each([
      ['regular date', '2026-11-03T08:00:00.000Z', '2027-11-03T08:00:00.000Z'],
      [
        'leap day into a common year',
        '2028-02-29T00:00:00.000Z',
        '2029-02-28T00:00:00.000Z',
      ],
      [
        'leap day into the next leap year',
        '2024-02-29T00:00:00.000Z',
        '2028-02-29T00:00:00.000Z',
        4,
      ],
    ])('%s', (_label, anchor, expected, periods = 1) => {
      expect(iso(computePeriodEnd(new Date(anchor), 'yearly', periods))).toBe(
        expected,
      );
    });
  });

  it('does not mutate the anchor', () => {
    const anchor = new Date('2026-01-31T00:00:00.000Z');

    computePeriodEnd(anchor, 'monthly');

    expect(iso(anchor)).toBe('2026-01-31T00:00:00.000Z');
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects periodsElapsed %s', (periods) => {
    const interval: PlanInterval = 'monthly';

    expect(() => computePeriodEnd(new Date(), interval, periods)).toThrow(
      RangeError,
    );
  });
});
