import { Module, type DynamicModule } from '@nestjs/common';
import { ChargesModule } from '../../charges/charges.module.js';
import { areBillingWorkersEnabled } from '../billing-queue-flags.js';
import { BillingQueueConnection } from '../billing-queue-connection.js';
import { ChargeRetriesProcessor } from './charge-retries.processor.js';
import { ChargeRetriesWorker } from './charge-retries.worker.js';

@Module({})
export class BillingWorkersModule {
  static register(env: Record<string, unknown> = process.env): DynamicModule {
    const enabled = areBillingWorkersEnabled(env);
    return {
      module: BillingWorkersModule,
      imports: enabled ? [ChargesModule] : [],
      providers: enabled
        ? [BillingQueueConnection, ChargeRetriesProcessor, ChargeRetriesWorker]
        : [],
    };
  }
}
