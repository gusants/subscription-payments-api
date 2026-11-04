import { requestSignal } from './request-signal.js';

describe('requestSignal', () => {
  it('aborts when the timeout elapses', async () => {
    const signal = requestSignal(10);

    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    expect(signal.reason).toMatchObject({ name: 'TimeoutError' });
  });

  it('aborts when the caller signal aborts first', () => {
    const caller = new AbortController();
    const signal = requestSignal(60_000, caller.signal);

    caller.abort(new Error('caller gave up'));

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toEqual(new Error('caller gave up'));
  });

  it('stays open while neither the timeout nor the caller fired', () => {
    expect(requestSignal(60_000, new AbortController().signal).aborted).toBe(
      false,
    );
  });
});
