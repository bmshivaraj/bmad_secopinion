import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface StorageProvider {
  save(bytes: Uint8Array): Promise<{ storageKey: string }>;
  read(storageKey: string): Promise<Uint8Array | null>;
  delete(storageKey: string): Promise<void>;
}

const STORAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class LocalDiskStorageProvider implements StorageProvider {
  private readonly rootDirectory: string;

  constructor(rootDirectory = resolve(process.cwd(), ".data", "doctor-credentials")) {
    this.rootDirectory = rootDirectory;
  }

  async save(bytes: Uint8Array): Promise<{ storageKey: string }> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const storageKey = randomUUID();
    const filePath = join(this.rootDirectory, storageKey);
    try {
      await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
    return { storageKey };
  }

  async read(storageKey: string): Promise<Uint8Array | null> {
    const filePath = this.getFilePath(storageKey);
    try {
      return await readFile(filePath);
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  async delete(storageKey: string): Promise<void> {
    const filePath = this.getFilePath(storageKey);
    try {
      await unlink(filePath);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }

  private getFilePath(storageKey: string): string {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new Error("Invalid storage key");
    }
    return join(this.rootDirectory, storageKey);
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export const storageProvider: StorageProvider = new LocalDiskStorageProvider();