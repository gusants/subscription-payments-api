import type {
  NewSubscription,
  StatusChange,
  Subscription,
} from './subscription.js';

export abstract class SubscriptionsRepository {
  abstract create(subscription: NewSubscription): Promise<Subscription>;
  abstract findById(id: string): Promise<Subscription | null>;
  abstract changeCardToken(
    id: string,
    cardToken: string,
  ): Promise<Subscription | null>;
  abstract changeStatus(
    id: string,
    change: StatusChange,
  ): Promise<Subscription | null>;
}
