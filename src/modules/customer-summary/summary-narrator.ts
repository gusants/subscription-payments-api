import {
  LlmProvider,
  LlmProviderError,
  type LlmJsonResponse,
} from '../../llm/index.js';
import type { Prompt } from '../../llm/prompt-loader.js';
import type { Clock } from '../../shared/clock/clock.js';
import type {
  LlmUsage,
  Narration,
  NarrationFailure,
  SummaryRecord,
  SummarySource,
} from './customer-summary.js';
import {
  buildFallbackSummary,
  findUnsupportedNumbers,
  latestPaymentMethod,
  parseSummaryOutput,
  SUMMARY_OUTPUT_JSON_SCHEMA,
  type AnonymizedContext,
  type SummaryOutput,
} from './domain/index.js';

export class SummaryNarrator {
  constructor(
    private readonly llm: LlmProvider,
    private readonly prompt: Prompt,
    private readonly clock: Clock,
  ) {}

  async narrate(context: AnonymizedContext): Promise<Narration> {
    const attempt = await this.askLlm(context);
    if ('failure' in attempt) {
      return this.fallback(context, attempt.failure);
    }
    const output = parseSummaryOutput(attempt.response.text);
    if (!output) {
      return this.fallback(context, 'invalid_output', attempt.response);
    }
    if (findUnsupportedNumbers(output, context).length > 0) {
      return this.fallback(context, 'unsupported_number', attempt.response);
    }
    return {
      record: this.record('llm', output),
      usage: usageOf(attempt.response),
      failure: null,
    };
  }

  private async askLlm(
    context: AnonymizedContext,
  ): Promise<{ response: LlmJsonResponse } | { failure: NarrationFailure }> {
    try {
      const response = await this.llm.generateJson({
        systemPrompt: this.prompt.text,
        context: JSON.stringify(context),
        jsonSchema: SUMMARY_OUTPUT_JSON_SCHEMA,
      });
      return { response };
    } catch (error) {
      return {
        failure: error instanceof LlmProviderError ? error.reason : 'unknown',
      };
    }
  }

  private fallback(
    context: AnonymizedContext,
    failure: NarrationFailure,
    response?: LlmJsonResponse,
  ): Narration {
    return {
      record: this.record(
        'fallback',
        buildFallbackSummary(context.metrics, latestPaymentMethod(context)),
      ),
      usage: response ? usageOf(response) : null,
      failure,
    };
  }

  private record(source: SummarySource, output: SummaryOutput): SummaryRecord {
    return {
      source,
      promptVersion: this.prompt.version,
      output,
      generatedAt: this.clock.now(),
    };
  }
}

function usageOf({
  model,
  inputTokens,
  outputTokens,
  latencyMs,
}: LlmJsonResponse): LlmUsage {
  return { model, inputTokens, outputTokens, latencyMs };
}
