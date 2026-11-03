import { monotonicFactory } from 'ulid';
import type { IdPrefix } from './id-prefix.js';

const nextUlid = monotonicFactory();

export function generateId(prefix: IdPrefix): string {
  return `${prefix}${nextUlid().toLowerCase()}`;
}
