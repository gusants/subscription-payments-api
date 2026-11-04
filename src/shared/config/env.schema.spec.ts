import { validateEnv } from './env.schema.js';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_HOST: 'localhost',
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
      FAKE_GATEWAY_PIX_EXPIRATION_SECONDS: 1800,
      FAKE_GATEWAY_BOLETO_EXPIRATION_SECONDS: 259200,
      FAKE_GATEWAY_EXPIRATION_SWEEP_INTERVAL_MS: 5000,
      CHARGE_ATTEMPT_LEASE_SECONDS: 30,
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
});
