import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { BullModule } from '@nestjs/bullmq';
import { Module, type DynamicModule } from '@nestjs/common';
import { isBullBoardEnabled } from './billing-queue-flags.js';
import { BillingQueueConnection } from './billing-queue-connection.js';
import { BillingQueueProducerConnection } from './billing-queue-producer-connection.js';
import { BillingQueueProducerConnectionModule } from './billing-queue-producer-connection.module.js';
import {
  BILLING_QUEUE_NAMES,
  BILLING_QUEUE_PREFIX,
  BULL_BOARD_ROUTE,
} from './billing-queue.constants.js';
import { BILLING_DEFAULT_JOB_OPTIONS } from './billing-queue.options.js';
import { BillingQueue } from './billing-queue.port.js';
import { BullMqBillingQueue } from './bullmq-billing-queue.js';

@Module({})
export class BillingQueueModule {
  static register(env: Record<string, unknown> = process.env): DynamicModule {
    return {
      module: BillingQueueModule,
      global: true,
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
        ...BILLING_QUEUE_NAMES.map((name) =>
          BullModule.registerQueueAsync({
            name,
            imports: [BillingQueueProducerConnectionModule],
            inject: [BillingQueueProducerConnection],
            useFactory: ({ redis }: BillingQueueProducerConnection) => ({
              connection: redis,
            }),
          }),
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
      ],
      providers: [{ provide: BillingQueue, useClass: BullMqBillingQueue }],
      exports: [BillingQueue],
    };
  }
}
