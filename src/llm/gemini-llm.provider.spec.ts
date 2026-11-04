import { Logger } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentResponse,
} from '@google/genai';
import type { MockInstance } from 'vitest';
import { FixedClock } from '../shared/clock/testing/fixed-clock.js';
import {
  GeminiLlmProvider,
  type GeminiModelsClient,
} from './gemini-llm.provider.js';
import type { LlmJsonRequest } from './llm-provider.js';
import { LlmProviderError } from './llm-provider.error.js';

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
    { model: 'gemini-test', timeoutMs: 5000, thinkingLevel: 'minimal' },
    clock,
  );

  let warn: MockInstance<Logger['warn']>;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    generateContent.mockReset();
    clock.set(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    warn.mockRestore();
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

  it.each([
    ['minimal', ThinkingLevel.MINIMAL],
    ['low', ThinkingLevel.LOW],
    ['medium', ThinkingLevel.MEDIUM],
    ['high', ThinkingLevel.HIGH],
  ] as const)(
    'configures %s thinking so reasoning does not eat the output budget',
    async (thinkingLevel, expected) => {
      const configured = new GeminiLlmProvider(
        { generateContent },
        { model: 'gemini-test', timeoutMs: 5000, thinkingLevel },
        clock,
      );
      generateContent.mockResolvedValue(reply({ text: '{}' }));

      await configured.generateJson(request);

      expect(generateContent.mock.calls[0]![0].config).toMatchObject({
        thinkingConfig: { thinkingLevel: expected },
      });
    },
  );

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
      finishReason: null,
      latencyMs: 0,
    });
  });

  it('falls back to the configured model and null tokens when the reply omits them', async () => {
    generateContent.mockResolvedValue(reply({ text: '{}' }));

    await expect(provider.generateJson(request)).resolves.toEqual({
      text: '{}',
      model: 'gemini-test',
      inputTokens: null,
      outputTokens: null,
      finishReason: null,
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
      { model: 'gemini-test', timeoutMs: 10, thinkingLevel: 'minimal' },
      clock,
    );
    generateContent.mockResolvedValue(reply({ text: '{}' }));

    await quick.generateJson(request);
    const signal = generateContent.mock.calls[0]![0].config!.abortSignal!;

    await vi.waitFor(() => expect(signal.aborted).toBe(true));
  });

  it('accepts a candidate that finished normally', async () => {
    generateContent.mockResolvedValue(
      reply({
        text: '{}',
        candidates: [{ finishReason: FinishReason.STOP }],
      }),
    );

    await expect(provider.generateJson(request)).resolves.toMatchObject({
      text: '{}',
    });
  });

  it.each([FinishReason.MAX_TOKENS, FinishReason.SAFETY])(
    'rejects a candidate that finished with %s',
    async (finishReason) => {
      generateContent.mockResolvedValue(
        reply({ text: '{"summary":"cut', candidates: [{ finishReason }] }),
      );

      await expect(provider.generateJson(request)).rejects.toMatchObject({
        reason: 'incomplete_response',
      });
    },
  );

  it('reports the finish reason of an accepted reply', async () => {
    generateContent.mockResolvedValue(
      reply({
        text: '{}',
        candidates: [{ finishReason: FinishReason.STOP }],
      }),
    );

    await expect(provider.generateJson(request)).resolves.toMatchObject({
      finishReason: 'STOP',
    });
  });

  it('carries the finish reason on the error and logs it with the token usage', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    generateContent.mockResolvedValue(
      reply({
        text: '',
        candidates: [{ finishReason: FinishReason.MAX_TOKENS }],
        usageMetadata: { candidatesTokenCount: 0, thoughtsTokenCount: 1024 },
      }),
    );

    const failure = await provider.generateJson(request).catch((e) => e);

    expect(failure).toMatchObject({
      reason: 'incomplete_response',
      finishReason: 'MAX_TOKENS',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        finishReason: 'MAX_TOKENS',
        outputTokens: 0,
        thoughtsTokens: 1024,
        thinkingLevel: 'minimal',
      }),
    );
  });

  it.each([undefined, ''])('rejects an empty reply (%j)', async (text) => {
    generateContent.mockResolvedValue(reply({ text }));

    await expect(provider.generateJson(request)).rejects.toMatchObject({
      reason: 'empty_response',
    });
  });

  it.each([
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [400, 'rejected'],
    [403, 'rejected'],
  ])('maps an ApiError with status %i to %s', async (status, reason) => {
    const cause = new ApiError({ message: 'nope', status });
    generateContent.mockRejectedValue(cause);

    const failure = await provider.generateJson(request).catch((e) => e);

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect(failure).toMatchObject({ reason, cause });
  });

  it('maps an abort to a timeout', async () => {
    generateContent.mockRejectedValue(
      new DOMException('This operation was aborted', 'AbortError'),
    );

    await expect(provider.generateJson(request)).rejects.toMatchObject({
      reason: 'timeout',
    });
  });

  it('maps any other failure to unknown', async () => {
    generateContent.mockRejectedValue(new Error('socket hang up'));

    await expect(provider.generateJson(request)).rejects.toMatchObject({
      reason: 'unknown',
    });
  });
});

describe('GeminiLlmProvider against a server that never answers', () => {
  const hangingServer: Server = createServer(() => undefined);
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) =>
      hangingServer.listen(0, '127.0.0.1', resolve),
    );
    const { port } = hangingServer.address() as { port: number };
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    hangingServer.closeAllConnections();
    await new Promise((resolve) => hangingServer.close(resolve));
  });

  it('surfaces the SDK abort as a timeout error', async () => {
    const sdk = new GoogleGenAI({
      apiKey: 'unused',
      httpOptions: { baseUrl },
    });
    const provider = new GeminiLlmProvider(
      sdk.models,
      { model: 'gemini-test', timeoutMs: 150, thinkingLevel: 'minimal' },
      new FixedClock(new Date('2026-01-01T00:00:00.000Z')),
    );

    await expect(provider.generateJson(request)).rejects.toMatchObject({
      reason: 'timeout',
      cause: { name: 'AbortError' },
    });
  });
});
