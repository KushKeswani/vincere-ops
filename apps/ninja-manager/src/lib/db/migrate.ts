import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { DatabaseClient } from "./client";

export async function migrateDatabase(
  database: DatabaseClient,
  migrationsDirectory = path.join(process.cwd(), "migrations"),
): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await database.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text");

  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const planned = await Promise.all(files.map(async (filename) => {
    const sql = await readFile(path.join(migrationsDirectory, filename), "utf8");
    const checksum = "sha256:" + createHash("sha256").update(sql, "utf8").digest("hex");
    return { filename, sql, checksum };
  }));
  const byFilename = new Map(planned.map((migration) => [migration.filename, migration]));
  const applied = await database.query<{ filename: string; checksum: string | null }>(
    "SELECT filename, checksum FROM schema_migrations",
  );
  for (const migration of applied) {
    const current = byFilename.get(migration.filename);
    if (!current) {
      throw new Error(`Applied migration ${migration.filename} is missing from the migration directory`);
    }
    if (!migration.checksum) {
      throw new Error(`Applied migration ${migration.filename} has no checksum; an explicit trusted baseline is required`);
    }
    if (migration.checksum !== current.checksum) {
      throw new Error(`Applied migration ${migration.filename} checksum does not match the current file`);
    }
  }
  const appliedNames = new Set(applied.map((migration) => migration.filename));

  for (const migration of planned) {
    if (appliedNames.has(migration.filename)) continue;
    await database.transaction(async (transaction) => {
      await transaction.exec(migration.sql);
      await transaction.query(
        "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
        [migration.filename, migration.checksum],
      );
    });
  }
}
