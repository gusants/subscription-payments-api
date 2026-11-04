import type {
  GatewayFailureReason,
  PaymentInstructions,
} from '../../gateway/index.js';
import type { Plan } from '../plans/plan.js';
import type {
  BillingPeriod,
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
  retryCount: number;
  firstFailedAt: Date | null;
  nextRetryAt: Date | null;
  dueDate: Date;
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date | null;
  expiresAt: Date | null;
  paymentInstructions: PaymentInstructions | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GatewayAttempt {
  gatewayAttemptKey: string;
  attemptStartedAt: Date;
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
> &
  GatewayAttempt &
  Partial<Pick<Charge, 'retryCount' | 'firstFailedAt'>>;

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
  firstFailedAt?: Date;
}

export interface ChargeOutcomeRecord {
  charge: ChargeSettlement;
  attempt: NewPaymentAttempt;
  subscription: {
    id: string;
    change: StatusChange | null;
    period?: BillingPeriod;
  };
}

export type ChargeSettlementRecord = Omit<ChargeOutcomeRecord, 'attempt'> & {
  attempt: NewPaymentAttempt | null;
};

export interface DunningExhaustion {
  charge: Pick<ChargeSettlement, 'id' | 'fromAnyOf'> | null;
  subscription: { id: string; change: StatusChange | null };
}

export interface RecordedOutcome {
  subscription: Subscription;
  charge: Charge;
  subscriptionChangeApplied: boolean;
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
  expiresAt: Date | null;
  paymentInstructions: PaymentInstructions | null;
}

export type AttachedGatewayCharge = Pick<
  Charge,
  'expiresAt' | 'paymentInstructions'
> & { gatewayChargeId: string };

export interface ChargeWithAttempts extends Charge {
  attempts: PaymentAttempt[];
}

export interface RenewalCandidate {
  subscription: Subscription;
  plan: Pick<Plan, 'amountCents' | 'interval'>;
}

export interface ChargeWithSubscription {
  charge: Charge;
  subscription: Subscription;
}

export interface ChargePage {
  items: ChargeWithAttempts[];
  total: number;
}
