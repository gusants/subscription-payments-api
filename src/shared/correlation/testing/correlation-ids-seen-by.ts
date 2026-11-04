import { currentCorrelationId } from '../correlation-context.js';

type Method = (...args: never[]) => unknown;

export function correlationIdsSeenBy<
  Target extends object,
  Name extends {
    [Key in keyof Target]: Target[Key] extends Method ? Key : never;
  }[keyof Target] &
    string,
>(target: Target, name: Name): (string | undefined)[] {
  const seen: (string | undefined)[] = [];
  const original = target[name] as Method;
  Object.defineProperty(target, name, {
    configurable: true,
    writable: true,
    value: (...args: never[]) => {
      seen.push(currentCorrelationId());
      return original.apply(target, args);
    },
  });
  return seen;
}
