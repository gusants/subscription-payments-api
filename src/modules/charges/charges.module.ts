import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../shared/config/env.schema.js';
import { CustomersModule } from '../customers/customers.module.js';
import { BillingRepository } from './billing.repository.js';
import { CHARGE_ATTEMPT_LEASE_MS } from './charge-attempt-lease.js';
import { ChargeDunning } from './charge-dunning.js';
import { ChargeProcessor } from './charge-processor.js';
import {
  RECONCILIATION_BATCH_SIZE,
  RECONCILIATION_STALE_AFTER_MS,
} from './charge-reconciliation-options.js';
import { ChargeReconciliationRunner } from './charge-reconciliation-runner.js';
import { ChargeRetryRunner } from './charge-retry-runner.js';
import { PrismaRenewalsRepository } from './prisma-renewals.repository.js';
import { RENEWAL_BATCH_SIZE } from './renewal-batch-size.js';
import { RenewalsRepository } from './renewals.repository.js';
import { SubscriptionRenewalRunner } from './subscription-renewal-runner.js';
import { DUNNING_INTERVAL_UNIT } from './dunning-interval-unit.js';
import { ChargesController } from './charges.controller.js';
import { ChargesRepository } from './charges.repository.js';
import { ChargesService } from './charges.service.js';
import { PrismaBillingRepository } from './prisma-billing.repository.js';
import { PrismaChargesRepository } from './prisma-charges.repository.js';

const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_MINUTE = 60 * MILLISECONDS_PER_SECOND;

@Module({
  imports: [CustomersModule],
  controllers: [ChargesController],
  providers: [
    ChargesService,
    ChargeProcessor,
    ChargeDunning,
    ChargeRetryRunner,
    SubscriptionRenewalRunner,
    ChargeReconciliationRunner,
    {
      provide: RECONCILIATION_BATCH_SIZE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('RECONCILIATION_BATCH_SIZE', { infer: true }),
    },
    {
      provide: RECONCILIATION_STALE_AFTER_MS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('RECONCILIATION_STALE_AFTER_MINUTES', { infer: true }) *
        MILLISECONDS_PER_MINUTE,
    },
    { provide: RenewalsRepository, useClass: PrismaRenewalsRepository },
    {
      provide: RENEWAL_BATCH_SIZE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('RENEWAL_BATCH_SIZE', { infer: true }),
    },
    { provide: BillingRepository, useClass: PrismaBillingRepository },
    { provide: ChargesRepository, useClass: PrismaChargesRepository },
    {
      provide: DUNNING_INTERVAL_UNIT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('RETRY_INTERVAL_UNIT', { infer: true }),
    },
    {
      provide: CHARGE_ATTEMPT_LEASE_MS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('CHARGE_ATTEMPT_LEASE_SECONDS', { infer: true }) *
        MILLISECONDS_PER_SECOND,
    },
  ],
  exports: [
    BillingRepository,
    ChargeProcessor,
    ChargeDunning,
    ChargeRetryRunner,
    SubscriptionRenewalRunner,
    ChargeReconciliationRunner,
  ],
})
export class ChargesModule {}
