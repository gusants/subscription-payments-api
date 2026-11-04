import { reconciliationIntervalMs, renewalIntervalMs } from './job-schedule.js';

describe('renewalIntervalMs', () => {
  it('sweeps hourly when the retry unit is days', () => {
    expect(renewalIntervalMs('days')).toBe(3_600_000);
  });

  it('sweeps every 30 seconds when the retry unit is minutes', () => {
    expect(renewalIntervalMs('minutes')).toBe(30_000);
  });

  it('prefers the configured interval over the unit default', () => {
    expect(renewalIntervalMs('days', 90)).toBe(90_000);
  });
});

describe('reconciliationIntervalMs', () => {
  it('sweeps every 5 minutes when the retry unit is days', () => {
    expect(reconciliationIntervalMs('days')).toBe(300_000);
  });

  it('sweeps every 30 seconds when the retry unit is minutes', () => {
    expect(reconciliationIntervalMs('minutes')).toBe(30_000);
  });

  it('prefers the configured interval over the unit default', () => {
    expect(reconciliationIntervalMs('days', 45)).toBe(45_000);
  });
});
