import { Logger } from '@nestjs/common';
import {
  ApiError,
  FinishReason,
  ThinkingLevel,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from '@google/genai';
import {
  LlmProvider,
  type LlmJsonRequest,
  type LlmJsonResponse,
} from './llm-provider.js';
import {
  LlmProviderError,
  type LlmFailureReason,
} from './llm-provider.error.js';
import { requestSignal } from './request-signal.js';
import type { LlmOptions, LlmThinkingLevel } from './llm.options.js';
import type { Clock } from '../shared/clock/clock.js';

export interface GeminiModelsClient {
  generateContent(
    params: GenerateContentParameters,
  ): Promise<GenerateContentResponse>;
}

const JSON_MIME_TYPE = 'application/json';
const MAX_OUTPUT_TOKENS = 1024;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const ABORT_ERROR_NAMES = ['AbortError', 'TimeoutError'];

const THINKING_LEVELS: Record<LlmThinkingLevel, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

export class GeminiLlmProvider extends LlmProvider {
  private readonly logger = new Logger(GeminiLlmProvider.name);

  constructor(
    private readonly models: GeminiModelsClient,
    private readonly options: LlmOptions,
    private readonly clock: Clock,
  ) {
    super();
  }

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    const startedAt = this.clock.now().getTime();
    const response = await this.callModel(request);
    return {
      text: this.completedText(response),
      model: response.modelVersion ?? this.options.model,
      inputTokens: response.usageMetadata?.promptTokenCount ?? null,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
      finishReason: finishReasonOf(response) ?? null,
      latencyMs: this.clock.now().getTime() - startedAt,
    };
  }

  private async callModel(
    request: LlmJsonRequest,
  ): Promise<GenerateContentResponse> {
    try {
      return await this.models.generateContent({
        model: this.options.model,
        contents: request.context,
        config: {
          systemInstruction: request.systemPrompt,
          responseMimeType: JSON_MIME_TYPE,
          responseJsonSchema: request.jsonSchema,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinkingConfig: {
            thinkingLevel: THINKING_LEVELS[this.options.thinkingLevel],
          },
          httpOptions: { timeout: this.options.timeoutMs },
          abortSignal: requestSignal(this.options.timeoutMs, request.signal),
        },
      });
    } catch (error) {
      throw new LlmProviderError(failureReasonOf(error), { cause: error });
    }
  }

  private completedText(response: GenerateContentResponse): string {
    const finishReason = finishReasonOf(response);
    if (finishReason !== undefined && finishReason !== FinishReason.STOP) {
      this.logIncomplete(response, finishReason);
      throw new LlmProviderError('incomplete_response', { finishReason });
    }
    if (!response.text) {
      this.logIncomplete(response, finishReason);
      throw new LlmProviderError('empty_response', {
        ...(finishReason && { finishReason }),
      });
    }
    return response.text;
  }

  private logIncomplete(
    response: GenerateContentResponse,
    finishReason: string | undefined,
  ): void {
    const usage = response.usageMetadata;
    this.logger.warn({
      msg: 'Gemini reply was not usable',
      finishReason: finishReason ?? null,
      model: this.options.model,
      thinkingLevel: this.options.thinkingLevel,
      outputTokens: usage?.candidatesTokenCount ?? null,
      thoughtsTokens: usage?.thoughtsTokenCount ?? null,
    });
  }
}

function failureReasonOf(error: unknown): LlmFailureReason {
  if (error instanceof ApiError) {
    if (error.status === HTTP_TOO_MANY_REQUESTS) return 'rate_limited';
    return error.status >= HTTP_SERVER_ERROR ? 'unavailable' : 'rejected';
  }
  if (error instanceof Error && ABORT_ERROR_NAMES.includes(error.name)) {
    return 'timeout';
  }
  return 'unknown';
}

function finishReasonOf(response: GenerateContentResponse) {
  return response.candidates?.[0]?.finishReason;
}
