import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { resolveLocalEvidencePresentation } from "@/lib/presentation/local-evidence";

import { LocalEvidenceNotice } from "./local-evidence-notice";

describe("LocalEvidenceNotice", () => {
  it("makes the demo boundary explicit on the runtime dashboard", () => {
    const markup = renderToStaticMarkup(
      <LocalEvidenceNotice
        presentation={resolveLocalEvidencePresentation({ configuredClass: "FIXTURE_DEMO" })}
        surface="runtime"
      />,
    );

    expect(markup).toContain("Fixture/demo evidence — not NinjaTrader state");
    expect(markup).toContain("demo seed");
    expect(markup).toContain("performs no NinjaTrader actuation");
    expect(markup).toContain('data-evidence-kind="fixture_demo"');
  });

  it("keeps Blueprint approval separate from NinjaTrader authorization", () => {
    const markup = renderToStaticMarkup(
      <LocalEvidenceNotice
        presentation={resolveLocalEvidencePresentation({ configuredClass: "LOCAL_PERSISTED" })}
        surface="blueprint"
      />,
    );

    expect(markup).toContain("Local persisted evidence — verify provenance");
    expect(markup).toContain("do not authorize or actuate NinjaTrader");
  });
});
