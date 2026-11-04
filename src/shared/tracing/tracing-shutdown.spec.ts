import { onTracingShutdown, shutdownTracing } from './tracing-shutdown.js';

describe('shutdownTracing', () => {
  it('does nothing when tracing never started', async () => {
    await expect(shutdownTracing()).resolves.toBeUndefined();
  });

  it('flushes the registered tracer exactly once', async () => {
    const shutdown = vi.fn(() => Promise.resolve());
    onTracingShutdown(shutdown);

    await shutdownTracing();
    await shutdownTracing();

    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
