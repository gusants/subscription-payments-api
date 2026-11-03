export const CHARGE_STATUSES = [
  'pending',
  'paid',
  'failed',
  'expired',
  'uncollectible',
] as const;

export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

export const PAYMENT_ATTEMPT_RESULTS = ['succeeded', 'declined'] as const;

export type PaymentAttemptResult = (typeof PAYMENT_ATTEMPT_RESULTS)[number];
