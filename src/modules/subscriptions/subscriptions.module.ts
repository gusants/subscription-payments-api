import { Module } from '@nestjs/common';
import { Clock, SystemClock } from '../../shared/clock/index.js';
import { ChargesModule } from '../charges/charges.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { PrismaSubscriptionsRepository } from './prisma-subscriptions.repository.js';
import { SubscriptionsController } from './subscriptions.controller.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';
import { SubscriptionsService } from './subscriptions.service.js';

@Module({
  imports: [ChargesModule, CustomersModule, PlansModule],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    {
      provide: SubscriptionsRepository,
      useClass: PrismaSubscriptionsRepository,
    },
    { provide: Clock, useClass: SystemClock },
  ],
})
export class SubscriptionsModule {}
