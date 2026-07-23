import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { hashCanonicalPayload } from "@/lib/domain/runtime-contracts";
import {
  createDeliveredSimStrategyControlCommand,
  MAX_SIM_CONTROL_TTL_MS,
  parseDeliveredSimStrategyControlCommand,
  parseSimControlAcknowledgement,
  SIM_CONTROL_PROTOCOL_VERSION,
  simStrategyControlCommandSchema,
  type SimStrategyControlCommand,
} from "@/lib/domain/sim-control-contracts";

function command(overrides: Partial<SimStrategyControlCommand> = {}): SimStrategyControlCommand {
  const issuedAt = new Date("2026-07-20T15:00:00.000Z");
  return {
    protocolVersion: SIM_CONTROL_PROTOCOL_VERSION,
    commandType: "SET_SIM_STRATEGY_GRID_ENABLED",
    commandId: randomUUID(),
    correlationId: randomUUID(),
    agentId: randomUUID(),
    idempotencyKey: `local-sim-control:${randomUUID()}`,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + MAX_SIM_CONTROL_TTL_MS).toISOString(),
    expectedStateVersion: `sha256:${"1".repeat(64)}`,
    approvalId: randomUUID(),
    dryRun: false,
    safetyPhase: "supervised_sim_only",
    actuator: "ninjatrader_control_center_uia",
    payload: {
      accountRef: `acct_${"a".repeat(32)}`,
      strategyRef: `strat_${"b".repeat(32)}`,
      expectedAccountType: "simulation",
      expectedConnectionStatus: "connected",
      expectedEnabled: false,
      desiredEnabled: true,
      expectedRuntimeState: "disabled",
      reasonCode: "OPERATOR_IMMEDIATE",
      scheduleOccurrenceKey: null,
      weeklyAuthorityId: null,
      weeklyAuthorityHash: null,
      interactiveConfirmationId: randomUUID(),
    },
    ...overrides,
  };
}

