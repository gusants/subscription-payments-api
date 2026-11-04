import {
  LlmProvider,
  type LlmJsonRequest,
  type LlmJsonResponse,
} from './llm-provider.js';
import { requestSignal } from './request-signal.js';
import type { LlmOptions } from './llm.options.js';

export type FakeLlmMode = 'ok' | 'error' | 'timeout' | 'invalid_json';

export const FAKE_LLM_MODEL = 'fake-llm';

export const FAKE_LLM_JSON = JSON.stringify({
  summary: 'Customer pays on time with no recent failures.',
  paymentBehavior: 'on_time',
  riskLevel: 'low',
  suggestedAction: 'No action needed.',
});

export const FAKE_LLM_INVALID_JSON = '{"summary": "truncated';

export class FakeLlmProvider extends LlmProvider {
  private mode: FakeLlmMode = 'ok';

  constructor(private readonly options: LlmOptions) {
    super();
  }

  setMode(mode: FakeLlmMode): void {
    this.mode = mode;
  }

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    if (this.mode === 'error') {
      throw new Error('fake llm failure');
    }
    if (this.mode === 'timeout') {
      return this.neverAnswer(request.signal);
    }
    return {
      text:
        this.mode === 'invalid_json' ? FAKE_LLM_INVALID_JSON : FAKE_LLM_JSON,
      model: FAKE_LLM_MODEL,
      inputTokens: null,
      outputTokens: null,
      latencyMs: 0,
    };
  }

  private neverAnswer(callerSignal?: AbortSignal): Promise<never> {
    const signal = requestSignal(this.options.timeoutMs, callerSignal);
    return new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      });
    });
  }
}
