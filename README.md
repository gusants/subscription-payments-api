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
| `pnpm start:worker` / `pnpm start:worker:prod` | Runs the queue workers alone, without HTTP (see Queues) |
| `pnpm test:e2e` | End-to-end tests against Postgres and Redis started by Testcontainers (Docker required, no compose needed) |

## Configuration

Environment variables are validated at startup. See `.env.example` for the full list; `LOG_LEVEL` controls verbosity (`info` by default). Logs are JSON, pretty-printed when `NODE_ENV=development`. Pino redacts, as `[Redacted]`, the `authorization`, `cookie`, `x-gateway-signature` and `Idempotency-Key` headers and any `cardToken`, `token` or `email` field up to three levels deep in a logged object (`src/shared/logging/redact-paths.ts`). Never put such values in a URL: the request path and query string are logged as they are.

## Correlation id

Every HTTP response carries an `x-correlation-id` header. Send your own (8 to 128 characters from `A-Z a-z 0-9 . _ -`) to have it reused; a missing or malformed value is discarded and a new `cor_<ulid>` is generated, so a client cannot inject arbitrary text into the logs. The id lives in an `AsyncLocalStorage` context (`src/shared/correlation/`) and Pino stamps it as `correlationId` on every log line written while serving the request, including the final `request completed` line. Work that does not start from HTTP (fake gateway webhook delivery and expiration sweeps) runs within an id of its own, inherited from the context that scheduled it when there is one.

Each charge records the id it was created under in `charges.correlation_id` (nullable: charges created before the column exist without one). A dunning reissue inherits the id of the expired charge it replaces; each renewal starts a new id. Whatever processes a charge later (retry and reconciliation workers, a manual `POST /charges/{id}/retry`, a gateway webhook) switches to the id of that charge, so filtering the logs by it follows the payment from creation to settlement. A webhook logs its own gateway event id and the id of the HTTP request that delivered it alongside, and so does a manual retry.

Payment milestones are logged as structured events with a fixed `event` field (`src/modules/charges/payment-events.ts`): `charge.created` (`origin`: `first_period`, `renewal` or `reissue`), `charge.attempt.failed`, `charge.paid`, `charge.expired` (each with `source`: `charge_flow` or `webhook`), `charge.retry.scheduled` (`attempt`, `delayMs`, `runAt`), `charge.dunning_exhausted`, `charge.refund_required` (level `error`, with a `reason`), `subscription.status_changed` (`from`, `to`, `cause`), `webhook.received` and `webhook.duplicate_ignored`. They are written only after the change they describe is committed, and once: a settlement replayed by a second writer logs nothing.

## Tracing

OpenTelemetry tracing is off by default and costs nothing while off: `src/instrumentation.ts` is preloaded by every start script and by the Docker image (`node --import ./dist/instrumentation.js`), reads `OTEL_ENABLED` and returns without loading the SDK unless it is `true`. It runs before Nest, so it reads `process.env` directly, through the same Zod rules as the rest of the configuration (`src/shared/tracing/tracing-settings.ts`); the `start*` scripts pass `--env-file-if-exists=.env` to Node so a value set in `.env` is seen there too.

When on, the SDK exports spans over OTLP/HTTP and instruments:

- **http** (incoming and outgoing requests; `/health` is not traced) and **express** (route handlers, so the server span is named after the route);
- **pg** and **ioredis**, only inside an operation that is already traced, so pool connections and BullMQ polling do not open traces of their own;
- **BullMQ jobs**, by hand (`src/modules/billing-queue/job-tracing.ts`): publishing a retry opens a `publish charge-retries` producer span and stores its W3C context in the job's `traceCarrier`; the worker opens a `process <queue>` consumer span as a child of it, so a retry shows up in the trace of the request that scheduled it. Recurring sweeps and jobs enqueued without a carrier start a trace of their own. Consumer spans carry the job's correlation id as `app.correlation_id`.

While a span is active, every log line also carries `trace_id` and `span_id`, next to `correlationId`.

The code is ESM, so `require` hooks alone are not enough: `instrumentation.ts` registers the `import-in-the-middle` loader hook for the instrumented packages only (`ioredis` is ESM and is not traced without it) and waits for the loader to acknowledge them before the application is imported.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OTEL_ENABLED` | `false` | Turns tracing on |
| `OTEL_SERVICE_NAME` | `subscription-payments-api` | `service.name` of the spans; give the worker process its own |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` (SDK default) | OTLP/HTTP collector base URL |

