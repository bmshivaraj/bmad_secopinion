CREATE TYPE "payout_attempt_status" AS ENUM ('Pending', 'Failed', 'Uncertain', 'Succeeded');

ALTER TABLE "cases"
ADD COLUMN "platform_fee_percent_at_closure" DECIMAL(5, 2);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "cases"
        JOIN "case_opinions" ON "case_opinions"."case_id" = "cases"."id"
        WHERE "cases"."status" = 'Closed'
    ) AND NOT EXISTS (SELECT 1 FROM "platform_settings") THEN
        RAISE EXCEPTION 'PlatformSettings is required to backfill existing closed Opinions';
    END IF;
END $$;

UPDATE "cases"
SET "platform_fee_percent_at_closure" = (
        SELECT "platform_fee_percent"
        FROM "platform_settings"
        ORDER BY "updated_at" DESC
        LIMIT 1
)
WHERE "status" = 'Closed'
    AND "platform_fee_percent_at_closure" IS NULL
    AND EXISTS (
            SELECT 1 FROM "case_opinions" WHERE "case_opinions"."case_id" = "cases"."id"
    );

CREATE TABLE "payout_attempts" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "charged_amount" DECIMAL(10, 2) NOT NULL,
    "platform_fee_percent" DECIMAL(5, 2) NOT NULL,
    "payout_amount" DECIMAL(10, 2) NOT NULL,
    "upi_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "transaction_id" TEXT,
    "status" "payout_attempt_status" NOT NULL DEFAULT 'Pending',
    "provider_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payout_attempts_case_id_key" ON "payout_attempts"("case_id");
CREATE UNIQUE INDEX "payout_attempts_idempotency_key_key" ON "payout_attempts"("idempotency_key");
CREATE INDEX "payout_attempts_doctor_id_created_at_idx" ON "payout_attempts"("doctor_id", "created_at");
CREATE INDEX "payout_attempts_status_created_at_idx" ON "payout_attempts"("status", "created_at");

CREATE TABLE "payout_batch_checkpoints" (
    "id" TEXT NOT NULL,
    "opinion_created_at" TIMESTAMP(3),
    "case_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_batch_checkpoints_pkey" PRIMARY KEY ("id")
);