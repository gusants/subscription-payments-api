const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'x-gateway-signature',
  'idempotency-key',
] as const;

const SENSITIVE_FIELDS = ['cardToken', 'token', 'email'] as const;

const UP_TO_THREE_LEVELS_DEEP = ['', '*.', '*.*.'] as const;

export const REDACTED = '[Redacted]';

export const REDACT_PATHS: readonly string[] = [
  ...SENSITIVE_HEADERS.flatMap((header) => [
    `req.headers["${header}"]`,
    `res.headers["${header}"]`,
  ]),
  ...SENSITIVE_FIELDS.flatMap((field) =>
    UP_TO_THREE_LEVELS_DEEP.map((prefix) => `${prefix}${field}`),
  ),
];