Any other standard `OTEL_*` variable (sampling, `OTEL_LOG_LEVEL`, resource attributes) is honoured by the SDK.

Jaeger runs locally behind the `observability` compose profile; the API in compose already points at it:

```bash
OTEL_ENABLED=true docker compose --profile observability up --build
open http://localhost:16686
# query API (Jaeger v2): /api/v3/services, /api/v3/traces?query.service_name=subscription-payments-api&query.start_time_min=...&query.start_time_max=...
docker compose --profile observability down
```

For the API on the host, start only the dependencies and Jaeger (`docker compose --profile observability up -d postgres redis jaeger`) and run `OTEL_ENABLED=true pnpm start:dev`.

Following one payment through its logs and traces: [docs/observability.md](docs/observability.md).

## Database

Migrations live in `prisma/migrations`. The unique index `charges_subscription_id_period_start_key` on `charges` (`subscription_id`, `period_start`) is partial (`WHERE status <> 'expired'`) and is declared only in the migration `20261109120000_dunning_state_and_partial_period_unique`, not in `prisma/schema.prisma`: Prisma 7 expresses partial indexes only behind the `partialIndexes` preview feature, which this project does not enable. Prisma's introspection ignores the partial index, so `prisma migrate dev` and `prisma migrate diff` report no drift and do not try to drop it (checked against the migrated database). Do not recreate that index from the schema or edit it outside a migration; an integration test (`test/integration/charges.schema.integration-spec.ts`) reads `pg_indexes.indexdef` and fails if the predicate is lost.

## Health

`GET /health` reports the status of Postgres and Redis and returns `503` when either is down.

## Queues

BullMQ queues `charge-retries`, `subscription-renewals` and `charge-reconciliation` live in the same Redis, under the key prefix `bull` (`bull:<queue>:*`). BullMQ gets its own connections, not the app Redis client. Producers (the queues the API enqueues into) use a fail-fast connection (`enableOfflineQueue: false`, command and connect timeouts, plus a 2 s enqueue timeout), so an enqueue during a Redis outage rejects quickly instead of hanging the request. Workers use a separate connection with `maxRetriesPerRequest: null` and an offline queue, which BullMQ requires to wait out Redis restarts.

Jobs keep the last 1000 completed (or 24h, whichever bound is hit first). Failed jobs are never removed: a job that exhausts its technical attempts stays in the failed set, which plays the dead-letter role and is visible in Bull Board.

