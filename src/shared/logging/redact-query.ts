import { REDACTED } from './redact-paths.js';

const QUERY_SEPARATOR = '?';

export function hasQueryString(url: string): boolean {
  return url.includes(QUERY_SEPARATOR);
}

export function urlWithQueryRedacted(url: string): string {
  const queryStart = url.indexOf(QUERY_SEPARATOR);
  if (queryStart === -1) return url;
  return `${url.slice(0, queryStart)}${QUERY_SEPARATOR}${REDACTED}`;
}
