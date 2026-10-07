import "dotenv/config";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "../src/generated/prisma/client.js";

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return url;
}

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
const ADMIN_ACCOUNT_ID = "00000000-0000-0000-0000-000000000002";
const MIN_ADMIN_PASSWORD_LENGTH = 8;
const MAX_ADMIN_PASSWORD_LENGTH = 1024;

interface AdminSeedEnvironment {
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
}

export function getAdminSeedCredentials(
  environment: AdminSeedEnvironment = process.env as AdminSeedEnvironment,
): { username: string; password: string } {
  const username = environment.ADMIN_USERNAME?.trim().toLowerCase();
  const password = environment.ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD environment variables are required to seed the Admin account.");
  }
  if (
    password.length < MIN_ADMIN_PASSWORD_LENGTH
    || password.length > MAX_ADMIN_PASSWORD_LENGTH
    || !/[A-Z]/.test(password)
    || !/[a-z]/.test(password)
    || !/[0-9]/.test(password)
  ) {
    throw new Error("ADMIN_PASSWORD must be 8-1024 characters and include uppercase, lowercase, and numeric characters.");
  }
  return { username, password };
}

export async function buildAdminAccountUpsert(credentials: { username: string; password: string }) {
  const passwordHash = await argon2.hash(credentials.password, { type: argon2.argon2id });
  return {
    where: { id: ADMIN_ACCOUNT_ID },
    update: { username: credentials.username, passwordHash },
    create: { id: ADMIN_ACCOUNT_ID, username: credentials.username, passwordHash },
  };
}

async function main() {
  const adminCredentials = getAdminSeedCredentials();
  const adapter = new PrismaPg({ connectionString: getDatabaseUrl() });
  const prisma = new PrismaClient({ adapter });

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

  await prisma.adminAccount.upsert(await buildAdminAccountUpsert(adminCredentials));

  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
