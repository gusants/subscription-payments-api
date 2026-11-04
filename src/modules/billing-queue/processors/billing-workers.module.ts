import { Module, type DynamicModule } from '@nestjs/common';
import { ChargesModule } from '../../charges/charges.module.js';
import { areBillingWorkersEnabled } from '../billing-queue-flags.js';
import { ChargeRetriesProcessor } from './charge-retries.processor.js';

@Module({})
export class BillingWorkersModule {
  static register(env: Record<string, unknown> = process.env): DynamicModule {
    const enabled = areBillingWorkersEnabled(env);
    return {
      module: BillingWorkersModule,
      imports: enabled ? [ChargesModule] : [],
      providers: enabled ? [ChargeRetriesProcessor] : [],
    };
  }
}
