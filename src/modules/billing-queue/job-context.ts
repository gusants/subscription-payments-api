import {
  acceptOrGenerateCorrelationId,
  runWithCorrelationId,
} from '../../shared/correlation/index.js';

export type TraceCarrier = Record<string, string>;

export interface JobContext {
  correlationId: string;
  traceCarrier?: TraceCarrier;
}

export function runWithinJobContext<T>(
  data: Partial<JobContext> | undefined,
  task: () => T,
): T {
  return runWithCorrelationId(
    acceptOrGenerateCorrelationId(data?.correlationId),
    task,
  );
}
