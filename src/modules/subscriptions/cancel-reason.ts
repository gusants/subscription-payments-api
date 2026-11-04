export const CANCEL_REASONS = [
  'payment_failed',
  'customer_request',
  'initial_payment_expired',
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];
