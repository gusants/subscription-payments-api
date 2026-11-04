import type { NewSubscription } from '../subscriptions/subscription.js';
import type { ChargeStatus } from './charge-status.js';
import type {
  AttachedGatewayCharge,
  Charge,
  ChargeOutcomeRecord,
  GatewayAttempt,
  NewCharge,
  RecordedOutcome,
  SubscriptionWithCharge,
} from './charge.js';

export abstract class BillingRepository {
  abstract createSubscriptionWithFirstCharge(
    subscription: NewSubscription,
    charge: NewCharge,
  ): Promise<SubscriptionWithCharge>;

  abstract markChargePending(
    id: string,
    fromAnyOf: readonly ChargeStatus[],
    attempt: GatewayAttempt,
  ): Promise<Charge | null>;

  abstract takeAttemptLease(
    id: string,
    leaseExpiredBefore: Date,
    startedAt: Date,
  ): Promise<Charge | null>;

  abstract attachGatewayCharge(
    id: string,
    attached: AttachedGatewayCharge,
  ): Promise<Charge | null>;

  abstract recordChargeOutcome(
    record: ChargeOutcomeRecord,
  ): Promise<RecordedOutcome>;
}
