import { Injectable } from '@nestjs/common';
import { Clock } from '../../shared/clock/index.js';
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
} from '../../shared/errors/index.js';
import { generateId, ID_PREFIXES } from '../../shared/ids/index.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { PlansRepository } from '../plans/plans.repository.js';
import { assertTransition, computePeriodEnd } from './domain/index.js';
import type { PaymentMethod, Subscription } from './subscription.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';

export interface CreateSubscriptionInput {
  customerId: string;
  planId: string;
  paymentMethod: PaymentMethod;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly subscriptions: SubscriptionsRepository,
    private readonly customers: CustomersRepository,
    private readonly plans: PlansRepository,
    private readonly clock: Clock,
  ) {}

  async create(input: CreateSubscriptionInput): Promise<Subscription> {
    const customer = await this.customers.findById(input.customerId);
    if (!customer) {
      throw new NotFoundError(`Customer ${input.customerId} not found`);
    }
    const plan = await this.plans.findById(input.planId);
    if (!plan) {
      throw new NotFoundError(`Plan ${input.planId} not found`);
    }
    if (!plan.active) {
      throw new UnprocessableError(`Plan ${plan.id} is not active`);
    }
    const periodStart = this.clock.now();
    return this.subscriptions.create({
      id: generateId(ID_PREFIXES.subscription),
      ...input,
      status: 'incomplete',
      currentPeriodStart: periodStart,
      currentPeriodEnd: computePeriodEnd(periodStart, plan.interval),
    });
  }

  async getById(id: string): Promise<Subscription> {
    const subscription = await this.subscriptions.findById(id);
    if (!subscription) {
      throw new NotFoundError(`Subscription ${id} not found`);
    }
    return subscription;
  }

  async cancel(id: string): Promise<Subscription> {
    const { status: from } = await this.getById(id);
    assertTransition(from, 'canceled');
    const canceled = await this.subscriptions.changeStatus(id, {
      from,
      to: 'canceled',
      canceledAt: this.clock.now(),
    });
    if (!canceled) {
      throw new ConflictError(`Subscription ${id} was modified concurrently`);
    }
    return canceled;
  }
}
