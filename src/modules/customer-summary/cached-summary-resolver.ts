import { Logger } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Narration, SummaryRecord } from './customer-summary.js';
import { summaryCacheKey } from './domain/index.js';
import type { LruSummaryCache } from './lru-summary-cache.js';
import type { SummaryCacheOptions } from './summary-cache.options.js';
import { SummaryCacheStore } from './summary-cache.store.js';

export type CacheOutcome = 'hit' | 'miss' | 'coalesced' | 'bypass' | 'memory';

export interface ResolvedSummary {
  narration: Narration;
  cache: CacheOutcome;
}

export type GenerateSummary = () => Promise<Narration>;

class CacheUnavailableError extends Error {}

export class CachedSummaryResolver {
  private readonly logger = new Logger(CachedSummaryResolver.name);
  private readonly inFlight = new Map<string, Promise<ResolvedSummary>>();

  constructor(
    private readonly store: SummaryCacheStore,
    private readonly options: SummaryCacheOptions,
    private readonly memory: LruSummaryCache,
  ) {}

  resolve(
    customerId: string,
    lastEventId: string,
    generate: GenerateSummary,
  ): Promise<ResolvedSummary> {
    const key = summaryCacheKey(customerId, lastEventId, this.options);
    const running = this.inFlight.get(key);
    if (running) {
      return running.then(({ narration }) => sharedResult(narration.record));
    }
    const started = this.resolveThroughStore(key, generate).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, started);
    return started;
  }

  private async resolveThroughStore(
    key: string,
    generate: GenerateSummary,
  ): Promise<ResolvedSummary> {
    try {
      const cached = await this.viaStore(() => this.store.find(key));
      if (cached) return { narration: noCall(cached), cache: 'hit' };
      return await this.generateUnderLock(key, generate);
    } catch (error) {
      if (!(error instanceof CacheUnavailableError)) throw error;
      this.logger.warn(`summary cache unavailable: ${describe(error.cause)}`);
      return this.generateWithoutStore(key, generate);
    }
  }

  private async generateUnderLock(
    key: string,
    generate: GenerateSummary,
  ): Promise<ResolvedSummary> {
    const maxPolls = Math.ceil(this.options.waitMs / this.options.pollMs);
    for (let poll = 0; poll <= maxPolls; poll++) {
      const token = await this.viaStore(() =>
        this.store.acquireLock(key, this.options.lockSeconds),
      );
      if (token) return this.generateHoldingLock(key, token, generate);
      await sleep(this.options.pollMs);
      const cached = await this.viaStore(() => this.store.find(key));
      if (cached) return sharedResult(cached);
    }
    return this.generateWithoutStore(key, generate);
  }

  private async generateWithoutStore(
    key: string,
    generate: GenerateSummary,
  ): Promise<ResolvedSummary> {
    const remembered = this.memory.find(key);
    if (remembered) return { narration: noCall(remembered), cache: 'memory' };
    const narration = await generate();
    this.memory.save(
      key,
      narration.record,
      this.ttlSecondsOf(narration.record),
    );
    return { narration, cache: 'bypass' };
  }

  private async generateHoldingLock(
    key: string,
    token: string,
    generate: GenerateSummary,
  ): Promise<ResolvedSummary> {
    try {
      const cached = await this.viaStore(() => this.store.find(key));
      if (cached) return sharedResult(cached);
      const narration = await generate();
      await this.saveQuietly(key, narration.record);
      return { narration, cache: 'miss' };
    } finally {
      await this.store.releaseLock(key, token).catch((error: unknown) => {
        this.logger.warn(`summary lock release failed: ${describe(error)}`);
      });
    }
  }

  private ttlSecondsOf(record: SummaryRecord): number {
    return record.source === 'llm'
      ? this.options.ttlSeconds
      : this.options.fallbackTtlSeconds;
  }

  private async viaStore<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      throw new CacheUnavailableError('summary cache unavailable', { cause });
    }
  }

  private async saveQuietly(key: string, record: SummaryRecord): Promise<void> {
    try {
      await this.store.save(key, record, this.ttlSecondsOf(record));
    } catch (error) {
      this.logger.warn(`summary cache write failed: ${describe(error)}`);
    }
  }
}

function noCall(record: SummaryRecord): Narration {
  return { record, usage: null, failure: null };
}

function sharedResult(record: SummaryRecord): ResolvedSummary {
  return { narration: noCall(record), cache: 'coalesced' };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
