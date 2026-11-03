export const SUBSCRIPTION_STATUSES = [
  'incomplete',
  'active',
  'past_due',
  'canceled',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
