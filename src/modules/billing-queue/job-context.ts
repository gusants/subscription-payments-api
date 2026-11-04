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
  publishDelayMs?: number;
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

function wasPublishedWithDelay(data: Partial<JobContext> | undefined): boolean {
  const publishDelayMs: unknown = data?.publishDelayMs;
  return typeof publishDelayMs === 'number' && publishDelayMs > 0;
}

export function processWithinJobContext<T>(
  job: ContextualJob,
  task: () => Promise<T>,
): Promise<T> {
  const correlationId = acceptOrGenerateCorrelationId(job.data?.correlationId);
  return traceProcessing(
    { queueName: job.queueName, jobName: job.name, jobId: job.id },
    {
      traceCarrier: job.data?.traceCarrier,
      delayed: wasPublishedWithDelay(job.data),
    },
    () => {
      trace.getActiveSpan()?.setAttribute('app.correlation_id', correlationId);
      return runWithCorrelationId(correlationId, task);
    },
  );
}
