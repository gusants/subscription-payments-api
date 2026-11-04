import { BadRequestException } from '@nestjs/common';
import {
  buildStoreKey,
  fingerprintRequest,
  parseIdempotencyKey,
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

describe('buildStoreKey', () => {
  it('scopes the key by method and resolved path', () => {
    expect(buildStoreKey('POST', '/charges/ch_x/retry', 'k1')).toBe(
      'idempotency:POST:/charges/ch_x/retry:k1',
    );
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
