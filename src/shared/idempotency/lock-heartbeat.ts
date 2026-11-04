export interface LockHeartbeat {
  intervalMs: number;
  extend: () => Promise<boolean>;
  onLost: () => void;
  onFailure: (error: unknown) => void;
}

export function startLockHeartbeat({
  intervalMs,
  extend,
  onLost,
  onFailure,
}: LockHeartbeat): () => void {
  let stopped = false;
  let extending = false;

  const stop = (): void => {
    stopped = true;
    clearInterval(timer);
  };

  const tick = async (): Promise<void> => {
    if (extending) return;
    extending = true;
    try {
      const held = await extend();
      if (!held && !stopped) {
        stop();
        onLost();
      }
    } catch (error) {
      if (!stopped) onFailure(error);
    } finally {
      extending = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return stop;
}
