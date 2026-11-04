# subscription-payments-api

[![CI](https://github.com/gusants/subscription-payments-api/actions/workflows/ci.yml/badge.svg)](https://github.com/gusants/subscription-payments-api/actions/workflows/ci.yml)

Subscription billing and payments API built with NestJS, PostgreSQL (Prisma) and Redis.

> Work in progress. The base (health check, structured logs, tests, Docker and CI) is in place; plans, customers, subscriptions and payments come next.

## Requirements

- Node.js 24 (see `.nvmrc`)
- pnpm 10 (`corepack enable` picks the pinned version)
- Docker

## Running

Everything in containers (API + Postgres + Redis):

```bash
cp .env.example .env
docker compose up --build
curl http://localhost:3000/health
```

Local development (API on the host, dependencies in Docker):

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm start:dev
```

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm start:dev` | Starts the API in watch mode |
| `pnpm build` | Compiles to `dist/` |
| `pnpm db:up` / `pnpm db:down` | Starts / stops Postgres and Redis |
| `pnpm prisma:migrate` | Creates and applies a migration in development |
| `pnpm lint` | Runs oxlint (type-aware) |
| `pnpm format` / `pnpm format:check` | Formats / checks formatting with Prettier |
| `pnpm typecheck` | Type-checks without emitting |
| `pnpm test` | Unit tests |
| `pnpm test:cov` | Unit tests with coverage (fails below 80%) |
| `pnpm test:e2e` | End-to-end tests against Postgres and Redis started by Testcontainers (Docker required, no compose needed) |

## Configuration

Environment variables are validated at startup. See `.env.example` for the full list; `LOG_LEVEL` controls verbosity (`info` by default). Logs are JSON, pretty-printed when `NODE_ENV=development`.

## Health

`GET /health` reports the status of Postgres and Redis and returns `503` when either is down.

## Payment gateway

`PAYMENT_GATEWAY=fake` (the only adapter for now) stores its customers and charges in the JSON file at `FAKE_GATEWAY_DATA_FILE`. Magic card tokens: `tok_success`, `tok_insufficient_funds`, `tok_expired_card`, `tok_fail_then_success` (declines the first attempt of a charge, approves the next) and anything else is declined as `invalid_token`.

The store is single-process: it serializes access with an in-memory queue, so only one Node process may use a given file. Background workers (retries, reconciliation) must run inside the API process, or use a real gateway.

`POST /fake-gateway/reset` (and the other `/fake-gateway/*` routes) are served when `FAKE_GATEWAY_ROUTES_ENABLED` is true. It defaults to true outside `NODE_ENV=production` and false in production unless set; the Docker demo sets it to true.

### Pix and boleto

Pix and boleto charges are born `pending` in the gateway with an expiry and payment instructions (`{ type: 'pix', copyPaste }` or `{ type: 'boleto', digitableLine, barcode }`). `POST /subscriptions` with `paymentMethod` `pix` or `boleto` creates the subscription `incomplete` and its first charge `pending`; `latestCharge` carries `expiresAt` and `paymentInstructions`. The charge is settled only when the gateway says so (reconciliation or, in the next piece, its webhook).

- `FAKE_GATEWAY_PIX_EXPIRATION_SECONDS` (default 1800) and `FAKE_GATEWAY_BOLETO_EXPIRATION_SECONDS` (default 259200, 3 days).
- An in-process sweep expires due charges every `FAKE_GATEWAY_EXPIRATION_SWEEP_INTERVAL_MS` (default 5000; 0 disables it).

Dev routes (same gating as `reset`). `{id}` is our charge id (`ch_...`) and they change the gateway state only; our charge follows through the webhook:

- `POST /fake-gateway/charges/{id}/pay` and `POST /fake-gateway/charges/{id}/expire` move a pending pix or boleto gateway charge to `paid` or `expired` and answer with it (`404` unknown charge, `409` when not a pending pix or boleto).
- `POST /fake-gateway/subscriptions/{id}/card` with `{ "cardToken": "tok_..." }` replaces the card token of a card subscription (`204`; `404` unknown, `422` not a card subscription), so the next attempt can be forced to decline.

### Gateway webhooks

Every gateway charge status change (card paid or failed on creation, pix or boleto paid or expired) appends an event `evt_<ulid>` to the fake store and delivers it with `POST` to `FAKE_GATEWAY_WEBHOOK_URL` (default `http://localhost:$PORT/webhooks/gateway`) after `FAKE_GATEWAY_WEBHOOK_DELAY_MS` (default 500). The body is `{ id, type, createdAt, data: { charge } }` with `type` `charge.paid`, `charge.failed` or `charge.expired`, signed in `x-gateway-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` with `GATEWAY_WEBHOOK_SECRET` (required, at least 32 characters; the Docker demo and `.env.example` ship a dev value). A failed delivery (non-2xx or network error) is resent up to 3 times with 1s, 2s and 4s backoff, then given up. With probability `FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE` (0 to 1, default 0) the same event is sent a second time. `FAKE_GATEWAY_WEBHOOK_DISPATCH_ENABLED=false` appends the events but delivers nothing; the test setup turns it off.

## Webhooks

`POST /webhooks/gateway` receives the gateway events (internal endpoint, tag `webhooks` in Swagger) and answers `200 { "received": true }`.

- Signature: header `x-gateway-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>." + raw body>` with `GATEWAY_WEBHOOK_SECRET`. The HMAC is computed over the raw request bytes (the app boots with `rawBody: true`, shared by `main.ts` and the e2e apps through `APP_OPTIONS`), never over re-serialized JSON, and compared in constant time.
- Anti-replay: `t` more than 5 minutes in the past or in the future is rejected.
- Missing, malformed or mismatched signature, or a `t` outside the window: `401` in the standard error body. The check runs before the payload is validated; a valid signature over a body that is not a gateway event is `400`.
- Idempotency: processing is synchronous, in one database transaction per event. It inserts the event into `webhook_events` (unique `gateway_event_id`, `ON CONFLICT DO NOTHING`), locks the charge and its subscription (`SELECT ... FOR UPDATE`, same order as the charge flow), applies the effect with guarded updates and stores `outcome` and `processed_at`. A repeated event id is a no-op that answers `200`; parallel copies apply once.
- The charge is resolved by `data.charge.externalRef` (our charge id). Outcomes recorded in `webhook_events.outcome`, always with `200`:

| Event | Charge state | Outcome and effect |
|---|---|---|
| any | unknown charge | `ignored_unknown_charge` |
| any | `data.charge.amountCents` differs from our charge amount, or `data.charge.customerId` differs from the gateway customer of the subscription owner | `rejected_mismatch`, logged at ERROR, no effect |
| `charge.paid` | `pending` | `applied`: charge `paid` (paid_at = the gateway charge `paidAt`, falling back to the event time), succeeded attempt, subscription `incomplete`/`past_due` to `active` |
| `charge.paid` | `pending` on a `canceled` subscription | `applied`: charge `paid` (the money moved) and the subscription stays `canceled`; logged at ERROR with charge, subscription and gateway ids because a refund is due |
| `charge.paid` | `paid` with the same gateway charge, or `pending` with that gateway charge already recorded as an attempt | `ignored_duplicate_state` |
| `charge.paid` | `expired`, or `paid` with a different gateway charge (double capture) | `requires_refund`, logged at ERROR with charge, subscription and gateway ids, no effect (refunds are not implemented) |
| `charge.failed` | `pending` | `applied`: charge `failed`, declined attempt with the reason, subscription to `past_due` |
| `charge.failed` | `failed` with the same gateway charge, or `pending` with that gateway charge already recorded as an attempt | `ignored_duplicate_state` |
| `charge.expired` | `pending` | `applied`: charge `expired`; subscription `incomplete` (first charge, never paid) to `canceled` with `canceled_at`, `active` (renewal) to `past_due`; no attempt |
| `charge.expired` | `expired` with the same gateway charge | `ignored_duplicate_state` |
| any other event | any other state (for example `expired` after `paid`, `paid` after `failed`) | `rejected_out_of_order`, logged at WARN, no effect |

The same expiry decision (charge `pending` to `expired` plus the subscription change above) is applied when `POST /charges/{id}/retry` reconciles a pending charge whose gateway charge is already `expired`. The charge flow applies the same guards: when it learns that the gateway paid a charge that a webhook already expired, or that was paid by another gateway charge, it logs an ERROR asking for a refund and answers `409`; when a webhook already settled the same outcome (same status and gateway charge) while the gateway call was in flight, it answers with the current state as a success.

## Idempotency

`POST /subscriptions` and `POST /charges/{id}/retry` accept an optional `Idempotency-Key` header (1 to 255 printable ASCII characters, otherwise `400`). Without it the endpoints behave as always. Routes opt in with `@Idempotent()` (`src/shared/idempotency/`); the interceptor talks to an `IdempotencyStore` port (Redis implementation, in-memory fake for tests).

- Scope: the Redis key is `idempotency:{method}:{path with params resolved}:{key}`, so the same key on `/charges/ch_a/retry` and `/charges/ch_b/retry` never collides. The request fingerprint is the SHA-256 of the method, path and the body in canonical form (object keys sorted), so key order in the JSON does not matter.
- Same key and fingerprint, first request completed: the stored status and serialized body are replayed with `Idempotent-Replayed: true`; the handler does not run.
- Same key, different fingerprint: `422`. Same key while the first request is still running: `409`.
- Atomicity: the lock is taken with a Lua script (`SET key value NX EX` plus `GET` when it loses), so concurrent requests have exactly one winner. The lock carries a token; completing or releasing is compare-and-set on it, so a request whose lock expired cannot overwrite a newer holder.
- Stored: `2xx` responses and the deterministic rejections `404`, `409` and `422` (a retry of a definite rejection does not re-execute; a `409` for a charge attempt still in flight is replayed too, so use a new key to try again later). Not stored, the lock is released so the same key can be retried: validation `400` (nothing ran; a corrected body can reuse the key), `5xx` and any unexpected exception.
- TTLs: `IDEMPOTENCY_TTL_SECONDS` (default 86400) for completed records; `IDEMPOTENCY_LOCK_TTL_SECONDS` (default 60) for the in-flight lock, so a crashed request does not block the key forever.
- Redis unavailable while a key was sent: `503`; the handler does not run. If Redis fails after the handler ran, the real response is still returned and the failure is logged (the record then expires with the lock TTL).

## Charge attempts and retries

Every gateway attempt carries the idempotency key `<chargeId>:<attemptNumber>`, persisted before the gateway is called, so re-sending an attempt never charges twice.

`POST /charges/{id}/retry` answers:

- `200` with `charge.status` `paid` or `failed` once the gateway decided.
- `200` with `charge.status` `pending` when the gateway was unavailable, its outcome is unknown (timeout) or it has not decided yet. The charge keeps its attempt key; retry again later.
- `409` when the charge is paid, its subscription is canceled, or it is `pending` with an attempt still in flight, that is, started less than `CHARGE_ATTEMPT_LEASE_SECONDS` (default 30) ago.

Retrying a `pending` charge past that lease reconciles it: the gateway is asked for the charge of the attempt key and its outcome is recorded; when the gateway never received it, the same attempt key is re-sent.
