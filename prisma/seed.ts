import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return url;
}

const adapter = new PrismaPg({ connectionString: getDatabaseUrl() });
const prisma = new PrismaClient({ adapter });

// AD-15: 15 default Specialty rows, seeded from the Architecture Spine.
const DEFAULT_SPECIALTIES = [
  "Orthopedics",
  "Cardiology",
  "Oncology",
  "Neurology",
  "Neurosurgery",
  "Gastroenterology",
  "Nephrology",
  "Urology",
  "Pulmonology",
  "Gynecology & Obstetrics",
  "ENT (Otolaryngology)",
  "Ophthalmology",
  "General Surgery",
  "Endocrinology",
  "Dermatology",
];

// Fixed id so the seed is idempotent for the PlatformSettings singleton (AD-16).
const PLATFORM_SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  for (const name of DEFAULT_SPECIALTIES) {
    await prisma.specialty.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  await prisma.platformSettings.upsert({
    where: { id: PLATFORM_SETTINGS_ID },
    update: {},
    create: {
      id: PLATFORM_SETTINGS_ID,
      standardCaseFee: 1000,
      urgentCaseFee: 2000,
      platformFeePercent: 20,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
