import type { GatewayEventType } from '../../../gateway/index.js';
import {
  CHARGE_STATUSES,
  type ChargeStatus,
} from '../../charges/charge-status.js';
import type { Charge } from '../../charges/charge.js';
import type { SubscriptionStatus } from '../../subscriptions/subscription-status.js';
import type { Subscription } from '../../subscriptions/subscription.js';
import type { WebhookDecision, WebhookTarget } from '../webhook-event.js';
import { decideWebhookEffect } from './decide-webhook-effect.js';

type OutcomeName = WebhookDecision['outcome'];

describe('decideWebhookEffect', () => {
  const now = new Date('2026-03-01T12:00:00.000Z');
  const occurredAt = new Date('2026-03-01T11:59:00.000Z');
  const EVENT_GATEWAY_CHARGE = 'gch_event';

  const charge = (overrides: Partial<Charge> = {}): Charge => ({
    id: 'ch_1',
    subscriptionId: 'sub_1',
    amountCents: 1990,
    method: 'pix',
    status: 'pending',
    gatewayChargeId: null,
    gatewayAttemptKey: 'ch_1:1',
    attemptStartedAt: null,
    attemptCount: 0,
    nextRetryAt: null,
    dueDate: now,
    periodStart: now,
    periodEnd: now,
    paidAt: null,
    expiresAt: null,
    paymentInstructions: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  const subscription = (status: SubscriptionStatus): Subscription => ({
    id: 'sub_1',
    customerId: 'cus_1',
    planId: 'plan_1',
    paymentMethod: 'pix',
    status,
    cardToken: null,
    billingAnchor: now,
    currentPeriodStart: now,
    currentPeriodEnd: now,
    canceledAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const target = (
    chargeStatus: ChargeStatus,
    options: {
      subscriptionStatus?: SubscriptionStatus;
      gatewayChargeId?: string | null;
      attemptRecorded?: boolean;
    } = {},
  ): WebhookTarget => ({
    charge: charge({
      status: chargeStatus,
      gatewayChargeId: options.gatewayChargeId ?? null,
    }),
    subscription: subscription(options.subscriptionStatus ?? 'incomplete'),
    attemptRecorded: options.attemptRecorded ?? false,
  });

  const decide = (
    type: GatewayEventType,
    webhookTarget: WebhookTarget | null,
    failureReason?: 'insufficient_funds',
  ) =>
    decideWebhookEffect({
      event: {
        type,
        gatewayChargeId: EVENT_GATEWAY_CHARGE,
        failureReason,
        occurredAt,
      },
      target: webhookTarget,
      now,
      attemptId: 'pa_1',
    });

  const MATRIX: [GatewayEventType, ChargeStatus, OutcomeName][] = [
    ['charge.paid', 'pending', 'applied'],
    ['charge.paid', 'paid', 'rejected_out_of_order'],
    ['charge.paid', 'failed', 'rejected_out_of_order'],
    ['charge.paid', 'expired', 'rejected_out_of_order'],
    ['charge.paid', 'uncollectible', 'rejected_out_of_order'],
    ['charge.failed', 'pending', 'applied'],
    ['charge.failed', 'paid', 'rejected_out_of_order'],
    ['charge.failed', 'failed', 'rejected_out_of_order'],
    ['charge.failed', 'expired', 'rejected_out_of_order'],
    ['charge.failed', 'uncollectible', 'rejected_out_of_order'],
    ['charge.expired', 'pending', 'applied'],
    ['charge.expired', 'paid', 'rejected_out_of_order'],
    ['charge.expired', 'failed', 'rejected_out_of_order'],
    ['charge.expired', 'expired', 'rejected_out_of_order'],
    ['charge.expired', 'uncollectible', 'rejected_out_of_order'],
  ];

  it('covers every event type against every charge status', () => {
    expect(MATRIX).toHaveLength(3 * CHARGE_STATUSES.length);
  });

  it.each(MATRIX)(
    '%s on a %s charge from another gateway charge is %s',
    (type, status, expected) => {
      const withOtherGatewayCharge = target(status, {
        gatewayChargeId: status === 'pending' ? null : 'gch_other',
      });

      expect(decide(type, withOtherGatewayCharge).outcome).toBe(expected);
    },
  );

  it('ignores an event for an unknown charge', () => {
    expect(decide('charge.paid', null)).toEqual({
      outcome: 'ignored_unknown_charge',
    });
  });

  describe.each([
    ['charge.paid', 'paid'],
    ['charge.failed', 'failed'],
    ['charge.expired', 'expired'],
  ] as const)('%s on a %s charge', (type, status) => {
    it('is a duplicate state when the charge already holds this gateway charge', () => {
      const settled = target(status, { gatewayChargeId: EVENT_GATEWAY_CHARGE });

      expect(decide(type, settled)).toEqual({
        outcome: 'ignored_duplicate_state',
      });
    });
  });

  describe.each(['charge.paid', 'charge.failed'] as const)(
    '%s on a pending charge whose attempt is already recorded',
    (type) => {
      it('is a duplicate state', () => {
        expect(
          decide(type, target('pending', { attemptRecorded: true })),
        ).toEqual({ outcome: 'ignored_duplicate_state' });
      });
    },
  );

  it('applies charge.expired on a pending charge even when an attempt exists', () => {
    expect(
      decide('charge.expired', target('pending', { attemptRecorded: true }))
        .outcome,
    ).toBe('applied');
  });

  describe('charge.paid on a pending charge', () => {
    it.each([
      ['incomplete', 'active'],
      ['past_due', 'active'],
    ] as const)(
      'settles it paid at the event time with a succeeded attempt and moves a %s subscription to %s',
      (subscriptionStatus, expected) => {
        const decision = decide(
          'charge.paid',
          target('pending', { subscriptionStatus }),
        );

        expect(decision).toEqual({
          outcome: 'applied',
          settlement: {
            charge: {
              id: 'ch_1',
              fromAnyOf: ['pending'],
              to: 'paid',
              gatewayChargeId: EVENT_GATEWAY_CHARGE,
              paidAt: occurredAt,
            },
            attempt: {
              id: 'pa_1',
              chargeId: 'ch_1',
              gatewayChargeId: EVENT_GATEWAY_CHARGE,
              result: 'succeeded',
              failureReason: null,
            },
            subscription: {
              id: 'sub_1',
              change: {
                fromAnyOf: expect.arrayContaining([subscriptionStatus]),
                to: expected,
              },
            },
          },
        });
      },
    );

    it('keeps an active subscription untouched', () => {
      const decision = decide(
        'charge.paid',
        target('pending', { subscriptionStatus: 'active' }),
      );

      expect(decision).toMatchObject({
        settlement: { subscription: { change: null } },
      });
    });

    it('keeps a canceled subscription canceled while still recording the payment', () => {
      const decision = decide(
        'charge.paid',
        target('pending', { subscriptionStatus: 'canceled' }),
      );

      expect(decision).toMatchObject({
        outcome: 'applied',
        settlement: {
          charge: { to: 'paid' },
          subscription: { change: null },
        },
      });
    });
  });

  describe('charge.failed on a pending charge', () => {
    it('records a failed charge, a declined attempt with the reason and moves the subscription to past_due', () => {
      const decision = decide(
        'charge.failed',
        target('pending', { subscriptionStatus: 'active' }),
        'insufficient_funds',
      );

      expect(decision).toEqual({
        outcome: 'applied',
        settlement: {
          charge: {
            id: 'ch_1',
            fromAnyOf: ['pending'],
            to: 'failed',
            gatewayChargeId: EVENT_GATEWAY_CHARGE,
            paidAt: null,
          },
          attempt: {
            id: 'pa_1',
            chargeId: 'ch_1',
            gatewayChargeId: EVENT_GATEWAY_CHARGE,
            result: 'declined',
            failureReason: 'insufficient_funds',
          },
          subscription: {
            id: 'sub_1',
            change: {
              fromAnyOf: expect.arrayContaining(['active']),
              to: 'past_due',
            },
          },
        },
      });
    });
  });

  describe('charge.expired on a pending charge', () => {
    it('cancels an incomplete subscription at the decision time without recording an attempt', () => {
      const decision = decide(
        'charge.expired',
        target('pending', { subscriptionStatus: 'incomplete' }),
      );

      expect(decision).toEqual({
        outcome: 'applied',
        settlement: {
          charge: {
            id: 'ch_1',
            fromAnyOf: ['pending'],
            to: 'expired',
            gatewayChargeId: EVENT_GATEWAY_CHARGE,
            paidAt: null,
          },
          attempt: null,
          subscription: {
            id: 'sub_1',
            change: {
              fromAnyOf: ['incomplete', 'active', 'past_due'],
              to: 'canceled',
              canceledAt: now,
            },
          },
        },
      });
    });

    it('moves an active subscription to past_due on a renewal', () => {
      const decision = decide(
        'charge.expired',
        target('pending', { subscriptionStatus: 'active' }),
      );

      expect(decision).toMatchObject({
        settlement: {
          subscription: {
            change: { fromAnyOf: ['incomplete', 'active'], to: 'past_due' },
          },
        },
      });
    });

    it.each(['past_due', 'canceled'] as const)(
      'leaves a %s subscription unchanged',
      (subscriptionStatus) => {
        const decision = decide(
          'charge.expired',
          target('pending', { subscriptionStatus }),
        );

        expect(decision).toMatchObject({
          outcome: 'applied',
          settlement: { subscription: { change: null } },
        });
      },
    );
  });
});
