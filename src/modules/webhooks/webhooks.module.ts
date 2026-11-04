import { Module } from '@nestjs/common';
import { GatewaySignatureGuard } from './gateway-signature.guard.js';
import { PrismaWebhookEventsRepository } from './prisma-webhook-events.repository.js';
import { WebhookEventProcessor } from './webhook-event.processor.js';
import { WebhookEventsRepository } from './webhook-events.repository.js';
import { WebhooksController } from './webhooks.controller.js';

@Module({
  controllers: [WebhooksController],
  providers: [
    GatewaySignatureGuard,
    WebhookEventProcessor,
    {
      provide: WebhookEventsRepository,
      useClass: PrismaWebhookEventsRepository,
    },
  ],
})
export class WebhooksModule {}
