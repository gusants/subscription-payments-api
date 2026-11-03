import { toChargeSummaryResponse } from '../charges/charge-presenter.js';
import type { CreatedSubscriptionResponse } from './dto/created-subscription-response.dto.js';
import type { SubscriptionResponse } from './dto/subscription-response.dto.js';
import type { CreatedSubscription } from './subscriptions.service.js';
import type { Subscription } from './subscription.js';

export function toSubscriptionResponse(
  subscription: Subscription,
): SubscriptionResponse {
  return {
    id: subscription.id,
    customerId: subscription.customerId,
    planId: subscription.planId,
    paymentMethod: subscription.paymentMethod,
    status: subscription.status,
    billingAnchor: subscription.billingAnchor.toISOString(),
    currentPeriodStart: subscription.currentPeriodStart.toISOString(),
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    canceledAt: subscription.canceledAt?.toISOString() ?? null,
    createdAt: subscription.createdAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString(),
  };
}

export function toCreatedSubscriptionResponse({
  subscription,
  latestCharge,
}: CreatedSubscription): CreatedSubscriptionResponse {
  return {
    ...toSubscriptionResponse(subscription),
    latestCharge: latestCharge ? toChargeSummaryResponse(latestCharge) : null,
  };
}
