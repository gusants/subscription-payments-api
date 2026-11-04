import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Link,
  type Span,
} from '@opentelemetry/api';
import type { TraceCarrier } from './job-context.js';

export const JOB_TRACER_NAME = 'subscription-payments-api/billing-queue';

const tracer = trace.getTracer(JOB_TRACER_NAME);

export interface JobPublication {
  traceCarrier: unknown;
  delayed: boolean;
}

export interface JobIdentity {
  queueName: string;
  jobName: string;
  jobId?: string | undefined;
}

type MessagingOperation = 'publish' | 'process';

function messagingAttributes(
  operation: MessagingOperation,
  { queueName, jobName, jobId }: JobIdentity,
): Attributes {
  return {
    'messaging.system': 'bullmq',
    'messaging.operation.type': operation,
    'messaging.destination.name': queueName,
    'messaging.bullmq.job.name': jobName,
    ...(jobId !== undefined && { 'messaging.message.id': jobId }),
  };
}

function isTraceCarrier(candidate: unknown): candidate is TraceCarrier {
  return typeof candidate === 'object' && candidate !== null;
}

async function endSpanAfter<T>(span: Span, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    span.recordException(failure);
    span.setStatus({ code: SpanStatusCode.ERROR, message: failure.message });
    throw error;
  } finally {
    span.end();
  }
}

export function currentTraceCarrier(): TraceCarrier | undefined {
  const carrier: TraceCarrier = {};
  propagation.inject(context.active(), carrier);
  return Object.keys(carrier).length > 0 ? carrier : undefined;
}

export function tracePublish<T>(
  job: JobIdentity,
  publish: (traceCarrier: TraceCarrier | undefined) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    `publish ${job.queueName}`,
    {
      kind: SpanKind.PRODUCER,
      attributes: messagingAttributes('publish', job),
    },
    (span) => endSpanAfter(span, () => publish(currentTraceCarrier())),
  );
}

function publisherContextOf(traceCarrier: unknown): Context {
  return isTraceCarrier(traceCarrier)
    ? propagation.extract(ROOT_CONTEXT, traceCarrier)
    : ROOT_CONTEXT;
}

function linksTo(publisherContext: Context): Link[] {
  const publisher = trace.getSpanContext(publisherContext);
  return publisher && trace.isSpanContextValid(publisher)
    ? [{ context: publisher }]
    : [];
}

export function traceProcessing<T>(
  job: JobIdentity,
  { traceCarrier, delayed }: JobPublication,
  process: () => Promise<T>,
): Promise<T> {
  const publisherContext = publisherContextOf(traceCarrier);
  return tracer.startActiveSpan(
    `process ${job.queueName}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: messagingAttributes('process', job),
      links: delayed ? linksTo(publisherContext) : [],
    },
    delayed ? ROOT_CONTEXT : publisherContext,
    (span) => endSpanAfter(span, process),
  );
}
