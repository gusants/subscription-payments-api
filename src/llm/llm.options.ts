export const LLM_OPTIONS = Symbol('LLM_OPTIONS');

export type LlmThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface LlmOptions {
  model: string;
  timeoutMs: number;
  thinkingLevel: LlmThinkingLevel;
}
