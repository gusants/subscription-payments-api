import {
  runWithCorrelationId,
  runWithinCorrelation,
} from '../../shared/correlation/index.js';
import type { Charge } from './charge.js';

export function runWithinChargeCorrelation<T>(
  { correlationId }: Pick<Charge, 'correlationId'>,
  task: () => T,
): T {
  return correlationId
    ? runWithCorrelationId(correlationId, task)
    : runWithinCorrelation(task);
}
