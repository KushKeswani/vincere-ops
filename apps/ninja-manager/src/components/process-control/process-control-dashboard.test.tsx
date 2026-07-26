import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProcessControlDashboardModel } from "./process-control-view-model";
import { ProcessControlDashboard } from "./process-control-dashboard";

const model: ProcessControlDashboardModel = {
  agentId: "30000000-0000-4000-8000-000000000001",
  installationLabel: "Edith",
  processStatus: "running",
  launch: { ready: false, reason: "NinjaTrader is already running, so launch is unavailable." },
  quit: { ready: true, reason: "Fresh usable sequential SIM-only evidence permits a queued readiness check only. Graceful-close actuation remains unavailable because atomic mutation readiness has not been proven." },
};

describe("ProcessControlDashboard", () => {
  it("renders launch and quit from the beginning with one exact confirmation each", () => {
    const markup = renderToStaticMarkup(
      <ProcessControlDashboard
        model={model}
        launchRequestId="70000000-0000-4000-8000-000000000001"
        quitRequestId="70000000-0000-4000-8000-000000000002"
      />,
    );
    expect(markup).toContain("Launch NinjaTrader");
    expect(markup).toContain("Graceful quit readiness check");
    expect(markup).toContain("Type LAUNCH NINJATRADER");
    expect(markup).toContain("Type QUIT NINJATRADER");
    expect(markup.match(/name="confirmation"/g)).toHaveLength(2);
    expect(markup).toContain("NinjaTrader is already running");
    expect(markup).toContain("actuation remains unavailable");
    expect(markup).toContain("Queue quit readiness check");
    expect(markup).toContain("remains blocked before the operating-system call");
  });

  it("sends only agent/request/command/confirmation fields and exposes no server-derived evidence", () => {
    const markup = renderToStaticMarkup(
      <ProcessControlDashboard
        model={model}
        launchRequestId="70000000-0000-4000-8000-000000000001"
        quitRequestId="70000000-0000-4000-8000-000000000002"
      />,
    );
    const names = [...markup.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(names)).toEqual(new Set(["agentId", "requestId", "commandType", "confirmation"]));
    expect(markup).not.toMatch(/install_[a-z0-9]+|process_[a-z0-9]+|sha256:|hmac-sha256|9232/);
  });

  it("keeps controls disabled when no installation or evidence is available", () => {
    const unavailable: ProcessControlDashboardModel = {
      agentId: null,
      installationLabel: "No local installation",
      processStatus: "not observed",
      launch: { ready: false, reason: "No authenticated process observation has been received." },
      quit: { ready: false, reason: "No authenticated process observation has been received." },
    };
    const markup = renderToStaticMarkup(
      <ProcessControlDashboard
        model={unavailable}
        launchRequestId="70000000-0000-4000-8000-000000000001"
        quitRequestId="70000000-0000-4000-8000-000000000002"
      />,
    );
    expect(markup.match(/<button[^>]*disabled/g)).toHaveLength(2);
    expect(markup).toContain("No authenticated process observation");
  });
});
