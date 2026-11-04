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

## Charge attempts and retries

Every gateway attempt carries the idempotency key `<chargeId>:<attemptNumber>`, persisted before the gateway is called, so re-sending an attempt never charges twice.

`POST /charges/{id}/retry` answers:

- `200` with `charge.status` `paid` or `failed` once the gateway decided.
- `200` with `charge.status` `pending` when the gateway was unavailable, its outcome is unknown (timeout) or it has not decided yet. The charge keeps its attempt key; retry again later.
- `409` when the charge is paid, its subscription is canceled, or it is `pending` with an attempt still in flight, that is, started less than `CHARGE_ATTEMPT_LEASE_SECONDS` (default 30) ago.

Retrying a `pending` charge past that lease reconciles it: the gateway is asked for the charge of the attempt key and its outcome is recorded; when the gateway never received it, the same attempt key is re-sent.
