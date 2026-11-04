import { FakeExpirationSweeper } from './fake-expiration-sweeper.js';
import type { FakeGatewaySimulator } from './fake-gateway.simulator.js';

describe('FakeExpirationSweeper', () => {
  const expireDue = vi.fn<FakeGatewaySimulator['expireDue']>();
  const simulator = { expireDue } as unknown as FakeGatewaySimulator;

  beforeEach(() => {
    vi.useFakeTimers();
    expireDue.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sweeps on every interval after init', async () => {
    const sweeper = new FakeExpirationSweeper(simulator, { intervalMs: 1000 });

    sweeper.onModuleInit();
    await vi.advanceTimersByTimeAsync(3000);

    expect(expireDue).toHaveBeenCalledTimes(3);
    sweeper.onModuleDestroy();
  });

  it('stops sweeping on destroy', async () => {
    const sweeper = new FakeExpirationSweeper(simulator, { intervalMs: 1000 });
    sweeper.onModuleInit();
    await vi.advanceTimersByTimeAsync(1000);

    sweeper.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(5000);

    expect(expireDue).toHaveBeenCalledTimes(1);
  });

  it('stays idle when the interval is zero', async () => {
    const sweeper = new FakeExpirationSweeper(simulator, { intervalMs: 0 });

    sweeper.onModuleInit();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(expireDue).not.toHaveBeenCalled();
  });

  it('keeps sweeping after a failed sweep', async () => {
    expireDue.mockRejectedValueOnce(new Error('disk full'));
    const sweeper = new FakeExpirationSweeper(simulator, { intervalMs: 1000 });

    sweeper.onModuleInit();
    await vi.advanceTimersByTimeAsync(2000);

    expect(expireDue).toHaveBeenCalledTimes(2);
    sweeper.onModuleDestroy();
  });
});
