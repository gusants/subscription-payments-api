import type { NewSubscription } from '../subscriptions/subscription.js';
import type { ChargeStatus } from './charge-status.js';
import type {
  Charge,
  ChargeOutcomeRecord,
  NewCharge,
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
  ): Promise<Charge | null>;

  abstract recordChargeOutcome(
    record: ChargeOutcomeRecord,
  ): Promise<SubscriptionWithCharge>;
}
