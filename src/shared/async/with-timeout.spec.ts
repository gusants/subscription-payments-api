import { withTimeout } from './with-timeout.js';

describe('withTimeout', () => {
  it('resolves with the operation result when it finishes in time', async () => {
    await expect(withTimeout(Promise.resolve('PONG'), 50)).resolves.toBe(
      'PONG',
    );
  });

  it('rejects when the operation never settles', async () => {
    const neverSettles = new Promise<never>(() => undefined);

    await expect(withTimeout(neverSettles, 10)).rejects.toThrow(
      'timed out after 10ms',
    );
  });
});
