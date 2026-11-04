import { ConflictError } from './conflict.error.js';
import { UnprocessableError } from './unprocessable.error.js';

describe('DomainError', () => {
  it('is not transient by default', () => {
    expect(new ConflictError('busy').transient).toBe(false);
  });

  it.each([ConflictError, UnprocessableError])(
    '%o can be marked transient',
    (ErrorType) => {
      expect(new ErrorType('later', { transient: true }).transient).toBe(true);
    },
  );

  it('keeps the message and names the error after its class', () => {
    const error = new UnprocessableError('nope', { transient: true });

    expect(error).toMatchObject({
      message: 'nope',
      name: 'UnprocessableError',
    });
  });
});
