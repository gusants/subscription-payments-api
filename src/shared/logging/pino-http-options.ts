import type { Options } from 'pino-http';
import type { Env } from '../config/env.schema.js';
import {
  correlationIdOfRequest,
  currentCorrelationId,
} from '../correlation/index.js';
import { REDACT_PATHS, REDACTED } from './redact-paths.js';

interface LoggingSettings {
  nodeEnv: Env['NODE_ENV'];
  level: Env['LOG_LEVEL'];
}

const prettyTransport = {
  target: 'pino-pretty',
  options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' },
};

export function correlationMixin(): { correlationId?: string } {
  const correlationId = currentCorrelationId();
  return correlationId ? { correlationId } : {};
}

export function buildPinoHttpOptions({
  nodeEnv,
  level,
}: LoggingSettings): Options {
  const isDevelopment = nodeEnv === 'development';
  return {
    level,
    autoLogging: { ignore: (request) => request.url === '/health' },
    genReqId: correlationIdOfRequest,
    mixin: correlationMixin,
    redact: { paths: [...REDACT_PATHS], censor: REDACTED },
    ...(isDevelopment && { transport: prettyTransport }),
  };
}
