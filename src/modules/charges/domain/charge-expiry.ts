import type { Subscription } from '../../subscriptions/subscription.js';
import type { Charge, ChargeSettlementRecord } from '../charge.js';
import { statusesAllowedToTransitionTo } from './charge-transitions.js';
import { subscriptionChange } from './subscription-change.js';
import { subscriptionStatusAfterExpiry } from './subscription-status-after-expiry.js';

export interface ChargeExpiry {
  charge: Pick<Charge, 'id'>;
  subscription: Pick<Subscription, 'id' | 'status'>;
  gatewayChargeId: string | null;
  now: Date;
}

export function expirySettlement({
  charge,
  subscription,
  gatewayChargeId,
  now,
}: ChargeExpiry): ChargeSettlementRecord {
  return {
    charge: {
      id: charge.id,
      fromAnyOf: statusesAllowedToTransitionTo('expired'),
      to: 'expired',
      gatewayChargeId,
      paidAt: null,
      firstFailedAt: now,
    },
    attempt: null,
    subscription: {
      id: subscription.id,
      change: subscriptionChange(
        subscription,
        subscriptionStatusAfterExpiry(subscription.status),
        now,
      ),
    },
  };
}
