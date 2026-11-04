import type { Subscription } from './subscription.js';
import {
  toCreatedSubscriptionResponse,
  toSubscriptionResponse,
} from './subscription-presenter.js';

const subscription: Subscription = {
  id: 'sub_1',
  customerId: 'cus_1',
  planId: 'plan_1',
  paymentMethod: 'pix',
  status: 'incomplete',
  cardToken: 'tok_secret',
  billingAnchor: new Date('2026-10-03T10:00:00.000Z'),
  currentPeriodStart: new Date('2026-11-03T10:00:00.000Z'),
  currentPeriodEnd: new Date('2026-12-03T10:00:00.000Z'),
  canceledAt: null,
  cancelReason: null,
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
      cancelReason: null,
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

describe('toCreatedSubscriptionResponse', () => {
  it('nests the charge summary and never exposes the card token', () => {
    const response = toCreatedSubscriptionResponse({
      subscription,
      latestCharge: {
        id: 'ch_1',
        status: 'failed',
        amountCents: 1990,
        failureReason: 'expired_card',
        expiresAt: null,
        paymentInstructions: null,
      },
    });

    expect(response.latestCharge).toEqual({
      id: 'ch_1',
      status: 'failed',
      amountCents: 1990,
      failureReason: 'expired_card',
    });
    expect(JSON.stringify(response)).not.toContain('tok_secret');
  });

  it('answers a null charge when none was created', () => {
    expect(
      toCreatedSubscriptionResponse({ subscription, latestCharge: null })
        .latestCharge,
    ).toBeNull();
  });
});
