import { Logger } from '@nestjs/common';
import {
  logPaymentEvent,
  PAYMENT_EVENTS,
  type PaymentEvent,
} from './payment-events.js';

describe('payment events', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a fixed vocabulary', () => {
    expect(Object.values(PAYMENT_EVENTS).sort()).toEqual([
      'charge.attempt.failed',
      'charge.created',
      'charge.dunning_exhausted',
      'charge.expired',
      'charge.paid',
      'charge.refund_required',
      'charge.retry.scheduled',
      'subscription.status_changed',
      'webhook.duplicate_ignored',
      'webhook.received',
    ]);
  });

  const paid: PaymentEvent = {
    event: 'charge.paid',
    chargeId: 'ch_1',
    subscriptionId: 'sub_1',
    source: 'charge_flow',
    gatewayChargeId: 'gch_1',
    amountCents: 1990,
    attemptCount: 1,
    retryCount: 0,
  };

  it('logs the event name and its fields as one structured line', () => {
    const log = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    logPaymentEvent(paid, 'Charge ch_1 paid');

    expect(log).toHaveBeenCalledWith({ ...paid, msg: 'Charge ch_1 paid' });
  });

  it.each([
    [
      'error',
      {
        event: 'charge.refund_required',
        chargeId: 'ch_1',
        subscriptionId: 'sub_1',
        gatewayChargeId: 'gch_1',
        reason: 'paid_on_canceled_subscription',
      },
    ],
    [
      'warn',
      {
        event: 'charge.dunning_exhausted',
        chargeId: 'ch_1',
        subscriptionId: 'sub_1',
        retryCount: 3,
      },
    ],
    ['log', paid],
  ] as const)('logs at %s level for %o', (level, event) => {
    const spy = vi
      .spyOn(Logger.prototype, level)
      .mockImplementation(() => undefined);

    logPaymentEvent(event, 'message');

    expect(spy).toHaveBeenCalledOnce();
  });
});
