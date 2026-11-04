import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  acceptOrGenerateCorrelationId,
  CORRELATION_ID_HEADER,
} from './correlation-id.js';

const resolvedByRequest = new WeakMap<IncomingMessage, string>();

export function correlationIdOfRequest(
  request: IncomingMessage,
  response: ServerResponse,
): string {
  const resolved = resolvedByRequest.get(request);
  if (resolved) return resolved;
  const correlationId = acceptOrGenerateCorrelationId(
    request.headers[CORRELATION_ID_HEADER],
  );
  resolvedByRequest.set(request, correlationId);
  if (!response.headersSent) {
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
  }
  return correlationId;
}
