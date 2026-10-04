-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "mobile_number" TEXT NOT NULL,
    "password_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patients_mobile_number_key" ON "patients"("mobile_number");
