import { BadRequestException } from '@nestjs/common';
import {
  buildStoreKey,
  describeIdempotencyKey,
  fingerprintRequest,
  parseIdempotencyKey,
  readIdempotencyKey,
} from './idempotency-key.js';

describe('parseIdempotencyKey', () => {
  it.each(['a', 'order 42/retry', 'x'.repeat(255)])('accepts %j', (key) => {
    expect(parseIdempotencyKey(key)).toBe(key);
  });

  it.each(['', 'x'.repeat(256), 'café', 'line\nbreak', 'tab\t'])(
    'rejects %j',
    (key) => {
      expect(() => parseIdempotencyKey(key)).toThrow(BadRequestException);
    },
  );
});

describe('readIdempotencyKey', () => {
  it('answers undefined when the header is absent', () => {
    expect(readIdempotencyKey(undefined)).toBeUndefined();
  });

  it('answers the single header value', () => {
    expect(readIdempotencyKey(['order-42'])).toBe('order-42');
  });

  it('rejects a header sent more than once even when each value is valid', () => {
    expect(() => readIdempotencyKey(['a', 'b'])).toThrow(BadRequestException);
  });

  it('applies the key format to the single value', () => {
    expect(() => readIdempotencyKey([''])).toThrow(BadRequestException);
  });
});

describe('buildStoreKey', () => {
  it('scopes the key by method and resolved path', () => {
    expect(buildStoreKey('POST', '/charges/ch_x/retry', 'k1')).toBe(
      'idempotency:POST:/charges/ch_x/retry:k1',
    );
  });
});

describe('describeIdempotencyKey', () => {
  it('names the route and a short digest instead of the key', () => {
    const label = describeIdempotencyKey('POST', '/subscriptions', 'k-secret');

    expect(label).toMatch(
      /^POST \/subscriptions \(Idempotency-Key sha256 [0-9a-f]{12}\)$/,
    );
    expect(label).not.toContain('k-secret');
  });

  it('tells two keys apart and gives the same key the same digest', () => {
    const label = (key: string) => describeIdempotencyKey('POST', '/p', key);

    expect(label('k1')).toBe(label('k1'));
    expect(label('k1')).not.toBe(label('k2'));
  });
});

describe('fingerprintRequest', () => {
  it('is stable across body key order', () => {
    expect(fingerprintRequest('POST', '/p', { a: 1, b: 2 })).toBe(
      fingerprintRequest('POST', '/p', { b: 2, a: 1 }),
    );
  });

  it('changes with the body and with the path', () => {
    const base = fingerprintRequest('POST', '/p', { a: 1 });

    expect(fingerprintRequest('POST', '/p', { a: 2 })).not.toBe(base);
    expect(fingerprintRequest('POST', '/q', { a: 1 })).not.toBe(base);
  });

  it('is a SHA-256 hex digest', () => {
    expect(fingerprintRequest('POST', '/p', undefined)).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
