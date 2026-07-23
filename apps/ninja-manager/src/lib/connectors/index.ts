import type { ConnectorHealthResult } from "@/lib/domain/types";

export interface OperationsConnector {
  readonly name: ConnectorHealthResult["connector"];
  checkHealth(clientId: string): Promise<ConnectorHealthResult>;
}

class SimulatedConnector implements OperationsConnector {
  constructor(
    readonly name: ConnectorHealthResult["connector"],
    private readonly simulatedStatus: ConnectorHealthResult["status"] = "healthy",
  ) {}

  async checkHealth(clientId: string): Promise<ConnectorHealthResult> {
    return {
      connector: this.name,
      status: this.simulatedStatus,
      summary: this.simulatedStatus === "healthy"
        ? `${this.name} simulation is responding normally.`
        : `${this.name} simulation requires attention.`,
      details: {
        adapter: "simulated",
        clientId,
        autonomousTrading: false,
        checkedAt: new Date().toISOString(),
      },
    };
  }
}

export function getConnector(
  name: ConnectorHealthResult["connector"],
  status: ConnectorHealthResult["status"] = "healthy",
): OperationsConnector {
  return new SimulatedConnector(name, status);
}
