import type { GenerateContentResponse } from '@google/genai';
import { FixedClock } from '../shared/clock/testing/fixed-clock.js';
import {
  GeminiLlmProvider,
  type GeminiModelsClient,
} from './gemini-llm.provider.js';
import type { LlmJsonRequest } from './llm-provider.js';

const request: LlmJsonRequest = {
  systemPrompt: 'be brief',
  context: '{"metrics":1}',
  jsonSchema: { type: 'object', properties: { summary: { type: 'string' } } },
};

function reply(overrides: Partial<GenerateContentResponse>) {
  return overrides as GenerateContentResponse;
}

describe('GeminiLlmProvider', () => {
  const generateContent = vi.fn<GeminiModelsClient['generateContent']>();
  const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));
  const provider = new GeminiLlmProvider(
    { generateContent },
    { model: 'gemini-test', timeoutMs: 5000 },
    clock,
  );

  beforeEach(() => {
    generateContent.mockReset();
    clock.set(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('asks for structured JSON with the system prompt and the context', async () => {
    generateContent.mockResolvedValue(reply({ text: '{}' }));

    await provider.generateJson(request);

    const params = generateContent.mock.calls[0]![0];
    expect(params.model).toBe('gemini-test');
    expect(params.contents).toBe(request.context);
    expect(params.config).toMatchObject({
      systemInstruction: 'be brief',
      responseMimeType: 'application/json',
      responseJsonSchema: request.jsonSchema,
      maxOutputTokens: 1024,
      httpOptions: { timeout: 5000 },
    });
  });

  it('maps text, model version and token usage', async () => {
    generateContent.mockResolvedValue(
      reply({
        text: '{"summary":"ok"}',
        modelVersion: 'gemini-test-001',
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 },
      }),
    );

    await expect(provider.generateJson(request)).resolves.toEqual({
      text: '{"summary":"ok"}',
      model: 'gemini-test-001',
      inputTokens: 120,
      outputTokens: 30,
      latencyMs: 0,
    });
  });

  it('falls back to the configured model and null tokens when the reply omits them', async () => {
    generateContent.mockResolvedValue(reply({}));

    await expect(provider.generateJson(request)).resolves.toEqual({
      text: '',
      model: 'gemini-test',
      inputTokens: null,
      outputTokens: null,
      latencyMs: 0,
    });
  });

  it('measures latency with the clock around the call', async () => {
    generateContent.mockImplementation(async () => {
      clock.set(new Date('2026-01-01T00:00:00.250Z'));
      return reply({ text: '{}' });
    });

    const response = await provider.generateJson(request);

    expect(response.latencyMs).toBe(250);
  });

  it('passes an abort signal that fires on the caller abort', async () => {
    generateContent.mockResolvedValue(reply({ text: '{}' }));
    const caller = new AbortController();

    await provider.generateJson({ ...request, signal: caller.signal });
    const signal = generateContent.mock.calls[0]![0].config!.abortSignal!;
    caller.abort();

    expect(signal.aborted).toBe(true);
  });

  it('passes an abort signal that fires on the configured timeout', async () => {
    const quick = new GeminiLlmProvider(
      { generateContent },
      { model: 'gemini-test', timeoutMs: 10 },
      clock,
    );
    generateContent.mockResolvedValue(reply({ text: '{}' }));

    await quick.generateJson(request);
    const signal = generateContent.mock.calls[0]![0].config!.abortSignal!;

    await vi.waitFor(() => expect(signal.aborted).toBe(true));
  });

  it('propagates SDK failures', async () => {
    generateContent.mockRejectedValue(new Error('429'));

    await expect(provider.generateJson(request)).rejects.toThrow('429');
  });
});
