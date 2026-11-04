import { context, propagation, trace } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace';

export interface InMemoryTracing {
  exporter: InMemorySpanExporter;
  stop: () => Promise<void>;
}

export function startInMemoryTracing(): InMemoryTracing {
  const exporter = new InMemorySpanExporter();
  const sdk = new NodeSDK({
    autoDetectResources: false,
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
    metricReaders: [],
    logRecordProcessors: [],
  });
  sdk.start();
  return {
    exporter,
    stop: async () => {
      await sdk.shutdown();
      trace.disable();
      context.disable();
      propagation.disable();
    },
  };
}
