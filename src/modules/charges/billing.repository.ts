import type { NewSubscription } from '../subscriptions/subscription.js';
import type {
  ChargeOutcomeRecord,
  NewCharge,
  SubscriptionWithCharge,
} from './charge.js';

export abstract class BillingRepository {
  abstract createSubscriptionWithFirstCharge(
    subscription: NewSubscription,
    charge: NewCharge,
  ): Promise<SubscriptionWithCharge>;

  abstract recordChargeOutcome(
    record: ChargeOutcomeRecord,
  ): Promise<SubscriptionWithCharge>;
}
