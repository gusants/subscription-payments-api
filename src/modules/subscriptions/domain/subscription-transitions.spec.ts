import {
  SUBSCRIPTION_STATUSES,
  type SubscriptionStatus,
} from '../subscription-status.js';
import { InvalidTransitionError } from './invalid-transition.error.js';
import {
  assertTransition,
  canTransition,
  statusesAllowedToTransitionTo,
} from './subscription-transitions.js';

type Pair = [SubscriptionStatus, SubscriptionStatus];

const ALLOWED: Pair[] = [
  ['incomplete', 'active'],
  ['incomplete', 'past_due'],
  ['incomplete', 'canceled'],
  ['active', 'past_due'],
  ['active', 'canceled'],
  ['past_due', 'active'],
  ['past_due', 'canceled'],
];

const FORBIDDEN: Pair[] = SUBSCRIPTION_STATUSES.flatMap((from) =>
  SUBSCRIPTION_STATUSES.map((to): Pair => [from, to]),
).filter(([from, to]) => !ALLOWED.some(([a, b]) => a === from && b === to));

describe('subscription transitions', () => {
  it('covers every status pair exactly once', () => {
    expect(ALLOWED.length + FORBIDDEN.length).toBe(
      SUBSCRIPTION_STATUSES.length ** 2,
    );
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
      expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
    });
  });

  it.each([
    ['canceled', ['incomplete', 'active', 'past_due']],
    ['active', ['incomplete', 'past_due']],
    ['past_due', ['incomplete', 'active']],
    ['incomplete', []],
  ] as const)('lists the statuses allowed to move to %s', (to, expected) => {
    expect(statusesAllowedToTransitionTo(to)).toEqual(expected);
  });

  it('describes the rejected transition in the error message', () => {
    expect(() => assertTransition('canceled', 'active')).toThrow(
      'Cannot transition subscription from canceled to active',
    );
  });

  it('treats canceled as terminal', () => {
    for (const to of SUBSCRIPTION_STATUSES) {
      expect(canTransition('canceled', to)).toBe(false);
    }
  });
});
