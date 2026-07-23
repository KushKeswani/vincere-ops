import { z, type RefinementCtx } from "zod";

import { hashCanonicalPayload } from "@/lib/domain/runtime-contracts";

export const OPERATOR_SCHEDULE_PROTOCOL_VERSION = "operator-schedule/1.0" as const;
export const OPERATOR_SCHEDULE_TIME_ZONE = "America/New_York" as const;
export const DEFAULT_ENABLE_LOCAL_TIME = "08:30" as const;
export const DEFAULT_EOD_LOCAL_TIME = "17:00" as const;
export const DEFAULT_FRIDAY_STOP_LOCAL_TIME = "18:00" as const;
export const ENABLE_DUE_WINDOW_MS = 5 * 60_000;
export const RUNTIME_FRESHNESS_LIMIT_MS = 30_000;

const isoTimestamp = z.iso.datetime({ offset: true });
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidLocalDate, "Invalid local date");
const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const opaqueAccountRef = z.string().regex(/^acct_[a-z0-9]{16,64}$/);
const opaqueStrategyRef = z.string().regex(/^strat_[a-z0-9]{16,64}$/);
const assignmentRevisionRef = z.string().regex(/^assignment_rev_[a-z0-9]{16,64}$/);
const weekdayOrder = ["MON", "TUE", "WED", "THU", "FRI"] as const;

export const operatorWeekdaySchema = z.enum(weekdayOrder);
export const operatorScheduleOccurrenceKindSchema = z.enum([
  "RECONCILE_AND_ENABLE_SIM_STACK",
  "CAPTURE_EOD_SNAPSHOT",
  "REVOKE_ENABLE_AUTHORITY",
  "DISABLE_EXACT_SIM_STACK",
  "DISARM_WEEKLY_SCHEDULE",
]);
export const operatorScheduleOccurrenceStatusSchema = z.enum([
  "planned",
  "due",
  "leased",
  "completed",
  "skipped",
  "failed",
  "indeterminate",
  "latched",
  "superseded",
]);
export const operatorScheduleLatchReasonSchema = z.enum([
  "OPERATOR_PAUSED",
  "STALE_RUNTIME_STATE",
  "CONNECTION_LOSS",
  "ADDON_OFFLINE",
  "TARGET_NOT_EXACT",
  "NON_SIM_TARGET",
  "ASSIGNMENT_REVISION_CHANGED",
  "SETTINGS_REVISION_CHANGED",
  "INDETERMINATE_MUTATION",
]);

const canonicalWeekdaysSchema = z.array(operatorWeekdaySchema).min(1).max(5).refine(
  (values) => values.every((value, index) => index === 0 || weekdayOrder.indexOf(values[index - 1]) < weekdayOrder.indexOf(value)),
  "Operating weekdays must be unique and ordered Monday through Friday",
);

