import {
  ExpressInstrumentation,
  ExpressLayerType,
} from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import type { Attributes } from '@opentelemetry/api';
import type { IncomingMessage } from 'node:http';
import { hasQueryString } from '../logging/redact-query.js';
import { REDACTED } from '../logging/redact-paths.js';

const UNTRACED_PATHS = new Set(['/health']);

function isUntracedRequest(request: IncomingMessage): boolean {
  return UNTRACED_PATHS.has(request.url ?? '');
}

export function redactedQueryAttributes(request: IncomingMessage): Attributes {
  return hasQueryString(request.url ?? '') ? { 'url.query': REDACTED } : {};
}

export function tracedInstrumentations() {
  return [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: isUntracedRequest,
      startIncomingSpanHook: redactedQueryAttributes,
    }),
    new ExpressInstrumentation({
      ignoreLayersType: [ExpressLayerType.MIDDLEWARE],
    }),
    new PgInstrumentation({
      requireParentSpan: true,
      ignoreConnectSpans: true,
    }),
    new IORedisInstrumentation({ requireParentSpan: true }),
  ];
}
