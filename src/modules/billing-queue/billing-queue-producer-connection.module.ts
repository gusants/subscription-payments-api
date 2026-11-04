import { Module } from '@nestjs/common';
import { BillingQueueProducerConnection } from './billing-queue-producer-connection.js';

@Module({
  providers: [BillingQueueProducerConnection],
  exports: [BillingQueueProducerConnection],
})
export class BillingQueueProducerConnectionModule {}
