import { AsyncLocalStorage } from 'node:async_hooks';
import { generateCorrelationId } from './correlation-id.js';

interface CorrelationContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

export function runWithCorrelationId<T>(
  correlationId: string,
  task: () => T,
): T {
  return storage.run({ correlationId }, task);
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export function currentOrNewCorrelationId(): string {
  return currentCorrelationId() ?? generateCorrelationId();
}

export function runWithinCorrelation<T>(task: () => T): T {
  return runWithCorrelationId(currentOrNewCorrelationId(), task);
}
