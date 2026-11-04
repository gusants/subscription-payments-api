import { validateEnv } from './env.schema.js';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_HOST: 'localhost',
  GATEWAY_WEBHOOK_SECRET: 'a-webhook-secret-with-at-least-32-characters',
};

describe('validateEnv', () => {
  it('applies defaults and coerces numeric values', () => {
    expect(validateEnv({ ...validEnv, PORT: '4000' })).toEqual({
      ...validEnv,
      NODE_ENV: 'development',
      PORT: 4000,
      LOG_LEVEL: 'info',
      REDIS_PORT: 6379,
      PAYMENT_GATEWAY: 'fake',
      FAKE_GATEWAY_DATA_FILE: 'data/fake-gateway.json',
      FAKE_GATEWAY_WEBHOOK_DELAY_MS: 500,
      FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE: 0,
      FAKE_GATEWAY_WEBHOOK_DISPATCH_ENABLED: true,
      FAKE_GATEWAY_PIX_EXPIRATION_SECONDS: 1800,
      FAKE_GATEWAY_BOLETO_EXPIRATION_SECONDS: 259200,
      FAKE_GATEWAY_EXPIRATION_SWEEP_INTERVAL_MS: 5000,
      RETRY_INTERVAL_UNIT: 'days',
      RENEWAL_BATCH_SIZE: 100,
      WORKERS_ENABLED: true,
      CHARGE_ATTEMPT_LEASE_SECONDS: 30,
      IDEMPOTENCY_TTL_SECONDS: 86400,
      IDEMPOTENCY_LOCK_TTL_SECONDS: 60,
    });
  });

  it('rejects an unknown payment gateway', () => {
    expect(() =>
      validateEnv({ ...validEnv, PAYMENT_GATEWAY: 'stripe' }),
    ).toThrow(/PAYMENT_GATEWAY/);
  });

  it('accepts a custom fake gateway data file', () => {
    expect(
      validateEnv({ ...validEnv, FAKE_GATEWAY_DATA_FILE: '/tmp/gw.json' })
        .FAKE_GATEWAY_DATA_FILE,
    ).toBe('/tmp/gw.json');
  });

  it.each(['0', '-5', 'abc'])(
    'rejects CHARGE_ATTEMPT_LEASE_SECONDS=%s',
    (CHARGE_ATTEMPT_LEASE_SECONDS) => {
      expect(() =>
        validateEnv({ ...validEnv, CHARGE_ATTEMPT_LEASE_SECONDS }),
      ).toThrow(/CHARGE_ATTEMPT_LEASE_SECONDS/);
    },
  );

  it.each([
    ['true', true],
    ['false', false],
  ])('parses FAKE_GATEWAY_ROUTES_ENABLED=%s', (raw, expected) => {
    expect(
      validateEnv({ ...validEnv, FAKE_GATEWAY_ROUTES_ENABLED: raw })
        .FAKE_GATEWAY_ROUTES_ENABLED,
    ).toBe(expected);
  });

  it('rejects an invalid FAKE_GATEWAY_ROUTES_ENABLED', () => {
    expect(() =>
      validateEnv({ ...validEnv, FAKE_GATEWAY_ROUTES_ENABLED: 'maybe' }),
    ).toThrow(/FAKE_GATEWAY_ROUTES_ENABLED/);
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('parses WORKERS_ENABLED=%s', (raw, expected) => {
    expect(
      validateEnv({ ...validEnv, WORKERS_ENABLED: raw }).WORKERS_ENABLED,
    ).toBe(expected);
  });

  it.each(['days', 'minutes'])('accepts RETRY_INTERVAL_UNIT=%s', (unit) => {
    expect(
      validateEnv({ ...validEnv, RETRY_INTERVAL_UNIT: unit })
        .RETRY_INTERVAL_UNIT,
    ).toBe(unit);
  });

  it('leaves the renewal interval unset so it follows the retry unit', () => {
    expect(validateEnv(validEnv).RENEWAL_JOB_INTERVAL_SECONDS).toBeUndefined();
  });

  it.each([['0'], ['-5'], ['1.5']])(
    'rejects RENEWAL_JOB_INTERVAL_SECONDS=%s',
    (raw) => {
      expect(() =>
        validateEnv({ ...validEnv, RENEWAL_JOB_INTERVAL_SECONDS: raw }),
      ).toThrow(/RENEWAL_JOB_INTERVAL_SECONDS/);
    },
  );

  it('rejects a renewal batch above the maximum', () => {
    expect(() =>
      validateEnv({ ...validEnv, RENEWAL_BATCH_SIZE: '1001' }),
    ).toThrow(/RENEWAL_BATCH_SIZE/);
  });

  it('rejects an invalid RETRY_INTERVAL_UNIT', () => {
    expect(() =>
      validateEnv({ ...validEnv, RETRY_INTERVAL_UNIT: 'hours' }),
    ).toThrow(/RETRY_INTERVAL_UNIT/);
  });

  it('leaves BULL_BOARD_ENABLED undefined when unset', () => {
    expect(validateEnv(validEnv).BULL_BOARD_ENABLED).toBeUndefined();
  });

  it('rejects an invalid BULL_BOARD_ENABLED', () => {
    expect(() =>
      validateEnv({ ...validEnv, BULL_BOARD_ENABLED: 'maybe' }),
    ).toThrow(/BULL_BOARD_ENABLED/);
  });

  it.each([
    'FAKE_GATEWAY_PIX_EXPIRATION_SECONDS',
    'FAKE_GATEWAY_BOLETO_EXPIRATION_SECONDS',
  ])('rejects a non-positive %s', (name) => {
    expect(() => validateEnv({ ...validEnv, [name]: '0' })).toThrow(
      new RegExp(name),
    );
  });

  it('accepts a zero sweep interval to disable the expiration sweep', () => {
    expect(
      validateEnv({
        ...validEnv,
        FAKE_GATEWAY_EXPIRATION_SWEEP_INTERVAL_MS: '0',
      }).FAKE_GATEWAY_EXPIRATION_SWEEP_INTERVAL_MS,
    ).toBe(0);
  });

  it('rejects a missing webhook secret', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: validEnv.DATABASE_URL,
        REDIS_HOST: 'localhost',
      }),
    ).toThrow(/GATEWAY_WEBHOOK_SECRET/);
  });

  it('rejects a webhook secret shorter than 32 characters', () => {
    expect(() =>
      validateEnv({ ...validEnv, GATEWAY_WEBHOOK_SECRET: 'x'.repeat(31) }),
    ).toThrow(/GATEWAY_WEBHOOK_SECRET/);
  });

  it('keeps the webhook url unset so it can default from the port', () => {
    expect(validateEnv(validEnv).FAKE_GATEWAY_WEBHOOK_URL).toBeUndefined();
  });

  it('accepts a custom webhook url', () => {
    expect(
      validateEnv({
        ...validEnv,
        FAKE_GATEWAY_WEBHOOK_URL: 'http://api:3000/webhooks/gateway',
      }).FAKE_GATEWAY_WEBHOOK_URL,
    ).toBe('http://api:3000/webhooks/gateway');
  });

  it.each(['-0.1', '1.1', 'often'])(
    'rejects FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE=%s',
    (FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE) => {
      expect(() =>
        validateEnv({ ...validEnv, FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE }),
      ).toThrow(/FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE/);
    },
  );

  it.each(['0', '0.25', '1'])(
    'accepts FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE=%s',
    (FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE) => {
      expect(
        validateEnv({ ...validEnv, FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE })
          .FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE,
      ).toBe(Number(FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE));
    },
  );

  it('rejects a negative webhook delay', () => {
    expect(() =>
      validateEnv({ ...validEnv, FAKE_GATEWAY_WEBHOOK_DELAY_MS: '-1' }),
    ).toThrow(/FAKE_GATEWAY_WEBHOOK_DELAY_MS/);
  });

  it('can turn webhook dispatch off', () => {
    expect(
      validateEnv({
        ...validEnv,
        FAKE_GATEWAY_WEBHOOK_DISPATCH_ENABLED: 'false',
      }).FAKE_GATEWAY_WEBHOOK_DISPATCH_ENABLED,
    ).toBe(false);
  });

  it('rejects a missing database url', () => {
    expect(() => validateEnv({ REDIS_HOST: 'localhost' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('accepts custom idempotency TTLs and rejects non-positive ones', () => {
    expect(
      validateEnv({
        ...validEnv,
        IDEMPOTENCY_TTL_SECONDS: '3600',
        IDEMPOTENCY_LOCK_TTL_SECONDS: '10',
      }),
    ).toMatchObject({
      IDEMPOTENCY_TTL_SECONDS: 3600,
      IDEMPOTENCY_LOCK_TTL_SECONDS: 10,
    });
    expect(() =>
      validateEnv({ ...validEnv, IDEMPOTENCY_TTL_SECONDS: '0' }),
    ).toThrow(/IDEMPOTENCY_TTL_SECONDS/);
  });
});
