import { GoogleGenAI } from '@google/genai';
import { GeminiLlmProvider } from '../llm/gemini-llm.provider.js';
import {
  LlmCallLimiter,
  LlmProvider,
  LlmProviderError,
  type LlmJsonRequest,
  type LlmJsonResponse,
} from '../llm/index.js';
import { loadCustomerSummaryPrompt } from '../llm/prompt-loader.js';
import { SummaryNarrator } from '../modules/customer-summary/summary-narrator.js';
import {
  buildAnonymizedContext,
  computePaymentMetrics,
  type ContextCharge,
} from '../modules/customer-summary/domain/index.js';
import { envSchema } from '../shared/config/env.schema.js';
import { SystemClock } from '../shared/clock/index.js';

const SMOKE_ENV = envSchema.pick({
  LLM_PROVIDER: true,
  LLM_MODEL: true,
  LLM_TIMEOUT_MS: true,
  LLM_THINKING_LEVEL: true,
  GEMINI_API_KEY: true,
});

const SMOKE_NOW = new Date('2026-06-01T00:00:00.000Z');
const SMOKE_CUSTOMER_SINCE = new Date('2025-09-20T00:00:00.000Z');
const SMOKE_AMOUNT_CENTS = 1990;
const SMOKE_SUBSCRIPTION_ID = 'sub_smoke';

class RecordingLlmProvider extends LlmProvider {
  finishReason: string | null = null;

  constructor(private readonly inner: LlmProvider) {
    super();
  }

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    try {
      const response = await this.inner.generateJson(request);
      this.finishReason = response.finishReason;
      return response;
    } catch (error) {
      if (error instanceof LlmProviderError) {
        this.finishReason = error.finishReason;
      }
      throw error;
    }
  }
}

function fail(message: string): never {
  console.error(`llm:smoke: ${message}`);
  process.exit(1);
}

function syntheticCharges(): ContextCharge[] {
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const charge = (
    overrides: Partial<ContextCharge> & Pick<ContextCharge, 'periodStart'>,
  ): ContextCharge => ({
    subscriptionId: SMOKE_SUBSCRIPTION_ID,
    status: 'paid',
    method: 'pix',
    amountCents: SMOKE_AMOUNT_CENTS,
    dueDate: overrides.periodStart,
    paidAt: day('2026-04-12'),
    failureReason: null,
    ...overrides,
  });
  return [
    charge({ periodStart: day('2026-03-10'), paidAt: day('2026-03-10') }),
    charge({
      periodStart: day('2026-04-10'),
      status: 'expired',
      paidAt: null,
    }),
    charge({ periodStart: day('2026-04-10') }),
    charge({
      periodStart: day('2026-05-10'),
      status: 'failed',
      method: 'card',
      paidAt: null,
      failureReason: 'insufficient_funds',
    }),
  ];
}

const parsed = SMOKE_ENV.safeParse(process.env);
if (!parsed.success) {
  fail(`invalid environment: ${parsed.error.message}`);
}
const env = parsed.data;
if (env.LLM_PROVIDER !== 'gemini') {
  fail('set LLM_PROVIDER=gemini to call the real model');
}
if (env.GEMINI_API_KEY === undefined) {
  fail('set GEMINI_API_KEY to call the real model');
}

const clock = new SystemClock();
const recorder = new RecordingLlmProvider(
  new GeminiLlmProvider(
    new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }).models,
    {
      model: env.LLM_MODEL,
      timeoutMs: env.LLM_TIMEOUT_MS,
      thinkingLevel: env.LLM_THINKING_LEVEL,
    },
    clock,
  ),
);
const charges = syntheticCharges();
const metrics = computePaymentMetrics(
  {
    customerSince: SMOKE_CUSTOMER_SINCE,
    charges,
    attempts: [{ result: 'declined' }],
  },
  SMOKE_NOW,
);
const context = buildAnonymizedContext({
  plan: { interval: 'monthly', amountCents: SMOKE_AMOUNT_CENTS },
  charges,
  metrics,
});
const prompt = await loadCustomerSummaryPrompt();

const narration = await new SummaryNarrator(
  recorder,
  prompt,
  clock,
  new LlmCallLimiter(1, clock),
).narrate(context);

console.log(
  JSON.stringify(
    {
      source: narration.record.source,
      failure: narration.failure,
      promptVersion: prompt.version,
      model: narration.usage?.model ?? env.LLM_MODEL,
      inputTokens: narration.usage?.inputTokens ?? null,
      outputTokens: narration.usage?.outputTokens ?? null,
      latencyMs: narration.usage?.latencyMs ?? null,
      finishReason: recorder.finishReason,
      output: narration.record.output,
    },
    null,
    2,
  ),
);
process.exit(narration.record.source === 'llm' ? 0 : 1);
