import { describeError } from './describe-error.js';

describe('describeError', () => {
  it('uses the message of an Error', () => {
    expect(describeError(new Error('connection refused'))).toBe(
      'connection refused',
    );
  });

  it('stringifies anything that is not an Error', () => {
    expect(describeError('ECONNRESET')).toBe('ECONNRESET');
  });
});
