import { lastEventId, summaryCacheKey } from './summary-cache-key.js';

const at = new Date('2026-03-10T12:00:00.123Z');

describe('lastEventId', () => {
  it('is none for a customer without any payment activity', () => {
    expect(
      lastEventId({ lastActivityAt: null, chargeCount: 0, attemptCount: 0 }),
    ).toBe('none');
  });

  it('combines the latest activity instant with the charge and attempt counts', () => {
    expect(
      lastEventId({ lastActivityAt: at, chargeCount: 3, attemptCount: 2 }),
    ).toBe(`${at.getTime()}-3-2`);
  });

  it.each([
    ['a later activity', { lastActivityAt: new Date(at.getTime() + 1) }],
    ['a new charge', { chargeCount: 4 }],
    ['a new attempt', { attemptCount: 3 }],
  ])('changes with %s', (_case, change) => {
    const base = { lastActivityAt: at, chargeCount: 3, attemptCount: 2 };

    expect(lastEventId({ ...base, ...change })).not.toBe(lastEventId(base));
  });

  it('is stable when nothing happened', () => {
    const activity = { lastActivityAt: at, chargeCount: 1, attemptCount: 1 };

    expect(lastEventId({ ...activity })).toBe(lastEventId(activity));
  });
});

describe('summaryCacheKey', () => {
  it('follows customer-summary:{customerId}:{lastEventId}', () => {
    expect(summaryCacheKey('cus_1', '17-3-2')).toBe(
      'customer-summary:cus_1:17-3-2',
    );
  });
});
