import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { SIGNATURE_HEADER } from '../../gateway/index.js';
import { Clock } from '../../shared/clock/index.js';
import type { Env } from '../../shared/config/env.schema.js';
import { checkWebhookSignature } from './domain/check-webhook-signature.js';

@Injectable()
export class GatewaySignatureGuard implements CanActivate {
  private readonly logger = new Logger(GatewaySignatureGuard.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly clock: Clock,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();
    const check = checkWebhookSignature({
      rawBody: request.rawBody ?? Buffer.alloc(0),
      header: request.header(SIGNATURE_HEADER),
      secret: this.config.get('GATEWAY_WEBHOOK_SECRET', { infer: true }),
      now: this.clock.now(),
    });
    if (check.accepted) return true;
    this.logger.warn(`Webhook rejected: ${check.reason}`);
    throw new UnauthorizedException('Invalid webhook signature');
  }
}
