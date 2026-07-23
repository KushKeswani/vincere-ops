import { describe, expect, it } from "vitest";

import {
  createWeeklyOperatorAuthority,
  defaultOperatorScheduleSettings,
  evaluateScheduleSafety,
  isAuthorityCurrent,
  materializeWeeklyOperatorOccurrences,
  occurrenceDisposition,
  OperatorScheduleTimeError,
  operatorScheduleOccurrenceSchema,
  operatorScheduleSettingsSchema,
  resolveOperatorLocalDateTime,
  reviseOperatorScheduleSettings,
  type OperatorScheduleSettings,
  type WeeklyOperatorAuthority,
} from "./operator-schedule-contracts";

const scheduleId = "10000000-0000-4000-8000-000000000001";
const authorityId = "20000000-0000-4000-8000-000000000001";
const assignmentRevisionRef = `assignment_rev_${"a".repeat(16)}`;

function authority(settings: OperatorScheduleSettings, weekStartLocalDate: string, armedAt: string): WeeklyOperatorAuthority {
  return createWeeklyOperatorAuthority({
    settings,
    authorityId,
    scheduleId: settings.scheduleId,
    settingsRevision: settings.settingsRevision,
    assignmentRevisionRef,
    weekStartLocalDate,
    armedAt,
    targets: [{
      accountRef: `acct_${"b".repeat(16)}`,
      expectedAccountType: "simulation",
      strategyRefs: [`strat_${"c".repeat(16)}`, `strat_${"d".repeat(16)}`],
    }],
  });
}

function readySafety(overrides: Record<string, unknown> = {}) {
  return {
    now: "2026-07-06T12:30:10.000Z",
    runtimeObservedAt: "2026-07-06T12:30:00.000Z",
    addonConnected: true,
    connectionStatus: "connected" as const,
    exactTargetsResolved: true,
    observedAccountTypes: ["simulation" as const],
    expectedAssignmentRevisionRef: assignmentRevisionRef,
    observedAssignmentRevisionRef: assignmentRevisionRef,
    expectedSettingsRevision: 1,
    observedSettingsRevision: 1,
    pendingIndeterminateMutation: false,
    operatorPaused: false,
    ...overrides,
  };
}

