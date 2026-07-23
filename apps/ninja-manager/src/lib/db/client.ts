import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { mkdirSync } from "node:fs";
import path from "node:path";

export interface DatabaseClient {
  query<T extends object>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(operation: (transaction: DatabaseTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface DatabaseTransaction {
  query<T extends object>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

interface PGliteQueryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

type PostgresTransactionSql = postgres.TransactionSql;

class PGliteTransaction implements DatabaseTransaction {
  constructor(private readonly client: PGliteQueryable) {}

  async query<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.client.query<T>(sql, params);
    return result.rows;
  }

  async exec(sql: string): Promise<void> {
    await this.client.exec(sql);
  }
}

class PostgresTransaction implements DatabaseTransaction {
  constructor(private readonly client: PostgresTransactionSql) {}

  async query<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.client.unsafe(sql, params as never[])) as unknown as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.client.unsafe(sql);
  }
}

class PGliteClient implements DatabaseClient {
  constructor(private readonly client: PGlite) {}

  async query<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.client.query(sql, params as never[]);
    return result.rows as T[];
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async exec(sql: string): Promise<void> {
    await this.client.exec(sql);
  }

  async transaction<T>(operation: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    return this.client.transaction(async (transaction) => operation(new PGliteTransaction(transaction)));
  }
}

class PostgresClient implements DatabaseClient {
  constructor(private readonly client: ReturnType<typeof postgres>) {}

  async query<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.client.unsafe(sql, params as never[])) as unknown as T[];
  }

  async close(): Promise<void> {
    await this.client.end();
  }

  async exec(sql: string): Promise<void> {
    await this.client.unsafe(sql);
  }

  async transaction<T>(operation: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    return this.client.begin(async (transaction) => operation(new PostgresTransaction(transaction))) as Promise<T>;
  }
}

interface DatabaseGlobalState {
  client: DatabaseClient;
  environment: string | undefined;
  url: string;
}

type NinjaManagerGlobal = typeof globalThis & {
  __vincereNinjaManagerDatabase?: DatabaseGlobalState;
};

const databaseGlobal = globalThis as NinjaManagerGlobal;

export type DatabaseConfigurationKind = "pglite" | "postgres";

export function getDatabaseUrl(environment = process.env.NODE_ENV): string {
  const configured = process.env.DATABASE_URL;
  if (configured) return configured;
  if (environment === "production") {
    throw new Error("DATABASE_URL is required in production");
  }
  return "file://.data/ninja-manager";
}

export function validateDatabaseConfiguration(
  url: string,
  environment = process.env.NODE_ENV,
): DatabaseConfigurationKind {
  if (url.startsWith("file://") || url === ":memory:") {
    if (environment === "production") {
      throw new Error("Production requires a managed PostgreSQL database");
    }
    return "pglite";
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must be a PostgreSQL URL or local PGlite path");
  }
  if (environment === "production" && parsed.searchParams.get("sslmode") !== "verify-full") {
    throw new Error("Production PostgreSQL requires sslmode=verify-full");
  }
  return "postgres";
}

export function createDatabaseClient(
  url = getDatabaseUrl(),
  environment = process.env.NODE_ENV,
): DatabaseClient {
  const kind = validateDatabaseConfiguration(url, environment);
  if (kind === "pglite") {
    const dataDir = url === ":memory:" ? "memory://" : url.replace("file://", "");
    if (url !== ":memory:") mkdirSync(path.dirname(dataDir), { recursive: true });
    return new PGliteClient(new PGlite(dataDir));
  }

  return new PostgresClient(postgres(url, {
    max: 10,
    prepare: false,
    ...(environment === "production" ? { ssl: "verify-full" as const } : {}),
  }));
}

export function getDatabase(): DatabaseClient {
  const environment = process.env.NODE_ENV;
  const url = getDatabaseUrl(environment);
  const existing = databaseGlobal.__vincereNinjaManagerDatabase;
  if (existing) {
    if (existing.url !== url || existing.environment !== environment) {
      throw new Error('Database configuration changed after initialization');
    }
    return existing.client;
  }

  const client = createDatabaseClient(url, environment);
  databaseGlobal.__vincereNinjaManagerDatabase = { client, environment, url };
  return client;
}

export async function closeDatabase(): Promise<void> {
  const existing = databaseGlobal.__vincereNinjaManagerDatabase;
  if (!existing) return;
  delete databaseGlobal.__vincereNinjaManagerDatabase;
  await existing.client.close();
}