export const operatorScheduleSettingsSchema = z.object({
  protocolVersion: z.literal(OPERATOR_SCHEDULE_PROTOCOL_VERSION),
  scheduleId: z.uuid(),
  settingsRevision: z.number().int().safe().positive(),
  timezone: z.literal(OPERATOR_SCHEDULE_TIME_ZONE),
  operatingWeekdays: canonicalWeekdaysSchema,
  enableLocalTime: localTimeSchema,
  eodLocalTime: localTimeSchema,
  fridayStopLocalTime: localTimeSchema,
  renewalPolicy: z.literal("explicit_arm_each_week"),
  dstPolicy: z.literal("reject_ambiguous_or_nonexistent"),
  missedPolicies: z.object({
    enable: z.literal("skip_after_due_window_no_catch_up"),
    eod: z.literal("run_once_same_local_day"),
    fridayStop: z.literal("revoke_then_latch_until_verified"),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (!(value.enableLocalTime < value.eodLocalTime && value.eodLocalTime < value.fridayStopLocalTime)) {
    context.addIssue({
      code: "custom",
      message: "Enable, EOD, and Friday stop times must be strictly ordered",
      path: ["enableLocalTime"],
    });
  }
});

const exactSimTargetSchema = z.object({
  accountRef: opaqueAccountRef,
  expectedAccountType: z.literal("simulation"),
  strategyRefs: z.array(opaqueStrategyRef).min(1).max(1_000).refine(
    (values) => values.every((value, index) => index === 0 || values[index - 1] < value),
    "Strategy references must be unique and sorted",
  ),
}).strict();

export const weeklyOperatorAuthoritySchema = z.object({
  protocolVersion: z.literal(OPERATOR_SCHEDULE_PROTOCOL_VERSION),
  authorityId: z.uuid(),
  scheduleId: z.uuid(),
  settingsRevision: z.number().int().safe().positive(),
  assignmentRevisionRef,
  weekStartLocalDate: localDateSchema,
  armedAt: isoTimestamp,
  enableAuthorityExpiresAt: isoTimestamp,
  renewalPolicy: z.literal("explicit_arm_each_week"),
  targets: z.array(exactSimTargetSchema).min(1).max(500).refine(
    (values) => values.every((value, index) => index === 0 || values[index - 1].accountRef < value.accountRef),
    "Exact SIM targets must be unique and sorted by account reference",
  ),
}).strict().superRefine((value, context) => {
  if (weekdayForLocalDate(value.weekStartLocalDate) !== "MON") {
    context.addIssue({ code: "custom", message: "The authority week must start on Monday", path: ["weekStartLocalDate"] });
  }
  if (Date.parse(value.armedAt) >= Date.parse(value.enableAuthorityExpiresAt)) {
    context.addIssue({ code: "custom", message: "Weekly authority must be armed before it expires", path: ["armedAt"] });
  }
  const strategyRefs = value.targets.flatMap((target) => target.strategyRefs);
  if (new Set(strategyRefs).size !== strategyRefs.length) {
    context.addIssue({ code: "custom", message: "A strategy may appear in only one exact SIM target", path: ["targets"] });
  }
});

export const operatorScheduleOccurrenceSchema = z.object({
  protocolVersion: z.literal(OPERATOR_SCHEDULE_PROTOCOL_VERSION),
  occurrenceKey: z.string().regex(/^schedule_occurrence:sha256:[a-f0-9]{64}$/),
  scheduleId: z.uuid(),
  authorityId: z.uuid(),
  settingsRevision: z.number().int().safe().positive(),
  assignmentRevisionRef,
  targetBindingHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  weekStartLocalDate: localDateSchema,
  localDate: localDateSchema,
  localTime: localTimeSchema,
  timezone: z.literal(OPERATOR_SCHEDULE_TIME_ZONE),
  kind: operatorScheduleOccurrenceKindSchema,
  fridaySequence: z.number().int().min(0).max(2).nullable(),
  scheduledAt: isoTimestamp,
  deadlineAt: isoTimestamp.nullable(),
  status: operatorScheduleOccurrenceStatusSchema,
  statusReason: z.enum(["ARMED_AFTER_DUE"]).nullable(),
  retryPolicy: z.enum(["never", "same_local_day_once", "operator_reconcile_until_verified"]),
}).strict().superRefine(validateOperatorScheduleOccurrence);

export const operatorScheduleSafetyInputSchema = z.object({
  now: isoTimestamp,
  runtimeObservedAt: isoTimestamp,
  addonConnected: z.boolean(),
  connectionStatus: z.enum(["connected", "connecting", "disconnected", "connection_lost", "unknown"]),
  exactTargetsResolved: z.boolean(),
  observedAccountTypes: z.array(z.enum(["simulation", "evaluation", "live", "unknown"])).min(1),
  expectedAssignmentRevisionRef: assignmentRevisionRef,
  observedAssignmentRevisionRef: assignmentRevisionRef,
  expectedSettingsRevision: z.number().int().safe().positive(),
  observedSettingsRevision: z.number().int().safe().positive(),
  pendingIndeterminateMutation: z.boolean(),
  operatorPaused: z.boolean(),
}).strict();

export type OperatorScheduleSettings = z.infer<typeof operatorScheduleSettingsSchema>;
export type WeeklyOperatorAuthority = z.infer<typeof weeklyOperatorAuthoritySchema>;
export type OperatorScheduleOccurrence = z.infer<typeof operatorScheduleOccurrenceSchema>;
export type OperatorScheduleOccurrenceKind = z.infer<typeof operatorScheduleOccurrenceKindSchema>;
export type OperatorScheduleOccurrenceStatus = z.infer<typeof operatorScheduleOccurrenceStatusSchema>;
export type OperatorScheduleLatchReason = z.infer<typeof operatorScheduleLatchReasonSchema>;
export type OperatorWeekday = z.infer<typeof operatorWeekdaySchema>;

type OccurrenceCrossFields = {
  kind: OperatorScheduleOccurrenceKind;
  fridaySequence: number | null;
  scheduledAt: string;
  deadlineAt: string | null;
  status: OperatorScheduleOccurrenceStatus;
  statusReason: "ARMED_AFTER_DUE" | null;
  retryPolicy: OperatorScheduleOccurrence["retryPolicy"];
};

function validateOperatorScheduleOccurrence(
  value: OccurrenceCrossFields,
  context: Pick<RefinementCtx, "addIssue">,
): void {
  const policyByKind = {
    RECONCILE_AND_ENABLE_SIM_STACK: { fridaySequence: null, retryPolicy: "never", requiresDeadline: true },
    CAPTURE_EOD_SNAPSHOT: { fridaySequence: null, retryPolicy: "same_local_day_once", requiresDeadline: true },
    REVOKE_ENABLE_AUTHORITY: { fridaySequence: 0, retryPolicy: "never", requiresDeadline: false },
    DISABLE_EXACT_SIM_STACK: { fridaySequence: 1, retryPolicy: "operator_reconcile_until_verified", requiresDeadline: false },
    DISARM_WEEKLY_SCHEDULE: { fridaySequence: 2, retryPolicy: "operator_reconcile_until_verified", requiresDeadline: false },
  } as const;
  const policy = policyByKind[value.kind];
  if (value.fridaySequence !== policy.fridaySequence) {
    context.addIssue({ code: "custom", message: "Friday sequence does not match occurrence kind", path: ["fridaySequence"] });
  }
  if (value.retryPolicy !== policy.retryPolicy) {
    context.addIssue({ code: "custom", message: "Retry policy does not match occurrence kind", path: ["retryPolicy"] });
  }
  if (policy.requiresDeadline !== (value.deadlineAt !== null)) {
    context.addIssue({ code: "custom", message: "Deadline presence does not match occurrence kind", path: ["deadlineAt"] });
  }
  if (value.deadlineAt !== null && Date.parse(value.deadlineAt) <= Date.parse(value.scheduledAt)) {
    context.addIssue({ code: "custom", message: "Occurrence deadline must follow its scheduled instant", path: ["deadlineAt"] });
  }
  if (value.statusReason === "ARMED_AFTER_DUE" && value.status !== "skipped") {
    context.addIssue({ code: "custom", message: "ARMED_AFTER_DUE is valid only for a skipped occurrence", path: ["statusReason"] });
  }
}

export class OperatorScheduleTimeError extends Error {
  constructor(
    public readonly code: "NONEXISTENT_LOCAL_TIME" | "AMBIGUOUS_LOCAL_TIME",
    message: string,
  ) {
    super(message);
    this.name = "OperatorScheduleTimeError";
  }
}

export function defaultOperatorScheduleSettings(
  scheduleId: string,
  settingsRevision = 1,
): OperatorScheduleSettings {
  return operatorScheduleSettingsSchema.parse({
    protocolVersion: OPERATOR_SCHEDULE_PROTOCOL_VERSION,
    scheduleId,
    settingsRevision,
    timezone: OPERATOR_SCHEDULE_TIME_ZONE,
    operatingWeekdays: [...weekdayOrder],
    enableLocalTime: DEFAULT_ENABLE_LOCAL_TIME,
    eodLocalTime: DEFAULT_EOD_LOCAL_TIME,
    fridayStopLocalTime: DEFAULT_FRIDAY_STOP_LOCAL_TIME,
    renewalPolicy: "explicit_arm_each_week",
    dstPolicy: "reject_ambiguous_or_nonexistent",
    missedPolicies: {
      enable: "skip_after_due_window_no_catch_up",
      eod: "run_once_same_local_day",
      fridayStop: "revoke_then_latch_until_verified",
    },
  });
}

export function reviseOperatorScheduleSettings(
  current: OperatorScheduleSettings,
  changes: Partial<Pick<OperatorScheduleSettings,
    "operatingWeekdays" | "enableLocalTime" | "eodLocalTime" | "fridayStopLocalTime">>,
): OperatorScheduleSettings {
  const parsed = operatorScheduleSettingsSchema.parse(current);
  return operatorScheduleSettingsSchema.parse({
    ...parsed,
    ...changes,
    settingsRevision: parsed.settingsRevision + 1,
  });
}

export function createWeeklyOperatorAuthority(input: Omit<WeeklyOperatorAuthority,
  "protocolVersion" | "enableAuthorityExpiresAt" | "renewalPolicy"> & {
    settings: OperatorScheduleSettings;
  }): WeeklyOperatorAuthority {
  const settings = operatorScheduleSettingsSchema.parse(input.settings);
  if (input.scheduleId !== settings.scheduleId || input.settingsRevision !== settings.settingsRevision) {
    throw new Error("Weekly authority must bind the current schedule and settings revision");
  }
  const fridayDate = addLocalDays(input.weekStartLocalDate, 4);
  const enableAuthorityExpiresAt = resolveOperatorLocalDateTime(
    fridayDate,
    settings.fridayStopLocalTime,
    settings.timezone,
  ).instant;
  return weeklyOperatorAuthoritySchema.parse({
    protocolVersion: OPERATOR_SCHEDULE_PROTOCOL_VERSION,
    authorityId: input.authorityId,
    scheduleId: input.scheduleId,
    settingsRevision: input.settingsRevision,
    assignmentRevisionRef: input.assignmentRevisionRef,
    weekStartLocalDate: input.weekStartLocalDate,
    armedAt: input.armedAt,
    targets: input.targets,
    enableAuthorityExpiresAt,
    renewalPolicy: "explicit_arm_each_week",
  });
}

export function isAuthorityCurrent(
  settings: OperatorScheduleSettings,
  authority: WeeklyOperatorAuthority,
  assignmentRevisionRefValue: string,
): boolean {
  const parsedSettings = operatorScheduleSettingsSchema.parse(settings);
  const parsedAuthority = weeklyOperatorAuthoritySchema.parse(authority);
  return parsedAuthority.scheduleId === parsedSettings.scheduleId
    && parsedAuthority.settingsRevision === parsedSettings.settingsRevision
    && parsedAuthority.assignmentRevisionRef === assignmentRevisionRefValue;
}

export function materializeWeeklyOperatorOccurrences(
  settingsInput: OperatorScheduleSettings,
  authorityInput: WeeklyOperatorAuthority,
): OperatorScheduleOccurrence[] {
  const settings = operatorScheduleSettingsSchema.parse(settingsInput);
  const authority = weeklyOperatorAuthoritySchema.parse(authorityInput);
  if (!isAuthorityCurrent(settings, authority, authority.assignmentRevisionRef)) {
    throw new Error("Weekly authority does not bind the current schedule settings");
  }
  const fridayDate = addLocalDays(authority.weekStartLocalDate, 4);
  const expectedExpiry = resolveOperatorLocalDateTime(fridayDate, settings.fridayStopLocalTime, settings.timezone).instant;
  if (authority.enableAuthorityExpiresAt !== expectedExpiry) {
    throw new Error("Weekly enable-authority expiry does not match the Friday stop occurrence");
  }

  const targetBindingHash = hashCanonicalPayload({
    assignmentRevisionRef: authority.assignmentRevisionRef,
    targets: authority.targets,
  });
  const drafts: Array<{
    localDate: string;
    localTime: string;
    kind: OperatorScheduleOccurrenceKind;
    fridaySequence: number | null;
    deadlineAt: string | null;
    retryPolicy: OperatorScheduleOccurrence["retryPolicy"];
  }> = [];

  for (const weekday of settings.operatingWeekdays) {
    const dayIndex = weekdayOrder.indexOf(weekday);
    const localDate = addLocalDays(authority.weekStartLocalDate, dayIndex);
    const enableAt = resolveOperatorLocalDateTime(localDate, settings.enableLocalTime, settings.timezone).instant;
    drafts.push({
      localDate,
      localTime: settings.enableLocalTime,
      kind: "RECONCILE_AND_ENABLE_SIM_STACK",
      fridaySequence: null,
      deadlineAt: new Date(Date.parse(enableAt) + ENABLE_DUE_WINDOW_MS).toISOString(),
      retryPolicy: "never",
    });
    const eodDeadline = weekday === "FRI"
      ? expectedExpiry
      : resolveOperatorLocalDateTime(addLocalDays(localDate, 1), "00:00", settings.timezone).instant;
    drafts.push({
      localDate,
      localTime: settings.eodLocalTime,
      kind: "CAPTURE_EOD_SNAPSHOT",
      fridaySequence: null,
      deadlineAt: eodDeadline,
      retryPolicy: "same_local_day_once",
    });
  }

  for (const [fridaySequence, kind] of [
    "REVOKE_ENABLE_AUTHORITY",
    "DISABLE_EXACT_SIM_STACK",
    "DISARM_WEEKLY_SCHEDULE",
  ].entries() as ArrayIterator<[number, OperatorScheduleOccurrenceKind]>) {
    drafts.push({
      localDate: fridayDate,
      localTime: settings.fridayStopLocalTime,
      kind,
      fridaySequence,
      deadlineAt: null,
      retryPolicy: kind === "REVOKE_ENABLE_AUTHORITY" ? "never" : "operator_reconcile_until_verified",
    });
  }

  return drafts.map((draft) => {
    const scheduledAt = resolveOperatorLocalDateTime(draft.localDate, draft.localTime, settings.timezone).instant;
    const armedAfterDue = Date.parse(authority.armedAt) > Date.parse(scheduledAt);
    const semanticKey = {
      protocolVersion: OPERATOR_SCHEDULE_PROTOCOL_VERSION,
      scheduleId: settings.scheduleId,
      settingsRevision: settings.settingsRevision,
      authorityId: authority.authorityId,
      assignmentRevisionRef: authority.assignmentRevisionRef,
      targetBindingHash,
      weekStartLocalDate: authority.weekStartLocalDate,
      localDate: draft.localDate,
      localTime: draft.localTime,
      kind: draft.kind,
      fridaySequence: draft.fridaySequence,
      scheduledAt,
    };
    return operatorScheduleOccurrenceSchema.parse({
      ...semanticKey,
      occurrenceKey: `schedule_occurrence:${hashCanonicalPayload(semanticKey)}`,
      timezone: settings.timezone,
      deadlineAt: draft.deadlineAt,
      status: armedAfterDue ? "skipped" : "planned",
      statusReason: armedAfterDue ? "ARMED_AFTER_DUE" : null,
      retryPolicy: draft.retryPolicy,
    });
  }).sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt)
    || (left.fridaySequence ?? -1) - (right.fridaySequence ?? -1)
    || left.kind.localeCompare(right.kind));
}

