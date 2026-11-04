import { sign } from '../../../gateway/index.js';
import {
  checkWebhookSignature,
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
} from './check-webhook-signature.js';

describe('checkWebhookSignature', () => {
  const secret = 'unit-test-webhook-secret-with-32-chars';
  const rawBody = Buffer.from('{"id":"evt_1"}');
  const now = new Date('2026-03-01T12:00:00.000Z');
  const nowSeconds = now.getTime() / 1000;

  const check = (header: string | undefined, body: Buffer = rawBody) =>
    checkWebhookSignature({ rawBody: body, header, secret, now });

  it('accepts a signature made with the secret over the raw body', () => {
    expect(check(sign(rawBody, secret, nowSeconds))).toEqual({
      accepted: true,
    });
  });

  it('rejects a missing header', () => {
    expect(check(undefined)).toEqual({
      accepted: false,
      reason: 'missing_signature',
    });
  });

  it('rejects a malformed header', () => {
    expect(check('garbage')).toEqual({
      accepted: false,
      reason: 'malformed_signature',
    });
  });

  it('rejects a tampered body', () => {
    const header = sign(rawBody, secret, nowSeconds);

    expect(check(header, Buffer.from('{"id":"evt_2"}'))).toEqual({
      accepted: false,
      reason: 'signature_mismatch',
    });
  });

  it('rejects a signature made with another secret', () => {
    expect(
      check(
        sign(rawBody, 'another-secret-with-more-than-32-chars', nowSeconds),
      ),
    ).toEqual({
      accepted: false,
      reason: 'signature_mismatch',
    });
  });

  it('accepts a timestamp exactly at the tolerance on both sides', () => {
    for (const offset of [
      -WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
      WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
    ]) {
      expect(check(sign(rawBody, secret, nowSeconds + offset))).toEqual({
        accepted: true,
      });
    }
  });

  it('rejects a timestamp older than the tolerance', () => {
    const stale = nowSeconds - WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS - 1;

    expect(check(sign(rawBody, secret, stale))).toEqual({
      accepted: false,
      reason: 'stale_timestamp',
    });
  });

  it('rejects a timestamp further in the future than the tolerance', () => {
    const future = nowSeconds + WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS + 1;

    expect(check(sign(rawBody, secret, future))).toEqual({
      accepted: false,
      reason: 'future_timestamp',
    });
  });

  it('checks the signature before the age', () => {
    const stale = nowSeconds - WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS - 1;

    expect(
      check(sign(rawBody, 'wrong-secret-with-more-than-32-chars!!', stale)),
    ).toEqual({
      accepted: false,
      reason: 'signature_mismatch',
    });
  });
});
