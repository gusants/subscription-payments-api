import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import {
  ConflictError,
  ServiceUnavailableError,
  toErrorResponse,
  UnprocessableError,
} from '../errors/index.js';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
} from './idempotency.constants.js';
import {
  buildStoreKey,
  fingerprintRequest,
  readIdempotencyKey,
} from './idempotency-key.js';
import { IDEMPOTENT_METADATA } from './idempotent.decorator.js';
import {
  type AcquireResult,
  type IdempotencyRecord,
  IdempotencyStore,
  type StoredResponse,
} from './idempotency.store.js';

const STORED_ERROR_STATUSES: ReadonlySet<number> = new Set([
  HttpStatus.NOT_FOUND,
  HttpStatus.CONFLICT,
  HttpStatus.UNPROCESSABLE_ENTITY,
]);

type Claim = { storeKey: string; fingerprint: string; lockToken: string };

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly store: IdempotencyStore,
    private readonly reflector: Reflector,
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

    const acquisition = await this.acquire(storeKey, fingerprint);
    if (!acquisition.acquired) {
      return this.replay(acquisition.existing, fingerprint, response);
    }
    const claim = { storeKey, fingerprint, lockToken: acquisition.lockToken };
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
  ): Promise<AcquireResult> {
    try {
      return await this.store.acquire(storeKey, fingerprint);
    } catch (error) {
      this.logger.error(error);
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
    return from([body]);
  }

  private async execute(
    next: CallHandler,
    claim: Claim,
    response: Response,
  ): Promise<unknown> {
    let body: unknown;
    try {
      body = await lastValueFrom(next.handle(), { defaultValue: undefined });
    } catch (error) {
      await this.settleFailure(claim, error);
      throw error;
    }
    await this.complete(claim, { statusCode: response.statusCode, body });
    return body;
  }

  private async settleFailure(claim: Claim, error: unknown): Promise<void> {
    const errorResponse = toErrorResponse(error);
    if (STORED_ERROR_STATUSES.has(errorResponse.statusCode)) {
      await this.complete(claim, {
        statusCode: errorResponse.statusCode,
        body: errorResponse,
      });
      return;
    }
    await this.guarded(claim, () =>
      this.store.release(claim.storeKey, claim.lockToken),
    );
  }

  private async complete(claim: Claim, stored: StoredResponse): Promise<void> {
    await this.guarded(claim, () =>
      this.store.complete(
        claim.storeKey,
        claim.lockToken,
        claim.fingerprint,
        stored,
      ),
    );
  }

  private async guarded(
    claim: Claim,
    operation: () => Promise<void>,
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      this.logger.error(
        `Could not settle idempotency record ${claim.storeKey}; it expires with the lock TTL`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
