import { describe, expect, it } from "vitest";

import { resolveLocalEvidencePresentation } from "./local-evidence";

describe("local evidence presentation", () => {
  it("labels the isolated prototype seed as fixture/demo evidence", () => {
    const presentation = resolveLocalEvidencePresentation({
      configuredClass: "FIXTURE_DEMO",
    });

    expect(presentation.kind).toBe("fixture_demo");
    expect(presentation.title).toContain("not NinjaTrader state");
  });

  it("detects retained fixture records from the fixture agent version", () => {
    expect(resolveLocalEvidencePresentation({ agentVersion: "fixture-1.0.0" }).kind).toBe("fixture_demo");
  });

  it("describes ordinary local records without promoting them to authoritative state", () => {
    const presentation = resolveLocalEvidencePresentation({
      configuredClass: "LOCAL_PERSISTED",
      agentVersion: "companion-2.0.0",
    });

    expect(presentation.kind).toBe("local_persisted");
    expect(presentation.description).toContain("does not prove current NinjaTrader state");
  });

  it("rejects an ambiguous configured evidence class", () => {
    expect(() => resolveLocalEvidencePresentation({ configuredClass: "REAL" }))
      .toThrow("NINJA_MANAGER_EVIDENCE_CLASS");
  });
});
