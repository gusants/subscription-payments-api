import {
  dunningRetryKind,
  dunningStepAfterFailure,
  type DunningStepInput,
} from './dunning-step.js';

describe('dunningStepAfterFailure', () => {
  const failedAt = new Date('2026-03-01T10:00:00.000Z');
  const dayMs = 24 * 60 * 60 * 1000;

  function input(
    overrides: {
      status?: DunningStepInput['charge']['status'];
      retryCount?: number;
      subscriptionStatus?: DunningStepInput['subscription']['status'];
      now?: Date;
      unit?: DunningStepInput['unit'];
    } = {},
  ): DunningStepInput {
    return {
      charge: {
        id: 'ch_1',
        status: overrides.status ?? 'failed',
        retryCount: overrides.retryCount ?? 0,
        firstFailedAt: failedAt,
      },
      subscription: {
        id: 'sub_1',
        status: overrides.subscriptionStatus ?? 'past_due',
      },
      unit: overrides.unit ?? 'days',
      now: overrides.now ?? failedAt,
    };
  }

  it.each([
    [0, 1, 1],
    [1, 2, 3],
    [2, 3, 7],
  ])(
    'after %i retries schedules retry %i at D+%i counted from the first failure',
    (retryCount, attempt, offsetDays) => {
      const step = dunningStepAfterFailure(
        input({ retryCount, now: new Date(failedAt.getTime() + dayMs) }),
      );

      expect(step).toEqual({
        kind: 'schedule',
        attempt,
        delayMs: offsetDays * dayMs - dayMs,
      });
    },
  );

  it('uses minutes when the interval unit is minutes', () => {
    expect(dunningStepAfterFailure(input({ unit: 'minutes' }))).toEqual({
      kind: 'schedule',
      attempt: 1,
      delayMs: 60 * 1000,
    });
  });

  it('runs a retry whose date already passed right away', () => {
    const late = new Date(failedAt.getTime() + 2 * dayMs);

    expect(dunningStepAfterFailure(input({ now: late }))).toMatchObject({
      kind: 'schedule',
      delayMs: 0,
    });
  });

  it('counts from now when the first failure was not recorded', () => {
    const step = dunningStepAfterFailure({
      ...input(),
      charge: {
        id: 'ch_1',
        status: 'failed',
        retryCount: 0,
        firstFailedAt: null,
      },
    });

    expect(step).toEqual({ kind: 'schedule', attempt: 1, delayMs: dayMs });
  });

  it('exhausts a failed charge after the third retry, making it uncollectible and canceling the subscription', () => {
    const step = dunningStepAfterFailure(input({ retryCount: 3 }));

    expect(step).toEqual({
      kind: 'exhaust',
      exhaustion: {
        charge: { id: 'ch_1', fromAnyOf: ['failed'] },
        subscription: {
          id: 'sub_1',
          change: {
            fromAnyOf: ['incomplete', 'active', 'past_due'],
            to: 'canceled',
            canceledAt: failedAt,
          },
        },
      },
    });
  });

  it('exhausts an expired charge by canceling the subscription only', () => {
    const step = dunningStepAfterFailure(
      input({ status: 'expired', retryCount: 3 }),
    );

    expect(step).toMatchObject({
      kind: 'exhaust',
      exhaustion: { charge: null },
    });
  });

  it.each(['paid', 'pending', 'uncollectible'] as const)(
    'does nothing for a %s charge',
    (status) => {
      expect(dunningStepAfterFailure(input({ status }))).toEqual({
        kind: 'none',
      });
    },
  );

  it('does nothing when the subscription is already canceled', () => {
    expect(
      dunningStepAfterFailure(input({ subscriptionStatus: 'canceled' })),
    ).toEqual({ kind: 'none' });
  });
});

describe('dunningRetryKind', () => {
  it('resubmits a failed charge that made exactly the previous retries', () => {
    expect(dunningRetryKind({ status: 'failed', retryCount: 1 }, 2)).toBe(
      'resubmit',
    );
  });

  it('reissues an expired charge that made exactly the previous retries', () => {
    expect(dunningRetryKind({ status: 'expired', retryCount: 0 }, 1)).toBe(
      'reissue',
    );
  });

  it.each([
    ['failed', 2, 2],
    ['failed', 0, 2],
    ['pending', 0, 1],
    ['paid', 0, 1],
    ['uncollectible', 0, 1],
  ] as const)(
    'skips a %s charge with %i retries made for attempt %i',
    (status, retryCount, attempt) => {
      expect(dunningRetryKind({ status, retryCount }, attempt)).toBeNull();
    },
  );
});
