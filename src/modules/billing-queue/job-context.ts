import { trace } from '@opentelemetry/api';
import {
  acceptOrGenerateCorrelationId,
  runWithCorrelationId,
} from '../../shared/correlation/index.js';
import { traceProcessing } from './job-tracing.js';

export type TraceCarrier = Record<string, string>;

export interface JobContext {
  correlationId: string;
  traceCarrier?: TraceCarrier;
}

export interface ContextualJob {
  id?: string | undefined;
  name: string;
  queueName: string;
  data: Partial<JobContext> | undefined;
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

export function processWithinJobContext<T>(
  job: ContextualJob,
  task: () => Promise<T>,
): Promise<T> {
  const correlationId = acceptOrGenerateCorrelationId(job.data?.correlationId);
  return traceProcessing(
    { queueName: job.queueName, jobName: job.name, jobId: job.id },
    job.data?.traceCarrier,
    () => {
      trace.getActiveSpan()?.setAttribute('app.correlation_id', correlationId);
      return runWithCorrelationId(correlationId, task);
    },
  );
}
