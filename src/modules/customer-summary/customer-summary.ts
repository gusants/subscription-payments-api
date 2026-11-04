import type { LlmFailureReason } from '../../llm/index.js';
import type { SummaryOutput } from './domain/index.js';

export type SummarySource = 'llm' | 'fallback';

export interface SummaryRecord {
  source: SummarySource;
  promptVersion: string;
  output: SummaryOutput;
  generatedAt: Date;
}

export type NarrationFailure = LlmFailureReason | 'invalid_output';

export interface LlmUsage {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

export interface Narration {
  record: SummaryRecord;
  usage: LlmUsage | null;
  failure: NarrationFailure | null;
}
