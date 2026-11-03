import { Module } from '@nestjs/common';
import { BillingRepository } from './billing.repository.js';
import { PrismaBillingRepository } from './prisma-billing.repository.js';

@Module({
  providers: [
    { provide: BillingRepository, useClass: PrismaBillingRepository },
  ],
  exports: [BillingRepository],
})
export class ChargesModule {}
