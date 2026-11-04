import {
  FAKE_LLM_INVALID_JSON,
  FAKE_LLM_JSON,
  FAKE_LLM_MODEL,
  FakeLlmProvider,
} from './fake-llm.provider.js';
import type { LlmJsonRequest } from './llm-provider.js';

const request: LlmJsonRequest = {
  systemPrompt: 'system',
  context: '{}',
  jsonSchema: { type: 'object' },
};

describe('FakeLlmProvider', () => {
  let provider: FakeLlmProvider;

  beforeEach(() => {
    provider = new FakeLlmProvider({ model: 'any', timeoutMs: 20 });
  });

  it('answers deterministically with valid JSON by default', async () => {
    const first = await provider.generateJson(request);
    const second = await provider.generateJson(request);

    expect(first).toEqual(second);
    expect(first).toEqual({
      text: FAKE_LLM_JSON,
      model: FAKE_LLM_MODEL,
      inputTokens: null,
      outputTokens: null,
      finishReason: 'STOP',
      latencyMs: 0,
    });
    expect(() => JSON.parse(first.text)).not.toThrow();
  });

  it('answers text that is not JSON in invalid_json mode', async () => {
    provider.setMode('invalid_json');

    const response = await provider.generateJson(request);

    expect(response.text).toBe(FAKE_LLM_INVALID_JSON);
    expect(() => JSON.parse(response.text)).toThrow();
  });

  it('fails in error mode', async () => {
    provider.setMode('error');

    await expect(provider.generateJson(request)).rejects.toThrow(
      'fake llm failure',
    );
  });

  it('rejects with a timeout once the configured timeout elapses', async () => {
    provider.setMode('timeout');

    await expect(provider.generateJson(request)).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });

  it('rejects in timeout mode when the caller aborts first', async () => {
    provider.setMode('timeout');
    const caller = new AbortController();
    const pending = provider.generateJson({
      ...request,
      signal: caller.signal,
    });

    caller.abort(new Error('caller gave up'));

    await expect(pending).rejects.toThrow('caller gave up');
  });

  it('can return to ok after a failing mode', async () => {
    provider.setMode('error');
    provider.setMode('ok');

    await expect(provider.generateJson(request)).resolves.toMatchObject({
      text: FAKE_LLM_JSON,
    });
  });
});
