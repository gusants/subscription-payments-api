export type LlmFailureReason =
  | 'timeout'
  | 'rate_limited'
  | 'unavailable'
  | 'rejected'
  | 'incomplete_response'
  | 'empty_response'
  | 'unknown';

export interface LlmProviderErrorOptions extends ErrorOptions {
  finishReason?: string;
}

export class LlmProviderError extends Error {
  readonly finishReason: string | null;

  constructor(
    readonly reason: LlmFailureReason,
    { finishReason, ...options }: LlmProviderErrorOptions = {},
  ) {
    super(`LLM provider failed: ${reason}`, options);
    this.name = 'LlmProviderError';
    this.finishReason = finishReason ?? null;
  }
}
