import type { LatestRuntimeObservationV2 } from "@/lib/repositories/runtime-repository";
import { isSequentialInventoryScopeUsable } from "@/lib/domain/runtime-observation-v2";

export interface BlueprintAccountOption {
  accountRef: string;
  displayLabel: string;
  maskedIdentifier: string;
  classificationLabel: string;
  connectionSummary: string;
}

export interface BlueprintMappingEvidence {
  accountOptions: BlueprintAccountOption[];
  mappingLockedReason: string | null;
}

export function buildBlueprintMappingEvidence(
  latest: LatestRuntimeObservationV2 | null,
  now: Date = new Date(),
): BlueprintMappingEvidence {
  if (!latest) {
    return { accountOptions: [], mappingLockedReason: "No Runtime-v2 account observation exists for the selected local agent." };
  }

  const { observation } = latest;
  const asOfMs = Date.parse(observation.asOf);
  const receivedAtMs = new Date(latest.receivedAt).getTime();
  const occurredAtMs = new Date(latest.occurredAt).getTime();
  const evidenceAtMs = Math.min(asOfMs, receivedAtMs, occurredAtMs);
  const liveAgeMs = now.getTime() - evidenceAtMs;
  if (
    observation.freshness.status !== "fresh"
    || observation.freshness.ageMs === null
    || !Number.isFinite(evidenceAtMs)
    || liveAgeMs < 0
    || liveAgeMs > observation.freshness.maxAgeMs
  ) {
    return { accountOptions: [], mappingLockedReason: "The selected agent's Runtime-v2 account evidence is stale or has unknown freshness." };
  }

  const { state } = observation;
  if (
    !isSequentialInventoryScopeUsable(state.collection.scopes.accounts)
    || !isSequentialInventoryScopeUsable(state.collection.scopes.connections)
    || state.addon?.status !== "connected"
    || state.addon.ipcAuthenticated !== true
  ) {
    return { accountOptions: [], mappingLockedReason: "Fresh account mapping requires usable sequential account and connection evidence from an authenticated Add-On; any source error remains blocking." };
  }

  const connections = new Map(state.connections.map((connection) => [connection.connectionRef, connection]));
  const accountOptions = state.accounts
    .filter((account) => (
      account.classification.environment === "simulation"
      && account.classification.authority === "authoritative"
      && account.classification.source === "ninjatrader_simulation_account"
      && account.status === "connected"
      && account.connectionRefs.length > 0
    ))
    .flatMap((account): BlueprintAccountOption[] => {
      const linkedConnections = account.connectionRefs
        .map((connectionRef) => connections.get(connectionRef))
        .filter((connection) => connection !== undefined);
      if (
        linkedConnections.length !== account.connectionRefs.length
        || linkedConnections.some((connection) => (
          connection.kind === "unknown"
          || connection.providerCode === null
          || connection.status !== "connected"
          || connection.health !== "healthy"
          || ["stale", "unavailable", "unknown"].includes(connection.marketDataStatus)
        ))
      ) return [];
      return [{
        accountRef: account.accountRef,
        displayLabel: account.displayLabel,
        maskedIdentifier: account.maskedIdentifier,
        classificationLabel: `Authoritative ${account.classification.environment}`,
        connectionSummary: linkedConnections.map((connection) => `${connection.displayLabel} (${connection.status})`).join(", "),
      }];
    })
    .sort((left, right) => left.displayLabel.localeCompare(right.displayLabel));

  return accountOptions.length > 0
    ? { accountOptions, mappingLockedReason: null }
    : { accountOptions: [], mappingLockedReason: "The fresh Runtime-v2 observation contains no eligible authoritative connected simulation accounts." };
}
