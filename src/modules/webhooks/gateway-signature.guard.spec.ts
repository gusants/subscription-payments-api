import {
  Logger,
  UnauthorizedException,
  type ExecutionContext,
  type RawBodyRequest,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { SIGNATURE_HEADER, sign } from '../../gateway/index.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import type { Env } from '../../shared/config/env.schema.js';
import { GatewaySignatureGuard } from './gateway-signature.guard.js';

describe('GatewaySignatureGuard', () => {
  const secret = 'guard-spec-secret-with-more-than-32-chars';
  const now = new Date('2026-03-01T12:00:00.000Z');
  const nowSeconds = now.getTime() / 1000;
  const body = '{"id":"evt_1"}';
  let guard: GatewaySignatureGuard;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const config = {
      get: () => secret,
    } as unknown as ConfigService<Env, true>;
    guard = new GatewaySignatureGuard(config, new FixedClock(now));
  });

  const contextOf = (
    rawBody: string | undefined,
    header: string | undefined,
  ): ExecutionContext => {
    const request = {
      rawBody: rawBody === undefined ? undefined : Buffer.from(rawBody),
      header: (name: string) =>
        name === SIGNATURE_HEADER ? header : undefined,
    } as unknown as RawBodyRequest<Request>;
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GatewaySignatureGuard — valid signature inside the window — allows the request', () => {
    const header = sign(body, secret, nowSeconds);

    expect(guard.canActivate(contextOf(body, header))).toBe(true);
  });

  it.each([
    ['missing header', undefined],
    ['malformed header', 'garbage'],
    [
      'other secret',
      sign(body, 'another-secret-with-more-than-32-chars', nowSeconds),
    ],
    ['stale timestamp', sign(body, secret, nowSeconds - 301)],
    ['future timestamp', sign(body, secret, nowSeconds + 301)],
  ])('GatewaySignatureGuard — %s — throws Unauthorized', (_name, header) => {
    expect(() => guard.canActivate(contextOf(body, header))).toThrow(
      UnauthorizedException,
    );
  });

  it('GatewaySignatureGuard — raw body unavailable — throws Unauthorized even with a signature of the body', () => {
    const header = sign(body, secret, nowSeconds);

    expect(() => guard.canActivate(contextOf(undefined, header))).toThrow(
      UnauthorizedException,
    );
  });
});
