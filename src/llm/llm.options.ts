export const LLM_OPTIONS = Symbol('LLM_OPTIONS');

export interface LlmOptions {
  model: string;
  timeoutMs: number;
}
