# subscription-payments-api

[![CI](https://github.com/gusants/subscription-payments-api/actions/workflows/ci.yml/badge.svg)](https://github.com/gusants/subscription-payments-api/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/gusants/subscription-payments-api/badges/coverage-badge.json)](https://github.com/gusants/subscription-payments-api/actions/workflows/ci.yml)

NestJS API that manages plans, customers and recurring subscriptions, and bills them against a payment gateway.

- Failed card charges and Pix/boleto expirations enter a dunning calendar (D+1, D+3, D+7) run by BullMQ; when retries run out the charge becomes `uncollectible` and the subscription is canceled.
- Gateway webhooks are HMAC-signed, verified and applied idempotently; `POST /subscriptions` and `POST /charges/{id}/retry` honour `Idempotency-Key`.
- `GET /metrics/overview` computes MRR, active and past-due subscriptions, delinquency rate and revenue by month; `GET /customers/{id}/summary` narrates a customer's payment history with an LLM, which never performs the calculations.

The payment gateway is a fake adapter behind a `PaymentGateway` port. Everything else (database, queues, webhooks, logs, tracing, LLM) is real.

## Contents

- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Scripts](#scripts)
- [Endpoints](#endpoints)
- [Configuration](#configuration)
- [Technical decisions](#technical-decisions)
- [Metrics](#metrics)
- [Correlation id](#correlation-id)
- [Tracing](#tracing)
- [Webhooks](#webhooks)
- [Testing](#testing)
- [Following a payment in the logs](#following-a-payment-in-the-logs)
- [Live dashboard](#live-dashboard)
- [Demo](#demo)
- [Production changes](#production-changes)
- [Known limitations](#known-limitations)

## Architecture

![Architecture: the API process (HTTP API, BullMQ workers, fake gateway adapter), PostgreSQL, Redis, the LLM provider and optional Jaeger](docs/images/architecture.png)

The source is [`docs/images/architecture.mmd`](docs/images/architecture.mmd) (also as [SVG](docs/images/architecture.svg)). To regenerate it with [mermaid-cli](https://github.com/mermaid-js/mermaid-cli):

```bash
npx -y @mermaid-js/mermaid-cli@11.4.2 -c docs/images/architecture.config.json -i docs/images/architecture.mmd -o docs/images/architecture.png -b white -s 3
```

The workers run in the API process by default (`WORKERS_ENABLED=true`). They can run in their own process (`pnpm start:worker`), but only with a real gateway: the fake gateway's JSON store is single-process.

### Dunning, end to end

A card that always declines (`tok_insufficient_funds`) walks the whole calendar:

```mermaid
sequenceDiagram
  autonumber
  participant Client
  participant API
  participant Gateway as Fake gateway
  participant Queue as BullMQ charge-retries
  participant Worker
  participant DB as PostgreSQL
  Client->>API: POST /subscriptions with card token tok_insufficient_funds
  API->>Gateway: charge, attempt 1
  Gateway-->>API: declined
  API->>DB: charge failed, subscription past_due, first_failed_at set
  API->>Queue: retry 1 job, delayed to D+1
  Note over Queue: job id is retry:{chargeId}:{n}, so it is never scheduled twice
  Queue->>Worker: D+1 reached
  Worker->>Gateway: charge, attempt 2
  Gateway-->>Worker: declined
  Worker->>DB: attempt recorded, retry_count 1
  Worker->>Queue: retry 2 job, delayed to D+3
  Queue->>Worker: D+3 reached
  Worker->>Gateway: charge, attempt 3
  Gateway-->>Worker: declined
  Worker->>Queue: retry 3 job, delayed to D+7
  Queue->>Worker: D+7 reached
  Worker->>Gateway: charge, attempt 4
  Gateway-->>Worker: declined
  Worker->>DB: charge uncollectible and subscription canceled, one transaction
```

Each retry is measured from the first failure, not chained from the previous retry. With `tok_fail_then_success` the retry is approved instead and the subscription returns to `active`. A Pix or boleto charge that expires is not retried in place: a new `pending` charge is issued for the same period, and after the third retry fails the subscription is canceled.

## Quick start

Requirements: Docker, Node.js 24 (`.nvmrc`) and pnpm 10 for the host-side commands. `scripts/demo.sh` also needs `curl` and `jq`.

### Option A: everything in Docker

Requirements: Docker with Compose 2.24 or newer. No Node.js, pnpm or `.env` is needed.

```bash
docker compose up --build -d --wait
docker compose run --rm seed
./scripts/demo.sh
```

- `docker compose up --build -d --wait` starts PostgreSQL, Redis and the API and returns when all three are healthy. The API container applies the migrations (`prisma migrate deploy`) on start and runs the workers in the same process. Swagger is at <http://localhost:3000/docs> and Bull Board at <http://localhost:3000/queues>.
- `docker compose run --rm seed` waits for the API, then loads the demo data set (plans, customers and months of payment history) with the opt-in the seed requires (see below). The `seed` service is behind the `tools` profile, so `up` never starts it.
- `./scripts/demo.sh` needs `curl` and `jq` on the host. It subscribes with a declining card, fires the retry, summarises with AI and reads the metrics.
- Without a `.env`, compose uses the development defaults (`POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` are all `payments`).
- With a `.env` (`cp .env.example .env`), compose also passes it to the API container, so every setting in the [Configuration](#configuration) table (`LLM_PROVIDER`, `GEMINI_API_KEY`, `RENEWAL_*`, `RECONCILIATION_*`, `IDEMPOTENCY_*`...) takes effect. The compose file overrides only what must point at the compose network or be fixed for the container: `NODE_ENV`, `PORT`, `DATABASE_URL`, `REDIS_*`, `FAKE_GATEWAY_DATA_FILE`, `FAKE_GATEWAY_WEBHOOK_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT` and `ALLOW_ACCELERATED_RETRIES`. `docker compose down -v` also wipes the data.
- `DEV_ROUTES_ENABLED`, `BULL_BOARD_ENABLED` and `FAKE_GATEWAY_ROUTES_ENABLED` default to `true` in compose (`scripts/demo.sh` needs the first one); set them to `false` in the shell or in `.env` to turn them off.
- The dunning calendar runs in days (D+1, D+3, D+7). To watch it end to end in minutes, set `RETRY_INTERVAL_UNIT=minutes` in `.env` and run `docker compose up -d --wait` again (see [Seeded past-due subscriptions](#seeded-past-due-subscriptions)). Use `.env` rather than an inline variable: compose evaluates the variable on every command, and `docker compose run --rm seed` with a different value would recreate the API with that value.

### Option B: API on the host

Requirements: Docker, Node.js 24 (`.nvmrc`) and pnpm 10.

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm prisma:migrate
pnpm start:dev
```

`pnpm db:up` starts only PostgreSQL and Redis. `start:dev` does not run migrations, so `pnpm prisma:migrate` is required on a fresh database. With the API running (`.env.example` sets `DEV_ROUTES_ENABLED=true`), `pnpm db:seed` loads the demo data and `./scripts/demo.sh` runs the walkthrough.

### Demo data and the demo script

`scripts/demo.sh` reads `BASE_URL` (default `http://localhost:3000`) and fails with a clear message if `POST /dev/retries/run-now` answers 404 (dev routes off) or if the subscription does not become `active` within `POLL_TIMEOUT_SECONDS` (default 30). `STEP_PAUSE_SECONDS` (default 0) pauses before each step, which the recorded GIF uses. It works under either retry unit because it fires the scheduled retry through the dev route instead of waiting for it.

The seed (`pnpm db:seed`, or `docker compose run --rm seed`) is a development tool and refuses to run unless the target is clearly a throwaway database:

- It refuses when `NODE_ENV=production` or when `DATABASE_URL` points at a host other than `localhost`, `127.0.0.1` or `[::1]`.
- `SEED_ALLOW_REMOTE=true` overrides both refusals. The compose `seed` service sets it, because from inside the compose network the database host is `postgres` and the container runs with `NODE_ENV=production`. Do not set it against a database you care about: the seed deletes and recreates its own rows (subscriptions whose id starts with `sub_seed_`, and their charges and attempts) and upserts the plans and customers.

#### Seeded past-due subscriptions

The seed reads `RETRY_INTERVAL_UNIT` and places the three past-due subscriptions as if their first failure happened 1, 1 and 3 retry units ago (so they have made 1, 1 and 2 retries), measured from the moment you seed. The reconciliation sweep treats a charge as overdue once its next retry offset (D+3, D+3 and D+7 from the first failure) plus `RECONCILIATION_STALE_AFTER_MINUTES` has passed. So they stay `past_due` for about 2 retry units (the first two) and 4 retry units (the third) after seeding: 2 and 4 days with the default `days`, but only about 7 and 9 minutes under `RETRY_INTERVAL_UNIT=minutes` (observed: the first two canceled about 8 minutes after seeding, the third about 10), after which the accelerated dunning retries them and cancels them (the seeded card always declines). The seed must see the same `RETRY_INTERVAL_UNIT` as the API (keep it in `.env`). Run the seed again to reset the demo.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm start:dev` | API in watch mode, with OpenTelemetry preloaded (inert unless `OTEL_ENABLED=true`) |
| `pnpm start` / `pnpm start:prod` | API from source / from `dist/` (after `pnpm build`) |
| `pnpm start:worker` / `pnpm start:worker:prod` | Workers only, as an application context with no HTTP server |
| `pnpm build` | Compiles to `dist/` |
| `pnpm db:up` / `pnpm db:down` | Starts / stops PostgreSQL and Redis with compose |
| `pnpm prisma:migrate` | `prisma migrate dev`: applies migrations and creates new ones |
| `pnpm prisma:generate` | Regenerates the Prisma client into `src/generated/prisma` |
| `pnpm db:seed` | Loads the demo data set into `DATABASE_URL`; see [Demo data](#demo-data-and-the-demo-script) for what it refuses |
| `pnpm openapi:export` | Regenerates `openapi.json`; CI fails when the committed file is stale |
| `pnpm llm:smoke` | One real call to the Gemini provider (needs `LLM_PROVIDER=gemini` and `GEMINI_API_KEY`); not run in CI |
| `pnpm lint` / `pnpm format:check` / `pnpm typecheck` | oxlint (type-aware), Prettier check, `tsc --noEmit` |
| `pnpm test` / `pnpm test:cov` | Unit tests / unit tests with coverage thresholds |
| `pnpm test:integration` | Repository, queue and cache tests against Testcontainers |
| `pnpm test:e2e` | HTTP flows against Testcontainers |

## Endpoints

No endpoint has authentication (see [Production changes](#production-changes)). The only guarded route is `POST /webhooks/gateway`, which checks the gateway signature.

Interactive reference: `GET /docs` (Swagger). Machine-readable: [`openapi.json`](openapi.json), committed at the repository root.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/plans` | Create plan (`amountCents`, `interval` `monthly` or `yearly`) |
| GET | `/plans` | List plans |
| POST | `/customers` | Create customer |
| GET | `/customers` | List customers (search, status filter, pagination) |
| GET | `/customers/{id}` | Customer detail |
| GET | `/customers/{id}/charges` | Charge history with attempts |
| GET | `/customers/{id}/summary` | AI summary of payment behaviour (cached per customer event) |
| POST | `/subscriptions` | Create subscription; accepts `Idempotency-Key`; card, Pix or boleto |
| GET | `/subscriptions/{id}` | Subscription detail |
| POST | `/subscriptions/{id}/cancel` | Immediate cancellation (no cancel-at-period-end) |
| POST | `/charges/{id}/retry` | Manual retry or reconciliation; accepts `Idempotency-Key`; answers `202`, `200`, `409` or `503` |
| POST | `/webhooks/gateway` | Gateway events; requires `x-gateway-signature`; tag `webhooks` |
| GET | `/metrics/overview` | `from` and `to` (both or neither); see [Metrics](#metrics) |
| GET | `/health` | Postgres and Redis; `503` when either is down |
| POST | `/dev/retries/run-now` | Promotes every delayed retry job; `404` unless `DEV_ROUTES_ENABLED` |
| POST | `/fake-gateway/reset` | Clears the fake gateway store; `404` unless `FAKE_GATEWAY_ROUTES_ENABLED` |
| POST | `/fake-gateway/charges/{id}/pay` | Settles a pending Pix or boleto at the gateway |
| POST | `/fake-gateway/charges/{id}/expire` | Expires a pending Pix or boleto at the gateway |
| POST | `/fake-gateway/subscriptions/{id}/card` | Replaces the card token of a card subscription (`{ "cardToken": "tok_..." }`) |

Bull Board is served at `/queues` (not in Swagger or `openapi.json`), enabled by `BULL_BOARD_ENABLED`.

Example, illustrative of the response shape (values are placeholders):

```bash
curl -s -X POST http://localhost:3000/subscriptions \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"customerId":"cus_...","planId":"plan_...","paymentMethod":"card","cardToken":"tok_success"}'
```

Retry the same request with the same key and the stored response is replayed with `Idempotent-Replayed: true`.

## Configuration

Variables are validated at startup from `src/shared/config/env.schema.ts`; an invalid value stops the process. `.env.example` lists them with the development values. Tracing variables are read before Nest starts from the same rules and are covered in [Tracing](#tracing).

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production`; drives the defaults of the dev flags below |
| `PORT` | `3000` | HTTP port |
| `LOG_LEVEL` | `info` | Pino level |
| `DATABASE_URL` | required | PostgreSQL URL |
| `REDIS_HOST` / `REDIS_PORT` | required / `6379` | Redis for queues, idempotency, cache and health |
| `PAYMENT_GATEWAY` | `fake` | Gateway adapter (only `fake` exists) |
| `FAKE_GATEWAY_DATA_FILE` | `data/fake-gateway.json` | JSON store of the fake gateway |
| `FAKE_GATEWAY_ROUTES_ENABLED` | `true` outside production | Mounts `/fake-gateway/*` |
| `FAKE_GATEWAY_PIX_EXPIRATION_SECONDS` | `1800` | Pix expiry |
| `FAKE_GATEWAY_BOLETO_EXPIRATION_SECONDS` | `259200` | Boleto expiry (3 days) |
| `FAKE_GATEWAY_EXPIRATION_SWEEP_INTERVAL_MS` | `5000` | Expiry sweep; `0` disables it |
| `FAKE_GATEWAY_WEBHOOK_URL` | `http://localhost:$PORT/webhooks/gateway` | Where the fake gateway delivers events |
| `FAKE_GATEWAY_WEBHOOK_DELAY_MS` | `500` | Delay before each webhook |
| `FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE` | `0` | Probability (0 to 1) of re-sending an event |
| `FAKE_GATEWAY_WEBHOOK_DISPATCH_ENABLED` | `true` | `false` stores events without delivering them |
| `SEED_ALLOW_REMOTE` | unset | Read only by the seed tool (`pnpm db:seed`, compose `seed` service); `true` lets it run against a non-local database or with `NODE_ENV=production` |
| `GATEWAY_WEBHOOK_SECRET` | required, 32+ chars | HMAC key for webhooks, shared by the fake gateway and the API |
| `RETRY_INTERVAL_UNIT` | `days` | `minutes` compresses the dunning calendar; refused in production. Compose defaults to `days` too |
| `ALLOW_ACCELERATED_RETRIES` | unset | Must be `true` to boot with `RETRY_INTERVAL_UNIT=minutes` in production |
| `WORKERS_ENABLED` | `true` | `false` makes the process enqueue only |
| `RENEWAL_JOB_INTERVAL_SECONDS` | `3600` (days) / `30` (minutes) | Renewal sweep period |
| `RENEWAL_BATCH_SIZE` | `100` (max 1000) | Subscriptions per renewal sweep |
| `RECONCILIATION_JOB_INTERVAL_SECONDS` | `300` (days) / `30` (minutes) | Reconciliation sweep period |
| `RECONCILIATION_STALE_AFTER_MINUTES` | `5` | Age before a pending charge or due retry is reconciled |
| `RECONCILIATION_BATCH_SIZE` | `100` (max 1000) | Rows per sweep and per kind |
| `CHARGE_ATTEMPT_LEASE_SECONDS` | `30` | How long an in-flight charge attempt blocks a retry |
| `DEV_ROUTES_ENABLED` | `true` outside production | Mounts `POST /dev/retries/run-now` |
| `BULL_BOARD_ENABLED` | `true` outside production | Mounts `/queues` |
| `IDEMPOTENCY_TTL_SECONDS` | `86400` | Lifetime of a completed idempotent response |
| `IDEMPOTENCY_LOCK_TTL_SECONDS` | `60` | Lock of an in-flight request; heartbeated while it runs |
| `LLM_PROVIDER` | `fake` | `fake` (no network) or `gemini` |
| `LLM_MODEL` | `gemini-3.5-flash-lite` | Model name for the provider |
| `LLM_TIMEOUT_MS` | `8000` | Timeout per model call |
| `LLM_THINKING_LEVEL` | `minimal` | `minimal`, `low`, `medium` or `high` (Gemini) |
| `LLM_MAX_CALLS_PER_MINUTE` | `60` | Per-process token bucket for model calls |
| `GEMINI_API_KEY` | required when `LLM_PROVIDER=gemini` | Gemini API key |
| `CUSTOMER_SUMMARY_CACHE_TTL_SECONDS` | `86400` | TTL of LLM summaries |
| `CUSTOMER_SUMMARY_FALLBACK_TTL_SECONDS` | `30` | TTL of fallback summaries |
| `CUSTOMER_SUMMARY_MEMORY_CACHE_MAX_ENTRIES` | `500` | In-process cache used when Redis is down |
| `OTEL_ENABLED` | `false` | Turns OpenTelemetry tracing on |
| `OTEL_SERVICE_NAME` | `subscription-payments-api` | `service.name` of the spans |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | SDK default (`http://localhost:4318`) | OTLP/HTTP collector |

Logs are JSON through Pino. Pino redacts `authorization`, `cookie`, `x-gateway-signature` and `idempotency-key` headers, and the fields `cardToken`, `token` and `email` at the top level of a log object or up to two levels below it. Query string values are never logged (`req.url` becomes `/customers?[Redacted]`). Paths are logged as they are, so never put personal data in a path segment. The rules live in `src/shared/logging/redact-paths.ts` and `src/shared/logging/request-serializer.ts`.

## Technical decisions

**The gateway is a port.** `PaymentGateway` (`src/gateway/payment-gateway.port.ts`) is implemented by a fake adapter that keeps customers, charges and events in a JSON file and delivers signed webhooks. Replacing it means writing one adapter; the billing rules do not change.

**Idempotency at the HTTP boundary.** `POST /subscriptions` and `POST /charges/{id}/retry` accept `Idempotency-Key`. The key is scoped to method, resolved path and key, and the body is fingerprinted in canonical form, so key order does not matter. The lock is taken with a Lua script and carries a token, so exactly one concurrent request wins and an expired lock cannot overwrite a newer one. Completed `2xx` responses and definite `404`, `409` and `422` are stored; validation errors, `5xx` and transient conflicts are not, so the client can retry. Same key with a different body is `422`; same key while the first request runs is `409`.

**Charges are committed before they are scheduled.** Settlements commit first and the next retry is enqueued afterwards, never inside a database transaction. If the enqueue fails, the settlement stays and the missing retry is recovered by `POST /charges/{id}/retry` or by reconciliation. The charge row (`first_failed_at`, `retry_count`) is the persisted record of what is owed.

**Dunning is scheduled business time; BullMQ retries are technical.** Retries at D+1, D+3 and D+7 from the first failure are delayed jobs with the id `retry:{chargeId}:{n}`, so scheduling the same retry twice yields one job. BullMQ `attempts` and exponential backoff (5 attempts, 5 s base) are used only for `GatewayUnavailableError`, which records no payment attempt and does not move the dunning calendar. A `GatewayOutcomeUnknownError` is not retried blindly: the charge stays `pending` and is resolved by asking the gateway about its attempt key.

**Attempt keys make re-sends safe.** Every gateway attempt uses the key `<chargeId>:<attemptNumber>`, persisted before the gateway is called. A re-send with the same key cannot charge twice; reconciliation asks the gateway for that key first.

**One live charge per period.** A partial unique index on `charges (subscription_id, period_start) WHERE status <> 'expired'` makes a period have at most one live charge, so Pix and boleto reissues and renewal sweeps cannot duplicate a period. The index is declared only in migration `20261109120000_dunning_state_and_partial_period_unique`, because Prisma 7 needs a preview feature this project does not enable. Do not recreate it from `schema.prisma`; an integration test checks the predicate in `pg_indexes`.

**Webhooks are verified on raw bytes and applied once.** The HMAC is computed over the raw request body with a constant-time comparison; timestamps more than 5 minutes off are rejected (`401`). Each event is inserted into `webhook_events` (unique `gateway_event_id`) in the same transaction that locks the charge and applies the effect. Duplicates answer `200` and do nothing.

**Correlation id as a search key.** Every charge stores the id it was created under, and every job, webhook and manual retry switches to it. This follows one payment across HTTP, queues and webhooks. It is not authentication: a client may choose any well-formed id.

**Metrics are pure functions.** MRR, delinquency and revenue are computed by functions in `src/modules/metrics/domain/` that are unit-tested without a database; the repository only loads the inputs.

**The LLM narrates; it does not decide.** `GET /customers/{id}/summary` works like this:

- Numbers (`monthsAsCustomer`, `totalPaidCents`, `failedAttempts`, `averageDaysLate`, `paymentSuccessRate`) are computed in code and returned as is.
- The model receives an anonymized context: plan, metrics and a timeline by billing period, with ISO UTC dates. No name, e-mail, document, real id or pseudonym of an id.
- The reply must match a Zod schema (`summary`, `paymentBehavior`, `riskLevel`, `suggestedAction`). Any number in the narration must derive from the context, otherwise the narration is discarded.
- Any provider error, timeout, truncated reply or invalid output yields a deterministic rules-based summary with `source: "fallback"`. The endpoint does not return 5xx because of the LLM.
- The model has no tools and cannot cancel, block or charge anything.
- The cache key is `customer-summary:{customerId}:{promptVersion}:{model}:{lastEventId}`, where `lastEventId` changes with any payment, attempt, status change, plan price change or completed month of tenure. Concurrent requests share one model call (in-process single-flight plus a Redis `SET NX` lock).
- The prompt is versioned in `src/llm/prompts/` (`customer-summary.v2.md`, returned as `promptVersion`).

## Metrics

`GET /metrics/overview?from=YYYY-MM-DD&to=YYYY-MM-DD` (or ISO datetimes; both or neither; at most 366 days). Without parameters the period is the current UTC calendar month.

Only two figures respect `from` and `to`; everything else is the state at the moment of the request:

| Field | Scope |
| --- | --- |
| `monthlyRecurringRevenueCents` | Current state |
| `activeSubscriptions`, `pastDueSubscriptions` | Current state |
| `subscriptionsByStatus` | Current state |
| `revenueByMonth` | Period: paid charges by `paid_at` |
| payment-failure cancellations inside `delinquencyRate` | Period: by `canceled_at` |

The four queries run in one `RepeatableRead` transaction, so the figures come from the same snapshot of the database.

- **MRR** (`monthlyRecurringRevenueCents`): the sum over plans of `amountCents` × active subscriptions for monthly plans, plus the yearly total ÷ 12, rounded once. It uses each plan's current `amountCents`, not the amount each subscription was billed at.
- **Delinquency rate** (`delinquencyRate`), a fraction between 0 and 1:

  ```
  delinquencyRate = (pastDue + canceledForPaymentFailure) / (active + pastDue + canceledForPaymentFailure)
  ```

  `pastDue` and `active` are current counts; `canceledForPaymentFailure` counts subscriptions with `status = canceled`, `cancel_reason = payment_failed` and `canceled_at` inside the period. The rate mixes the two scopes on purpose and is `null` when the denominator is 0.
- **`revenueByMonth`**: the sum of `amount_cents` of `paid` charges by `paid_at` month (UTC), inside the period. It is effective revenue: a charge paid after its subscription was canceled is left out, because that money is refund-due (see [Webhooks](#webhooks)). A `requires_refund` webhook never marks a charge `paid`, so it is not counted either.

The formula is implemented in `src/modules/metrics/domain/delinquency-rate.ts`. The same wording is in the field descriptions of `openapi.json`.

## Correlation id

Every HTTP response carries an `x-correlation-id` header. A client may send its own (8 to 128 characters from `A-Z a-z 0-9 . _ -`) and it is reused; a missing or malformed value is replaced with a generated `cor_<ulid>`. The id lives in an `AsyncLocalStorage` context (`src/shared/correlation/`) and Pino writes it as `correlationId` on every line of the request, including `request completed`.

Charges record the id they were created under in `charges.correlation_id`. A dunning reissue inherits the id of the charge it replaces; a renewal starts a new one. Retry job data carries the id, and the worker processes the job within it. The id is never part of the job id, so jobs deduplicate regardless of the id.

Payment milestones are logged as structured events with a fixed `event` field (`src/modules/charges/payment-events.ts`): `charge.created`, `charge.attempt.failed`, `charge.retry.scheduled`, `charge.paid`, `charge.expired`, `charge.refund_required`, `charge.dunning_exhausted`, `subscription.status_changed`, `webhook.received` and `webhook.duplicate_ignored`. They are written once, after the change they describe is committed.

## Tracing

OpenTelemetry is off by default and costs nothing while off. When on (`OTEL_ENABLED=true`), the SDK exports spans over OTLP/HTTP and instruments HTTP, Express, `pg` and `ioredis` (the last two only inside traced operations). BullMQ jobs are traced by hand: publishing a job opens a producer span and stores its W3C context in the job; the worker opens a consumer span. A dunning retry, published with a delay of days, runs in its own trace linked to the publish span, so a request trace does not stay open for a week. Log lines carry `trace_id` and `span_id` while a span is active.

Jaeger runs behind the `observability` compose profile:

```bash
OTEL_ENABLED=true docker compose --profile observability up --build
open http://localhost:16686
docker compose --profile observability down
```

With the API on the host, start only the dependencies with `docker compose --profile observability up -d postgres redis jaeger` and run `OTEL_ENABLED=true pnpm start:dev`.

## Webhooks

`POST /webhooks/gateway` answers `200 { "received": true }` once the event is processed. It is internal to the gateway integration and tagged `webhooks` in Swagger.

- Header: `x-gateway-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>." + raw body>`, keyed with `GATEWAY_WEBHOOK_SECRET`.
- Missing or invalid signature, or a timestamp outside the 5-minute window: `401`. A valid signature over a body that is not a gateway event: `400`.
- The charge is resolved by `data.charge.externalRef`. Each event is recorded in `webhook_events` with an `outcome`:

| Event | Charge state | Outcome |
| --- | --- | --- |
| any | unknown charge | `ignored_unknown_charge` |
| any | amount or customer differs from ours | `rejected_mismatch`, logged at ERROR |
| `charge.paid` | `pending` | `applied`: charge `paid`, subscription to `active` |
| `charge.paid` | `pending` on a canceled subscription | `applied`, logged at ERROR: a refund is due |
| `charge.paid` | already `paid` with the same gateway charge | `ignored_duplicate_state` |
| `charge.paid` | `expired`, `failed`, `uncollectible`, or a different gateway charge | `requires_refund`, logged at ERROR |
| `charge.failed` | `pending` | `applied`: charge `failed`, subscription `past_due` |
| `charge.expired` | `pending` | `applied`: charge `expired`; a first charge cancels the subscription, a renewal makes it `past_due` |
| any other | any other state | `rejected_out_of_order`, logged at WARN |

Refunds are not implemented; a `requires_refund` outcome is a log signal, not an action.

## Testing

| Layer | Files | Command | Needs |
| --- | --- | --- | --- |
| Unit | `src/**/*.spec.ts` | `pnpm test` | nothing |
| Coverage | same | `pnpm test:cov` | fails below 80% lines, branches, functions and statements globally, and below 90% in `src/modules/**/domain/**` |
| Integration | `test/integration/*.integration-spec.ts` | `pnpm test:integration` | Docker: PostgreSQL 17 and Redis 7.4 via Testcontainers, migrations applied |
| End-to-end | `test/e2e/*.e2e-spec.ts` | `pnpm test:e2e` | Docker: the full app through Supertest, same containers |

Testcontainers starts its own databases; no compose stack is needed. Domain rules are tested as pure functions in the unit layer; the integration layer checks repositories, Redis scripts and the partial index; the e2e layer covers the journeys (subscription, dunning recovery, reconciliation, webhooks, idempotency, summary, metrics).

CI (`.github/workflows/ci.yml`) runs on push and pull request. The `quality` job runs lint, format check, typecheck, unit tests with coverage, integration, e2e, build, and a check that `openapi.json` is up to date. On push to `main` a second job publishes the coverage badge JSON to the `badges` branch, which the badge above reads. The badge shows line coverage of the unit tests only (`pnpm test:cov`); integration and e2e runs are not measured.

## Following a payment in the logs

[`docs/observability.md`](docs/observability.md) walks through one payment from the first request to the webhook that confirms it, with the filter commands and the trace view.

## Live dashboard

[Cadência Billing](https://cadencia-billing.gusantos1704.workers.dev) is the React dashboard built on this API ([source](https://github.com/gusants/subscription-billing-dashboard)). The live demo runs the same OpenAPI contract in the browser with Mock Service Worker, so it needs no backend; locally it can also point at this API (`VITE_API_MODE=api`).

The customer page reads straight from this API's resources: the subscription status, the charges with every attempt and its decline reason, the next dunning retry, and the AI summary from `GET /customers/{id}/summary`.

![Dashboard customer page: declined card attempts, the retry schedule and the AI summary](https://raw.githubusercontent.com/gusants/subscription-billing-dashboard/main/docs/media/customer-detail.png)

| Overview (metrics) | Simulator (fake gateway) |
| --- | --- |
| ![Dashboard overview with MRR, delinquency and revenue by month](https://raw.githubusercontent.com/gusants/subscription-billing-dashboard/main/docs/media/overview.png) | ![Dashboard simulator panel that drives the fake gateway](https://raw.githubusercontent.com/gusants/subscription-billing-dashboard/main/docs/media/simulator.png) |

## Demo

![Demo: a declined card goes past_due, the retry recovers it, then the AI summary and the metrics overview](docs/demo.gif)

`scripts/demo.sh` against the compose stack with the demo seed. The GIF is recorded with [VHS](https://github.com/charmbracelet/vhs) from [`docs/demo.tape`](docs/demo.tape); to re-record it, start the stack, run the seed and then `vhs docs/demo.tape`.

Scheduled dunning retries in Bull Board (`/queues`), one delayed job per failed charge with a deterministic `retry:{chargeId}:{attempt}` id and the correlation id carried in the job data:

![Bull Board showing delayed charge-retry jobs](docs/images/bull-board-retries.png)

## Production changes

- **Payment gateway.** Replace the fake adapter with a real `PaymentGateway` implementation. The fake gateway's JSON store is single-process, so the workers must then be able to run in a separate process. Refunds are not implemented.
- **Authentication and authorization.** No route is authenticated, including `/docs`, `/queues` (Bull Board, which shows and can act on jobs), `/dev/*`, `/fake-gateway/*`, customer data and the summary endpoint that triggers LLM calls. Put the API behind an authenticating gateway and keep the dev and fake gateway routes off.
- **Rate limits.** No HTTP rate limit. The LLM bucket is per process, so N instances make up to N times `LLM_MAX_CALLS_PER_MINUTE` calls.
- **Secrets.** `GATEWAY_WEBHOOK_SECRET`, `GEMINI_API_KEY` and database credentials come from `.env` in this repository. Use a secret manager. The values in `.env.example` are development values.
- **Demo flags in production.** `RETRY_INTERVAL_UNIT=minutes` (with `ALLOW_ACCELERATED_RETRIES=true`), `BULL_BOARD_ENABLED`, `DEV_ROUTES_ENABLED` and `FAKE_GATEWAY_ROUTES_ENABLED` are on in the compose file for the demo (`RETRY_INTERVAL_UNIT=minutes` only when you ask for it). Production must not use them.
- **Data retention and privacy.** Customer names and e-mails, webhook events, payment attempts and failed jobs are kept indefinitely; there is no deletion or export endpoint, which LGPD requests will need. Logs are written to stdout; there is no shipping or retention configuration.
- **Queues and Redis.** One Redis instance holds the queues, idempotency keys and summary cache, with `noeviction` and AOF in compose. A managed Redis with persistence and failover is needed. Completed jobs are kept for 1000 entries or 24 hours; failed jobs are kept until someone removes them.
- **Time zones and multi-region.** The project has no time zone setting: metrics months and summary timelines are UTC. Multi-region deployment is not designed; the renewal and reconciliation sweeps assume one shared Redis and database.
- **Schema.** The partial unique index is outside Prisma's schema (see [Technical decisions](#technical-decisions)).

## Known limitations

- Only the fake gateway exists; it stores data in a local file and delivers webhooks with a timer.
- Cancellation is immediate; there is no cancel-at-period-end.
- The coverage badge and the thresholds cover unit tests only; the integration and e2e suites are not instrumented.
- `charges.next_retry_at` is declared in the schema but never written or read by the application (the retry schedule is derived from `first_failed_at` and `retry_count`), so it is always empty.
- Metrics are computed on request from the tables; there is no pre-aggregation.
- `monthlyRecurringRevenueCents`, `activeSubscriptions`, `pastDueSubscriptions` and `subscriptionsByStatus` are current counts, while the cancellations in the delinquency rate and `revenueByMonth` are bounded by the requested period. There is no point-in-time history: asking for a past period does not reconstruct the past MRR.
