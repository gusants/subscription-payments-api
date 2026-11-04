import { verify } from '../../../gateway/index.js';

export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

const MILLISECONDS_PER_SECOND = 1000;

export type WebhookRejection =
  | 'missing_signature'
  | 'malformed_signature'
  | 'signature_mismatch'
  | 'stale_timestamp'
  | 'future_timestamp';

export type WebhookSignatureCheck =
  { accepted: true } | { accepted: false; reason: WebhookRejection };

export interface WebhookSignatureInput {
  rawBody: Buffer;
  header: string | undefined;
  secret: string;
  now: Date;
}

const rejected = (reason: WebhookRejection): WebhookSignatureCheck => ({
  accepted: false,
  reason,
});

export function checkWebhookSignature({
  rawBody,
  header,
  secret,
  now,
}: WebhookSignatureInput): WebhookSignatureCheck {
  if (!header) return rejected('missing_signature');
  const verification = verify(rawBody, header, secret);
  if (!verification.valid) {
    return rejected(
      verification.reason === 'malformed'
        ? 'malformed_signature'
        : 'signature_mismatch',
    );
  }
  const ageSeconds =
    Math.floor(now.getTime() / MILLISECONDS_PER_SECOND) -
    verification.timestamp;
  if (ageSeconds > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    return rejected('stale_timestamp');
  }
  if (ageSeconds < -WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    return rejected('future_timestamp');
  }
  return { accepted: true };
}
