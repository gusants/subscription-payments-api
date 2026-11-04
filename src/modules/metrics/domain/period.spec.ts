import {
  currentMonthPeriod,
  isOrderedPeriod,
  isWithinMaxSpan,
  parsePeriodBound,
  requestedPeriod,
} from './period.js';

describe('period', () => {
  describe('parsePeriodBound', () => {
    it('reads a date-only from as the start of that UTC day', () => {
      expect(parsePeriodBound('2026-11-01', 'from').toISOString()).toBe(
        '2026-11-01T00:00:00.000Z',
      );
    });

    it('reads a date-only to as the end of that UTC day', () => {
      expect(parsePeriodBound('2026-11-30', 'to').toISOString()).toBe(
        '2026-11-30T23:59:59.999Z',
      );
    });

    it('keeps a datetime as given, honoring its offset', () => {
      expect(
        parsePeriodBound('2026-11-01T03:00:00-03:00', 'from').toISOString(),
      ).toBe('2026-11-01T06:00:00.000Z');
    });
  });

  describe('currentMonthPeriod', () => {
    it('spans the whole UTC month of the given instant', () => {
      const { from, to } = currentMonthPeriod(
        new Date('2026-11-04T18:00:00.000Z'),
      );

      expect(from.toISOString()).toBe('2026-11-01T00:00:00.000Z');
      expect(to.toISOString()).toBe('2026-11-30T23:59:59.999Z');
    });

    it('handles December rolling into the next year', () => {
      const { from, to } = currentMonthPeriod(
        new Date('2026-12-31T23:59:59.999Z'),
      );

      expect(from.toISOString()).toBe('2026-12-01T00:00:00.000Z');
      expect(to.toISOString()).toBe('2026-12-31T23:59:59.999Z');
    });
  });

  describe('requestedPeriod', () => {
    it('builds the period when both bounds are given', () => {
      expect(requestedPeriod({ from: '2026-01-01', to: '2026-01-31' })).toEqual(
        {
          from: new Date('2026-01-01T00:00:00.000Z'),
          to: new Date('2026-01-31T23:59:59.999Z'),
        },
      );
    });

    it.each([
      [{}],
      [{ from: '2026-01-01' }],
      [{ to: '2026-01-31' }],
      [{ from: undefined, to: undefined }],
    ])('returns null when a bound is missing (%j)', (query) => {
      expect(requestedPeriod(query)).toBeNull();
    });
  });

  describe('isOrderedPeriod', () => {
    const at = (iso: string) => new Date(iso);

    it('accepts equal and increasing bounds', () => {
      const instant = at('2026-01-01T00:00:00.000Z');

      expect(isOrderedPeriod({ from: instant, to: instant })).toBe(true);
      expect(
        isOrderedPeriod({ from: instant, to: at('2026-01-02T00:00:00.000Z') }),
      ).toBe(true);
    });

    it('rejects a from after the to', () => {
      expect(
        isOrderedPeriod({
          from: at('2026-01-02T00:00:00.000Z'),
          to: at('2026-01-01T00:00:00.000Z'),
        }),
      ).toBe(false);
    });
  });

  describe('isWithinMaxSpan', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');

    it('accepts exactly the maximum span', () => {
      expect(
        isWithinMaxSpan({ from, to: new Date('2027-01-02T00:00:00.000Z') }),
      ).toBe(true);
    });

    it('rejects anything longer', () => {
      expect(
        isWithinMaxSpan({ from, to: new Date('2027-01-02T00:00:00.001Z') }),
      ).toBe(false);
    });
  });
});
