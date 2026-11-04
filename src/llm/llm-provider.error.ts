export type LlmFailureReason =
  | 'timeout'
  | 'rate_limited'
  | 'unavailable'
  | 'rejected'
  | 'incomplete_response'
  | 'empty_response'
  | 'unknown';

export class LlmProviderError extends Error {
  constructor(
    readonly reason: LlmFailureReason,
    options?: ErrorOptions,
  ) {
    super(`LLM provider failed: ${reason}`, options);
    this.name = 'LlmProviderError';
  }
}
