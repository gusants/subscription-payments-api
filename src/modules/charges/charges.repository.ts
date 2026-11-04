import type { PageWindow } from '../customers/customer.js';
import type {
  Charge,
  ChargePage,
  ChargeWithAttempts,
  ChargeWithSubscription,
} from './charge.js';

export abstract class ChargesRepository {
  abstract findWithSubscription(
    id: string,
  ): Promise<ChargeWithSubscription | null>;
  abstract findLiveByPeriod(
    subscriptionId: string,
    periodStart: Date,
  ): Promise<Charge | null>;
  abstract findWithAttempts(id: string): Promise<ChargeWithAttempts | null>;
  abstract listByCustomer(
    customerId: string,
    window: PageWindow,
  ): Promise<ChargePage>;
}
