export function requestSignal(
  timeoutMs: number,
  callerSignal?: AbortSignal,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return callerSignal ? AbortSignal.any([timeout, callerSignal]) : timeout;
}
