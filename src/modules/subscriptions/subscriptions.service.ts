import { Injectable } from '@nestjs/common';
import {
  GatewayUnavailableError,
  PaymentGateway,
} from '../../gateway/index.js';
import { Clock } from '../../shared/clock/index.js';
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  UnprocessableError,
} from '../../shared/errors/index.js';
import { generateId, ID_PREFIXES } from '../../shared/ids/index.js';
import { BillingRepository } from '../charges/billing.repository.js';
import type { Charge, ChargeSummary } from '../charges/charge.js';
import { assertBillable, nextGatewayAttempt } from '../charges/domain/index.js';
import { ChargeProcessor } from '../charges/charge-processor.js';
import type { Customer } from '../customers/customer.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import type { Plan } from '../plans/plan.js';
import { PlansRepository } from '../plans/plans.repository.js';
import {
  assertTransition,
  computePeriodEnd,
  statusesAllowedToTransitionTo,
} from './domain/index.js';
import type {
  NewSubscription,
  PaymentMethod,
  Subscription,
} from './subscription.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';

interface CreateSubscriptionBase {
  customerId: string;
  planId: string;
}

export type CreateSubscriptionInput =
  | (CreateSubscriptionBase & { paymentMethod: 'card'; cardToken: string })
  | (CreateSubscriptionBase & {
      paymentMethod: Exclude<PaymentMethod, 'card'>;
    });

export interface CreatedSubscription {
  subscription: Subscription;
  latestCharge: ChargeSummary | null;
}

const summarize = (
  { id, status, amountCents, expiresAt, paymentInstructions }: Charge,
  failureReason: ChargeSummary['failureReason'] = null,
): ChargeSummary => ({
  id,
  status,
  amountCents,
  failureReason,
  expiresAt,
  paymentInstructions,
});

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly subscriptions: SubscriptionsRepository,
    private readonly billing: BillingRepository,
    private readonly customers: CustomersRepository,
    private readonly plans: PlansRepository,
    private readonly gateway: PaymentGateway,
    private readonly clock: Clock,
    private readonly chargeProcessor: ChargeProcessor,
  ) {}

  async create(input: CreateSubscriptionInput): Promise<CreatedSubscription> {
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
    return this.createWithFirstCharge(input, customer, plan);
  }

  async getById(id: string): Promise<Subscription> {
    const subscription = await this.subscriptions.findById(id);
    if (!subscription) {
      throw new NotFoundError(`Subscription ${id} not found`);
    }
    return subscription;
  }

  async cancel(id: string): Promise<Subscription> {
    const { status } = await this.getById(id);
    assertTransition(status, 'canceled');
    const canceled = await this.subscriptions.changeStatus(id, {
      fromAnyOf: statusesAllowedToTransitionTo('canceled'),
      to: 'canceled',
      canceledAt: this.clock.now(),
    });
    if (!canceled) {
      throw new ConflictError(`Subscription ${id} was modified concurrently`);
    }
    return canceled;
  }

  async changeCardToken(id: string, cardToken: string): Promise<Subscription> {
    const { paymentMethod } = await this.getById(id);
    if (paymentMethod !== 'card') {
      throw new UnprocessableError(
        `Subscription ${id} is paid by ${paymentMethod}, not card`,
      );
    }
    const changed = await this.subscriptions.changeCardToken(id, cardToken);
    if (!changed) {
      throw new NotFoundError(`Subscription ${id} not found`);
    }
    return changed;
  }

  private async createWithFirstCharge(
    input: CreateSubscriptionInput,
    customer: Customer,
    plan: Plan,
  ): Promise<CreatedSubscription> {
    const gatewayCustomerId = await this.ensureGatewayCustomer(customer);
    const newSubscription = this.newSubscription(
      input,
      plan,
      input.paymentMethod === 'card' ? input.cardToken : null,
    );
    const chargeId = generateId(ID_PREFIXES.charge);
    const { subscription, charge } =
      await this.billing.createSubscriptionWithFirstCharge(newSubscription, {
        id: chargeId,
        subscriptionId: newSubscription.id,
        amountCents: plan.amountCents,
        method: input.paymentMethod,
        dueDate: newSubscription.billingAnchor,
        periodStart: newSubscription.currentPeriodStart,
        periodEnd: newSubscription.currentPeriodEnd,
        ...nextGatewayAttempt(
          { id: chargeId, attemptCount: 0 },
          this.clock.now(),
        ),
      });
    assertBillable(subscription);
    const processed = await this.chargeProcessor.process({
      charge,
      subscription,
      customer: { ...customer, gatewayCustomerId },
    });
    return {
      subscription: processed.subscription,
      latestCharge: summarize(processed.charge, processed.failureReason),
    };
  }

  private newSubscription(
    input: CreateSubscriptionInput,
    plan: Plan,
    cardToken: string | null,
  ): NewSubscription {
    const billingAnchor = this.clock.now();
    return {
      id: generateId(ID_PREFIXES.subscription),
      customerId: input.customerId,
      planId: input.planId,
      paymentMethod: input.paymentMethod,
      status: 'incomplete',
      cardToken,
      billingAnchor,
      currentPeriodStart: billingAnchor,
      currentPeriodEnd: computePeriodEnd(billingAnchor, plan.interval, 1),
    };
  }

  private async ensureGatewayCustomer(customer: Customer): Promise<string> {
    if (customer.gatewayCustomerId) {
      return customer.gatewayCustomerId;
    }
    try {
      const created = await this.gateway.createCustomer({
        externalRef: customer.id,
        name: customer.name,
        email: customer.email,
      });
      return await this.customers.assignGatewayCustomerId(
        customer.id,
        created.id,
      );
    } catch (error) {
      if (error instanceof GatewayUnavailableError) {
        throw new ServiceUnavailableError('Payment gateway is unavailable');
      }
      throw error;
    }
  }
}
