import { Injectable, Logger } from '@nestjs/common';
import {
  GatewayUnavailableError,
  PaymentGateway,
  type GatewayCharge,
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
import {
  assertTransition as assertChargeTransition,
  toChargeOutcome,
  type ChargeOutcome,
} from '../charges/domain/index.js';
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
import type { SubscriptionStatus } from './subscription-status.js';
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

const SUBSCRIPTION_STATUS_AFTER_FIRST_CHARGE: Readonly<
  Record<ChargeOutcome['chargeStatus'], SubscriptionStatus>
> = {
  paid: 'active',
  failed: 'past_due',
};

const summarize = (
  { id, status, amountCents }: Charge,
  failureReason: ChargeSummary['failureReason'] = null,
): ChargeSummary => ({ id, status, amountCents, failureReason });

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly subscriptions: SubscriptionsRepository,
    private readonly billing: BillingRepository,
    private readonly customers: CustomersRepository,
    private readonly plans: PlansRepository,
    private readonly gateway: PaymentGateway,
    private readonly clock: Clock,
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
    if (input.paymentMethod !== 'card') {
      return this.createWithoutCharge(input, plan);
    }
    return this.createChargingCard(input, customer, plan);
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

  private async createWithoutCharge(
    input: CreateSubscriptionInput,
    plan: Plan,
  ): Promise<CreatedSubscription> {
    const subscription = await this.subscriptions.create(
      this.newSubscription(input, plan, null),
    );
    return { subscription, latestCharge: null };
  }

  private async createChargingCard(
    input: CreateSubscriptionInput & { paymentMethod: 'card' },
    customer: Customer,
    plan: Plan,
  ): Promise<CreatedSubscription> {
    const gatewayCustomerId = await this.ensureGatewayCustomer(customer);
    const newSubscription = this.newSubscription(input, plan, input.cardToken);
    const { subscription, charge } =
      await this.billing.createSubscriptionWithFirstCharge(newSubscription, {
        id: generateId(ID_PREFIXES.charge),
        subscriptionId: newSubscription.id,
        amountCents: plan.amountCents,
        method: input.paymentMethod,
        dueDate: newSubscription.billingAnchor,
        periodStart: newSubscription.currentPeriodStart,
        periodEnd: newSubscription.currentPeriodEnd,
      });
    const gatewayCharge = await this.requestGatewayCharge(
      charge,
      gatewayCustomerId,
      input.cardToken,
    );
    const outcome = gatewayCharge && toChargeOutcome(gatewayCharge);
    if (!gatewayCharge || !outcome) {
      return { subscription, latestCharge: summarize(charge) };
    }
    return this.settleFirstCharge(subscription, charge, gatewayCharge, outcome);
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

  private async requestGatewayCharge(
    charge: Charge,
    gatewayCustomerId: string,
    cardToken: string,
  ): Promise<GatewayCharge | null> {
    try {
      return await this.gateway.createCharge({
        gatewayCustomerId,
        amountCents: charge.amountCents,
        method: 'card',
        cardToken,
        externalRef: charge.id,
      });
    } catch (error) {
      if (error instanceof GatewayUnavailableError) {
        this.logger.warn(
          `Gateway unavailable for charge ${charge.id}; left pending for reconciliation`,
        );
        return null;
      }
      throw error;
    }
  }

  private async settleFirstCharge(
    subscription: Subscription,
    charge: Charge,
    gatewayCharge: GatewayCharge,
    outcome: ChargeOutcome,
  ): Promise<CreatedSubscription> {
    const subscriptionStatus =
      SUBSCRIPTION_STATUS_AFTER_FIRST_CHARGE[outcome.chargeStatus];
    assertChargeTransition(charge.status, outcome.chargeStatus);
    assertTransition(subscription.status, subscriptionStatus);
    const settled = await this.billing.recordChargeOutcome({
      charge: {
        id: charge.id,
        fromAnyOf: [charge.status],
        to: outcome.chargeStatus,
        gatewayChargeId: gatewayCharge.id,
        paidAt: outcome.chargeStatus === 'paid' ? this.clock.now() : null,
      },
      attempt: {
        id: generateId(ID_PREFIXES.paymentAttempt),
        chargeId: charge.id,
        gatewayChargeId: gatewayCharge.id,
        result: outcome.attemptResult,
        failureReason: outcome.failureReason,
      },
      subscription: {
        id: subscription.id,
        change: { fromAnyOf: [subscription.status], to: subscriptionStatus },
      },
    });
    return {
      subscription: settled.subscription,
      latestCharge: summarize(settled.charge, outcome.failureReason),
    };
  }
}
