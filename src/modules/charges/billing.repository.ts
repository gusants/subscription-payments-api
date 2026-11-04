import type { NewSubscription } from '../subscriptions/subscription.js';
import type { ChargeStatus } from './charge-status.js';
import type {
  AttachedGatewayCharge,
  Charge,
  ChargeSettlementRecord,
  DunningExhaustion,
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
    retryNumber: number,
  ): Promise<Charge | null>;

  abstract createRetryCharge(charge: NewCharge): Promise<Charge | null>;

  abstract recordDunningExhaustion(
    exhaustion: DunningExhaustion,
  ): Promise<boolean>;

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
    record: ChargeSettlementRecord,
  ): Promise<RecordedOutcome>;
}
