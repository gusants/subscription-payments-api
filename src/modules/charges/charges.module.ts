import { Module } from '@nestjs/common';
import { Clock, SystemClock } from '../../shared/clock/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { BillingRepository } from './billing.repository.js';
import { ChargeProcessor } from './charge-processor.js';
import { ChargesController } from './charges.controller.js';
import { ChargesRepository } from './charges.repository.js';
import { ChargesService } from './charges.service.js';
import { PrismaBillingRepository } from './prisma-billing.repository.js';
import { PrismaChargesRepository } from './prisma-charges.repository.js';

@Module({
  imports: [CustomersModule],
  controllers: [ChargesController],
  providers: [
    ChargesService,
    ChargeProcessor,
    { provide: BillingRepository, useClass: PrismaBillingRepository },
    { provide: ChargesRepository, useClass: PrismaChargesRepository },
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [BillingRepository, ChargeProcessor],
})
export class ChargesModule {}
