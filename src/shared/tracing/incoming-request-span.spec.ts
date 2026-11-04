import type { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { REDACTED } from '../logging/redact-paths.js';
import {
  startInMemoryTracing,
  type InMemoryTracing,
} from './testing/in-memory-tracing.js';
import { tracedInstrumentations } from './traced-instrumentations.js';

const EMAIL = 'ana.span@example.com';

describe('incoming request span with tracing on', () => {
  let tracing: InMemoryTracing;
  let close: () => Promise<void>;
  let baseUrl: string;

  beforeAll(async () => {
    const [httpInstrumentation] = tracedInstrumentations() as [
      HttpInstrumentation,
    ];
    tracing = startInMemoryTracing([httpInstrumentation]);
    const http = createRequire(import.meta.url)(
      'node:http',
    ) as typeof import('node:http');
    const server = http.createServer((_request, response) =>
      response.end('ok'),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      });
  });

  afterAll(async () => {
    await close();
    await tracing.stop();
  });

  it('records that a query was sent but not its values', async () => {
    await fetch(`${baseUrl}/customers?search=${encodeURIComponent(EMAIL)}`);

    await vi.waitFor(() =>
      expect(tracing.exporter.getFinishedSpans()).not.toHaveLength(0),
    );
    const [span] = tracing.exporter.getFinishedSpans();
    expect(span!.attributes).toMatchObject({
      'url.path': '/customers',
      'url.query': REDACTED,
    });
    expect(JSON.stringify(span!.attributes)).not.toContain('ana.span');
  });
});
