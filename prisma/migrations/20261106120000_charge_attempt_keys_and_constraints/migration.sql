-- CreateEnum
CREATE TYPE "charge_failure_reason" AS ENUM ('insufficient_funds', 'expired_card', 'invalid_token');

-- AlterTable
ALTER TABLE "charges" ADD COLUMN "gateway_attempt_key" TEXT,
ADD COLUMN "attempt_started_at" TIMESTAMPTZ(3);

UPDATE "charges"
SET "gateway_attempt_key" = "id" || ':' || ("attempt_count" + 1),
    "attempt_started_at" = "updated_at"
WHERE "status" = 'pending';

-- AlterTable
ALTER TABLE "payment_attempts"
ALTER COLUMN "failure_reason" TYPE "charge_failure_reason"
USING ("failure_reason"::"charge_failure_reason");

-- DropIndex
DROP INDEX "charges_subscription_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "charges_gateway_attempt_key_key" ON "charges"("gateway_attempt_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_gateway_charge_id_key" ON "payment_attempts"("gateway_charge_id");
