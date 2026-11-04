import { Injectable, Logger } from '@nestjs/common';
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../shared/errors/index.js';
import {
  paginate,
  toSkipTake,
  type Paginated,
  type PaginationQuery,
} from '../../shared/pagination/index.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { MAX_DUNNING_RETRIES } from './domain/retry-schedule.js';
import type { Subscription } from '../subscriptions/subscription.js';
import type { ChargeWithAttempts, ChargeWithSubscription } from './charge.js';
import { ChargeDunning } from './charge-dunning.js';
import { ChargeProcessor } from './charge-processor.js';
import { ChargesRepository } from './charges.repository.js';
import { assertBillable, assertTransition } from './domain/index.js';

export interface ChargeRetryResult {
  charge: ChargeWithAttempts;
  subscription: Subscription;
  queued: boolean;
}

@Injectable()
export class ChargesService {
  private readonly logger = new Logger(ChargesService.name);

  constructor(
    private readonly charges: ChargesRepository,
    private readonly customers: CustomersRepository,
    private readonly chargeProcessor: ChargeProcessor,
    private readonly dunning: ChargeDunning,
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
    if (found.charge.status === 'pending') {
      const { subscription } = await this.chargeProcessor.reconcile(
        found.charge,
      );
      return {
        charge: await this.chargeWithAttempts(id),
        subscription,
        queued: false,
      };
    }
    await this.enqueueRetry(found);
    return {
      charge: await this.chargeWithAttempts(id),
      subscription: found.subscription,
      queued: true,
    };
  }

  private async enqueueRetry({
    charge,
    subscription,
  }: ChargeWithSubscription): Promise<void> {
    if (charge.status === 'expired') {
      await this.assertNewestOfPeriod(charge);
    } else {
      assertTransition(charge.status, 'pending');
    }
    assertBillable(subscription);
    if (charge.retryCount >= MAX_DUNNING_RETRIES) {
      throw new ConflictError(
        `Charge ${charge.id} has used its ${MAX_DUNNING_RETRIES} retries`,
      );
    }
    try {
      await this.dunning.requestRetryNow(charge);
    } catch (error) {
      this.logger.error(
        `Could not enqueue retry ${charge.retryCount + 1} of charge ${charge.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableError('Retry queue is unavailable');
    }
  }

  private async assertNewestOfPeriod({
    id,
    subscriptionId,
    periodStart,
  }: ChargeWithSubscription['charge']): Promise<void> {
    const newest = await this.charges.findNewestByPeriod(
      subscriptionId,
      periodStart,
    );
    if (newest && newest.id !== id) {
      throw new ConflictError(
        `Charge ${id} was superseded by charge ${newest.id} for the same period`,
      );
    }
  }

  private async chargeWithAttempts(id: string): Promise<ChargeWithAttempts> {
    const charge = await this.charges.findWithAttempts(id);
    if (!charge) {
      throw new NotFoundError(`Charge ${id} not found`);
    }
    return charge;
  }
}
