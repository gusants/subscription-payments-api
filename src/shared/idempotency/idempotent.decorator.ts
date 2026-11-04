import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { IDEMPOTENCY_KEY_HEADER } from './idempotency.constants.js';

export const IDEMPOTENT_METADATA = 'idempotent';

export const Idempotent = () =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_METADATA, true),
    ApiHeader({
      name: IDEMPOTENCY_KEY_HEADER,
      required: false,
      description:
        'Client-generated key (1 to 255 printable ASCII characters). The same key with the same request replays the first response with the header Idempotent-Replayed: true; the same key with a different body answers 422; the same key while the first request is still running answers 409',
      schema: { type: 'string', minLength: 1, maxLength: 255 },
    }),
  );
