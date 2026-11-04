import { setTimeout as sleep } from 'node:timers/promises';
import {
  currentCorrelationId,
  currentOrNewCorrelationId,
  runWithCorrelationId,
  runWithinCorrelation,
} from './correlation-context.js';
import { isValidCorrelationId } from './correlation-id.js';

describe('correlation context', () => {
  it('has no id outside a context', () => {
    expect(currentCorrelationId()).toBeUndefined();
  });

  it('keeps the id across awaits and timers inside the context', async () => {
    const seen = await runWithCorrelationId('journey-0001', async () => {
      await sleep(1);
      return new Promise<string | undefined>((resolve) => {
        setTimeout(() => resolve(currentCorrelationId()), 1);
      });
    });

    expect(seen).toBe('journey-0001');
    expect(currentCorrelationId()).toBeUndefined();
  });

  it('isolates concurrent contexts', async () => {
    const seen = await Promise.all(
      ['journey-000a', 'journey-000b'].map((id) =>
        runWithCorrelationId(id, async () => {
          await sleep(1);
          return currentCorrelationId();
        }),
      ),
    );

    expect(seen).toEqual(['journey-000a', 'journey-000b']);
  });

  it('restores the outer id when a nested context ends', async () => {
    const seen = await runWithCorrelationId('outer-00001', async () => {
      const inner = await runWithCorrelationId('inner-00001', async () => {
        await sleep(1);
        return currentCorrelationId();
      });
      return [inner, currentCorrelationId()];
    });

    expect(seen).toEqual(['inner-00001', 'outer-00001']);
  });

  it('keeps the current id when one exists', () => {
    expect(
      runWithCorrelationId('journey-0001', () => currentOrNewCorrelationId()),
    ).toBe('journey-0001');
    expect(
      runWithCorrelationId('journey-0001', () =>
        runWithinCorrelation(currentCorrelationId),
      ),
    ).toBe('journey-0001');
  });

  it('starts a new context with a generated id when there is none', () => {
    const id = runWithinCorrelation(currentCorrelationId);

    expect(isValidCorrelationId(id)).toBe(true);
    expect(isValidCorrelationId(currentOrNewCorrelationId())).toBe(true);
  });
});
