import type { PageWindow } from '../customers/customer.js';
import type {
  ChargePage,
  ChargeWithAttempts,
  ChargeWithSubscription,
} from './charge.js';

export abstract class ChargesRepository {
  abstract findWithSubscription(
    id: string,
  ): Promise<ChargeWithSubscription | null>;
  abstract findWithAttempts(id: string): Promise<ChargeWithAttempts | null>;
  abstract listByCustomer(
    customerId: string,
    window: PageWindow,
  ): Promise<ChargePage>;
}
