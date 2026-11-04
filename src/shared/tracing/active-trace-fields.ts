import { isSpanContextValid, trace } from '@opentelemetry/api';

export interface TraceFields {
  trace_id?: string;
  span_id?: string;
}

export function activeTraceFields(): TraceFields {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) return {};
  return { trace_id: spanContext.traceId, span_id: spanContext.spanId };
}
