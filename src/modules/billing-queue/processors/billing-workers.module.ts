import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../shared/config/env.schema.js';
import { ChargesModule } from '../../charges/charges.module.js';
import { areBillingWorkersEnabled } from '../billing-queue-flags.js';
import { BillingQueueConnection } from '../billing-queue-connection.js';
import { renewalIntervalMs } from '../domain/job-schedule.js';
import { RENEWAL_INTERVAL_MS } from '../recurring-job-intervals.js';
import { ChargeRetriesProcessor } from './charge-retries.processor.js';
import { ChargeRetriesWorker } from './charge-retries.worker.js';
import { SubscriptionRenewalsProcessor } from './subscription-renewals.processor.js';
import { SubscriptionRenewalsWorker } from './subscription-renewals.worker.js';

@Module({})
export class BillingWorkersModule {
  static register(env: Record<string, unknown> = process.env): DynamicModule {
    const enabled = areBillingWorkersEnabled(env);
    return {
      module: BillingWorkersModule,
      imports: enabled ? [ChargesModule] : [],
      providers: enabled
        ? [
            BillingQueueConnection,
            ChargeRetriesProcessor,
            ChargeRetriesWorker,
            SubscriptionRenewalsProcessor,
            SubscriptionRenewalsWorker,
            {
              provide: RENEWAL_INTERVAL_MS,
              inject: [ConfigService],
              useFactory: (config: ConfigService<Env, true>) =>
                renewalIntervalMs(
                  config.get('RETRY_INTERVAL_UNIT', { infer: true }),
                  config.get('RENEWAL_JOB_INTERVAL_SECONDS', { infer: true }),
                ),
            },
          ]
        : [],
    };
  }
}
