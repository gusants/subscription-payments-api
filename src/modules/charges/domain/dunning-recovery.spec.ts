import {
  overdueDunningCutoffs,
  staleAttemptCutoff,
} from './dunning-recovery.js';

describe('overdueDunningCutoffs', () => {
  const now = new Date('2026-03-10T12:00:00.000Z');
  const grace = 5 * 60 * 1000;
  const day = 24 * 60 * 60 * 1000;

  it('pairs every retry count with the failure time before which its job is overdue', () => {
    expect(overdueDunningCutoffs(now, 'days', grace)).toEqual([
      { retryCount: 0, failedBefore: new Date(now.getTime() - grace - day) },
      {
        retryCount: 1,
        failedBefore: new Date(now.getTime() - grace - 3 * day),
      },
      {
        retryCount: 2,
        failedBefore: new Date(now.getTime() - grace - 7 * day),
      },
      { retryCount: 3, failedBefore: new Date(now.getTime() - grace) },
    ]);
  });

  it('measures the offsets in minutes when the unit is minutes', () => {
    const [first] = overdueDunningCutoffs(now, 'minutes', 0);

    expect(first?.failedBefore).toEqual(new Date(now.getTime() - 60_000));
  });
});

describe('staleAttemptCutoff', () => {
  it('goes back by the stale window', () => {
    expect(
      staleAttemptCutoff(new Date('2026-03-10T12:00:00.000Z'), 300_000),
    ).toEqual(new Date('2026-03-10T11:55:00.000Z'));
  });
});
