import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../shared/errors/index.js';
import {
  paginate,
  toSkipTake,
  type Paginated,
  type PaginationQuery,
} from '../../shared/pagination/index.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import type { Subscription } from '../subscriptions/subscription.js';
import type { ChargeWithAttempts } from './charge.js';
import { ChargeProcessor } from './charge-processor.js';
import { ChargesRepository } from './charges.repository.js';

export interface ChargeRetryResult {
  charge: ChargeWithAttempts;
  subscription: Subscription;
}

@Injectable()
export class ChargesService {
  constructor(
    private readonly charges: ChargesRepository,
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
    const processed =
      found.charge.status === 'pending'
        ? await this.chargeProcessor.reconcile(found.charge)
        : await this.chargeProcessor.retry(found.charge);
    const charge = await this.charges.findWithAttempts(id);
    if (!charge) {
      throw new NotFoundError(`Charge ${id} not found`);
    }
    return { charge, subscription: processed.subscription };
  }
}
