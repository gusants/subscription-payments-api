import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runWithCorrelationId } from './correlation-context.js';
import { correlationIdOfRequest } from './request-correlation-id.js';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ): void {
    runWithCorrelationId(correlationIdOfRequest(request, response), next);
  }
}