export function evaluateScheduleSafety(input: z.input<typeof operatorScheduleSafetyInputSchema>): {
  state: "ready" | "latched";
  reasons: OperatorScheduleLatchReason[];
} {
  const value = operatorScheduleSafetyInputSchema.parse(input);
  const reasons: OperatorScheduleLatchReason[] = [];
  const ageMs = Date.parse(value.now) - Date.parse(value.runtimeObservedAt);
  if (value.operatorPaused) reasons.push("OPERATOR_PAUSED");
  if (ageMs < -5_000 || ageMs > RUNTIME_FRESHNESS_LIMIT_MS) reasons.push("STALE_RUNTIME_STATE");
  if (!value.addonConnected) reasons.push("ADDON_OFFLINE");
  if (value.connectionStatus !== "connected") reasons.push("CONNECTION_LOSS");
  if (!value.exactTargetsResolved) reasons.push("TARGET_NOT_EXACT");
  if (value.observedAccountTypes.some((accountType) => accountType !== "simulation")) reasons.push("NON_SIM_TARGET");
  if (value.expectedAssignmentRevisionRef !== value.observedAssignmentRevisionRef) reasons.push("ASSIGNMENT_REVISION_CHANGED");
  if (value.expectedSettingsRevision !== value.observedSettingsRevision) reasons.push("SETTINGS_REVISION_CHANGED");
  if (value.pendingIndeterminateMutation) reasons.push("INDETERMINATE_MUTATION");
  return { state: reasons.length === 0 ? "ready" : "latched", reasons };
}

