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
