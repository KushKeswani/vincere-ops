import { createHmac } from 'node:crypto';

import { z } from 'zod';

import {
  runtimeSnapshotPayloadSchema,
  runtimeStateVersion,
} from '@/lib/domain/runtime-contracts';

const rawAccountSchema = z.object({
  localId: z.string().min(1).max(256),
  accountName: z.string().min(1).max(256),
  accountKind: z.enum(['simulation', 'evaluation', 'live', 'unknown']),
  connectionName: z.string().max(256),
  connectionStatus: z.enum(['connected', 'connecting', 'disconnected', 'unknown']),
}).strict();

const rawStrategySchema = z.object({
  localId: z.string().min(1).max(1024),
  accountLocalId: z.string().min(1).max(256),
  strategyName: z.string().min(1).max(256),
  strategyType: z.string().min(1).max(256),
  instrument: z.string().min(1).max(128),
  timeframe: z.string().min(1).max(128),
  enabled: z.boolean(),
  sync: z.boolean().nullable(),
  runtimeState: z.enum(['disabled', 'waiting_sync', 'running', 'error', 'unknown']),
  stateCode: z.enum([
    'SYNCHRONIZED',
    'AWAITING_SYNC',
    'AWAITING_CONNECTION',
    'DISABLED_BY_CONFIGURATION',
    'ERROR_REPORTED',
    'UNKNOWN',
  ]).nullable(),
}).strict();

export const rawAddonSnapshotSchema = z.object({
  observedAt: z.iso.datetime({ offset: true }),
  addonVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/),
  accounts: z.array(rawAccountSchema).max(500),
  strategies: z.array(rawStrategySchema).max(10_000),
}).strict();

export type RawAddonSnapshot = z.infer<typeof rawAddonSnapshotSchema>;

function keyedHex(secret: Buffer, purpose: string, value: string): string {
  return createHmac('sha256', secret).update(`${purpose}\n${value}`, 'utf8').digest('hex');
}

function accountLabel(kind: RawAddonSnapshot['accounts'][number]['accountKind'], index: number): string {
  const prefix = kind === 'simulation'
    ? 'Simulation'
    : kind === 'evaluation'
      ? 'Evaluation'
      : kind === 'live'
        ? 'Live'
        : 'Unknown';
  return `${prefix} account ${index + 1}`;
}

function maskedIdentifier(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9]/g, '');
  const suffix = safe.slice(-4) || 'NA';
  return `****${suffix.length >= 2 ? suffix : `0${suffix}`}`;
}

const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function instrumentCode(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, ' ');
  if (/^[A-Z]{1,6}(?: [A-Z]{3}[0-9]{2})?$/.test(normalized)) return normalized;
  const numericExpiry = normalized.match(/^([A-Z]{1,6}) (0[1-9]|1[0-2])-([0-9]{2})$/);
  if (numericExpiry) return `${numericExpiry[1]} ${monthNames[Number(numericExpiry[2]) - 1]}${numericExpiry[3]}`;
  throw new Error(`Unsupported instrument format from Add-On: ${normalized}`);
}

function timeframeCode(value: string): string {
  const normalized = value.trim();
  if (/^(?:[1-9][0-9]{0,2} (?:Second|Minute|Day)|Tick|Range)$/.test(normalized)) return normalized;
  throw new Error(`Unsupported timeframe format from Add-On: ${normalized}`);
}

function strategyType(value: string): string {
  const typeName = value.split('.').at(-1)?.replace(/[^A-Za-z0-9_.-]/g, '_') ?? '';
  const normalized = /^[A-Za-z]/.test(typeName) ? typeName : `Strategy_${typeName}`;
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(normalized)) {
    throw new Error('Strategy type cannot be represented by runtime protocol v1');
  }
  return normalized;
}

export function adaptAddonSnapshot(input: unknown, identitySecret: Buffer) {
  if (identitySecret.length !== 32) throw new Error('Identity secret must contain exactly 32 bytes');
  const raw = rawAddonSnapshotSchema.parse(input);
  const accountByLocalId = new Map<string, string>();

  const accounts = raw.accounts
    .map((account) => ({
      raw: account,
      accountRef: `acct_${keyedHex(identitySecret, 'account-ref-v1', account.localId).slice(0, 32)}`,
    }))
    .sort((left, right) => left.accountRef.localeCompare(right.accountRef))
    .map(({ raw: account, accountRef }, index) => {
      if (accountByLocalId.has(account.localId)) throw new Error('Add-On returned duplicate local account IDs');
      accountByLocalId.set(account.localId, accountRef);
      return {
        accountRef,
        maskedIdentifier: maskedIdentifier(account.accountName),
        identifierFingerprint: `hmac-sha256:${keyedHex(identitySecret, 'account-fingerprint-v1', account.localId)}`,
        displayLabel: accountLabel(account.accountKind, index),
        accountType: account.accountKind,
        connectionKind: account.accountKind === 'simulation'
          ? 'simulation' as const
          : account.connectionName
            ? 'brokerage' as const
            : 'unknown' as const,
        connectionStatus: account.connectionStatus,
      };
    });

  const strategies = raw.strategies
    .map((strategy) => {
      const accountRef = accountByLocalId.get(strategy.accountLocalId);
      if (!accountRef) throw new Error('Add-On returned a strategy for an unknown account');
      return {
        strategyRef: `strat_${keyedHex(identitySecret, 'strategy-ref-v1', strategy.localId).slice(0, 32)}`,
        accountRef,
        displayLabel: '',
        strategyType: strategyType(strategy.strategyType),
        instrumentCode: instrumentCode(strategy.instrument),
        timeframeCode: timeframeCode(strategy.timeframe),
        enabled: strategy.enabled,
        sync: strategy.sync,
        runtimeState: strategy.runtimeState,
        stateCode: strategy.stateCode,
      };
    })
    .sort((left, right) => left.strategyRef.localeCompare(right.strategyRef))
    .map((strategy, index) => ({ ...strategy, displayLabel: `Strategy ${index + 1}` }));

  const runtimeState = { accounts, strategies };
  return runtimeSnapshotPayloadSchema.parse({
    source: 'ninjatrader_addon',
    collectionMode: 'supervised_simulation',
    complete: true,
    observedAt: raw.observedAt,
    addonVersion: raw.addonVersion,
    stateVersion: runtimeStateVersion(runtimeState),
    ...runtimeState,
  });
}
