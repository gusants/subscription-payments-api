const COLON_FREE_ID = /^[A-Za-z0-9_-]+$/;

export function retryJobId(chargeId: string, attempt: number): string {
  if (!COLON_FREE_ID.test(chargeId)) {
    throw new RangeError(`chargeId is not a valid job id segment: ${chargeId}`);
  }
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError(
      `attempt must be a positive integer, received ${attempt}`,
    );
  }
  return `retry:${chargeId}:${attempt}`;
}
