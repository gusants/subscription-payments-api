import type { SubscriptionResponse } from './dto/subscription-response.dto.js';
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
    currentPeriodStart: subscription.currentPeriodStart.toISOString(),
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    canceledAt: subscription.canceledAt?.toISOString() ?? null,
    createdAt: subscription.createdAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString(),
  };
}
