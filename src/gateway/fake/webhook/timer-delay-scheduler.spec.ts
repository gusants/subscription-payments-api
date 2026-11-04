import { TimerDelayScheduler } from './timer-delay-scheduler.js';

describe('TimerDelayScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the task once after the delay', () => {
    const task = vi.fn().mockResolvedValue(undefined);
    new TimerDelayScheduler().after(1000, task);

    vi.advanceTimersByTime(999);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(5000);

    expect(task).toHaveBeenCalledOnce();
  });

  it('cancels pending tasks on destroy', () => {
    const task = vi.fn().mockResolvedValue(undefined);
    const scheduler = new TimerDelayScheduler();
    scheduler.after(1000, task);

    scheduler.onModuleDestroy();
    vi.advanceTimersByTime(5000);

    expect(task).not.toHaveBeenCalled();
  });

  it('forgets a task once it ran', () => {
    const scheduler = new TimerDelayScheduler();
    scheduler.after(10, vi.fn().mockResolvedValue(undefined));
    vi.advanceTimersByTime(10);

    expect(() => scheduler.onModuleDestroy()).not.toThrow();
  });
});
