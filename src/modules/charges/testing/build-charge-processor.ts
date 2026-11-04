import type { PaymentGateway } from '../../../gateway/index.js';
import type { Clock } from '../../../shared/clock/index.js';
import type { CustomersRepository } from '../../customers/customers.repository.js';
import type { InMemorySubscriptionsRepository } from '../../subscriptions/testing/in-memory-subscriptions.repository.js';
import { RecordingBillingQueue } from '../../billing-queue/testing/recording-billing-queue.js';
import { ChargeDunning } from '../charge-dunning.js';
import { ChargeProcessor } from '../charge-processor.js';
import type { InMemoryBillingRepository } from './in-memory-billing.repository.js';
import { InMemoryChargesRepository } from './in-memory-charges.repository.js';

export const TEST_ATTEMPT_LEASE_MS = 30_000;

export interface ChargeProcessorParts {
  billing: InMemoryBillingRepository;
  subscriptions: InMemorySubscriptionsRepository;
  customers: CustomersRepository;
  gateway: PaymentGateway;
  clock: Clock;
  queue?: RecordingBillingQueue;
}

export function buildChargeDunning(
  billing: InMemoryBillingRepository,
  clock: Clock,
  queue: RecordingBillingQueue = new RecordingBillingQueue(),
): ChargeDunning {
  return new ChargeDunning(billing, queue, clock, 'days');
}

export function buildChargeProcessor({
  billing,
  subscriptions,
  customers,
  gateway,
  clock,
  queue,
}: ChargeProcessorParts): ChargeProcessor {
  return new ChargeProcessor(
    billing,
    new InMemoryChargesRepository(billing, subscriptions),
    customers,
    gateway,
    clock,
    buildChargeDunning(billing, clock, queue),
    TEST_ATTEMPT_LEASE_MS,
  );
}
