import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClient } from "./client";
import { migrateDatabase } from "./migrate";

const temporaryDirectories: string[] = [];

async function migrationDirectory(sql = "CREATE TABLE example (id text PRIMARY KEY);\n"): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ninja-manager-migrations-"));
  temporaryDirectories.push(directory);
  await writeFile(path.join(directory, "0001_example.sql"), sql, "utf8");
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("migrateDatabase checksummed ledger", () => {
  it("records a checksum and accepts an unchanged rerun", async () => {
    const database = createDatabaseClient(":memory:");
    const directory = await migrationDirectory();
    try {
      await migrateDatabase(database, directory);
      await expect(migrateDatabase(database, directory)).resolves.toBeUndefined();
      const [row] = await database.query<{ checksum: string }>("SELECT checksum FROM schema_migrations");
      expect(row.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    } finally {
      await database.close();
    }
  });

  it("fails closed when an applied migration file changes", async () => {
    const database = createDatabaseClient(":memory:");
    const directory = await migrationDirectory();
    try {
      await migrateDatabase(database, directory);
      await writeFile(path.join(directory, "0001_example.sql"), "CREATE TABLE changed (id text PRIMARY KEY);\n", "utf8");
      await expect(migrateDatabase(database, directory)).rejects.toThrow("checksum does not match");
    } finally {
      await database.close();
    }
  });

  it("refuses to silently bless a legacy filename-only ledger", async () => {
    const database = createDatabaseClient(":memory:");
    const directory = await migrationDirectory();
    try {
      await database.exec("CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
      await database.query("INSERT INTO schema_migrations (filename) VALUES ('0001_example.sql')");
      await expect(migrateDatabase(database, directory)).rejects.toThrow("explicit trusted baseline");
    } finally {
      await database.close();
    }
  });
});
