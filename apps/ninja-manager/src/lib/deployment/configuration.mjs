const deploymentModes = new Set(["CENTRAL_CONNECTED", "LOCAL_ONLY"]);

/**
 * @param {string | undefined} value
 * @param {string} [environment]
 * @returns {"CENTRAL_CONNECTED" | "LOCAL_ONLY"}
 */
export function parseRuntimeMode(value, environment = "development") {
  if (!value) {
    if (environment === "production") {
      throw new Error("NINJA_MANAGER_MODE is required in production");
    }
    return "CENTRAL_CONNECTED";
  }

  if (!deploymentModes.has(value)) {
    throw new Error(`Unsupported NINJA_MANAGER_MODE: ${value}`);
  }
  return /** @type {"CENTRAL_CONNECTED" | "LOCAL_ONLY"} */ (value);
}

/** @param {string | undefined} value */
export function parseRuntimePort(value) {
  if (!value) return 3000;
  if (!/^\d+$/.test(value)) throw new Error("PORT must be an integer between 1 and 65535");
  const port = Number(value);
  if (port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

/** @param {string} value */
function parseOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APP_URL must be an absolute HTTP(S) origin");
  }
  if (
    !["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || (url.pathname !== "/" && url.pathname !== "")
    || url.search
    || url.hash
  ) {
    throw new Error("APP_URL must be an absolute HTTP(S) origin without credentials, path, query, or fragment");
  }
  return url;
}

/**
 * Resolve the deployment boundary before either Next.js or application code starts.
 * LOCAL_ONLY has one valid listener address: IPv4 loopback 127.0.0.1.
 *
 * @param {NodeJS.ProcessEnv} [environment]
 */
export function resolveRuntimeConfiguration(environment = process.env) {
  const nodeEnvironment = environment.NODE_ENV ?? "development";
  const mode = parseRuntimeMode(environment.NINJA_MANAGER_MODE, nodeEnvironment);
  const configuredHost = environment.NINJA_MANAGER_BIND_HOST?.trim();
  const bindHost = configuredHost || "127.0.0.1";

  if (mode === "LOCAL_ONLY" && bindHost !== "127.0.0.1") {
    throw new Error("LOCAL_ONLY requires the exact IPv4 loopback NINJA_MANAGER_BIND_HOST=127.0.0.1");
  }

  const port = parseRuntimePort(environment.PORT);
  const defaultAppUrl = mode === "LOCAL_ONLY"
    ? `http://127.0.0.1:${port}`
    : `http://127.0.0.1:${port}`;
  const appUrl = parseOrigin(environment.APP_URL?.trim() || defaultAppUrl);

  if (mode === "LOCAL_ONLY" && appUrl.hostname !== "127.0.0.1") {
    throw new Error("LOCAL_ONLY APP_URL must use the 127.0.0.1 host");
  }
  const appUrlPort = Number(appUrl.port || (appUrl.protocol === "https:" ? 443 : 80));
  if (mode === "LOCAL_ONLY" && appUrlPort !== port) {
    throw new Error(`LOCAL_ONLY APP_URL port ${appUrlPort} must match PORT ${port}`);
  }
  if (mode === "CENTRAL_CONNECTED" && nodeEnvironment === "production" && appUrl.protocol !== "https:") {
    throw new Error("CENTRAL_CONNECTED production APP_URL must use HTTPS");
  }

  return {
    mode,
    bindHost,
    port,
    appUrl: appUrl.origin,
    secureCookies: appUrl.protocol === "https:",
  };
}
