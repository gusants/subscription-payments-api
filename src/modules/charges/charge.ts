import type { GatewayFailureReason } from '../../gateway/index.js';
import type {
  PaymentMethod,
  StatusChange,
  Subscription,
} from '../subscriptions/subscription.js';
import type { ChargeStatus, PaymentAttemptResult } from './charge-status.js';

export interface Charge {
  id: string;
  subscriptionId: string;
  amountCents: number;
  method: PaymentMethod;
  status: ChargeStatus;
  gatewayChargeId: string | null;
  gatewayAttemptKey: string | null;
  attemptStartedAt: Date | null;
  attemptCount: number;
  nextRetryAt: Date | null;
  dueDate: Date;
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewCharge = Pick<
  Charge,
  | 'id'
  | 'subscriptionId'
  | 'amountCents'
  | 'method'
  | 'dueDate'
  | 'periodStart'
  | 'periodEnd'
>;

export interface PaymentAttempt {
  id: string;
  chargeId: string;
  gatewayChargeId: string;
  result: PaymentAttemptResult;
  failureReason: GatewayFailureReason | null;
  createdAt: Date;
}

export type NewPaymentAttempt = Omit<PaymentAttempt, 'createdAt'>;

export interface ChargeSettlement {
  id: string;
  fromAnyOf: readonly ChargeStatus[];
  to: ChargeStatus;
  gatewayChargeId: string;
  paidAt: Date | null;
}

export interface ChargeOutcomeRecord {
  charge: ChargeSettlement;
  attempt: NewPaymentAttempt;
  subscription: { id: string; change: StatusChange | null };
}

export interface SubscriptionWithCharge {
  subscription: Subscription;
  charge: Charge;
}

export interface ChargeSummary {
  id: string;
  status: ChargeStatus;
  amountCents: number;
  failureReason: GatewayFailureReason | null;
}

export interface ChargeWithAttempts extends Charge {
  attempts: PaymentAttempt[];
}

export interface ChargeWithSubscription {
  charge: Charge;
  subscription: Subscription;
}

export interface ChargePage {
  items: ChargeWithAttempts[];
  total: number;
}
