import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-gateway-signature';

const SIGNATURE_VERSION = 'v1';
const SHA256_HEX = /^[0-9a-f]{64}$/i;

export type SignatureVerification =
  | { valid: true; timestamp: number }
  | { valid: false; reason: 'malformed' | 'mismatch' };

const digest = (
  rawBody: string | Buffer,
  secret: string,
  timestamp: number,
): Buffer =>
  createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();

export function sign(
  rawBody: string | Buffer,
  secret: string,
  timestamp: number,
): string {
  const signature = digest(rawBody, secret, timestamp).toString('hex');
  return `t=${timestamp},${SIGNATURE_VERSION}=${signature}`;
}

interface ParsedHeader {
  timestamp: number;
  signatures: string[];
}

function parseHeader(header: string): ParsedHeader | null {
  const fields = header.split(',').map((part) => part.trim().split('='));
  const timestamps = fields.filter(([key]) => key === 't');
  const signatures = fields
    .filter(([key]) => key === SIGNATURE_VERSION)
    .map(([, value]) => value ?? '')
    .filter((value) => SHA256_HEX.test(value));
  const [timestampField] = timestamps;
  const timestamp = Number(timestampField?.[1]);
  if (
    timestamps.length !== 1 ||
    !Number.isSafeInteger(timestamp) ||
    signatures.length === 0
  ) {
    return null;
  }
  return { timestamp, signatures };
}

export function verify(
  rawBody: string | Buffer,
  header: string,
  secret: string,
): SignatureVerification {
  const parsed = parseHeader(header);
  if (!parsed) return { valid: false, reason: 'malformed' };
  const expected = digest(rawBody, secret, parsed.timestamp);
  const matches = parsed.signatures.some((signature) =>
    timingSafeEqual(Buffer.from(signature, 'hex'), expected),
  );
  return matches
    ? { valid: true, timestamp: parsed.timestamp }
    : { valid: false, reason: 'mismatch' };
}
