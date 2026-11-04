import { startLockHeartbeat } from './lock-heartbeat.js';

describe('startLockHeartbeat', () => {
  const INTERVAL_MS = 1000;
  let extend: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  let onLost: ReturnType<typeof vi.fn<() => void>>;
  let onFailure: ReturnType<typeof vi.fn<(error: unknown) => void>>;

  const start = () =>
    startLockHeartbeat({ intervalMs: INTERVAL_MS, extend, onLost, onFailure });

  beforeEach(() => {
    vi.useFakeTimers();
    extend = vi.fn(() => Promise.resolve(true));
    onLost = vi.fn();
    onFailure = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('extends the lock every interval and not before', async () => {
    start();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(extend).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(extend).toHaveBeenCalledTimes(2);
  });

  it('stops extending once stopped', async () => {
    const stop = start();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    stop();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);

    expect(extend).toHaveBeenCalledTimes(1);
  });

  it('reports the lost lock once and stops', async () => {
    extend.mockResolvedValue(false);
    start();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 4);

    expect(onLost).toHaveBeenCalledOnce();
    expect(extend).toHaveBeenCalledOnce();
  });

  it('reports a failed extension and keeps going', async () => {
    const failure = new Error('redis down');
    extend.mockRejectedValueOnce(failure).mockResolvedValue(true);
    start();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(onFailure).toHaveBeenCalledWith(failure);
    expect(extend).toHaveBeenCalledTimes(2);
    expect(onLost).not.toHaveBeenCalled();
  });

  it('does not start a new extension while the previous one is still running', async () => {
    let finish: (held: boolean) => void = () => undefined;
    extend.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    start();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(extend).toHaveBeenCalledOnce();

    finish(true);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(extend).toHaveBeenCalledTimes(2);
  });

  it('ignores the answer of an extension that finishes after stop', async () => {
    let finish: (held: boolean) => void = () => undefined;
    extend.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const stop = start();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    stop();
    finish(false);
    await vi.advanceTimersByTimeAsync(0);

    expect(onLost).not.toHaveBeenCalled();
  });
});
