import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { CHARGE_RETRIES_QUEUE } from '../../src/modules/billing-queue/billing-queue.constants.js';
import { retryJobId } from '../../src/modules/billing-queue/domain/retry-schedule.js';
import { ChargeRetryRunner } from '../../src/modules/charges/charge-retry-runner.js';

export function findRetryJob(
  app: INestApplication,
  chargeId: string,
  attempt: number,
): Promise<Job | undefined> {
  return app
    .get<Queue>(getQueueToken(CHARGE_RETRIES_QUEUE))
    .getJob(retryJobId(chargeId, attempt));
}

export function runRetryJob(
  app: INestApplication,
  chargeId: string,
  attempt: number,
): Promise<void> {
  return app.get(ChargeRetryRunner).run({ chargeId, attempt });
}
