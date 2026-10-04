CREATE TYPE "doctor_verification_status" AS ENUM ('Pending', 'Verified', 'Rejected');

CREATE TABLE "doctors" (
    "id" TEXT NOT NULL,
    "mobile_number" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "verification_status" "doctor_verification_status" NOT NULL DEFAULT 'Pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "doctor_specialties" (
    "doctor_id" TEXT NOT NULL,
    "specialty_id" TEXT NOT NULL,
    CONSTRAINT "doctor_specialties_pkey" PRIMARY KEY ("doctor_id", "specialty_id")
);

CREATE TABLE "doctor_credentials" (
    "id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "doctor_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "doctors_mobile_number_key" ON "doctors"("mobile_number");
CREATE UNIQUE INDEX "doctors_username_key" ON "doctors"("username");
CREATE UNIQUE INDEX "doctor_credentials_storage_key_key" ON "doctor_credentials"("storage_key");

ALTER TABLE "doctor_specialties"
ADD CONSTRAINT "doctor_specialties_doctor_id_fkey"
FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "doctor_specialties"
ADD CONSTRAINT "doctor_specialties_specialty_id_fkey"
FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "doctor_credentials"
ADD CONSTRAINT "doctor_credentials_doctor_id_fkey"
FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;