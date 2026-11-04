#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
POLL_TIMEOUT_SECONDS="${POLL_TIMEOUT_SECONDS:-30}"
POLL_INTERVAL_SECONDS=1

for tool in curl jq; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "error: '$tool' is required but not installed" >&2
    exit 1
  }
done

if [[ -t 1 ]]; then BOLD=$'\033[1m' RESET=$'\033[0m'; else BOLD='' RESET=''; fi

step() { printf '\n%s%s%s\n' "$BOLD" "$*" "$RESET"; }

request() {
  local method="$1" path="$2" body="${3:-}"
  local -a args=(-sS -X "$method" -H 'Content-Type: application/json' -w '\n%{http_code}')
  [[ "$method" == "POST" ]] && args+=(-H "Idempotency-Key: $(uuidgen 2>/dev/null || date +%s%N)")
  [[ -n "$body" ]] && args+=(-d "$body")
  local response
  response="$(curl "${args[@]}" "$BASE_URL$path")" || {
    echo "error: cannot reach $BASE_URL (is the API running?)" >&2
    exit 1
  }
  RESPONSE_STATUS="${response##*$'\n'}"
  RESPONSE_BODY="${response%$'\n'*}"
}

call() {
  request "$@"
  if [[ "$RESPONSE_STATUS" != 2* ]]; then
    echo "error: $1 $2 answered $RESPONSE_STATUS: $RESPONSE_BODY" >&2
    exit 1
  fi
}

run_id="$(date +%s)"

step "1. Create a customer and a plan"
call POST /customers "{\"name\":\"Demo Customer\",\"email\":\"demo-$run_id@example.com\"}"
customer_id="$(jq -r '.id' <<<"$RESPONSE_BODY")"
call POST /plans '{"name":"Demo Monthly","amountCents":4990,"interval":"monthly"}'
plan_id="$(jq -r '.id' <<<"$RESPONSE_BODY")"
echo "customer $customer_id | plan $plan_id (R\$ 49,90 / month)"

step "2. Subscribe with a card that declines the first attempt (tok_fail_then_success)"
call POST /subscriptions "{\"customerId\":\"$customer_id\",\"planId\":\"$plan_id\",\"paymentMethod\":\"card\",\"cardToken\":\"tok_fail_then_success\"}"
subscription_id="$(jq -r '.id' <<<"$RESPONSE_BODY")"
jq '{subscription: .id, status, charge: .latestCharge.status, failureReason: .latestCharge.failureReason}' <<<"$RESPONSE_BODY"

step "3. The subscription is past_due; the first retry is scheduled for D+1 (1 minute with RETRY_INTERVAL_UNIT=minutes)"
call GET "/subscriptions/$subscription_id"
jq '{subscription: .id, status}' <<<"$RESPONSE_BODY"
call GET "/customers/$customer_id/charges"
jq '.data[0] | {charge: .id, status, attemptCount, attempts: [.attempts[] | {result, failureReason}]}' <<<"$RESPONSE_BODY"

step "4. Fire the scheduled retry now (dev route)"
request POST /dev/retries/run-now
if [[ "$RESPONSE_STATUS" == "404" ]]; then
  echo "error: POST /dev/retries/run-now answered 404. Start the API with DEV_ROUTES_ENABLED=true" >&2
  exit 1
fi
[[ "$RESPONSE_STATUS" == 2* ]] || {
  echo "error: POST /dev/retries/run-now answered $RESPONSE_STATUS: $RESPONSE_BODY (is Redis up?)" >&2
  exit 1
}
jq . <<<"$RESPONSE_BODY"

step "5. Wait for the worker to settle the retry (timeout ${POLL_TIMEOUT_SECONDS}s)"
deadline=$((SECONDS + POLL_TIMEOUT_SECONDS))
status=""
while [[ "$status" != "active" ]]; do
  ((SECONDS < deadline)) || {
    echo "error: subscription still '$status' after ${POLL_TIMEOUT_SECONDS}s. Is the worker running (WORKERS_ENABLED=true)?" >&2
    exit 1
  }
  call GET "/subscriptions/$subscription_id"
  status="$(jq -r '.status' <<<"$RESPONSE_BODY")"
  echo "status: $status"
  [[ "$status" == "active" ]] || sleep "$POLL_INTERVAL_SECONDS"
done

step "6. Customer payment summary"
call GET "/customers/$customer_id/summary"
jq . <<<"$RESPONSE_BODY"

step "7. Metrics overview (current month)"
call GET /metrics/overview
jq '{monthlyRecurringRevenueCents, activeSubscriptions, pastDueSubscriptions, delinquencyRate, subscriptionsByStatus}' <<<"$RESPONSE_BODY"
