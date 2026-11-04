import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { Clock } from '../shared/clock/clock.js';
import type { Env } from '../shared/config/env.schema.js';
import { FakeLlmProvider } from './fake-llm.provider.js';
import { GeminiLlmProvider } from './gemini-llm.provider.js';
import { LlmProvider } from './llm-provider.js';
import { LLM_OPTIONS, type LlmOptions } from './llm.options.js';

@Module({
  providers: [
    {
      provide: LLM_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): LlmOptions => ({
        model: config.get('LLM_MODEL', { infer: true }),
        timeoutMs: config.get('LLM_TIMEOUT_MS', { infer: true }),
      }),
    },
    {
      provide: LlmProvider,
      inject: [ConfigService, LLM_OPTIONS, Clock],
      useFactory: (
        config: ConfigService<Env, true>,
        options: LlmOptions,
        clock: Clock,
      ): LlmProvider => {
        const providers: Record<Env['LLM_PROVIDER'], () => LlmProvider> = {
          fake: () => new FakeLlmProvider(options),
          gemini: () =>
            new GeminiLlmProvider(
              new GoogleGenAI({
                apiKey: config.get('GEMINI_API_KEY', { infer: true }),
              }).models,
              options,
              clock,
            ),
        };
        return providers[config.get('LLM_PROVIDER', { infer: true })]();
      },
    },
  ],
  exports: [LlmProvider],
})
export class LlmModule {}
