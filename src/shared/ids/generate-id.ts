import { ulid } from 'ulid';
import type { IdPrefix } from './id-prefix.js';

export function generateId(prefix: IdPrefix): string {
  return `${prefix}${ulid().toLowerCase()}`;
}
