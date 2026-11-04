import { generateId, ID_PREFIXES } from '../../../shared/ids/index.js';
import { retryJobId } from './retry-job-id.js';

describe('retryJobId', () => {
  it('is deterministic for a charge and attempt', () => {
    expect(retryJobId('ch_abc', 2)).toBe('retry:ch_abc:2');
    expect(retryJobId('ch_abc', 2)).toBe(retryJobId('ch_abc', 2));
  });

  it('differs per attempt and per charge', () => {
    expect(retryJobId('ch_abc', 1)).not.toBe(retryJobId('ch_abc', 2));
    expect(retryJobId('ch_abc', 1)).not.toBe(retryJobId('ch_def', 1));
  });

  it('accepts every generated charge id', () => {
    const chargeId = generateId(ID_PREFIXES.charge);

    expect(retryJobId(chargeId, 1)).toBe(`retry:${chargeId}:1`);
  });

  it.each(['ch_a:b', 'ch_a b', '', 'retry:ch_abc:1'])(
    'rejects the charge id %j',
    (chargeId) => {
      expect(() => retryJobId(chargeId, 1)).toThrow(RangeError);
    },
  );

  it.each([0, -1, 1.5, Number.NaN])('rejects the attempt %s', (attempt) => {
    expect(() => retryJobId('ch_abc', attempt)).toThrow(RangeError);
  });
});
