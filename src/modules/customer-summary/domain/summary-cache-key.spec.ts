import {
  lastEventId,
  summaryCacheKey,
  type PaymentActivity,
} from './summary-cache-key.js';

const at = new Date('2026-03-10T12:00:00.123Z');
const planUpdatedAt = new Date('2026-02-01T00:00:00.000Z');

const base: PaymentActivity = {
  lastActivityAt: at,
  chargeCount: 3,
  attemptCount: 2,
  planUpdatedAt,
};

describe('lastEventId', () => {
  it('carries none as the activity of a customer without any payment activity', () => {
    expect(
      lastEventId(
        {
          lastActivityAt: null,
          chargeCount: 0,
          attemptCount: 0,
          planUpdatedAt: null,
        },
        0,
      ),
    ).toBe('none-0-0-0-0');
  });

  it('combines activity, counts, plan update and months as customer', () => {
    expect(lastEventId(base, 8)).toBe(
      `${at.getTime()}-3-2-${planUpdatedAt.getTime()}-8`,
    );
  });

  it.each([
    ['a later activity', { lastActivityAt: new Date(at.getTime() + 1) }],
    ['a new charge', { chargeCount: 4 }],
    ['a new attempt', { attemptCount: 3 }],
    ['a plan price change', { planUpdatedAt: new Date(at.getTime()) }],
  ])('changes with %s', (_case, change) => {
    expect(lastEventId({ ...base, ...change }, 8)).not.toBe(
      lastEventId(base, 8),
    );
  });

  it('changes when the customer completes another month', () => {
    expect(lastEventId(base, 9)).not.toBe(lastEventId(base, 8));
  });

  it('is stable when nothing happened', () => {
    expect(lastEventId({ ...base }, 8)).toBe(lastEventId(base, 8));
  });
});

describe('summaryCacheKey', () => {
  const scope = { promptVersion: 'v2', model: 'gemini-test' };

  it('follows customer-summary:{customerId}:{promptVersion}:{model}:{lastEventId}', () => {
    expect(summaryCacheKey('cus_1', '17-3-2', scope)).toBe(
      'customer-summary:cus_1:v2:gemini-test:17-3-2',
    );
  });

  it('changes with the prompt version and with the model', () => {
    const key = summaryCacheKey('cus_1', 'e', scope);

    expect(
      summaryCacheKey('cus_1', 'e', { ...scope, promptVersion: 'v3' }),
    ).not.toBe(key);
    expect(
      summaryCacheKey('cus_1', 'e', { ...scope, model: 'other' }),
    ).not.toBe(key);
  });
});
