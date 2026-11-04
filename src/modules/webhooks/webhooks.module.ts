import { Module } from '@nestjs/common';
import { GatewaySignatureGuard } from './gateway-signature.guard.js';
import { WebhooksController } from './webhooks.controller.js';

@Module({
  controllers: [WebhooksController],
  providers: [GatewaySignatureGuard],
})
export class WebhooksModule {}
