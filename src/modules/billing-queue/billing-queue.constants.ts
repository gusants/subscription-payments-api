export const CHARGE_RETRIES_QUEUE = 'charge-retries';
export const SUBSCRIPTION_RENEWALS_QUEUE = 'subscription-renewals';
export const CHARGE_RECONCILIATION_QUEUE = 'charge-reconciliation';

export const BILLING_QUEUE_NAMES = [
  CHARGE_RETRIES_QUEUE,
  SUBSCRIPTION_RENEWALS_QUEUE,
  CHARGE_RECONCILIATION_QUEUE,
] as const;

export const BILLING_QUEUE_PREFIX = 'bull';
export const BULL_BOARD_ROUTE = '/queues';
