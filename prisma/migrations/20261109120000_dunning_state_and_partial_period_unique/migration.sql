ALTER TABLE "charges"
    ADD COLUMN "first_failed_at" TIMESTAMPTZ(3),
    ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "charges" SET "first_failed_at" = "updated_at"
WHERE "status" IN ('failed', 'expired', 'uncollectible');

DROP INDEX "charges_subscription_id_period_start_key";

CREATE UNIQUE INDEX "charges_subscription_id_period_start_key"
    ON "charges"("subscription_id", "period_start")
    WHERE "status" <> 'expired';
