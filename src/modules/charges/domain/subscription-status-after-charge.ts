import type { SubscriptionStatus } from '../../subscriptions/subscription-status.js';
import type { ChargeOutcome } from './charge-outcome.js';

type NonCanceledStatus = Exclude<SubscriptionStatus, 'canceled'>;

const SUBSCRIPTION_STATUS_AFTER_CHARGE: Readonly<
  Record<ChargeOutcome['chargeStatus'], NonCanceledStatus>
> = {
  paid: 'active',
  failed: 'past_due',
};

export function subscriptionStatusAfterCharge(
  current: SubscriptionStatus,
  chargeStatus: ChargeOutcome['chargeStatus'],
): NonCanceledStatus | null {
  const target = SUBSCRIPTION_STATUS_AFTER_CHARGE[chargeStatus];
  return target === current ? null : target;
}
