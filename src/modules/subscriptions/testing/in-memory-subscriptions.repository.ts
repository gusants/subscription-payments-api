import type {
  NewSubscription,
  StatusChange,
  Subscription,
} from '../subscription.js';
import { SubscriptionsRepository } from '../subscriptions.repository.js';

export class InMemorySubscriptionsRepository extends SubscriptionsRepository {
  private readonly subscriptions = new Map<string, Subscription>();

  create(subscription: NewSubscription): Promise<Subscription> {
    const now = new Date();
    const created: Subscription = {
      ...subscription,
      canceledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.subscriptions.set(created.id, created);
    return Promise.resolve({ ...created });
  }

  findById(id: string): Promise<Subscription | null> {
    const found = this.subscriptions.get(id);
    return Promise.resolve(found ? { ...found } : null);
  }

  changeStatus(
    id: string,
    { from, to, canceledAt }: StatusChange,
  ): Promise<Subscription | null> {
    const found = this.subscriptions.get(id);
    if (found?.status !== from) return Promise.resolve(null);
    const updated: Subscription = {
      ...found,
      status: to,
      canceledAt: canceledAt ?? found.canceledAt,
      updatedAt: new Date(),
    };
    this.subscriptions.set(id, updated);
    return Promise.resolve({ ...updated });
  }
}
