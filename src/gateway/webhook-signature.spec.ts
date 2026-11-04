import { createHmac } from 'node:crypto';
import { SIGNATURE_HEADER, sign, verify } from './webhook-signature.js';

const secret = 'a-webhook-secret-with-at-least-32-characters';
const rawBody = '{"id":"evt_1","type":"charge.paid"}';
const timestamp = 1_793_700_000;

describe('webhook signature', () => {
  it('names the header the gateway sends', () => {
    expect(SIGNATURE_HEADER).toBe('x-gateway-signature');
  });

  describe('sign', () => {
    it('formats t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">', () => {
      const expected = createHmac('sha256', secret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      expect(sign(rawBody, secret, timestamp)).toBe(
        `t=${timestamp},v1=${expected}`,
      );
    });

    it('signs a Buffer body like its string form', () => {
      expect(sign(Buffer.from(rawBody), secret, timestamp)).toBe(
        sign(rawBody, secret, timestamp),
      );
    });
  });

  describe('verify', () => {
    const header = sign(rawBody, secret, timestamp);

    it('accepts a valid signature and reports its timestamp', () => {
      expect(verify(rawBody, header, secret)).toEqual({
        valid: true,
        timestamp,
      });
    });

    it('accepts a Buffer body', () => {
      expect(verify(Buffer.from(rawBody), header, secret).valid).toBe(true);
    });

    it('rejects a tampered body', () => {
      expect(verify(`${rawBody} `, header, secret)).toEqual({
        valid: false,
        reason: 'mismatch',
      });
    });

    it('rejects a signature made with another secret', () => {
      expect(
        verify(rawBody, header, 'another-secret-with-at-least-32-chars!'),
      ).toEqual({ valid: false, reason: 'mismatch' });
    });

    it('rejects a replay under a forged timestamp', () => {
      const forged = header.replace(`t=${timestamp}`, `t=${timestamp + 1}`);

      expect(verify(rawBody, forged, secret)).toEqual({
        valid: false,
        reason: 'mismatch',
      });
    });

    it('accepts the fields in any order, with spaces and unknown fields', () => {
      const [t, v1] = header.split(',');

      expect(verify(rawBody, `v0=ignored, ${v1}, ${t}`, secret).valid).toBe(
        true,
      );
    });

    it('accepts a header carrying several signatures when one matches', () => {
      const stale = `v1=${'0'.repeat(64)}`;

      expect(verify(rawBody, `${header},${stale}`, secret).valid).toBe(true);
    });

    it.each([
      ['an empty header', ''],
      ['a header without timestamp', `v1=${'a'.repeat(64)}`],
      ['a header without signature', `t=${timestamp}`],
      ['a non numeric timestamp', `t=yesterday,v1=${'a'.repeat(64)}`],
      ['a repeated timestamp', `t=1,t=2,v1=${'a'.repeat(64)}`],
      ['a signature that is not sha256 hex', `t=${timestamp},v1=abc`],
      [
        'a signature with non hex characters',
        `t=${timestamp},v1=${'z'.repeat(64)}`,
      ],
    ])('rejects %s as malformed', (_, malformed) => {
      expect(verify(rawBody, malformed, secret)).toEqual({
        valid: false,
        reason: 'malformed',
      });
    });
  });
});
