import { urlWithQueryRedacted } from './redact-query.js';

const UNLOGGED_REQUEST_FIELDS: ReadonlySet<string> = new Set(['query', 'raw']);

export function serializeRequestWithoutQuery(request: unknown): unknown {
  if (typeof request !== 'object' || request === null) return request;
  const logged: Record<string, unknown> = Object.fromEntries(
    Object.entries(request).filter(
      ([field]) => !UNLOGGED_REQUEST_FIELDS.has(field),
    ),
  );
  if (typeof logged['url'] === 'string') {
    logged['url'] = urlWithQueryRedacted(logged['url']);
  }
  return logged;
}
