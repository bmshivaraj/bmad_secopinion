-- CreateTable
CREATE TABLE "case_document_requests" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "requested_by_doctor_id" TEXT NOT NULL,
    "note" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilled_at" TIMESTAMP(3),

    CONSTRAINT "case_document_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "case_document_requests_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "case_document_requests_case_id_created_at_idx" ON "case_document_requests"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "case_document_requests_case_id_fulfilled_at_idx" ON "case_document_requests"("case_id", "fulfilled_at");

-- Enforce at most one unfulfilled request per Case while allowing later request cycles.
CREATE UNIQUE INDEX "case_document_requests_one_active_per_case_key" ON "case_document_requests"("case_id") WHERE "fulfilled_at" IS NULL;
