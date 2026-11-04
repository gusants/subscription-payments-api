import type { SerializedRequest } from 'pino';
import { REDACTED } from './redact-paths.js';
import { urlWithQueryRedacted } from './redact-query.js';
import { serializeRequestWithoutQuery } from './request-serializer.js';

const serializedRequest = (url: string): SerializedRequest =>
  ({
    id: 'cor_1',
    method: 'GET',
    url,
    query: { search: 'ana@example.com' },
    params: { id: 'cus_1' },
    headers: { host: 'localhost' },
    remoteAddress: '127.0.0.1',
    remotePort: 5050,
  }) as unknown as SerializedRequest;

describe('urlWithQueryRedacted', () => {
  it.each([
    ['/customers', '/customers'],
    ['/customers?search=ana%40example.com', `/customers?${REDACTED}`],
    ['/customers?', `/customers?${REDACTED}`],
    ['/customers?ana@example.com', `/customers?${REDACTED}`],
  ])('turns %s into %s', (url, expected) => {
    expect(urlWithQueryRedacted(url)).toBe(expected);
  });
});

describe('serializeRequestWithoutQuery', () => {
  it('keeps what identifies the request and drops the query values', () => {
    const logged = serializeRequestWithoutQuery(
      serializedRequest('/customers?search=ana%40example.com&page=2'),
    );

    expect(logged).toEqual({
      id: 'cor_1',
      method: 'GET',
      url: `/customers?${REDACTED}`,
      params: { id: 'cus_1' },
      headers: { host: 'localhost' },
      remoteAddress: '127.0.0.1',
      remotePort: 5050,
    });
    expect(JSON.stringify(logged)).not.toContain('ana');
  });

  it.each([
    ['a string', 'GET /customers'],
    ['null', null],
  ])('passes %s through', (_label, value) => {
    expect(serializeRequestWithoutQuery(value)).toBe(value);
  });

  it('keeps an object logged as req that has no url', () => {
    expect(serializeRequestWithoutQuery({ body: { name: 'Ana' } })).toEqual({
      body: { name: 'Ana' },
    });
  });
});
