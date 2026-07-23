import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

import { createDatabaseClient } from "../src/lib/db/client";
import { parseDeploymentMode } from "../src/lib/deployment/contracts";

const expectedByMode = {
  CENTRAL_CONNECTED: {
    deployment_mode: "CENTRAL_CONNECTED",
    installation_kind: "central_hub",
    enrollment_state: "active",
    has_local_client: false,
  },
  LOCAL_ONLY: {
    deployment_mode: "LOCAL_ONLY",
    installation_kind: "local_node",
    enrollment_state: "standalone",
    has_local_client: true,
  },
} as const;

const mode = parseDeploymentMode(process.env.NINJA_MANAGER_MODE, process.env.NODE_ENV);
const database = createDatabaseClient();
try {
  const expectedMigrationNames = (await readdir("migrations"))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  const expectedMigrations = await Promise.all(expectedMigrationNames.map(async (filename) => ({
    filename,
    checksum: "sha256:" + createHash("sha256")
      .update(await readFile(`migrations/${filename}`, "utf8"), "utf8")
      .digest("hex"),
  })));
  const migrations = await database.query<{ filename: string; checksum: string }>(
    "SELECT filename, checksum FROM schema_migrations ORDER BY filename",
  );
  if (JSON.stringify(migrations) !== JSON.stringify(expectedMigrations)) {
    throw new Error(`Unexpected migration ledger: ${JSON.stringify(migrations)}`);
  }

  const installations = await database.query<{
    deployment_mode: string;
    installation_kind: string;
    enrollment_state: string;
    has_local_client: boolean;
  }>(`
    SELECT deployment_mode, installation_kind, enrollment_state,
      local_client_id IS NOT NULL AS has_local_client
    FROM product_installations
  `);
  if (installations.length !== 1) {
    throw new Error(`Expected one product installation, found ${installations.length}`);
  }
  const expectedInstallation = expectedByMode[mode];
  for (const [field, expectedValue] of Object.entries(expectedInstallation)) {
    if (installations[0][field as keyof typeof installations[0]] !== expectedValue) {
      throw new Error(`Unexpected ${field} in ${mode} fixture`);
    }
  }

  const [fixtureCounts] = await database.query<{
    agents: number;
    clients: number;
    organizations: number;
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM agent_installations) AS agents,
      (SELECT COUNT(*)::int FROM clients) AS clients,
      (SELECT COUNT(*)::int FROM organizations) AS organizations
  `);
  if (fixtureCounts.agents !== 3 || fixtureCounts.clients !== 1 || fixtureCounts.organizations !== 2) {
    throw new Error(`Unexpected repeat-seed fixture counts in ${mode}`);
  }

  console.log(`Verified ${mode}: ${expectedMigrations.length} checksummed migrations and repeatable mode-specific demo seed.`);
} finally {
  await database.close();
}
