import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createDatabaseClient } from "./client";
import { NinjaRepository } from "../repositories/ninja-repository";

async function migration(filename: string): Promise<string> {
  return readFile(new URL("../../../migrations/" + filename, import.meta.url), "utf8");
}

async function createOrganizations(database: ReturnType<typeof createDatabaseClient>): Promise<void> {
  await database.query(
    "INSERT INTO organizations (id, name, slug) VALUES ('org-1', 'One', 'one'), ('org-2', 'Two', 'two')",
  );
}

describe("global email identity migration", () => {
  it("enforces case-insensitive uniqueness across organizations", async () => {
    const database = createDatabaseClient(":memory:");
    try {
      await database.exec(await migration("0001_initial.sql"));
      await createOrganizations(database);
      await database.query(
        "INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES ('user-1', 'org-1', 'operator@example.com', 'One', 'hash', 'client')",
      );
      await database.exec(await migration("0015_global_email_identity.sql"));

      await expect(database.query(
        "INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES ('user-2', 'org-2', 'OPERATOR@example.com', 'Two', 'hash', 'client')",
      )).rejects.toThrow();
      expect(await database.query("SELECT id FROM users")).toHaveLength(1);
    } finally {
      await database.close();
    }
  });

  it("fails the migration without rewriting historical duplicate identities", async () => {
    const database = createDatabaseClient(":memory:");
    try {
      await database.exec(await migration("0001_initial.sql"));
      await createOrganizations(database);
      await database.query(
        [
          "INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES",
          "('user-1', 'org-1', 'duplicate@example.com', 'One', 'hash', 'client'),",
          "('user-2', 'org-2', 'DUPLICATE@example.com', 'Two', 'hash', 'client')",
        ].join(" "),
      );

      expect(await new NinjaRepository(database).findUserByEmail("duplicate@example.com")).toBeNull();

      await expect(database.exec(await migration("0015_global_email_identity.sql"))).rejects.toThrow();
      const users = await database.query<{ id: string; email: string }>("SELECT id, email FROM users ORDER BY id");
      expect(users).toEqual([
        { id: "user-1", email: "duplicate@example.com" },
        { id: "user-2", email: "DUPLICATE@example.com" },
      ]);
    } finally {
      await database.close();
    }
  });
});