Retry job data is `{ chargeId, attempt, correlationId }` (plus a `traceCarrier` with the W3C trace context when tracing is on, see Tracing): the correlation id of the charge travels with the job and the worker processes it within that id; jobs enqueued before the field existed get a generated one. The id is data only, never part of the job id, so two enqueues of the same retry under different ids still dedupe into one job (the first one's data wins). Every technical attempt that fails is logged as a warning within the job's id. The renewal and reconciliation sweeps run each execution within a fresh id, and each charge they touch within the id of that charge.

- `WORKERS_ENABLED` (default true): when false the process only enqueues. `pnpm start:worker` (`pnpm start:worker:prod` after a build) boots the same modules as an application context, with no HTTP server and workers forced on, so workers can run in their own process: run the API with `WORKERS_ENABLED=false` and the worker separately. Mind the single-process fake gateway store (see Payment gateway): with the fake gateway the workers must stay in the API process.
- `RETRY_INTERVAL_UNIT` (`days` default, or `minutes`; the Docker demo uses `minutes`): unit of the dunning calendar. With `NODE_ENV=production` the app refuses to boot on `minutes` unless `ALLOW_ACCELERATED_RETRIES=true` (set in the Docker demo), so a real deployment cannot compress the calendar by accident. Retries fall on D+1, D+3 and D+7, each measured from the original failure (not chained from the previous retry); after the third retry the charge is exhausted. Retry jobs get the deterministic id `retry:{chargeId}:{attempt}`, so scheduling the same retry twice yields one job.
- `RENEWAL_JOB_INTERVAL_SECONDS` (optional): how often the renewal sweep runs. Defaults to 3600 (hourly) with `RETRY_INTERVAL_UNIT=days` and to 30 with `minutes`. `RENEWAL_BATCH_SIZE` (default 100, max 1000): subscriptions renewed per sweep.
- `RECONCILIATION_JOB_INTERVAL_SECONDS` (optional): how often the reconciliation sweep runs. Defaults to 300 with `RETRY_INTERVAL_UNIT=days` and to 30 with `minutes`. `RECONCILIATION_STALE_AFTER_MINUTES` (default 5): how long a pending card charge, or a due dunning retry, must be overdue before the sweep acts on it (keep it above `CHARGE_ATTEMPT_LEASE_SECONDS`). `RECONCILIATION_BATCH_SIZE` (default 100, max 1000): rows handled per sweep and per kind.
- `DEV_ROUTES_ENABLED`: gates `POST /dev/retries/run-now` (below). Defaults to true outside `NODE_ENV=production` and false in production unless set to true; when off the route does not exist (404). The Docker demo runs with `NODE_ENV=production` and the fake gateway routes on, so set `DEV_ROUTES_ENABLED: "true"` there (it is).
- `BULL_BOARD_ENABLED`: Bull Board is served at `/queues` (not in Swagger or `openapi.json`). Defaults to true outside `NODE_ENV=production` and false in production unless set; the Docker demo sets it to true.

### Dunning retries

When a charge fails (declined by the gateway, a `charge.failed` webhook, or a pix/boleto charge expiring on a renewal) the settlement is committed first and only then is the next retry scheduled as a delayed job in `charge-retries`, never inside a database transaction. The state that drives the calendar lives on the charge: `first_failed_at` (set once, on the first failed or expired settlement) and `retry_count` (retries already started). Retry `n` is due at `first_failed_at` + D+1, D+3 or D+7 and its job id is `retry:{chargeId}:{n}`, so the charge flow and the webhook scheduling the same retry yield one job.

- If the enqueue fails the settlement is kept and an ERROR is logged with charge, subscription and retry number; nothing is rolled back. The failed charge with its `first_failed_at` and `retry_count` is the persisted record of the missing retry: the same follow-up is idempotent and is recovered by `POST /charges/{id}/retry` (or the reconciliation job).
- The worker (`WORKERS_ENABLED`) runs a retry only if the charge still matches it: a `failed` card charge with exactly `n - 1` retries is resubmitted as a new attempt (`{chargeId}:{attempts + 1}` key) and `retry_count` becomes `n`; stale or duplicated jobs are skipped.
- Pix and boleto: `expired` is terminal, so each retry issues a new `pending` charge for the same period carrying `first_failed_at` and `retry_count`. The unique index on (`subscription_id`, `period_start`) is partial and excludes `expired` charges, so a period has at most one live charge.
- After the third retry fails the charge becomes `uncollectible` (an expired pix/boleto charge stays `expired`) and the subscription `canceled`, in one transaction, guarded by the current status so a concurrent payment wins.

### Subscription renewals

A repeatable job (BullMQ job scheduler `subscription-renewals`, upserted at worker boot so several instances share one schedule) sweeps `active` subscriptions whose `current_period_end` has passed and that have no charge yet for the next period. For each one it creates the charge for the period starting at `current_period_end` (ending at `computePeriodEnd(billing_anchor, interval, n)`, amount of the plan today) and runs it through the same `ChargeProcessor` as the first charge, outside any transaction. A failed card charge enters the dunning calendar; a pix/boleto charge waits for its webhook.

- One charge per period: the partial unique index on (`subscription_id`, `period_start`) rejects a second one, and a unique violation is treated as already generated. The sweep also skips any subscription that already has a charge, in any status, for that period: dunning owns it from then on, so a failed or expired renewal is never duplicated by the sweep.
- The period only advances when money lands: a `paid` settlement (charge flow or webhook) moves `current_period_start`/`current_period_end` to the paid charge's period, in the same transaction, and never backwards. Until then the subscription keeps its old period and, if the renewal fails, goes `past_due`.
- Not renewed: `canceled` (cancellation is immediate, there is no cancel-at-period-end), `past_due` (its current period is unpaid; dunning handles it) and `incomplete`.
- The sweep takes at most `RENEWAL_BATCH_SIZE` subscriptions, oldest period first; one failing subscription is logged (subscription id and period) and does not stop the batch. A renewal charge left `pending` by a technical failure is recovered by reconciliation.

### Reconciliation

A repeatable job (job scheduler `charge-reconciliation`, upserted at worker boot) closes the gaps the other flows leave behind. It runs two independent passes, each limited to `RECONCILIATION_BATCH_SIZE` rows, oldest first:

- Stuck charges: `pending` card charges, and `pending` pix/boleto charges that never reached the gateway (no gateway charge id), whose attempt started more than `RECONCILIATION_STALE_AFTER_MINUTES` ago (or that never recorded an attempt and were created that long ago) go through `ChargeProcessor.reconcile`: it takes the attempt lease, asks the gateway for the charge of the attempt key, applies what it holds (a pix/boleto the gateway already issued gets its payment instructions attached) and only re-sends (same key) if the gateway never received it. This also recovers renewals and reissues left pending by a technical failure (the renewal sweep reports them as `awaitingReconciliation`). Pix and boleto charges the gateway already holds are left to their webhook and expiry. Charges of a card subscription without a card token are skipped.
- Lost dunning follow-ups: `failed` (and `expired` pix/boleto) charges whose next retry slot passed more than the stale window ago, on subscriptions that are not canceled and, for expired charges, only the newest charge of the period (no live charge and none with more retries for the same period), so an expired ancestor of a reissue is never reissued again out of calendar; a reissue is also refused when the period already has a charge with that many retries. The enqueue is re-applied through the same path as the original settlement, so the deterministic job id makes it idempotent; a charge that already used all its retries gets its exhaustion (`uncollectible` and canceled subscription) re-applied.
- Canceled subscriptions: a pending charge whose subscription was canceled is still checked with the gateway instead of being rejected. If the gateway holds it paid it is applied and ERROR-logged as a payment on a canceled subscription that needs a refund (the same signal as the webhook); a decline is recorded without touching the subscription; if the gateway never received it, the charge is expired without being sent.
- One failing charge is logged with its id, subscription and attempt start, and does not stop the batch. A reconciliation that hits a live attempt (lease still valid) fails with a transient conflict and is retried by the next sweep.

### Running retries now (development)

`POST /dev/retries/run-now` promotes every delayed job of `charge-retries` with `job.promote()` and answers `{ "promoted": n }`, so a demo does not have to wait for D+1, D+3 or D+7 (together with the fake gateway routes, this is what the Project 2 simulator drives). Promotion only moves the jobs to the waiting list: the worker (`WORKERS_ENABLED`) settles them asynchronously, so poll the customer charge history. Jobs that are not delayed anymore by the time they are promoted are skipped and not counted. It answers 503 when the queue is unreachable. The route is controlled by `DEV_ROUTES_ENABLED` and is part of `openapi.json` under the `dev` tag.

### Technical retries

A retry job separates a business failure from a technical one:

- A decline (or an expired pix/boleto) is a customer attempt: it is recorded as a payment attempt and moves the dunning calendar.
- `GatewayUnavailableError` is technical. The worker rethrows it and BullMQ re-runs the job up to 5 attempts with exponential backoff (5 s, 10 s, 20 s, 40 s). It records no payment attempt, so `attempt_count` does not move, and it does not touch `retry_count`: the re-run stays inside the same calendar slot. The re-run finds the charge `pending` with the retry already started (or, for pix/boleto, the live charge of the period created by this retry) and resumes it: it asks the gateway for the charge of the attempt key first and only re-sends the same key if the gateway never received it, so nothing is charged twice. A job that exhausts its attempts stays in the failed set (the DLQ in Bull Board) with the charge `pending`; reconciliation of pending charges picks it up.
- `GatewayOutcomeUnknownError` (the response was lost, the gateway may have processed it) is not retried blindly: the job completes and the charge stays `pending` with its attempt key. The charge flow's lease and reconciliation, or the gateway webhook, resolve it by asking the gateway about the attempt key. When it settles as `failed` the next dunning retry is scheduled as usual.

## Payment gateway

`PAYMENT_GATEWAY=fake` (the only adapter for now) stores its customers and charges in the JSON file at `FAKE_GATEWAY_DATA_FILE`. Magic card tokens: `tok_success`, `tok_insufficient_funds`, `tok_expired_card`, `tok_fail_then_success` (declines the first attempt of a charge, approves the next), `tok_timeout_then_success` (the first call for a charge reference fails as gateway unavailable and stores nothing, later calls approve; the memory of that first timeout lives in the process) and anything else is declined as `invalid_token`.

The store is single-process: it serializes access with an in-memory queue, so only one Node process may use a given file. Background workers (retries, reconciliation) must run inside the API process, or use a real gateway. In the Docker demo the workers therefore stay in the API process.

`POST /fake-gateway/reset` (and the other `/fake-gateway/*` routes) are served when `FAKE_GATEWAY_ROUTES_ENABLED` is true. It defaults to true outside `NODE_ENV=production` and false in production unless set; the Docker demo sets it to true.

### Pix and boleto

Pix and boleto charges are born `pending` in the gateway with an expiry and payment instructions (`{ type: 'pix', copyPaste }` or `{ type: 'boleto', digitableLine, barcode }`). `POST /subscriptions` with `paymentMethod` `pix` or `boleto` creates the subscription `incomplete` and its first charge `pending`; `latestCharge` carries `expiresAt` and `paymentInstructions`. The charge is settled only when the gateway says so (reconciliation or, in the next piece, its webhook).

- `FAKE_GATEWAY_PIX_EXPIRATION_SECONDS` (default 1800) and `FAKE_GATEWAY_BOLETO_EXPIRATION_SECONDS` (default 259200, 3 days).
- An in-process sweep expires due charges every `FAKE_GATEWAY_EXPIRATION_SWEEP_INTERVAL_MS` (default 5000; 0 disables it).

Dev routes (same gating as `reset`). `{id}` is our charge id (`ch_...`) and they change the gateway state only; our charge follows through the webhook:

- `POST /fake-gateway/charges/{id}/pay` and `POST /fake-gateway/charges/{id}/expire` move a pending pix or boleto gateway charge to `paid` or `expired` and answer with it (`404` unknown charge, `409` when not a pending pix or boleto, or when `pay` arrives after the charge expiry: the charge then expires instead and the `charge.expired` event is emitted, even if the sweep has not run yet).
- `POST /fake-gateway/subscriptions/{id}/card` with `{ "cardToken": "tok_..." }` replaces the card token of a card subscription (`204`; `404` unknown, `422` not a card subscription), so the next attempt can be forced to decline.

### Gateway webhooks

Every gateway charge status change (card paid or failed on creation, pix or boleto paid or expired) appends an event `evt_<ulid>` to the fake store and delivers it with `POST` to `FAKE_GATEWAY_WEBHOOK_URL` (default `http://localhost:$PORT/webhooks/gateway`) after `FAKE_GATEWAY_WEBHOOK_DELAY_MS` (default 500). The body is `{ id, type, createdAt, data: { charge } }` with `type` `charge.paid`, `charge.failed` or `charge.expired`, signed in `x-gateway-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` with `GATEWAY_WEBHOOK_SECRET` (required, at least 32 characters; the Docker demo and `.env.example` ship a dev value). A failed delivery (non-2xx or network error) is resent up to 3 times with 1s, 2s and 4s backoff, then given up. On boot the dispatcher reschedules every stored event that was never delivered and still has attempts left, so a restart does not lose events. A paid gateway charge carries `paidAt`, which our charge stores as `paid_at` whichever path settles it (charge flow, reconciliation or webhook). With probability `FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE` (0 to 1, default 0) the same event is sent a second time. `FAKE_GATEWAY_WEBHOOK_DISPATCH_ENABLED=false` appends the events but delivers nothing; the test setup turns it off.

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
| `charge.paid` | `expired`, `failed`, `uncollectible`, or `paid` with a different gateway charge (double capture) | `requires_refund`, logged at ERROR with charge, subscription and gateway ids, no effect (refunds are not implemented) |
| `charge.failed` | `pending` | `applied`: charge `failed`, declined attempt with the reason, subscription to `past_due` |
| `charge.failed` | `failed` with the same gateway charge, or `pending` with that gateway charge already recorded as an attempt | `ignored_duplicate_state` |
| `charge.expired` | `pending` | `applied`: charge `expired`; subscription `incomplete` (first charge, never paid) to `canceled` with `canceled_at`, `active` (renewal) to `past_due`; no attempt |
| `charge.expired` | `expired` with the same gateway charge | `ignored_duplicate_state` |
| any other event | any other state (for example `expired` after `paid`, `paid` after `failed`) | `rejected_out_of_order`, logged at WARN, no effect |

The same expiry decision (charge `pending` to `expired` plus the subscription change above) is applied when `POST /charges/{id}/retry` reconciles a pending charge whose gateway charge is already `expired`. The charge flow applies the same guards: when it learns that the gateway paid a charge that a webhook already expired, or that was paid by another gateway charge, it logs an ERROR asking for a refund and answers `409`; when a webhook already settled the same outcome (same status and gateway charge) while the gateway call was in flight, it answers with the current state as a success.

## Idempotency

`POST /subscriptions` and `POST /charges/{id}/retry` accept an optional `Idempotency-Key` header (1 to 255 printable ASCII characters, otherwise `400`; sending the header more than once is also `400`). Without it the endpoints behave as always. Routes opt in with `@Idempotent()` (`src/shared/idempotency/`); the interceptor talks to an `IdempotencyStore` port (Redis implementation, in-memory fake for tests).

- Scope: the Redis key is `idempotency:{method}:{path with params resolved}:{key}`, so the same key on `/charges/ch_a/retry` and `/charges/ch_b/retry` never collides. The request fingerprint is the SHA-256 of the method, path and the body in canonical form (object keys sorted), so key order in the JSON does not matter.
- Same key and fingerprint, first request completed: the stored status and serialized body are replayed with `Idempotent-Replayed: true`; the handler does not run.
- Same key, different fingerprint: `422`. Same key while the first request is still running: `409`.
- Atomicity: the lock is taken with a Lua script (`SET key value NX EX` plus `GET` when it loses), so concurrent requests have exactly one winner. The lock carries a token; completing or releasing is compare-and-set on it, so a request whose lock expired cannot overwrite a newer holder.
- Stored: `2xx` responses and the deterministic rejections `404`, `409` and `422` (a retry of a definite rejection does not re-execute). Not stored, the lock is released so the same key can be retried: validation `400` (nothing ran; a corrected body can reuse the key), `5xx`, any unexpected exception and the transient rejections. A domain error is transient (`DomainError.transient`, e.g. `new ConflictError(message, { transient: true })`) when the same request may succeed later; marked as such: a charge attempt still in flight within the lease, a charge modified concurrently, and a customer with no gateway customer yet. They are answered with their usual `409`/`422` but never stored or replayed.
- TTLs: `IDEMPOTENCY_TTL_SECONDS` (default 86400) for completed records; `IDEMPOTENCY_LOCK_TTL_SECONDS` (default 60) for the in-flight lock, so a crashed request does not block the key forever.
- Lock heartbeat: while the handler runs the interceptor extends the lock every third of the lock TTL (token-guarded `PEXPIRE` in a Lua script), so a handler slower than the TTL keeps its key; the heartbeat stops in a `finally`. If the lock was lost anyway (expired or taken over) it is logged at ERROR with the key, both when the heartbeat notices and when completing or releasing finds it gone. A failing `complete` or `release` is retried (3 attempts, 50 ms and 100 ms backoff) before being logged at ERROR with the key.
- Redis unavailable while a key was sent: `503` within about a second; the handler does not run. If Redis fails after the handler ran, the real response is still returned and the failure is logged (the record then expires with the lock TTL).
- The app Redis client (idempotency and `/health`) fails fast: `enableOfflineQueue: false`, `maxRetriesPerRequest: 1`, `commandTimeout` 1000 ms, `connectTimeout` 2000 ms (`src/shared/redis/app-redis-client.ts`). Boot waits up to 3 s for the first connection and carries on if Redis is not up yet; ioredis keeps reconnecting in the background, also after a Redis restart. Connections with other needs (for example BullMQ workers, which require `maxRetriesPerRequest: null`) are created with `createRedisConnection(options)` and do not inherit these options.

## Charge attempts and retries

Every gateway attempt carries the idempotency key `<chargeId>:<attemptNumber>`, persisted before the gateway is called, so re-sending an attempt never charges twice.

`POST /charges/{id}/retry` answers:

- `202` for a `failed` charge: the next dunning retry was queued to run now, with the same deterministic job id as the scheduled one (a job already scheduled for later is promoted, never duplicated; a job that already `failed` after exhausting its technical attempts, or `completed` without the charge advancing, is run again with its attempts reset), and the body is the charge as it is at that moment, still `failed`. The worker settles it asynchronously; read the result in the customer charge history. A replay with the same `Idempotency-Key` answers `202` too.
- `200` for a `pending` charge past its attempt lease, reconciled inline (below): `charge.status` is `paid` or `failed` once the gateway decided, and stays `pending` when the gateway is unavailable, its outcome is unknown (timeout) or it has not decided yet; the charge keeps its attempt key.
- `202` also for an `expired` pix/boleto charge that is the newest of its period: the retry queued is the dunning reissue, which issues a new `pending` charge for the period (the expired one stays as it is).
- `409` when the charge is paid or uncollectible, is expired but superseded by a newer charge of the same period, its subscription is canceled, it already used its 3 dunning retries, or it is `pending` with an attempt still in flight, that is, started less than `CHARGE_ATTEMPT_LEASE_SECONDS` (default 30) ago.
- `503` when the retry queue is unreachable; nothing was queued and the same `Idempotency-Key` can be sent again.

Retrying a `pending` charge past that lease reconciles it: the gateway is asked for the charge of the attempt key and its outcome is recorded; when the gateway never received it, the same attempt key is re-sent.
