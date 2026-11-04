import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../shared/config/env.schema.js';
import { CustomersModule } from '../customers/customers.module.js';
import { BillingRepository } from './billing.repository.js';
import { CHARGE_ATTEMPT_LEASE_MS } from './charge-attempt-lease.js';
import { ChargeProcessor } from './charge-processor.js';
import { ChargesController } from './charges.controller.js';
import { ChargesRepository } from './charges.repository.js';
import { ChargesService } from './charges.service.js';
import { PrismaBillingRepository } from './prisma-billing.repository.js';
import { PrismaChargesRepository } from './prisma-charges.repository.js';

const MILLISECONDS_PER_SECOND = 1000;

@Module({
  imports: [CustomersModule],
  controllers: [ChargesController],
  providers: [
    ChargesService,
    ChargeProcessor,
    { provide: BillingRepository, useClass: PrismaBillingRepository },
    { provide: ChargesRepository, useClass: PrismaChargesRepository },
    {
      provide: CHARGE_ATTEMPT_LEASE_MS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('CHARGE_ATTEMPT_LEASE_SECONDS', { infer: true }) *
        MILLISECONDS_PER_SECOND,
    },
  ],
  exports: [BillingRepository, ChargeProcessor],
})
export class ChargesModule {}
