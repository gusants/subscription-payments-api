import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';

const VALID_KEY = /^[\x20-\x7E]{1,255}$/;
const LOGGED_KEY_DIGEST_LENGTH = 12;

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

export function describeIdempotencyKey(
  method: string,
  path: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(idempotencyKey)
    .digest('hex')
    .slice(0, LOGGED_KEY_DIGEST_LENGTH);
  return `${method} ${path} (Idempotency-Key sha256 ${digest})`;
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
