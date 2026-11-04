import { metricsOverviewQuerySchema } from './metrics-overview-query.dto.js';

describe('metricsOverviewQuerySchema', () => {
  const messagesOf = (query: unknown) => {
    const result = metricsOverviewQuerySchema.safeParse(query);
    return result.success
      ? []
      : result.error.issues.map(({ message }) => message);
  };

  it.each([
    [{}],
    [{ from: '2026-11-01', to: '2026-11-30' }],
    [{ from: '2026-11-01T00:00:00Z', to: '2026-11-30T23:59:59.999Z' }],
    [{ from: '2026-11-01T00:00:00-03:00', to: '2026-11-30' }],
    [{ from: '2026-11-30', to: '2026-11-30' }],
    [{ from: '2026-01-01', to: '2027-01-01' }],
  ])('accepts %j', (query) => {
    expect(metricsOverviewQuerySchema.safeParse(query).success).toBe(true);
  });

  it('rejects a lone bound', () => {
    expect(messagesOf({ from: '2026-11-01' })).toEqual([
      'from and to must be provided together',
    ]);
    expect(messagesOf({ to: '2026-11-01' })).toEqual([
      'from and to must be provided together',
    ]);
  });

  it.each(['yesterday', '2026-02-30', '2026-11-01 10:00', '01/11/2026'])(
    'rejects the malformed bound %s',
    (value) => {
      expect(messagesOf({ from: value, to: '2026-11-30' })).not.toEqual([]);
    },
  );

  it('rejects from after to', () => {
    expect(messagesOf({ from: '2026-11-30', to: '2026-11-01' })).toEqual([
      'from must not be after to',
    ]);
  });

  it('rejects a period longer than the maximum', () => {
    expect(messagesOf({ from: '2026-01-01', to: '2027-01-02' })).toEqual([
      'period must not exceed 366 days',
    ]);
  });
});
