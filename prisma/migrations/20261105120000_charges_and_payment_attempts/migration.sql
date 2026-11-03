-- CreateEnum
CREATE TYPE "charge_status" AS ENUM ('pending', 'paid', 'failed', 'expired', 'uncollectible');

-- CreateEnum
CREATE TYPE "payment_attempt_result" AS ENUM ('succeeded', 'declined');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "card_token" TEXT;

-- CreateTable
CREATE TABLE "charges" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "method" "payment_method" NOT NULL,
    "status" "charge_status" NOT NULL DEFAULT 'pending',
    "gateway_charge_id" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMPTZ(3),
    "due_date" TIMESTAMPTZ(3) NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "charges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "charges_amount_cents_positive" CHECK ("amount_cents" > 0)
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" TEXT NOT NULL,
    "charge_id" TEXT NOT NULL,
    "gateway_charge_id" TEXT NOT NULL,
    "result" "payment_attempt_result" NOT NULL,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "charges_gateway_charge_id_key" ON "charges"("gateway_charge_id");

-- CreateIndex
CREATE INDEX "charges_subscription_id_idx" ON "charges"("subscription_id");

-- CreateIndex
CREATE INDEX "charges_status_next_retry_at_idx" ON "charges"("status", "next_retry_at");

-- CreateIndex
CREATE UNIQUE INDEX "charges_subscription_id_period_start_key" ON "charges"("subscription_id", "period_start");

-- CreateIndex
CREATE INDEX "payment_attempts_charge_id_idx" ON "payment_attempts"("charge_id");

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
