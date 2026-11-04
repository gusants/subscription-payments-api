import { buildDemoSeed } from './build-demo-seed.js';

const NOW = new Date('2026-11-04T15:30:00.000Z');

describe('buildDemoSeed', () => {
  const seed = buildDemoSeed(NOW);

  it('is deterministic for the same instant', () => {
    expect(buildDemoSeed(NOW)).toEqual(seed);
  });

  it('keeps every row id unique', () => {
    for (const rows of [
      seed.plans,
      seed.customers,
      seed.subscriptions,
      seed.charges,
      seed.attempts,
    ]) {
      const ids = rows.map(({ id }) => id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('never repeats a period start for non-expired charges of a subscription', () => {
    const keys = seed.charges
      .filter(({ status }) => status !== 'expired')
      .map(
        ({ subscriptionId, periodStart }) =>
          `${subscriptionId}|${(periodStart as Date).toISOString()}`,
      );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers every subscription status and cancellation reason', () => {
    expect(new Set(seed.subscriptions.map(({ status }) => status))).toEqual(
      new Set(['active', 'past_due', 'canceled']),
    );
    expect(
      new Set(seed.subscriptions.map(({ cancelReason }) => cancelReason)),
    ).toEqual(new Set([undefined, 'payment_failed', 'customer_request']));
  });

  it('sets cancellation fields only on canceled subscriptions', () => {
    for (const { status, canceledAt, cancelReason } of seed.subscriptions) {
      expect(status === 'canceled').toBe(Boolean(canceledAt && cancelReason));
    }
  });

  it('records dunning state on every charge that failed once', () => {
    const failedOnce = seed.charges.filter(
      ({ firstFailedAt }) => firstFailedAt,
    );

    expect(failedOnce.length).toBeGreaterThan(0);
    for (const charge of seed.charges) {
      expect(Boolean(charge.paidAt)).toBe(charge.status === 'paid');
      expect(charge.correlationId).toEqual(expect.any(String));
    }
    for (const { status, nextRetryAt } of seed.charges) {
      expect(status === 'failed').toBe(Boolean(nextRetryAt));
    }
  });

  it('keeps retry history behind one declined attempt per failure', () => {
    for (const charge of seed.charges.filter(({ id }) =>
      seed.attempts.some(({ chargeId }) => chargeId === id),
    )) {
      const declined = seed.attempts.filter(
        ({ chargeId, result }) =>
          chargeId === charge.id && result === 'declined',
      );
      expect(declined).toHaveLength(
        charge.status === 'paid'
          ? (charge.retryCount ?? 0)
          : (charge.retryCount ?? 0) + 1,
      );
    }
  });

  it('never dates an event in the future, except the next retry', () => {
    const dates = [
      ...seed.subscriptions.flatMap(({ createdAt, canceledAt }) => [
        createdAt,
        canceledAt,
      ]),
      ...seed.charges.flatMap(({ dueDate, paidAt, firstFailedAt }) => [
        dueDate,
        paidAt,
        firstFailedAt,
      ]),
      ...seed.attempts.map(({ createdAt }) => createdAt),
    ].filter((date): date is Date => date instanceof Date);

    expect(
      Math.max(...dates.map((date) => date.getTime())),
    ).toBeLessThanOrEqual(NOW.getTime());
  });

  it('schedules the next retry of past-due charges after now', () => {
    const nextRetries = seed.charges
      .map(({ nextRetryAt }) => nextRetryAt)
      .filter((date): date is Date => date instanceof Date);

    expect(nextRetries.length).toBeGreaterThan(0);
    for (const date of nextRetries) {
      expect(date.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });
});
