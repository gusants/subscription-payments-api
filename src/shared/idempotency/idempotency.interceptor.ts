import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import {
  ConflictError,
  DomainError,
  ServiceUnavailableError,
  toErrorResponse,
  UnprocessableError,
} from '../errors/index.js';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_LOCK_HEARTBEAT_MS,
  IDEMPOTENT_REPLAYED_HEADER,
} from './idempotency.constants.js';
import {
  buildStoreKey,
  describeIdempotencyKey,
  fingerprintRequest,
  readIdempotencyKey,
} from './idempotency-key.js';
import { startLockHeartbeat } from './lock-heartbeat.js';
import { IDEMPOTENT_METADATA } from './idempotent.decorator.js';
import {
  type AcquireResult,
  type IdempotencyRecord,
  IdempotencyStore,
  type StoredResponse,
} from './idempotency.store.js';

const SETTLE_ATTEMPTS = 3;
const SETTLE_RETRY_BASE_DELAY_MS = 50;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const stackOf = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

const STORED_ERROR_STATUSES: ReadonlySet<number> = new Set([
  HttpStatus.NOT_FOUND,
  HttpStatus.CONFLICT,
  HttpStatus.UNPROCESSABLE_ENTITY,
]);

function isStorable(error: unknown, statusCode: number): boolean {
  const transient = error instanceof DomainError && error.transient;
  return !transient && STORED_ERROR_STATUSES.has(statusCode);
}

type Claim = {
  storeKey: string;
  keyLabel: string;
  fingerprint: string;
  lockToken: string;
};

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly store: IdempotencyStore,
    private readonly reflector: Reflector,
    @Inject(IDEMPOTENCY_LOCK_HEARTBEAT_MS)
    private readonly heartbeatMs: number,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (!this.isIdempotent(context)) {
      return next.handle();
    }
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const key = readIdempotencyKey(
      request.headersDistinct[IDEMPOTENCY_KEY_HEADER.toLowerCase()],
    );
    if (key === undefined) {
      return next.handle();
    }
    const fingerprint = fingerprintRequest(
      request.method,
      request.path,
      request.body,
    );
    const storeKey = buildStoreKey(request.method, request.path, key);
    const keyLabel = describeIdempotencyKey(request.method, request.path, key);

    const acquisition = await this.acquire(storeKey, fingerprint, keyLabel);
    if (!acquisition.acquired) {
      return this.replay(acquisition.existing, fingerprint, response);
    }
    const claim = {
      storeKey,
      keyLabel,
      fingerprint,
      lockToken: acquisition.lockToken,
    };
    return from(this.execute(next, claim, response));
  }

  private isIdempotent(context: ExecutionContext): boolean {
    return (
      context.getType() === 'http' &&
      this.reflector.get<boolean | undefined>(
        IDEMPOTENT_METADATA,
        context.getHandler(),
      ) === true
    );
  }

  private async acquire(
    storeKey: string,
    fingerprint: string,
    keyLabel: string,
  ): Promise<AcquireResult> {
    try {
      return await this.store.acquire(storeKey, fingerprint);
    } catch (error) {
      this.logger.error(
        `Could not acquire idempotency lock for ${keyLabel}: ${messageOf(error)}`,
        stackOf(error),
      );
      throw new ServiceUnavailableError('Idempotency store unavailable');
    }
  }

  private replay(
    existing: IdempotencyRecord,
    fingerprint: string,
    response: Response,
  ): Observable<unknown> {
    if (existing.fingerprint !== fingerprint) {
      throw new UnprocessableError(
        'Idempotency-Key was already used with a different request',
      );
    }
    if (existing.state === 'in_progress') {
      throw new ConflictError(
        'A request with this Idempotency-Key is still being processed',
      );
    }
    response.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    const { statusCode, body } = existing.response;
    if (statusCode >= HttpStatus.BAD_REQUEST) {
      throw new HttpException(body as object, statusCode);
    }
    response.status(statusCode);
    return from([body]);
  }

  private async execute(
    next: CallHandler,
    claim: Claim,
    response: Response,
  ): Promise<unknown> {
    let body: unknown;
    try {
      body = await this.withLockHeartbeat(claim, () =>
        lastValueFrom(next.handle(), { defaultValue: undefined }),
      );
    } catch (error) {
      await this.settleFailure(claim, error);
      throw error;
    }
    await this.complete(claim, { statusCode: response.statusCode, body });
    return body;
  }

  private async withLockHeartbeat<T>(
    claim: Claim,
    operation: () => Promise<T>,
  ): Promise<T> {
    const stopHeartbeat = startLockHeartbeat({
      intervalMs: this.heartbeatMs,
      extend: () => this.store.extendLock(claim.storeKey, claim.lockToken),
      onLost: () =>
        this.logger.error(
          `Idempotency lock for ${claim.keyLabel} was lost while the handler was running; the same key may run again`,
        ),
      onFailure: (error) =>
        this.logger.warn(
          `Could not extend idempotency lock for ${claim.keyLabel}: ${messageOf(error)}`,
        ),
    });
    try {
      return await operation();
    } finally {
      stopHeartbeat();
    }
  }

  private async settleFailure(claim: Claim, error: unknown): Promise<void> {
    const errorResponse = toErrorResponse(error);
    if (isStorable(error, errorResponse.statusCode)) {
      await this.complete(claim, {
        statusCode: errorResponse.statusCode,
        body: errorResponse,
      });
      return;
    }
    await this.settle(claim, 'release', () =>
      this.store.release(claim.storeKey, claim.lockToken),
    );
  }

  private complete(claim: Claim, stored: StoredResponse): Promise<void> {
    return this.settle(claim, 'complete', () =>
      this.store.complete(
        claim.storeKey,
        claim.lockToken,
        claim.fingerprint,
        stored,
      ),
    );
  }

  private async settle(
    claim: Claim,
    action: 'complete' | 'release',
    operation: () => Promise<boolean>,
  ): Promise<void> {
    for (let attempt = 1; attempt <= SETTLE_ATTEMPTS; attempt += 1) {
      try {
        if (!(await operation())) {
          this.logger.error(
            `Idempotency lock for ${claim.keyLabel} was lost before it could be ${action}d`,
          );
        }
        return;
      } catch (error) {
        if (attempt === SETTLE_ATTEMPTS) {
          this.logger.error(
            `Could not ${action} idempotency record for ${claim.keyLabel} after ${attempt} attempts; it expires with the lock TTL`,
            stackOf(error),
          );
          return;
        }
        await delay(SETTLE_RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }
}
