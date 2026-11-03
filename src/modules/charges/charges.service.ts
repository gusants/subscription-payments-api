import { Injectable } from '@nestjs/common';
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
} from '../../shared/errors/index.js';
import {
  paginate,
  toSkipTake,
  type Paginated,
  type PaginationQuery,
} from '../../shared/pagination/index.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import type { Subscription } from '../subscriptions/subscription.js';
import { BillingRepository } from './billing.repository.js';
import type { ChargeWithAttempts } from './charge.js';
import { ChargeProcessor } from './charge-processor.js';
import { ChargesRepository } from './charges.repository.js';
import {
  assertTransition,
  statusesAllowedToTransitionTo,
} from './domain/index.js';

export interface ChargeRetryResult {
  charge: ChargeWithAttempts;
  subscription: Subscription;
}

@Injectable()
export class ChargesService {
  constructor(
    private readonly charges: ChargesRepository,
    private readonly billing: BillingRepository,
    private readonly customers: CustomersRepository,
    private readonly chargeProcessor: ChargeProcessor,
  ) {}

  async listByCustomer(
    customerId: string,
    query: PaginationQuery,
  ): Promise<Paginated<ChargeWithAttempts>> {
    if (!(await this.customers.findById(customerId))) {
      throw new NotFoundError(`Customer ${customerId} not found`);
    }
    const { items, total } = await this.charges.listByCustomer(
      customerId,
      toSkipTake(query),
    );
    return paginate(items, total, query);
  }

  async retry(id: string): Promise<ChargeRetryResult> {
    const found = await this.charges.findWithSubscription(id);
    if (!found) {
      throw new NotFoundError(`Charge ${id} not found`);
    }
    assertTransition(found.charge.status, 'pending');
    if (found.subscription.status === 'canceled') {
      throw new ConflictError(
        `Subscription ${found.subscription.id} is canceled`,
      );
    }
    const gatewayCustomerId = await this.gatewayCustomerIdOf(
      found.subscription.customerId,
    );
    const pending = await this.billing.markChargePending(
      id,
      statusesAllowedToTransitionTo('pending'),
    );
    if (!pending) {
      throw new ConflictError(`Charge ${id} was modified concurrently`);
    }
    const processed = await this.chargeProcessor.process({
      charge: pending,
      subscription: found.subscription,
      gatewayCustomerId,
    });
    const charge = await this.charges.findWithAttempts(id);
    if (!charge) {
      throw new NotFoundError(`Charge ${id} not found`);
    }
    return { charge, subscription: processed.subscription };
  }

  private async gatewayCustomerIdOf(customerId: string): Promise<string> {
    const customer = await this.customers.findById(customerId);
    if (!customer?.gatewayCustomerId) {
      throw new UnprocessableError(
        `Customer ${customerId} has no gateway customer`,
      );
    }
    return customer.gatewayCustomerId;
  }
}
