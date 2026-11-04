import { generateId, ID_PREFIXES } from '../ids/index.js';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

const CORRELATION_ID_FORMAT = /^[A-Za-z0-9._-]{8,128}$/;

export function isValidCorrelationId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && CORRELATION_ID_FORMAT.test(candidate);
}

export function generateCorrelationId(): string {
  return generateId(ID_PREFIXES.correlation);
}

export function acceptOrGenerateCorrelationId(candidate: unknown): string {
  return isValidCorrelationId(candidate) ? candidate : generateCorrelationId();
}
