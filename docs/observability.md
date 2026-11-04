# Observability: following a payment

How to follow one payment from the first request to the gateway webhook that confirms it, using logs and traces. The setup details (headers, variables, compose profile) are in the README sections [Correlation id](../README.md#correlation-id) and [Tracing](../README.md#tracing); this document covers what the signals look like and how to read them.

## Correlation id

- **Birth:** the `x-correlation-id` request header is reused when it has 8 to 128 characters from `A-Z a-z 0-9 . _ -`; otherwise a `cor_<ulid>` is generated.
- **In memory:** an `AsyncLocalStorage` context (`src/shared/correlation/`). Pino stamps `correlationId` on every line written within it.
- **In the database:** `charges.correlation_id`, written when the charge is created. A dunning reissue inherits the id of the charge it replaces; a renewal starts a new one.
- **In jobs:** the retry job data carries `correlationId` (`src/modules/billing-queue/job-context.ts`). The worker runs the job within that id.
- **In webhooks:** a gateway webhook logs the id of its charge as `correlationId`, and its own HTTP request id as `requestCorrelationId`.

## Event vocabulary

Payment events are emitted through `logPaymentEvent` (`src/modules/charges/payment-events.ts`). Each line has `event`, the fields below, `correlationId`, and `trace_id`/`span_id` when a span is active.

| Event                         | Level | Logged when                                                                                                                              | Fields                                                                                                                                       |
| ----------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `charge.created`              | log   | a charge row is created: first period (`origin` `first_period`), renewal, or dunning reissue (`reissue`)                                 | `chargeId`, `subscriptionId`, `origin`, `amountCents`, `method`, `retryCount`                                                                |
| `charge.attempt.failed`       | log   | a settlement is the one that moves a charge to `failed`                                                                                  | `chargeId`, `subscriptionId`, `source`, `gatewayChargeId`, `failureReason`, `attemptCount`, `retryCount`                                     |
| `charge.retry.scheduled`      | log   | a retry job changes: enqueued, a failed one re-run, or a delayed one moved to now; not when the job already exists as asked              | `chargeId`, `subscriptionId`, `attempt`, `delayMs`, `runAt`                                                                                  |
| `charge.paid`                 | log   | a settlement is the one that moves a charge to `paid`                                                                                    | `chargeId`, `subscriptionId`, `source`, `gatewayChargeId`, `amountCents`, `attemptCount`, `retryCount`                                       |
| `charge.expired`              | log   | a settlement is the one that moves a pix or boleto charge to `expired`                                                                   | `chargeId`, `subscriptionId`, `source`, `gatewayChargeId`, `retryCount`                                                                      |
| `charge.refund_required`      | error | money was captured for a charge that cannot keep it (paid on a canceled subscription, captured twice, webhook outcome `requires_refund`) | `chargeId`, `subscriptionId`, `gatewayChargeId`, `reason`                                                                                    |
| `charge.dunning_exhausted`    | warn  | the dunning retries are used up and the subscription is canceled                                                                         | `chargeId`, `subscriptionId`, `retryCount`                                                                                                   |
| `subscription.status_changed` | log   | a subscription changes status                                                                                                            | `subscriptionId`, `from`, `to`, `cause` (`cancel_requested`, `charge.<status>` or `charge.dunning_exhausted`), `chargeId` (absent on cancel) |
| `webhook.received`            | log   | each gateway webhook is processed, before its outcome is applied                                                                         | `gatewayEventId`, `eventType`, `chargeId`, `gatewayChargeId`, `requestCorrelationId`                                                         |
| `webhook.duplicate_ignored`   | log   | the same gateway event id arrives again                                                                                                  | `gatewayEventId`, `eventType`, `chargeId`                                                                                                    |

Source of the settlement (`source`): `charge_flow` (the API or a retry worker settling the charge) or `webhook`.

A webhook whose event id is new but whose effect is already applied (for example `charge.failed` after the charge flow recorded the failure) emits no event of its own. It is logged by the webhook processor as a plain message ending in `ignored_duplicate_state`, and stored with that `outcome` in `webhook_events`.

## Redacted fields

Pino `redact` (`src/shared/logging/redact-paths.ts`) replaces the value with `[Redacted]`:

- headers, on requests and responses: `authorization`, `cookie`, `x-gateway-signature`, `idempotency-key`;
- fields `cardToken`, `token` and `email`, at the top level of a log object or up to two levels below it (`*.email`, `*.*.email`).

Query strings can carry personal data (`GET /customers?search=` matches e-mails), so their values are never written. The request serializer (`src/shared/logging/request-serializer.ts`) logs `req.url` as `/customers?[Redacted]` and drops `req.query`; with tracing on, the http server span records `url.query` as `[Redacted]` (`startIncomingSpanHook` in `src/shared/tracing/traced-instrumentations.ts`). The path and the route stay readable.

The `Idempotency-Key` value never appears outside the header redaction either: the idempotency interceptor names a key in its log lines as `<METHOD> <path> (Idempotency-Key sha256 <first 12 hex chars>)` (`describeIdempotencyKey` in `src/shared/idempotency/idempotency-key.ts`), and logs the message and stack of a Redis failure, never the error object (ioredis attaches the command arguments to it). With tracing on, ioredis spans record `db.query.text` as the command name only (`evalsha`, `hgetall`), since the idempotency scripts carry the key and the stored response body in their arguments. To find the lines of a known key, compute the same digest: `printf %s "$KEY" | shasum -a 256 | cut -c1-12`.

The e2e journey test asserts that neither the card token nor the customer e-mail appears in the captured logs, including after a customer search by e-mail.

## Walkthrough: `tok_fail_then_success`

The card token `tok_fail_then_success` declines the first attempt of a charge and approves the next one. The run below was executed against the compose stack (`OTEL_ENABLED=true`, observability profile) with the fixed id `walkthrough-tok-fail-0001`. Identifiers and timestamps are from that run.

### Reproduce the run

See [Reproduce](#reproduce). The API calls, in order:

1. `POST /customers`, `POST /plans`.
2. `POST /subscriptions` with `x-correlation-id: walkthrough-tok-fail-0001` and `cardToken` `tok_fail_then_success`. The response is `201` with `status: past_due` and a failed `latestCharge` (`insufficient_funds`). The retry is due 1 minute later (`RETRY_INTERVAL_UNIT=minutes` in compose).
3. `POST /dev/retries/run-now` promotes the retry (`{"promoted":1}`). The worker settles it right away.
4. The gateway delivers `charge.failed` (about 500 ms after step 2) and `charge.paid` (about 500 ms after the worker settles the retry).

### Filter the logs by correlation id

```bash
CID=walkthrough-tok-fail-0001
docker compose logs --no-color --no-log-prefix api \
  | jq -R -c --arg cid "$CID" 'fromjson? | select(.correlationId == $cid and .event != null) | {time: (.time/1000 | todate), event, trace_id, msg}'
```

Output, unchanged:

```json
{"time":"2026-11-04T14:58:13Z","event":"charge.created","trace_id":"dcfde1fc02fdad67a7aa84f34d0db351","msg":"Charge ch_01m6kh2n92ef85z3v9ztpm7npv created for subscription sub_01m6kh2n917bj03ys2arb16zdd (first_period)"}
{"time":"2026-11-04T14:58:13Z","event":"charge.attempt.failed","trace_id":"dcfde1fc02fdad67a7aa84f34d0db351","msg":"Charge ch_01m6kh2n92ef85z3v9ztpm7npv attempt failed: insufficient_funds"}
{"time":"2026-11-04T14:58:13Z","event":"subscription.status_changed","trace_id":"dcfde1fc02fdad67a7aa84f34d0db351","msg":"Subscription sub_01m6kh2n917bj03ys2arb16zdd moved from incomplete to past_due after charge ch_01m6kh2n92ef85z3v9ztpm7npv failed"}
{"time":"2026-11-04T14:58:13Z","event":"charge.retry.scheduled","trace_id":"dcfde1fc02fdad67a7aa84f34d0db351","msg":"Retry 1 of charge ch_01m6kh2n92ef85z3v9ztpm7npv scheduled for 2026-11-04T14:59:13.426Z"}
{"time":"2026-11-04T14:58:13Z","event":"webhook.received","trace_id":"285aa572c88f2351dab2e474c381d1a3","msg":"Webhook event evt_01m6kh2n9c7cmzv44w6j50382c (charge.failed) received for charge ch_01m6kh2n92ef85z3v9ztpm7npv"}
{"time":"2026-11-04T14:58:16Z","event":"charge.paid","trace_id":"dcfde1fc02fdad67a7aa84f34d0db351","msg":"Charge ch_01m6kh2n92ef85z3v9ztpm7npv paid"}
{"time":"2026-11-04T14:58:16Z","event":"subscription.status_changed","trace_id":"dcfde1fc02fdad67a7aa84f34d0db351","msg":"Subscription sub_01m6kh2n917bj03ys2arb16zdd moved from past_due to active after charge ch_01m6kh2n92ef85z3v9ztpm7npv paid"}
{"time":"2026-11-04T14:58:17Z","event":"webhook.received","trace_id":"8428fb1a391e9aa50e37c5665cb504d7","msg":"Webhook event evt_01m6kh2raqmwyb332zefxp1s7g (charge.paid) received for charge ch_01m6kh2n92ef85z3v9ztpm7npv"}
```

Reading the journey:

- The charge flow records the decline, the subscription moves to `past_due` and the retry is enqueued, all in the `POST /subscriptions` trace.
- `charge.failed` from the gateway arrives after that and is logged as `webhook.received` in its own trace (`285aa572…`). Its outcome is `ignored_duplicate_state`, so no second `charge.attempt.failed` appears.
- The retry worker settles the charge in the subscription trace (`dcfde1fc…`), with `source` `charge_flow`, `retryCount` 1 and `attemptCount` 2. The subscription returns to `active`.
- `charge.paid` from the gateway arrives in its own trace (`8428fb1a…`) and is also `ignored_duplicate_state`.

The request logs (`request completed`) and the `Promoted 1 delayed charge retries` line carry the same `correlationId` but are not payment events; they are included by the same filter when the `event` condition is dropped.

## Trace in Jaeger

Service name: `subscription-payments-api` (`OTEL_SERVICE_NAME`). Query the Jaeger v2 API for the run window:

```bash
curl -s "http://localhost:16686/api/v3/traces?query.service_name=subscription-payments-api&query.start_time_min=2026-11-04T14:50:00Z&query.start_time_max=2026-11-04T16:00:00Z" \
  | jq -r '.result.resourceSpans[].scopeSpans[].spans[] | select(.traceId == "dcfde1fc02fdad67a7aa84f34d0db351") | .name' | sort | uniq -c
```

Fetch one trace by id with `GET http://localhost:16686/api/v3/traces/<trace_id>`. The UI is at `http://localhost:16686/trace/<trace_id>`.

Trace `dcfde1fc02fdad67a7aa84f34d0db351` (the `trace_id` of `charge.created`, `charge.paid` and the subscription events above), 40 spans, root `POST /subscriptions`. Express middleware layers are omitted:

```text
POST /subscriptions                          http server    49 ms
└─ request handler - /subscriptions          express         48 ms
   ├─ pg.query  (5 SELECT, 4 UPDATE, 3 INSERT, 2 BEGIN, 2 COMMIT)
   └─ publish charge-retries                 producer         4 ms
      ├─ zscore, evalsha, hgetall            ioredis client
      └─ process charge-retries              consumer        24 ms   app.correlation_id=walkthrough-tok-fail-0001
         └─ pg.query  (8 SELECT, 3 UPDATE, 1 INSERT, 1 BEGIN, 1 COMMIT)
```

- The worker's `process charge-retries` span is a child of the `publish charge-retries` span from the request that scheduled the retry, so it is in the same trace, even though it ran about 3 s later.
- The two gateway webhooks are separate roots (`POST /webhooks/gateway`, traces `285aa572…` and `8428fb1a…`), not children of the request that created the charge. Join them to the payment through `correlationId` and `chargeId` in the logs.
- The `run-now` request is another root (`9a75887a…`).

TODO: add Jaeger screenshot. Start the stack (see [Reproduce](#reproduce)), open `http://localhost:16686`, select service `subscription-payments-api`, open the `POST /subscriptions` trace of the run, save it as `docs/images/jaeger-trace.png`, and embed it here as `![Jaeger trace](images/jaeger-trace.png)`.

## Reproduce

Requires Docker and a `.env` (`cp .env.example .env`).

```bash
OTEL_ENABLED=true docker compose --profile observability up --build --wait

B=http://localhost:3000
CID=walkthrough-tok-fail-0001
CUS=$(curl -s -X POST $B/customers -H 'content-type: application/json' -d '{"name":"Ana","email":"ana.walkthrough@example.com"}' | jq -r .id)
PLAN=$(curl -s -X POST $B/plans -H 'content-type: application/json' -d '{"name":"Basic","amountCents":1990,"interval":"monthly"}' | jq -r .id)
curl -s -X POST $B/subscriptions -H 'content-type: application/json' -H "x-correlation-id: $CID" \
  -d "{\"customerId\":\"$CUS\",\"planId\":\"$PLAN\",\"paymentMethod\":\"card\",\"cardToken\":\"tok_fail_then_success\"}"
curl -s -X POST $B/dev/retries/run-now -H "x-correlation-id: $CID"
sleep 5

docker compose --profile observability down -v
```

The ids change on every run; use the ones printed by your run. `down -v` also drops the fake gateway data volume.

## Debugging an incident

Start from whatever you have.

**From a correlation id** (a client sent `x-correlation-id`, or a response carried one):

```bash
docker compose logs --no-color --no-log-prefix api \
  | jq -R -c --arg cid "$CID" 'fromjson? | select(.correlationId == $cid)'
```

**From a charge id:** find the correlation id stored on the charge, then filter by it. Lines with no `chargeId` (for example `Promoted N delayed charge retries`) only match by correlation id.

```bash
docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tA -c \"SELECT correlation_id FROM charges WHERE id = 'ch_...';\""
```

**From a log line with `trace_id`:** open `http://localhost:16686/trace/<trace_id>`, or `GET /api/v3/traces/<trace_id>`. A `process charge-retries` span shows the job's `app.correlation_id`.

**Webhook outcomes:** `webhook_events.outcome` records what each gateway event did, including `ignored_duplicate_state`, `requires_refund` and `rejected_mismatch` (see [Webhooks](../README.md#webhooks)).

## Known limitations

- Traces exist only with `OTEL_ENABLED=true`; logs carry `correlationId` regardless.
- Retry jobs are traced by hand; BullMQ polling and recurring sweeps are not traced as part of a payment, and each sweep starts its own trace.
- `docker compose logs` shows only what the container still holds. Use the log store of your environment for older runs.
