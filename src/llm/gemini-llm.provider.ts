import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from '@google/genai';
import {
  LlmProvider,
  type LlmJsonRequest,
  type LlmJsonResponse,
} from './llm-provider.js';
import { requestSignal } from './request-signal.js';
import type { LlmOptions } from './llm.options.js';
import type { Clock } from '../shared/clock/clock.js';

export interface GeminiModelsClient {
  generateContent(
    params: GenerateContentParameters,
  ): Promise<GenerateContentResponse>;
}

const JSON_MIME_TYPE = 'application/json';
const MAX_OUTPUT_TOKENS = 1024;

export class GeminiLlmProvider extends LlmProvider {
  constructor(
    private readonly models: GeminiModelsClient,
    private readonly options: LlmOptions,
    private readonly clock: Clock,
  ) {
    super();
  }

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    const startedAt = this.clock.now().getTime();
    const response = await this.models.generateContent({
      model: this.options.model,
      contents: request.context,
      config: {
        systemInstruction: request.systemPrompt,
        responseMimeType: JSON_MIME_TYPE,
        responseJsonSchema: request.jsonSchema,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        httpOptions: { timeout: this.options.timeoutMs },
        abortSignal: requestSignal(this.options.timeoutMs, request.signal),
      },
    });
    return {
      text: response.text ?? '',
      model: response.modelVersion ?? this.options.model,
      inputTokens: response.usageMetadata?.promptTokenCount ?? null,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
      latencyMs: this.clock.now().getTime() - startedAt,
    };
  }
}
