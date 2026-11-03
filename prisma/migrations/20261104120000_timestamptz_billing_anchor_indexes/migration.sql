-- AlterTable
ALTER TABLE "plans"
    ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
    ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "customers"
    ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
    ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "subscriptions"
    ALTER COLUMN "current_period_start" SET DATA TYPE TIMESTAMPTZ(3) USING "current_period_start" AT TIME ZONE 'UTC',
    ALTER COLUMN "current_period_end" SET DATA TYPE TIMESTAMPTZ(3) USING "current_period_end" AT TIME ZONE 'UTC',
    ALTER COLUMN "canceled_at" SET DATA TYPE TIMESTAMPTZ(3) USING "canceled_at" AT TIME ZONE 'UTC',
    ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
    ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "billing_anchor" TIMESTAMPTZ(3);

UPDATE "subscriptions" SET "billing_anchor" = "current_period_start";

ALTER TABLE "subscriptions" ALTER COLUMN "billing_anchor" SET NOT NULL;

-- AddCheckConstraint
ALTER TABLE "plans" ADD CONSTRAINT "plans_amount_cents_positive" CHECK ("amount_cents" > 0);

-- CreateIndex
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions"("plan_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_current_period_end_idx" ON "subscriptions"("status", "current_period_end");
