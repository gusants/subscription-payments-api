import {
  FAKE_LLM_JSON,
  FakeLlmProvider,
  type FakeLlmMode,
} from '../../llm/fake-llm.provider.js';
import {
  LlmProvider,
  LlmProviderError,
  type LlmJsonRequest,
  type LlmJsonResponse,
} from '../../llm/index.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import {
  buildAnonymizedContext,
  type AnonymizedContext,
} from './domain/index.js';
import { SummaryNarrator } from './summary-narrator.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');
const prompt = { version: 'v1', text: 'system prompt' };

const context: AnonymizedContext = buildAnonymizedContext({
  customerId: 'cus_1',
  plan: { interval: 'monthly', amountCents: 1990 },
  charges: [],
  metrics: {
    monthsAsCustomer: 8,
    totalPaidCents: 39920,
    failedAttempts: 3,
    averageDaysLate: 2.4,
    paymentSuccessRate: 0.85,
  },
});

class ScriptedLlm extends LlmProvider {
  requests: LlmJsonRequest[] = [];

  constructor(private readonly respond: () => Promise<LlmJsonResponse>) {
    super();
  }

  generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    this.requests.push(request);
    return this.respond();
  }
}

function replyWith(text: string): ScriptedLlm {
  return new ScriptedLlm(() =>
    Promise.resolve({
      text,
      model: 'scripted',
      inputTokens: 100,
      outputTokens: 20,
      latencyMs: 42,
    }),
  );
}

function narratorFor(llm: LlmProvider): SummaryNarrator {
  return new SummaryNarrator(llm, prompt, new FixedClock(NOW));
}

describe('SummaryNarrator', () => {
  it('returns the validated LLM output with its usage', async () => {
    const narration = await narratorFor(replyWith(FAKE_LLM_JSON)).narrate(
      context,
    );

    expect(narration).toEqual({
      record: {
        source: 'llm',
        promptVersion: 'v1',
        generatedAt: NOW,
        output: JSON.parse(FAKE_LLM_JSON),
      },
      usage: {
        model: 'scripted',
        inputTokens: 100,
        outputTokens: 20,
        latencyMs: 42,
      },
      failure: null,
    });
  });

  it('sends the prompt, the serialized context and the schema derived from the output type', async () => {
    const llm = replyWith(FAKE_LLM_JSON);

    await narratorFor(llm).narrate(context);

    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]).toMatchObject({
      systemPrompt: 'system prompt',
      context: JSON.stringify(context),
      jsonSchema: { type: 'object' },
    });
  });

  it.each([
    'Customer paid 999999 cents with 42 failures.',
    'Customer owes 1.234,56 in total.',
  ])('falls back when the narration invents numbers (%s)', async (summary) => {
    const reply = JSON.stringify({ ...JSON.parse(FAKE_LLM_JSON), summary });

    const narration = await narratorFor(replyWith(reply)).narrate(context);

    expect(narration.record.source).toBe('fallback');
    expect(narration.failure).toBe('unsupported_number');
    expect(narration.usage).toMatchObject({ model: 'scripted' });
  });

  it('falls back when the suggested action invents a number', async () => {
    const reply = JSON.stringify({
      ...JSON.parse(FAKE_LLM_JSON),
      suggestedAction: 'Call the customer within 48 hours.',
    });

    const narration = await narratorFor(replyWith(reply)).narrate(context);

    expect(narration.failure).toBe('unsupported_number');
  });

  it('keeps a narration whose numbers come from the context', async () => {
    const reply = JSON.stringify({
      ...JSON.parse(FAKE_LLM_JSON),
      summary:
        'Customer for 8 months paid 399.20, 85% of periods paid, 3 failed attempts.',
    });

    const narration = await narratorFor(replyWith(reply)).narrate(context);

    expect(narration.record.source).toBe('llm');
    expect(narration.failure).toBeNull();
  });

  it('never uses numbers coming from the LLM', async () => {
    const withNumbers = JSON.stringify({
      ...JSON.parse(FAKE_LLM_JSON),
      metrics: { totalPaidCents: 1 },
      totalPaidCents: 1,
    });

    const narration = await narratorFor(replyWith(withNumbers)).narrate(
      context,
    );

    expect(Object.keys(narration.record.output).sort()).toEqual([
      'paymentBehavior',
      'riskLevel',
      'suggestedAction',
      'summary',
    ]);
  });

  it.each<[FakeLlmMode, string]>([
    ['error', 'unknown'],
    ['timeout', 'unknown'],
    ['invalid_json', 'invalid_output'],
  ])(
    'falls back when the fake provider is in %s mode',
    async (mode, failure) => {
      const llm = new FakeLlmProvider({ model: 'fake', timeoutMs: 10 });
      llm.setMode(mode);

      const narration = await narratorFor(llm).narrate(context);

      expect(narration.record.source).toBe('fallback');
      expect(narration.failure).toBe(failure);
      expect(narration.record.output).toMatchObject({
        paymentBehavior: 'occasional_delays',
        riskLevel: 'medium',
      });
    },
  );

  it('keeps the reason of a provider failure', async () => {
    const llm = new ScriptedLlm(() =>
      Promise.reject(new LlmProviderError('timeout')),
    );

    const narration = await narratorFor(llm).narrate(context);

    expect(narration).toMatchObject({
      record: { source: 'fallback', promptVersion: 'v1', generatedAt: NOW },
      usage: null,
      failure: 'timeout',
    });
  });

  it.each([
    ['an unknown enum value', { riskLevel: 'medio' }],
    ['a missing field', { suggestedAction: undefined }],
    ['an oversized summary', { summary: 'x'.repeat(5000) }],
  ])('falls back on %s and keeps the usage', async (_case, override) => {
    const invalid = JSON.stringify({
      ...JSON.parse(FAKE_LLM_JSON),
      ...override,
    });

    const narration = await narratorFor(replyWith(invalid)).narrate(context);

    expect(narration.record.source).toBe('fallback');
    expect(narration.failure).toBe('invalid_output');
    expect(narration.usage).toMatchObject({ model: 'scripted', latencyMs: 42 });
  });

  it('derives the fallback from the code metrics only', async () => {
    const llm = replyWith(
      JSON.stringify({ ...JSON.parse(FAKE_LLM_JSON), riskLevel: 'bogus' }),
    );

    const { record } = await narratorFor(llm).narrate(context);

    expect(record.output.summary).toContain('8 months');
    expect(record.output.summary).toContain('399.20');
    expect(record.output.summary).toContain('85%');
    expect(record.output.summary).toContain('3 failed payment attempts');
  });
});
