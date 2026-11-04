export interface LlmJsonRequest {
  systemPrompt: string;
  context: string;
  jsonSchema: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface LlmJsonResponse {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
  latencyMs: number;
}

export abstract class LlmProvider {
  abstract generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse>;
}