export function occurrenceDisposition(
  occurrenceInput: OperatorScheduleOccurrence,
  now: string,
  completedFridayKinds: OperatorScheduleOccurrenceKind[] = [],
): "pending" | "due" | "missed" | "blocked" | "terminal" {
  const occurrence = operatorScheduleOccurrenceSchema.parse(occurrenceInput);
  const nowMs = Date.parse(isoTimestamp.parse(now));
  if (["completed", "skipped", "failed", "indeterminate", "superseded"].includes(occurrence.status)) return "terminal";
  if (nowMs < Date.parse(occurrence.scheduledAt)) return "pending";
  if (occurrence.deadlineAt !== null && nowMs >= Date.parse(occurrence.deadlineAt)) return "missed";
  if (occurrence.kind === "DISABLE_EXACT_SIM_STACK" && !completedFridayKinds.includes("REVOKE_ENABLE_AUTHORITY")) return "blocked";
  if (occurrence.kind === "DISARM_WEEKLY_SCHEDULE" && !completedFridayKinds.includes("DISABLE_EXACT_SIM_STACK")) return "blocked";
  return "due";
}

const statusTransitions: Record<OperatorScheduleOccurrenceStatus, readonly OperatorScheduleOccurrenceStatus[]> = {
  planned: ["due", "skipped", "superseded", "latched"],
  due: ["leased", "skipped", "latched", "superseded"],
  leased: ["completed", "failed", "indeterminate", "latched"],
  latched: ["due", "skipped", "superseded"],
  completed: [],
  skipped: [],
  failed: [],
  indeterminate: [],
  superseded: [],
};

