import type { IncomingMessage } from 'node:http';
import { buildPinoHttpOptions } from './pino-http-options.js';

function ignoresRequestTo(url: string) {
  const options = buildPinoHttpOptions({
    nodeEnv: 'production',
    level: 'info',
  });
  const autoLogging = options.autoLogging as {
    ignore: (request: IncomingMessage) => boolean;
  };
  return autoLogging.ignore({ url } as IncomingMessage);
}

describe('buildPinoHttpOptions', () => {
  it('logs plain JSON outside development', () => {
    const options = buildPinoHttpOptions({
      nodeEnv: 'production',
      level: 'warn',
    });

    expect(options.level).toBe('warn');
    expect(options.transport).toBeUndefined();
  });

  it('pretty prints in development', () => {
    const options = buildPinoHttpOptions({
      nodeEnv: 'development',
      level: 'debug',
    });

    expect(options.transport).toMatchObject({ target: 'pino-pretty' });
  });

  it('skips request logs for the health probe only', () => {
    expect(ignoresRequestTo('/health')).toBe(true);
    expect(ignoresRequestTo('/plans')).toBe(false);
  });

  it('redacts credentials from request headers', () => {
    const options = buildPinoHttpOptions({
      nodeEnv: 'production',
      level: 'info',
    });

    expect(options.redact).toEqual([
      'req.headers.authorization',
      'req.headers.cookie',
    ]);
  });
});
