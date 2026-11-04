-- CreateEnum
CREATE TYPE "webhook_event_outcome" AS ENUM ('applied', 'ignored_duplicate_state', 'ignored_unknown_charge', 'rejected_out_of_order');

-- AlterTable
ALTER TABLE "charges" ADD COLUMN "expires_at" TIMESTAMPTZ(3),
ADD COLUMN "payment_instructions" JSONB;

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "gateway_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "gateway_charge_id" TEXT,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "outcome" "webhook_event_outcome",

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "webhook_events_outcome_requires_processed_at" CHECK (("outcome" IS NULL) = ("processed_at" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_gateway_event_id_key" ON "webhook_events"("gateway_event_id");

-- CreateIndex
CREATE INDEX "webhook_events_gateway_charge_id_idx" ON "webhook_events"("gateway_charge_id");