export function isOccurrenceStatusTransitionAllowed(
  from: OperatorScheduleOccurrenceStatus,
  to: OperatorScheduleOccurrenceStatus,
): boolean {
  return statusTransitions[from].includes(to);
}

export function resolveOperatorLocalDateTime(
  localDate: string,
  localTime: string,
  timezone: string = OPERATOR_SCHEDULE_TIME_ZONE,
): { instant: string; offsetMinutes: number } {
  localDateSchema.parse(localDate);
  localTimeSchema.parse(localTime);
  if (timezone !== OPERATOR_SCHEDULE_TIME_ZONE) throw new Error(`Unsupported operator schedule timezone: ${timezone}`);
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = localTime.split(":").map(Number);
  const targetNaiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const matches: number[] = [];
  for (let instant = targetNaiveUtc - 18 * 60 * 60_000; instant <= targetNaiveUtc + 18 * 60 * 60_000; instant += 60_000) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]));
    if (
      Number(parts.year) === year
      && Number(parts.month) === month
      && Number(parts.day) === day
      && Number(parts.hour) === hour
      && Number(parts.minute) === minute
      && Number(parts.second) === 0
    ) matches.push(instant);
  }
  if (matches.length === 0) {
    throw new OperatorScheduleTimeError("NONEXISTENT_LOCAL_TIME", `${localDate} ${localTime} does not exist in ${timezone}`);
  }
  if (matches.length !== 1) {
    throw new OperatorScheduleTimeError("AMBIGUOUS_LOCAL_TIME", `${localDate} ${localTime} is ambiguous in ${timezone}`);
  }
  return {
    instant: new Date(matches[0]).toISOString(),
    offsetMinutes: (targetNaiveUtc - matches[0]) / 60_000,
  };
}

function isValidLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function addLocalDays(localDate: string, days: number): string {
  localDateSchema.parse(localDate);
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function weekdayForLocalDate(localDate: string): OperatorWeekday | "SAT" | "SUN" {
  localDateSchema.parse(localDate);
  const [year, month, day] = localDate.split("-").map(Number);
  return (["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const)[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}
