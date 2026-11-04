import {
  areBillingWorkersEnabled,
  areDevRoutesEnabled,
  isBullBoardEnabled,
} from './billing-queue-flags.js';

describe('areBillingWorkersEnabled', () => {
  it('is enabled by default', () => {
    expect(areBillingWorkersEnabled({})).toBe(true);
  });

  it.each([
    ['false', false],
    ['0', false],
    ['true', true],
  ])('parses WORKERS_ENABLED=%s', (WORKERS_ENABLED, expected) => {
    expect(areBillingWorkersEnabled({ WORKERS_ENABLED })).toBe(expected);
  });
});

describe('isBullBoardEnabled', () => {
  it.each(['development', 'test'])('is enabled in %s', (NODE_ENV) => {
    expect(isBullBoardEnabled({ NODE_ENV })).toBe(true);
  });

  it('is enabled by default, as the default environment is development', () => {
    expect(isBullBoardEnabled({})).toBe(true);
  });

  it('is disabled in production', () => {
    expect(isBullBoardEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('is enabled in production when the flag is explicitly true', () => {
    expect(
      isBullBoardEnabled({
        NODE_ENV: 'production',
        BULL_BOARD_ENABLED: 'true',
      }),
    ).toBe(true);
  });

  it('is disabled outside production when the flag is explicitly false', () => {
    expect(
      isBullBoardEnabled({
        NODE_ENV: 'development',
        BULL_BOARD_ENABLED: 'false',
      }),
    ).toBe(false);
  });
});

describe('areDevRoutesEnabled', () => {
  it.each(['development', 'test'])('is enabled in %s', (NODE_ENV) => {
    expect(areDevRoutesEnabled({ NODE_ENV })).toBe(true);
  });

  it('is enabled by default, as the default environment is development', () => {
    expect(areDevRoutesEnabled({})).toBe(true);
  });

  it('is disabled in production', () => {
    expect(areDevRoutesEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('is enabled in production when the flag is explicitly true', () => {
    expect(
      areDevRoutesEnabled({
        NODE_ENV: 'production',
        DEV_ROUTES_ENABLED: 'true',
      }),
    ).toBe(true);
  });

  it('is disabled outside production when the flag is explicitly false', () => {
    expect(
      areDevRoutesEnabled({
        NODE_ENV: 'development',
        DEV_ROUTES_ENABLED: 'false',
      }),
    ).toBe(false);
  });
});
