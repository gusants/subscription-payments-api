export const FAKE_CHARGE_EXPIRATION = Symbol('FAKE_CHARGE_EXPIRATION');
export const FAKE_EXPIRATION_SWEEP = Symbol('FAKE_EXPIRATION_SWEEP');

export interface FakeChargeExpiration {
  pixMs: number;
  boletoMs: number;
}

export interface FakeExpirationSweep {
  intervalMs: number;
}
