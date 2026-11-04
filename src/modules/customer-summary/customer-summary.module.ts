import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { LlmCallLimiter, LlmModule, LlmProvider } from '../../llm/index.js';
import {
  loadCustomerSummaryPrompt,
  type Prompt,
} from '../../llm/prompt-loader.js';
import { Clock } from '../../shared/clock/clock.js';
import type { Env } from '../../shared/config/env.schema.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants.js';
import { CachedSummaryResolver } from './cached-summary-resolver.js';
import { CustomerSummaryController } from './customer-summary.controller.js';
import { CustomerSummaryRepository } from './customer-summary.repository.js';
import { CustomerSummaryService } from './customer-summary.service.js';
import { PrismaCustomerSummaryRepository } from './prisma-customer-summary.repository.js';
import { LruSummaryCache } from './lru-summary-cache.js';
import { RedisSummaryCacheStore } from './redis-summary-cache.store.js';
import {
  SUMMARY_CACHE_OPTIONS,
  type SummaryCacheOptions,
} from './summary-cache.options.js';
import { SummaryCacheStore } from './summary-cache.store.js';
import { SummaryNarrator } from './summary-narrator.js';

const CUSTOMER_SUMMARY_PROMPT = Symbol('CUSTOMER_SUMMARY_PROMPT');
const MILLISECONDS_PER_SECOND = 1000;
const LOCK_MARGIN_SECONDS = 5;
const WAIT_MARGIN_MS = 1000;
const POLL_MS = 50;

@Module({
  imports: [LlmModule],
  controllers: [CustomerSummaryController],
  providers: [
    CustomerSummaryService,
    {
      provide: CustomerSummaryRepository,
      useClass: PrismaCustomerSummaryRepository,
    },
    { provide: CUSTOMER_SUMMARY_PROMPT, useFactory: loadCustomerSummaryPrompt },
    {
      provide: SummaryNarrator,
      inject: [LlmProvider, CUSTOMER_SUMMARY_PROMPT, Clock, LlmCallLimiter],
      useFactory: (
        llm: LlmProvider,
        prompt: Prompt,
        clock: Clock,
        limiter: LlmCallLimiter,
      ) => new SummaryNarrator(llm, prompt, clock, limiter),
    },
    {
      provide: SUMMARY_CACHE_OPTIONS,
      inject: [ConfigService, CUSTOMER_SUMMARY_PROMPT],
      useFactory: (
        config: ConfigService<Env, true>,
        prompt: Prompt,
      ): SummaryCacheOptions => {
        const llmTimeoutMs = config.get('LLM_TIMEOUT_MS', { infer: true });
        return {
          ttlSeconds: config.get('CUSTOMER_SUMMARY_CACHE_TTL_SECONDS', {
            infer: true,
          }),
          fallbackTtlSeconds: config.get(
            'CUSTOMER_SUMMARY_FALLBACK_TTL_SECONDS',
            { infer: true },
          ),
          lockSeconds:
            Math.ceil(llmTimeoutMs / MILLISECONDS_PER_SECOND) +
            LOCK_MARGIN_SECONDS,
          waitMs: llmTimeoutMs + WAIT_MARGIN_MS,
          pollMs: POLL_MS,
          promptVersion: prompt.version,
          model: config.get('LLM_MODEL', { infer: true }),
        };
      },
    },
    {
      provide: SummaryCacheStore,
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => new RedisSummaryCacheStore(redis),
    },
    {
      provide: LruSummaryCache,
      inject: [ConfigService, Clock],
      useFactory: (config: ConfigService<Env, true>, clock: Clock) =>
        new LruSummaryCache(
          config.get('CUSTOMER_SUMMARY_MEMORY_CACHE_MAX_ENTRIES', {
            infer: true,
          }),
          clock,
        ),
    },
    {
      provide: CachedSummaryResolver,
      inject: [SummaryCacheStore, SUMMARY_CACHE_OPTIONS, LruSummaryCache],
      useFactory: (
        store: SummaryCacheStore,
        options: SummaryCacheOptions,
        memory: LruSummaryCache,
      ) => new CachedSummaryResolver(store, options, memory),
    },
  ],
})
export class CustomerSummaryModule {}
