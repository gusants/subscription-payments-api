export type StoredResponse = { statusCode: number; body: unknown };

export type IdempotencyRecord =
  | { state: 'in_progress'; fingerprint: string }
  | { state: 'completed'; fingerprint: string; response: StoredResponse };

export type AcquireResult =
  | { acquired: true; lockToken: string }
  | { acquired: false; existing: IdempotencyRecord };

export abstract class IdempotencyStore {
  abstract acquire(key: string, fingerprint: string): Promise<AcquireResult>;
  abstract complete(
    key: string,
    lockToken: string,
    fingerprint: string,
    response: StoredResponse,
  ): Promise<boolean>;
  abstract release(key: string, lockToken: string): Promise<boolean>;
  abstract extendLock(key: string, lockToken: string): Promise<boolean>;
}
