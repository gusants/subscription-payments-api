import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { BullModule } from '@nestjs/bullmq';
import { Module, type DynamicModule } from '@nestjs/common';
import {
  areBillingWorkersEnabled,
  isBullBoardEnabled,
} from './billing-queue-flags.js';
import { BillingQueueConnection } from './billing-queue-connection.js';
import {
  BILLING_QUEUE_NAMES,
  BILLING_QUEUE_PREFIX,
  BULL_BOARD_ROUTE,
} from './billing-queue.constants.js';
import { BILLING_DEFAULT_JOB_OPTIONS } from './billing-queue.options.js';
import { BillingQueue } from './billing-queue.port.js';
import { BullMqBillingQueue } from './bullmq-billing-queue.js';
import { BillingWorkersModule } from './processors/billing-workers.module.js';

@Module({})
export class BillingQueueModule {
  static register(env: Record<string, unknown> = process.env): DynamicModule {
    return {
      module: BillingQueueModule,
      imports: [
        BullModule.forRootAsync({
          extraProviders: [BillingQueueConnection],
          inject: [BillingQueueConnection],
          useFactory: ({ redis }: BillingQueueConnection) => ({
            connection: redis,
            prefix: BILLING_QUEUE_PREFIX,
            defaultJobOptions: BILLING_DEFAULT_JOB_OPTIONS,
          }),
        }),
        BullModule.registerQueue(
          ...BILLING_QUEUE_NAMES.map((name) => ({ name })),
        ),
        ...(isBullBoardEnabled(env)
          ? [
              BullBoardModule.forRoot({
                route: BULL_BOARD_ROUTE,
                adapter: ExpressAdapter,
              }),
              BullBoardModule.forFeature(
                ...BILLING_QUEUE_NAMES.map((name) => ({
                  name,
                  adapter: BullMQAdapter,
                })),
              ),
            ]
          : []),
        ...(areBillingWorkersEnabled(env) ? [BillingWorkersModule] : []),
      ],
      providers: [{ provide: BillingQueue, useClass: BullMqBillingQueue }],
      exports: [BillingQueue],
    };
  }
}