describe("sim-control/1.0", () => {
  it("round-trips an exact SIM-only command with canonical integrity", () => {
    const delivered = createDeliveredSimStrategyControlCommand(command());
    expect(parseDeliveredSimStrategyControlCommand(delivered)).toEqual(delivered);
  });

  it("rejects broad or live-account shapes", () => {
    const input = command() as unknown as Record<string, unknown>;
    input.payload = {
      ...(input.payload as Record<string, unknown>),
      expectedAccountType: "live",
      allStrategies: true,
    };
    expect(() => simStrategyControlCommandSchema.parse(input)).toThrow();
  });

  it("requires a real state transition", () => {
    const input = command();
    input.payload.expectedEnabled = true;
    input.payload.desiredEnabled = true;
    expect(() => simStrategyControlCommandSchema.parse(input)).toThrow(/states must differ/);
  });

  it("limits commands to 60 seconds", () => {
    const input = command({ expiresAt: "2026-07-20T15:01:00.001Z" });
    expect(() => simStrategyControlCommandSchema.parse(input)).toThrow(/exceeds 60 seconds/);
  });

  it("requires scheduled commands to bind the due execution", () => {
    const input = command();
    input.payload.reasonCode = "SCHEDULED_WEEKLY_AUTHORITY";
    input.payload.interactiveConfirmationId = null;
    expect(() => simStrategyControlCommandSchema.parse(input)).toThrow(/weekly authority/);
  });

  it("rejects an emergency enable", () => {
    const input = command();
    input.payload.reasonCode = "EMERGENCY_SIM_DISABLE";
    expect(() => simStrategyControlCommandSchema.parse(input)).toThrow(/only disable/);
  });

  it("detects delivery tampering", () => {
    const delivered = createDeliveredSimStrategyControlCommand(command());
    const tampered = structuredClone(delivered);
    tampered.command.payload.desiredEnabled = false;
    expect(() => parseDeliveredSimStrategyControlCommand(tampered)).toThrow();
  });

  it("accepts only a fully verified completed enable acknowledgement", () => {
    const evidence = {
      actuator: "ninjatrader_control_center_uia" as const,
      preStateVersion: `sha256:${"1".repeat(64)}`,
      postStateEventId: randomUUID(),
      postStateVersion: `sha256:${"2".repeat(64)}`,
      accountRef: `acct_${"a".repeat(32)}`,
      strategyRef: `strat_${"b".repeat(32)}`,
      desiredEnabled: true,
      observedEnabled: true,
      observedSync: true,
      observedRuntimeState: "running" as const,
      matchedRowCount: 1,
      changedRowCount: 1,
      mutationMayHaveOccurred: true,
      retrySafe: false,
      errorCode: "NONE" as const,
      recoveryCode: "NONE" as const,
    };
    const acknowledgement = {
      protocolVersion: SIM_CONTROL_PROTOCOL_VERSION,
      acknowledgementId: randomUUID(),
      commandId: randomUUID(),
      correlationId: randomUUID(),
      agentId: randomUUID(),
      leaseId: randomUUID(),
      sequence: 2,
      status: "completed" as const,
      evidence,
      evidenceHash: hashCanonicalPayload(evidence),
      occurredAt: "2026-07-20T15:00:05.000Z",
    };
    expect(parseSimControlAcknowledgement(acknowledgement).status).toBe("completed");
  });

  it("rejects a completed enable without synchronized running evidence", () => {
    const evidence = {
      actuator: "ninjatrader_control_center_uia" as const,
      preStateVersion: `sha256:${"1".repeat(64)}`,
      postStateEventId: randomUUID(),
      postStateVersion: `sha256:${"2".repeat(64)}`,
      accountRef: `acct_${"a".repeat(32)}`,
      strategyRef: `strat_${"b".repeat(32)}`,
      desiredEnabled: true,
      observedEnabled: true,
      observedSync: false,
      observedRuntimeState: "waiting_sync" as const,
      matchedRowCount: 1,
      changedRowCount: 1,
      mutationMayHaveOccurred: true,
      retrySafe: false,
      errorCode: "NONE" as const,
      recoveryCode: "RECONCILE_MANUALLY" as const,
    };
    expect(() => parseSimControlAcknowledgement({
      protocolVersion: SIM_CONTROL_PROTOCOL_VERSION,
      acknowledgementId: randomUUID(),
      commandId: randomUUID(),
      correlationId: randomUUID(),
      agentId: randomUUID(),
      leaseId: randomUUID(),
      sequence: 2,
      status: "completed",
      evidence,
      evidenceHash: hashCanonicalPayload(evidence),
      occurredAt: "2026-07-20T15:00:05.000Z",
    })).toThrow(/running, synchronized/);
  });

  it("makes an indeterminate post-actuation result non-retryable", () => {
    const evidence = {
      actuator: "ninjatrader_control_center_uia" as const,
      preStateVersion: `sha256:${"1".repeat(64)}`,
      postStateEventId: null,
      postStateVersion: null,
      accountRef: `acct_${"a".repeat(32)}`,
      strategyRef: `strat_${"b".repeat(32)}`,
      desiredEnabled: false,
      observedEnabled: null,
      observedSync: null,
      observedRuntimeState: null,
      matchedRowCount: 1,
      changedRowCount: 0,
      mutationMayHaveOccurred: true,
      retrySafe: true,
      errorCode: "ACTUATOR_TIMEOUT" as const,
      recoveryCode: "NEW_APPROVAL_REQUIRED" as const,
    };
    expect(() => parseSimControlAcknowledgement({
      protocolVersion: SIM_CONTROL_PROTOCOL_VERSION,
      acknowledgementId: randomUUID(),
      commandId: randomUUID(),
      correlationId: randomUUID(),
      agentId: randomUUID(),
      leaseId: randomUUID(),
      sequence: 2,
      status: "indeterminate",
      evidence,
      evidenceHash: hashCanonicalPayload(evidence),
      occurredAt: "2026-07-20T15:00:05.000Z",
    })).toThrow(/cannot be retried/);
  });
});
