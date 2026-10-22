-- AlterTable
ALTER TABLE "case_document_requests" ADD COLUMN "closed_at" TIMESTAMP(3);

-- Index now excludes requests closed by a final Opinion as well as upload-fulfilled requests.
DROP INDEX "case_document_requests_one_active_per_case_key";
CREATE UNIQUE INDEX "case_document_requests_one_active_per_case_key"
ON "case_document_requests"("case_id")
WHERE "fulfilled_at" IS NULL AND "closed_at" IS NULL;

-- CreateTable
CREATE TABLE "case_opinions" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "text" VARCHAR(10000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_opinions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "case_opinions_case_id_key" UNIQUE ("case_id"),
    CONSTRAINT "case_opinions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Index the stable payout cursor order.
CREATE INDEX "case_opinions_created_at_case_id_idx" ON "case_opinions"("created_at", "case_id");