export type LocalEvidenceKind = "fixture_demo" | "local_persisted";

export interface LocalEvidencePresentation {
  readonly kind: LocalEvidenceKind;
  readonly title: string;
  readonly description: string;
}

interface LocalEvidenceInput {
  readonly configuredClass?: string;
  readonly agentVersion?: string | null;
}

const fixturePresentation: LocalEvidencePresentation = {
  kind: "fixture_demo",
  title: "Fixture/demo evidence — not NinjaTrader state",
  description:
    "This isolated prototype contains rows created by the demo seed. Health, account, strategy, and workflow records shown under this label are demonstration evidence, not a claim about a running NinjaTrader installation.",
};

const localPresentation: LocalEvidencePresentation = {
  kind: "local_persisted",
  title: "Local persisted evidence — verify provenance",
  description:
    "These records came from this loopback dashboard's local database. Local persistence alone does not prove current NinjaTrader state; check each observation's source, authentication, freshness, and completeness.",
};

export function resolveLocalEvidencePresentation({
  configuredClass,
  agentVersion,
}: LocalEvidenceInput): LocalEvidencePresentation {
  if (configuredClass && !["FIXTURE_DEMO", "LOCAL_PERSISTED"].includes(configuredClass)) {
    throw new Error("NINJA_MANAGER_EVIDENCE_CLASS must be FIXTURE_DEMO or LOCAL_PERSISTED");
  }

  if (
    configuredClass === "FIXTURE_DEMO"
    || agentVersion?.startsWith("fixture-")
  ) {
    return fixturePresentation;
  }

  return localPresentation;
}
