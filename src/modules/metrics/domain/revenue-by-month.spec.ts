import { revenueByMonth } from './revenue-by-month.js';

describe('revenueByMonth', () => {
  const period = (from: string, to: string) => ({
    from: new Date(from),
    to: new Date(to),
  });

  it('returns a single zero month for an empty current month', () => {
    expect(
      revenueByMonth(
        period('2026-11-01T00:00:00.000Z', '2026-11-30T23:59:59.999Z'),
        [],
      ),
    ).toEqual([{ month: '2026-11', revenueCents: 0 }]);
  });

  it('fills months without payments with zero, across a year boundary', () => {
    expect(
      revenueByMonth(
        period('2026-11-15T00:00:00.000Z', '2027-02-10T00:00:00.000Z'),
        [
          { month: '2026-11', revenueCents: 1990 },
          { month: '2027-02', revenueCents: 500 },
        ],
      ),
    ).toEqual([
      { month: '2026-11', revenueCents: 1990 },
      { month: '2026-12', revenueCents: 0 },
      { month: '2027-01', revenueCents: 0 },
      { month: '2027-02', revenueCents: 500 },
    ]);
  });

  it('adds rows that fall in the same month and ignores months outside the period', () => {
    expect(
      revenueByMonth(
        period('2026-11-01T00:00:00.000Z', '2026-11-30T23:59:59.999Z'),
        [
          { month: '2026-11', revenueCents: 100 },
          { month: '2026-11', revenueCents: 250 },
          { month: '2026-10', revenueCents: 999 },
        ],
      ),
    ).toEqual([{ month: '2026-11', revenueCents: 350 }]);
  });
});
