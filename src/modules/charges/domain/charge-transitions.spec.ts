import { CHARGE_STATUSES, type ChargeStatus } from '../charge-status.js';
import {
  assertTransition,
  canTransition,
  statusesAllowedToTransitionTo,
} from './charge-transitions.js';
import { InvalidChargeTransitionError } from './invalid-charge-transition.error.js';

type Pair = [ChargeStatus, ChargeStatus];

const ALLOWED: Pair[] = [
  ['pending', 'paid'],
  ['pending', 'failed'],
  ['pending', 'expired'],
  ['failed', 'pending'],
  ['failed', 'uncollectible'],
];

const FORBIDDEN: Pair[] = CHARGE_STATUSES.flatMap((from) =>
  CHARGE_STATUSES.map((to): Pair => [from, to]),
).filter(([from, to]) => !ALLOWED.some(([a, b]) => a === from && b === to));

describe('charge transitions', () => {
  it('covers every status pair exactly once', () => {
    expect(ALLOWED.length + FORBIDDEN.length).toBe(CHARGE_STATUSES.length ** 2);
  });

  describe.each(ALLOWED)('%s -> %s', (from, to) => {
    it('is allowed', () => {
      expect(canTransition(from, to)).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
    });
  });

  describe.each(FORBIDDEN)('%s -> %s', (from, to) => {
    it('is forbidden', () => {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow(
        InvalidChargeTransitionError,
      );
    });
  });

  it.each(['paid', 'expired', 'uncollectible'] as const)(
    'treats %s as terminal',
    (terminal) => {
      for (const to of CHARGE_STATUSES) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    },
  );

  it.each([
    ['pending', ['failed']],
    ['paid', ['pending']],
    ['failed', ['pending']],
    ['expired', ['pending']],
    ['uncollectible', ['failed']],
  ] as const)('lists the statuses allowed to move to %s', (to, expected) => {
    expect(statusesAllowedToTransitionTo(to)).toEqual(expected);
  });

  it('describes the rejected transition in the error message', () => {
    expect(() => assertTransition('paid', 'failed')).toThrow(
      'Cannot transition charge from paid to failed',
    );
  });

  it('answers as a conflict', () => {
    expect(new InvalidChargeTransitionError('paid', 'pending').name).toBe(
      'InvalidChargeTransitionError',
    );
  });
});