describe("operator-schedule/1.0", () => {
  it("converts the 08:30 Eastern default correctly in winter and summer", () => {
    expect(resolveOperatorLocalDateTime("2026-01-05", "08:30")).toEqual({
      instant: "2026-01-05T13:30:00.000Z",
      offsetMinutes: -300,
    });
    expect(resolveOperatorLocalDateTime("2026-07-06", "08:30")).toEqual({
      instant: "2026-07-06T12:30:00.000Z",
      offsetMinutes: -240,
    });
  });

  it("generates weekday enable and EOD occurrences plus ordered Friday shutdown", () => {
    const settings = defaultOperatorScheduleSettings(scheduleId);
    const occurrences = materializeWeeklyOperatorOccurrences(settings, authority(settings, "2026-07-06", "2026-07-05T18:00:00.000Z"));
    expect(occurrences).toHaveLength(13);
    expect(occurrences.filter((item) => item.kind === "RECONCILE_AND_ENABLE_SIM_STACK")).toHaveLength(5);
    expect(occurrences.filter((item) => item.kind === "CAPTURE_EOD_SNAPSHOT")).toHaveLength(5);
    expect(occurrences[0].scheduledAt).toBe("2026-07-06T12:30:00.000Z");
    expect(occurrences.filter((item) => item.fridaySequence !== null).map((item) => item.kind)).toEqual([
      "REVOKE_ENABLE_AUTHORITY",
      "DISABLE_EXACT_SIM_STACK",
      "DISARM_WEEKLY_SCHEDULE",
    ]);
  });

  it("expires enable authority at Friday 18:00 Eastern before exact stop and disarm", () => {
    const settings = defaultOperatorScheduleSettings(scheduleId);
    const arm = authority(settings, "2026-07-06", "2026-07-05T18:00:00.000Z");
    const friday = materializeWeeklyOperatorOccurrences(settings, arm).filter((item) => item.fridaySequence !== null);
    expect(arm.enableAuthorityExpiresAt).toBe("2026-07-10T22:00:00.000Z");
    expect(friday.every((item) => item.scheduledAt === arm.enableAuthorityExpiresAt)).toBe(true);
    expect(occurrenceDisposition(friday[1], "2026-07-10T22:01:00.000Z")).toBe("blocked");
    expect(occurrenceDisposition(friday[1], "2026-07-10T22:01:00.000Z", ["REVOKE_ENABLE_AUTHORITY"])).toBe("due");
    expect(occurrenceDisposition(friday[2], "2026-07-10T22:01:00.000Z", ["REVOKE_ENABLE_AUTHORITY"])).toBe("blocked");
    expect(occurrenceDisposition(friday[2], "2026-07-10T22:01:00.000Z", ["DISABLE_EXACT_SIM_STACK"])).toBe("due");
  });

  it("materializes one authority week and never creates an automatic renewal", () => {
    const settings = defaultOperatorScheduleSettings(scheduleId);
    const occurrences = materializeWeeklyOperatorOccurrences(settings, authority(settings, "2026-07-06", "2026-07-05T18:00:00.000Z"));
    expect(new Set(occurrences.map((item) => item.weekStartLocalDate))).toEqual(new Set(["2026-07-06"]));
    expect(occurrences.every((item) => item.localDate >= "2026-07-06" && item.localDate <= "2026-07-10")).toBe(true);
    expect(settings.renewalPolicy).toBe("explicit_arm_each_week");
  });

  it("marks earlier midweek occurrences skipped instead of catching them up", () => {
    const settings = defaultOperatorScheduleSettings(scheduleId);
    const occurrences = materializeWeeklyOperatorOccurrences(settings, authority(settings, "2026-07-06", "2026-07-08T16:00:00.000Z"));
    const skipped = occurrences.filter((item) => item.status === "skipped");
    expect(skipped).toHaveLength(5);
    expect(skipped.every((item) => item.statusReason === "ARMED_AFTER_DUE")).toBe(true);
    expect(occurrences.find((item) => item.localDate === "2026-07-08" && item.kind === "CAPTURE_EOD_SNAPSHOT")?.status).toBe("planned");
  });

  it("uses deterministic duplicate-safe occurrence keys", () => {
    const settings = defaultOperatorScheduleSettings(scheduleId);
    const arm = authority(settings, "2026-07-06", "2026-07-05T18:00:00.000Z");
    const first = materializeWeeklyOperatorOccurrences(settings, arm);
    const second = materializeWeeklyOperatorOccurrences(structuredClone(settings), structuredClone(arm));
    expect(second.map((item) => item.occurrenceKey)).toEqual(first.map((item) => item.occurrenceKey));
    expect(new Set(first.map((item) => item.occurrenceKey)).size).toBe(first.length);
  });

  it("turns every settings edit into a new revision that invalidates the existing arm", () => {
    const settings = defaultOperatorScheduleSettings(scheduleId);
    const arm = authority(settings, "2026-07-06", "2026-07-05T18:00:00.000Z");
    const revised = reviseOperatorScheduleSettings(settings, { enableLocalTime: "08:45" });
    expect(revised.settingsRevision).toBe(2);
    expect(isAuthorityCurrent(revised, arm, assignmentRevisionRef)).toBe(false);
    expect(() => materializeWeeklyOperatorOccurrences(revised, arm)).toThrow(/current schedule settings/);
  });

  it("rejects forged Friday sequences and deadline shapes", () => {
    const settings = defaultOperatorScheduleSettings(scheduleId);
    const occurrences = materializeWeeklyOperatorOccurrences(settings, authority(settings, "2026-07-06", "2026-07-05T18:00:00.000Z"));
    const enable = occurrences.find((item) => item.kind === "RECONCILE_AND_ENABLE_SIM_STACK")!;
    const eod = occurrences.find((item) => item.kind === "CAPTURE_EOD_SNAPSHOT")!;
    const revoke = occurrences.find((item) => item.kind === "REVOKE_ENABLE_AUTHORITY")!;
    const disable = occurrences.find((item) => item.kind === "DISABLE_EXACT_SIM_STACK")!;
    const disarm = occurrences.find((item) => item.kind === "DISARM_WEEKLY_SCHEDULE")!;

    expect(operatorScheduleOccurrenceSchema.safeParse({ ...enable, fridaySequence: 0 }).success).toBe(false);
    expect(operatorScheduleOccurrenceSchema.safeParse({ ...eod, fridaySequence: 2 }).success).toBe(false);
    expect(operatorScheduleOccurrenceSchema.safeParse({ ...revoke, fridaySequence: null }).success).toBe(false);
    expect(operatorScheduleOccurrenceSchema.safeParse({ ...disable, fridaySequence: 2 }).success).toBe(false);
    expect(operatorScheduleOccurrenceSchema.safeParse({ ...disarm, fridaySequence: 1 }).success).toBe(false);
    expect(operatorScheduleOccurrenceSchema.safeParse({ ...enable, deadlineAt: null }).success).toBe(false);
    expect(operatorScheduleOccurrenceSchema.safeParse({ ...eod, deadlineAt: null }).success).toBe(false);
    expect(operatorScheduleOccurrenceSchema.safeParse({ ...revoke, deadlineAt: enable.deadlineAt }).success).toBe(false);
    expect(operatorScheduleOccurrenceSchema.safeParse({ ...disable, deadlineAt: enable.deadlineAt }).success).toBe(false);
    expect(operatorScheduleOccurrenceSchema.safeParse({ ...disarm, deadlineAt: enable.deadlineAt }).success).toBe(false);
    expect(operatorScheduleOccurrenceSchema.safeParse({ ...enable, deadlineAt: enable.scheduledAt }).success).toBe(false);
  });

  it("rejects unsafe schedule settings", () => {
    const defaults = defaultOperatorScheduleSettings(scheduleId);
    expect(operatorScheduleSettingsSchema.safeParse({ ...defaults, timezone: "EST" }).success).toBe(false);
    expect(operatorScheduleSettingsSchema.safeParse({ ...defaults, operatingWeekdays: ["TUE", "MON"] }).success).toBe(false);
    expect(operatorScheduleSettingsSchema.safeParse({ ...defaults, enableLocalTime: "18:30" }).success).toBe(false);
  });

  it("rejects forged status reasons and retry policies", () => {
    const settings = defaultOperatorScheduleSettings(scheduleId);
    const occurrences = materializeWeeklyOperatorOccurrences(settings, authority(settings, "2026-07-06", "2026-07-05T18:00:00.000Z"));
    const enable = occurrences.find((item) => item.kind === "RECONCILE_AND_ENABLE_SIM_STACK")!;
    const eod = occurrences.find((item) => item.kind === "CAPTURE_EOD_SNAPSHOT")!;
    const revoke = occurrences.find((item) => item.kind === "REVOKE_ENABLE_AUTHORITY")!;
    const disable = occurrences.find((item) => item.kind === "DISABLE_EXACT_SIM_STACK")!;
    const disarm = occurrences.find((item) => item.kind === "DISARM_WEEKLY_SCHEDULE")!;

    expect(operatorScheduleOccurrenceSchema.safeParse({ ...enable, statusReason: "ARMED_AFTER_DUE" }).success).toBe(false);
    expect(operatorScheduleOccurrenceSchema.safeParse({ ...enable, retryPolicy: "same_local_day_once" }).success).toBe(false);
    expect(operatorScheduleOccurrenceSchema.safeParse({ ...eod, retryPolicy: "never" }).success).toBe(false);
    expect(operatorScheduleOccurrenceSchema.safeParse({ ...revoke, retryPolicy: "operator_reconcile_until_verified" }).success).toBe(false);
    expect(operatorScheduleOccurrenceSchema.safeParse({ ...disable, retryPolicy: "never" }).success).toBe(false);
    expect(operatorScheduleOccurrenceSchema.safeParse({ ...disarm, retryPolicy: "never" }).success).toBe(false);
  });

  it("latches stale state and connection loss instead of allowing scheduled work", () => {
    expect(evaluateScheduleSafety(readySafety())).toEqual({ state: "ready", reasons: [] });
    expect(evaluateScheduleSafety(readySafety({
      runtimeObservedAt: "2026-07-06T12:29:00.000Z",
      connectionStatus: "connection_lost",
    }))).toEqual({ state: "latched", reasons: ["STALE_RUNTIME_STATE", "CONNECTION_LOSS"] });
  });

  it("applies distinct missed-enable, EOD, and Friday-stop policies", () => {
    const settings = defaultOperatorScheduleSettings(scheduleId);
    const occurrences = materializeWeeklyOperatorOccurrences(settings, authority(settings, "2026-07-06", "2026-07-05T18:00:00.000Z"));
    const mondayEnable = occurrences.find((item) => item.localDate === "2026-07-06" && item.kind === "RECONCILE_AND_ENABLE_SIM_STACK")!;
    const mondayEod = occurrences.find((item) => item.localDate === "2026-07-06" && item.kind === "CAPTURE_EOD_SNAPSHOT")!;
    const fridayRevoke = occurrences.find((item) => item.kind === "REVOKE_ENABLE_AUTHORITY")!;
    expect(occurrenceDisposition(mondayEnable, "2026-07-06T12:34:59.000Z")).toBe("due");
    expect(occurrenceDisposition(mondayEnable, "2026-07-06T12:35:00.000Z")).toBe("missed");
    expect(occurrenceDisposition(mondayEod, "2026-07-06T22:00:00.000Z")).toBe("due");
    expect(occurrenceDisposition(mondayEod, "2026-07-07T04:00:00.000Z")).toBe("missed");
    expect(occurrenceDisposition(fridayRevoke, "2026-07-12T12:00:00.000Z")).toBe("due");
  });

  it("rejects custom nonexistent and ambiguous Eastern local times", () => {
    expect(() => resolveOperatorLocalDateTime("2026-03-08", "02:30")).toThrow(OperatorScheduleTimeError);
    try {
      resolveOperatorLocalDateTime("2026-03-08", "02:30");
    } catch (error) {
      expect((error as OperatorScheduleTimeError).code).toBe("NONEXISTENT_LOCAL_TIME");
    }
    expect(() => resolveOperatorLocalDateTime("2026-11-01", "01:30")).toThrow(OperatorScheduleTimeError);
    try {
      resolveOperatorLocalDateTime("2026-11-01", "01:30");
    } catch (error) {
      expect((error as OperatorScheduleTimeError).code).toBe("AMBIGUOUS_LOCAL_TIME");
    }
  });
});
