import { afterEach, describe, expect, it } from "vitest";

import {
  closeDatabase,
  createDatabaseClient,
  getDatabase,
  getDatabaseUrl,
  validateDatabaseConfiguration,
} from "./client";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(async () => {
  await closeDatabase();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("production database configuration", () => {
  it("fails closed when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;

    expect(() => getDatabaseUrl("production")).toThrow("DATABASE_URL is required in production");
  });

  it.each([
    "file://.data/ninja-manager",
    ":memory:",
  ])("rejects local PGlite URL %s in production", (url) => {
    expect(() => validateDatabaseConfiguration(url, "production")).toThrow(
      "Production requires a managed PostgreSQL database",
    );
  });

  it.each([
    "postgresql://database-user:database-password@db.example.test:5432/ninja_manager",
    "postgresql://database-user:database-password@db.example.test:5432/ninja_manager?sslmode=disable",
    "postgresql://database-user:database-password@db.example.test:5432/ninja_manager?sslmode=require",
  ])("rejects PostgreSQL URL without certificate verification in production", (url) => {
    let failure: unknown;
    try {
      validateDatabaseConfiguration(url, "production");
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Production PostgreSQL requires sslmode=verify-full");
    expect((failure as Error).message).not.toContain("database-password");
    expect((failure as Error).message).not.toContain(url);
  });

  it("accepts verify-full configuration without opening a database connection", () => {
    const url = "postgresql://database-user:database-password@db.example.test:5432/ninja_manager?sslmode=verify-full";

    expect(validateDatabaseConfiguration(url, "production")).toBe("postgres");
  });
});

describe("DatabaseClient transactions", () => {
  it("commits all writes through the transaction callback", async () => {
    const database = createDatabaseClient(":memory:");
    try {
      await database.exec("CREATE TABLE records (id text PRIMARY KEY, value text NOT NULL)");
      await database.transaction(async (transaction) => {
        await transaction.query("INSERT INTO records (id, value) VALUES ($1, $2)", ["one", "committed"]);
        await transaction.query("INSERT INTO records (id, value) VALUES ($1, $2)", ["two", "committed"]);
      });

      expect(await database.query("SELECT id FROM records ORDER BY id")).toEqual([{ id: "one" }, { id: "two" }]);
    } finally {
      await database.close();
    }
  });

  it("rolls back every write when the callback fails", async () => {
    const database = createDatabaseClient(":memory:");
    try {
      await database.exec("CREATE TABLE records (id text PRIMARY KEY, value text NOT NULL)");
      await expect(database.transaction(async (transaction) => {
        await transaction.query("INSERT INTO records (id, value) VALUES ($1, $2)", ["one", "rolled-back"]);
        throw new Error("stop the transaction");
      })).rejects.toThrow("stop the transaction");

      expect(await database.query("SELECT id FROM records")).toHaveLength(0);
    } finally {
      await database.close();
    }
  });
});

describe("DatabaseClient server lifecycle", () => {
  it("shares one client across server module consumers", async () => {
    process.env.DATABASE_URL = ":memory:";

    const first = getDatabase();
    const second = getDatabase();

    expect(second).toBe(first);
    await first.exec("CREATE TABLE shared_records (id text PRIMARY KEY)");
    expect(await second.query("SELECT id FROM shared_records")).toEqual([]);
  });
});
