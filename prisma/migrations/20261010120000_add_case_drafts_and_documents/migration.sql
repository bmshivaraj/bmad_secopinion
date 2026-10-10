-- CreateEnum
CREATE TYPE "case_status" AS ENUM ('Draft');

-- CreateTable
CREATE TABLE "cases" (
    "id" TEXT NOT NULL,
    "creation_request_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "affected_body_area" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "additional_details" TEXT NOT NULL DEFAULT '',
    "status" "case_status" NOT NULL DEFAULT 'Draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_documents" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cases_patient_id_status_updated_at_idx" ON "cases"("patient_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "cases_creation_request_id_key" ON "cases"("creation_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_documents_storage_key_key" ON "case_documents"("storage_key");

-- CreateIndex
CREATE INDEX "case_documents_case_id_created_at_idx" ON "case_documents"("case_id", "created_at");

-- AddForeignKey
ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;