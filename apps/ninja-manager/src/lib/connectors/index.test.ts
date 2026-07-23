import { describe, expect, it } from "vitest";

import { getConnector } from ".";

describe("simulated connector", () => {
  it("returns safe evidence without claiming a live operation", async () => {
    const result = await getConnector("vps", "offline").checkHealth("client-1");
    expect(result.status).toBe("offline");
    expect(result.details.adapter).toBe("simulated");
    expect(result.details.autonomousTrading).toBe(false);
  });
});
