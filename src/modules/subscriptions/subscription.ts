import type { CancelReason } from './cancel-reason.js';
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
  cancelReason: CancelReason | null;
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

export interface BillingPeriod {
  start: Date;
  end: Date;
}

interface StatusChangeBase {
  fromAnyOf: readonly SubscriptionStatus[];
}

export interface CancelingStatusChange extends StatusChangeBase {
  to: 'canceled';
  canceledAt: Date;
  cancelReason: CancelReason;
}

export interface NonCancelingStatusChange extends StatusChangeBase {
  to: Exclude<SubscriptionStatus, 'canceled'>;
  canceledAt?: undefined;
  cancelReason?: undefined;
}

export type StatusChange = CancelingStatusChange | NonCancelingStatusChange;
