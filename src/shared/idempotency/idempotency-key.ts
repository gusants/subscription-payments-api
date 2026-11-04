import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';

const VALID_KEY = /^[\x20-\x7E]{1,255}$/;

export function parseIdempotencyKey(raw: string): string {
  if (!VALID_KEY.test(raw)) {
    throw new BadRequestException(
      'Idempotency-Key must be 1 to 255 printable ASCII characters',
    );
  }
  return raw;
}

export function readIdempotencyKey(
  headerValues: readonly string[] | undefined,
): string | undefined {
  if (headerValues === undefined) return undefined;
  if (headerValues.length > 1) {
    throw new BadRequestException('Idempotency-Key must be sent only once');
  }
  return parseIdempotencyKey(headerValues[0]!);
}

export function buildStoreKey(
  method: string,
  path: string,
  idempotencyKey: string,
): string {
  return `idempotency:${method}:${path}:${idempotencyKey}`;
}

export function fingerprintRequest(
  method: string,
  path: string,
  body: unknown,
): string {
  return createHash('sha256')
    .update(canonicalJson({ method, path, body }))
    .digest('hex');
}
