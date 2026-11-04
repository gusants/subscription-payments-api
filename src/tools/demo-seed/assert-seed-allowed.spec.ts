import { assertSeedAllowed } from './assert-seed-allowed.js';

const target = (overrides: Partial<Parameters<typeof assertSeedAllowed>[0]>) =>
  assertSeedAllowed({
    nodeEnv: 'development',
    databaseUrl: 'postgresql://u:p@localhost:5432/payments',
    allowRemote: false,
    ...overrides,
  });

describe('assertSeedAllowed', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'allows a local database host (%s) outside production',
    (host) => {
      expect(() =>
        target({ databaseUrl: `postgresql://u:p@${host}:5432/payments` }),
      ).not.toThrow();
    },
  );

  it('refuses production', () => {
    expect(() => target({ nodeEnv: 'production' })).toThrow(/production/);
  });

  it('refuses a remote database host', () => {
    expect(() =>
      target({ databaseUrl: 'postgresql://u:p@db.internal:5432/payments' }),
    ).toThrow(/db\.internal/);
  });

  it('does not leak credentials in the refusal message', () => {
    expect(() =>
      target({ databaseUrl: 'postgresql://user:secret@db.internal/payments' }),
    ).toThrow(expect.not.stringContaining('secret'));
  });

  it('lets SEED_ALLOW_REMOTE override both refusals', () => {
    expect(() =>
      target({
        nodeEnv: 'production',
        databaseUrl: 'postgresql://u:p@postgres:5432/payments',
        allowRemote: true,
      }),
    ).not.toThrow();
  });
});
