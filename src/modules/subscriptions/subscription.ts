import type { SubscriptionStatus } from './subscription-status.js';

export const PAYMENT_METHODS = ['card', 'pix', 'boleto'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface Subscription {
  id: string;
  customerId: string;
  planId: string;
  paymentMethod: PaymentMethod;
  status: SubscriptionStatus;
  cardToken: string | null;
  billingAnchor: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewSubscription = Pick<
  Subscription,
  | 'id'
  | 'customerId'
  | 'planId'
  | 'paymentMethod'
  | 'status'
  | 'cardToken'
  | 'billingAnchor'
  | 'currentPeriodStart'
  | 'currentPeriodEnd'
>;

export interface StatusChange {
  fromAnyOf: readonly SubscriptionStatus[];
  to: SubscriptionStatus;
  canceledAt?: Date;
}
