import {
  ExpressInstrumentation,
  ExpressLayerType,
} from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import type { IncomingMessage } from 'node:http';

const UNTRACED_PATHS = new Set(['/health']);

function isUntracedRequest(request: IncomingMessage): boolean {
  return UNTRACED_PATHS.has(request.url ?? '');
}

export function tracedInstrumentations() {
  return [
    new HttpInstrumentation({ ignoreIncomingRequestHook: isUntracedRequest }),
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
