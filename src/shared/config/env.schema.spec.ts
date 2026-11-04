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
