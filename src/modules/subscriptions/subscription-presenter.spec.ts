import type { Subscription } from './subscription.js';
import { toSubscriptionResponse } from './subscription-presenter.js';

const subscription: Subscription = {
  id: 'sub_1',
  customerId: 'cus_1',
  planId: 'plan_1',
  paymentMethod: 'pix',
  status: 'incomplete',
  billingAnchor: new Date('2026-10-03T10:00:00.000Z'),
  currentPeriodStart: new Date('2026-11-03T10:00:00.000Z'),
  currentPeriodEnd: new Date('2026-12-03T10:00:00.000Z'),
  canceledAt: null,
  createdAt: new Date('2026-11-03T10:00:01.000Z'),
  updatedAt: new Date('2026-11-03T10:00:02.000Z'),
};

describe('toSubscriptionResponse', () => {
  it('serializes dates as ISO strings and keeps a null canceledAt', () => {
    expect(toSubscriptionResponse(subscription)).toEqual({
      id: 'sub_1',
      customerId: 'cus_1',
      planId: 'plan_1',
      paymentMethod: 'pix',
      status: 'incomplete',
      billingAnchor: '2026-10-03T10:00:00.000Z',
      currentPeriodStart: '2026-11-03T10:00:00.000Z',
      currentPeriodEnd: '2026-12-03T10:00:00.000Z',
      canceledAt: null,
      createdAt: '2026-11-03T10:00:01.000Z',
      updatedAt: '2026-11-03T10:00:02.000Z',
    });
  });

  it('serializes canceledAt when present', () => {
    const response = toSubscriptionResponse({
      ...subscription,
      status: 'canceled',
      canceledAt: new Date('2026-11-04T00:00:00.000Z'),
    });

    expect(response.canceledAt).toBe('2026-11-04T00:00:00.000Z');
  });
});
