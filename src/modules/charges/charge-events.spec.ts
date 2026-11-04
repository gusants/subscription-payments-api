import type {
  Charge,
  ChargeSettlementRecord,
  RecordedOutcome,
} from './charge.js';
import { logSettlementEvents, type SettlementReport } from './charge-events.js';
import {
  eventNames,
  recordPaymentEvents,
} from './testing/record-payment-events.js';
import type { Subscription } from '../subscriptions/subscription.js';

const at = new Date('2026-03-01T10:00:00.000Z');

const charge: Charge = {
  id: 'ch_1',
  subscriptionId: 'sub_1',
  amountCents: 1990,
  method: 'card',
  status: 'paid',
  gatewayChargeId: 'gch_1',
  gatewayAttemptKey: 'ch_1:1',
  attemptStartedAt: at,
  attemptCount: 1,
  retryCount: 0,
  firstFailedAt: null,
  nextRetryAt: null,
  dueDate: at,
  periodStart: at,
  periodEnd: at,
  paidAt: at,
  expiresAt: null,
  paymentInstructions: null,
  correlationId: 'cor_test_journey',
  createdAt: at,
  updatedAt: at,
};

const subscription = { id: 'sub_1', status: 'active' } as Subscription;

const settlement: ChargeSettlementRecord = {
  charge: {
    id: 'ch_1',
    fromAnyOf: ['pending'],
    to: 'paid',
    gatewayChargeId: 'gch_1',
    paidAt: at,
  },
  attempt: null,
  subscription: {
    id: 'sub_1',
    change: { fromAnyOf: ['incomplete', 'past_due'], to: 'active' },
  },
};

const recordedOutcome: RecordedOutcome = {
  charge,
  subscription,
  subscriptionChangeApplied: true,
  chargeSettledNow: true,
};

const report = (overrides: Partial<SettlementReport> = {}) => ({
  settlement,
  recorded: recordedOutcome,
  previousSubscriptionStatus: 'incomplete' as const,
  source: 'charge_flow' as const,
  ...overrides,
});

describe('logSettlementEvents', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the settlement and the subscription move it caused', () => {
    const recorded = recordPaymentEvents();

    logSettlementEvents(report());

    expect(eventNames(recorded)).toEqual([
      'charge.paid',
      'subscription.status_changed',
    ]);
  });

  it('logs nothing when the charge was already settled the same way', () => {
    const recorded = recordPaymentEvents();

    logSettlementEvents(
      report({ recorded: { ...recordedOutcome, chargeSettledNow: false } }),
    );

    expect(recorded).toEqual([]);
  });

  it('logs no subscription move when the change was not applied', () => {
    const recorded = recordPaymentEvents();

    logSettlementEvents(
      report({
        recorded: {
          ...recordedOutcome,
          subscriptionChangeApplied: false,
          subscription: { ...subscription, status: 'canceled' },
        },
      }),
    );

    expect(eventNames(recorded)).toEqual(['charge.paid']);
  });

  it('logs no subscription move when the subscription already had that status', () => {
    const recorded = recordPaymentEvents();

    logSettlementEvents(report({ previousSubscriptionStatus: 'active' }));

    expect(eventNames(recorded)).toEqual(['charge.paid']);
  });

  it('logs an expiry', () => {
    const recorded = recordPaymentEvents();

    logSettlementEvents(
      report({
        settlement: {
          ...settlement,
          subscription: { id: 'sub_1', change: null },
        },
        recorded: {
          ...recordedOutcome,
          charge: { ...charge, status: 'expired', paidAt: null },
        },
      }),
    );

    expect(recorded).toEqual([
      expect.objectContaining({
        event: 'charge.expired',
        chargeId: 'ch_1',
        gatewayChargeId: 'gch_1',
      }),
    ]);
  });
});
