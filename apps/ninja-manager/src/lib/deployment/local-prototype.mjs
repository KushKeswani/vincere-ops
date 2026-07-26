import path from "node:path";

export const LOCAL_PROTOTYPE_PORT = 3000;
export const LOCAL_PROTOTYPE_DATABASE_DIRECTORY = ".data/local-prototype";

/**
 * @param {{actualNode: string, expectedNode: string, npmUserAgent: string | undefined, expectedNpm: string}} input
 */
export function assertLocalPrototypeToolchain(input) {
  if (input.actualNode !== input.expectedNode) {
    throw new Error(`Local prototype requires Node.js ${input.expectedNode}; current runtime is ${input.actualNode}`);
  }
  const npmVersion = /^npm\/([^\s]+)/.exec(input.npmUserAgent ?? "")?.[1];
  if (npmVersion !== input.expectedNpm) {
    throw new Error(`Local prototype requires npm ${input.expectedNpm} through npm run; current npm is ${npmVersion ?? "unknown"}`);
  }
}

/**
 * Build a closed local-only environment. Caller-provided deployment and database
 * values are deliberately replaced so this launcher cannot select another store.
 *
 * @param {string} projectRoot
 * @param {NodeJS.ProcessEnv} [inheritedEnvironment]
 */
export function buildLocalPrototypeEnvironment(projectRoot, inheritedEnvironment = process.env) {
  const databasePath = path.resolve(projectRoot, LOCAL_PROTOTYPE_DATABASE_DIRECTORY).replaceAll("\\", "/");
  const databaseUrl = `file://${databasePath}`;

  return {
    ...inheritedEnvironment,
    NODE_ENV: "development",
    NINJA_MANAGER_MODE: "LOCAL_ONLY",
    NINJA_MANAGER_BIND_HOST: "127.0.0.1",
    NINJA_MANAGER_EVIDENCE_CLASS: "FIXTURE_DEMO",
    PORT: String(LOCAL_PROTOTYPE_PORT),
    APP_URL: `http://127.0.0.1:${LOCAL_PROTOTYPE_PORT}`,
    DATABASE_URL: databaseUrl,
    NEXT_DIST_DIR: ".next-local-prototype",
    DEMO_STAFF_EMAIL: "staff@vincere.local",
    DEMO_CLIENT_EMAIL: "client@vincere.local",
    DEMO_EMPTY_STAFF_EMAIL: "empty-staff@vincere.local",
    DEMO_STAFF_PASSWORD: "VincereStaff!2026",
    DEMO_CLIENT_PASSWORD: "VincereClient!2026",
    DEMO_AGENT_TOKEN: undefined,
  };
}
