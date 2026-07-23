ALTER TABLE agent_installations
  ADD COLUMN IF NOT EXISTS last_event_sequence bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_authenticated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_contact_at timestamptz,
  ADD COLUMN IF NOT EXISTS addon_connected boolean,
  ADD COLUMN IF NOT EXISTS addon_version text,
  ADD COLUMN IF NOT EXISTS pending_event_count integer,
  ADD CONSTRAINT agent_installations_event_sequence_nonnegative CHECK (last_event_sequence >= 0),
  ADD CONSTRAINT agent_installations_pending_event_count_nonnegative
    CHECK (pending_event_count IS NULL OR pending_event_count >= 0);

ALTER TABLE agent_events
  ADD COLUMN IF NOT EXISTS envelope_hash text,
  ADD COLUMN IF NOT EXISTS credential_id text,
  ADD COLUMN IF NOT EXISTS legacy_unverified boolean NOT NULL DEFAULT false;

UPDATE agent_installations AS agent
SET last_event_sequence = COALESCE((
  SELECT MAX(event.sequence)
  FROM agent_events AS event
  WHERE event.agent_id = agent.id
), 0);

INSERT INTO audit_events
  (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata)
SELECT
  'migration-0003-event-' || event.id,
  event.organization_id,
  NULL,
  'agent.event_legacy_quarantined',
  'agent_event',
  event.id,
  '{"reason":"0002 event retained only as unverified hash evidence; payload redacted"}'::jsonb
FROM agent_events AS event
WHERE event.envelope_hash IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE agent_events
SET
  legacy_unverified = true,
  payload = '{"legacyRedacted":true}'::jsonb
WHERE envelope_hash IS NULL;

UPDATE agent_installations
SET status = 'degraded'
WHERE status <> 'disabled'
  AND EXISTS (
    SELECT 1 FROM agent_events
    WHERE agent_events.agent_id = agent_installations.id
      AND agent_events.legacy_unverified = true
  );

UPDATE runtime_account_observations
SET
  display_name = 'Unknown account 1',
  connection_name = 'unknown'
WHERE agent_event_id IN (
  SELECT id FROM agent_events WHERE legacy_unverified = true
);

UPDATE runtime_strategy_observations
SET
  strategy_name = 'Strategy 1',
  instrument = 'UNK',
  timeframe = '1 Minute',
  state_detail = 'UNKNOWN'
WHERE agent_event_id IN (
  SELECT id FROM agent_events WHERE legacy_unverified = true
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_environments_org_id
  ON environments(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_org_id
  ON agent_installations(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_events_org_agent_id
  ON agent_events(organization_id, agent_id, id);

INSERT INTO audit_events
  (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata)
SELECT
  'migration-0003-agent-environment-' || agent.id,
  agent.organization_id,
  NULL,
  'agent.environment_binding_cleared',
  'agent_installation',
  agent.id,
  '{"reason":"legacy environment belonged to a different tenant or no longer existed"}'::jsonb
FROM agent_installations AS agent
WHERE agent.environment_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM environments
    WHERE environments.id = agent.environment_id
      AND environments.organization_id = agent.organization_id
  )
ON CONFLICT (id) DO NOTHING;

UPDATE agent_installations AS agent
SET environment_id = NULL
WHERE environment_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM environments
    WHERE environments.id = agent.environment_id
      AND environments.organization_id = agent.organization_id
  );

ALTER TABLE agent_installations
  ADD CONSTRAINT agent_installations_environment_org_fk
  FOREIGN KEY (organization_id, environment_id)
  REFERENCES environments(organization_id, id);

ALTER TABLE agent_events
  ADD CONSTRAINT agent_events_agent_org_fk
  FOREIGN KEY (organization_id, agent_id)
  REFERENCES agent_installations(organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT agent_events_envelope_hash_format
  CHECK (envelope_hash IS NULL OR envelope_hash ~ '^sha256:[a-f0-9]{64}$');

ALTER TABLE runtime_account_observations
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'unknown'
    CHECK (account_type IN ('simulation', 'evaluation', 'live', 'unknown')),
  ADD CONSTRAINT runtime_accounts_event_org_fk
  FOREIGN KEY (organization_id, agent_id, agent_event_id)
  REFERENCES agent_events(organization_id, agent_id, id) ON DELETE CASCADE;

ALTER TABLE runtime_strategy_observations
  ADD COLUMN IF NOT EXISTS strategy_type text NOT NULL DEFAULT 'UnknownStrategy',
  ADD CONSTRAINT runtime_strategies_event_org_fk
  FOREIGN KEY (organization_id, agent_id, agent_event_id)
  REFERENCES agent_events(organization_id, agent_id, id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS runtime_account_identities (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  account_ref text NOT NULL,
  identifier_fingerprint text NOT NULL
    CHECK (identifier_fingerprint ~ '^hmac-sha256:[a-f0-9]{64}$'),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, agent_id)
    REFERENCES agent_installations(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, agent_id, account_ref),
  UNIQUE (organization_id, agent_id, identifier_fingerprint)
);

CREATE TABLE IF NOT EXISTS runtime_strategy_identities (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  strategy_ref text NOT NULL,
  account_ref text NOT NULL,
  strategy_type text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, agent_id)
    REFERENCES agent_installations(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, agent_id, account_ref)
    REFERENCES runtime_account_identities(organization_id, agent_id, account_ref) ON DELETE CASCADE,
  UNIQUE (organization_id, agent_id, strategy_ref)
);

CREATE TABLE IF NOT EXISTS agent_credentials (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  token_last_four text NOT NULL CHECK (char_length(token_last_four) = 4),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by text REFERENCES users(id),
  replaced_by_id text REFERENCES agent_credentials(id),
  FOREIGN KEY (organization_id, agent_id)
    REFERENCES agent_installations(organization_id, id) ON DELETE CASCADE,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_credentials_one_active
  ON agent_credentials(agent_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_credentials_active
  ON agent_credentials(token_hash, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE agent_events
  ADD CONSTRAINT agent_events_credential_fk
  FOREIGN KEY (credential_id) REFERENCES agent_credentials(id);

ALTER TABLE agent_commands
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS semantic_hash text,
  ADD COLUMN IF NOT EXISTS envelope_hash text,
  ADD COLUMN IF NOT EXISTS last_ack_sequence bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_ack_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS bound_lease_id text,
  ADD COLUMN IF NOT EXISTS bound_delivery_attempt integer,
  ADD COLUMN IF NOT EXISTS legacy_unverified boolean NOT NULL DEFAULT false;

INSERT INTO audit_events
  (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata)
SELECT
  'migration-0003-command-' || command.id,
  command.organization_id,
  NULL,
  'agent.command_legacy_quarantined',
  'agent_command',
  command.id,
  '{"reason":"0002 command lacked correlation and canonical integrity evidence"}'::jsonb
FROM agent_commands AS command
WHERE command.correlation_id IS NULL OR command.semantic_hash IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE agent_commands
SET
  legacy_unverified = true,
  status = 'indeterminate',
  correlation_id = CASE
    WHEN command_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      THEN command_id
    ELSE '00000000-0000-4000-8000-000000000000'
  END,
  semantic_hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  envelope_hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  expires_at = CASE
    WHEN expires_at <= issued_at THEN issued_at + interval '1 second'
    WHEN expires_at > issued_at + interval '10 minutes' THEN issued_at + interval '10 minutes'
    ELSE expires_at
  END
WHERE correlation_id IS NULL OR semantic_hash IS NULL OR envelope_hash IS NULL;

ALTER TABLE agent_commands
  ALTER COLUMN correlation_id SET NOT NULL,
  ALTER COLUMN semantic_hash SET NOT NULL,
  ALTER COLUMN envelope_hash SET NOT NULL,
  ADD CONSTRAINT agent_commands_agent_org_fk
    FOREIGN KEY (organization_id, agent_id)
    REFERENCES agent_installations(organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT agent_commands_expiry_order CHECK (expires_at > issued_at),
  ADD CONSTRAINT agent_commands_max_ttl CHECK (expires_at <= issued_at + interval '10 minutes'),
  ADD CONSTRAINT agent_commands_ack_sequence_nonnegative CHECK (last_ack_sequence >= 0),
  ADD CONSTRAINT agent_commands_delivery_attempts_nonnegative CHECK (delivery_attempts >= 0),
  ADD CONSTRAINT agent_commands_bound_attempt_positive
    CHECK (bound_delivery_attempt IS NULL OR bound_delivery_attempt > 0),
  ADD CONSTRAINT agent_commands_semantic_hash_format
    CHECK (semantic_hash ~ '^sha256:[a-f0-9]{64}$'),
  ADD CONSTRAINT agent_commands_envelope_hash_format
    CHECK (envelope_hash ~ '^sha256:[a-f0-9]{64}$');

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_commands_org_agent_id
  ON agent_commands(organization_id, agent_id, id);

CREATE TABLE IF NOT EXISTS command_deliveries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  command_record_id text NOT NULL,
  credential_id text NOT NULL REFERENCES agent_credentials(id),
  lease_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  delivered_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NOT NULL,
  canonicalization text NOT NULL CHECK (canonicalization = 'RFC8785'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  semantic_hash text NOT NULL CHECK (semantic_hash ~ '^sha256:[a-f0-9]{64}$'),
  envelope_hash text NOT NULL CHECK (envelope_hash ~ '^sha256:[a-f0-9]{64}$'),
  FOREIGN KEY (organization_id, agent_id, command_record_id)
    REFERENCES agent_commands(organization_id, agent_id, id) ON DELETE CASCADE,
  UNIQUE (agent_id, lease_id),
  UNIQUE (command_record_id, attempt),
  CHECK (lease_expires_at > delivered_at)
);

CREATE INDEX IF NOT EXISTS idx_command_deliveries_lease
  ON command_deliveries(agent_id, lease_expires_at);

ALTER TABLE command_acknowledgements
  ADD COLUMN IF NOT EXISTS protocol_version text,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS sequence bigint,
  ADD COLUMN IF NOT EXISTS evidence_hash text,
  ADD COLUMN IF NOT EXISTS acknowledgement_hash text,
  ADD COLUMN IF NOT EXISTS credential_id text REFERENCES agent_credentials(id),
  ADD COLUMN IF NOT EXISTS lease_id text,
  ADD COLUMN IF NOT EXISTS legacy_unverified boolean NOT NULL DEFAULT false;

INSERT INTO audit_events
  (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata)
SELECT
  'migration-0003-ack-' || acknowledgement.id,
  acknowledgement.organization_id,
  NULL,
  'agent.acknowledgement_legacy_quarantined',
  'command_acknowledgement',
  acknowledgement.id,
  '{"reason":"0002 acknowledgement lacked lease, sequence, credential, and canonical evidence"}'::jsonb
FROM command_acknowledgements AS acknowledgement
WHERE acknowledgement.sequence IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE command_acknowledgements AS acknowledgement
SET
  legacy_unverified = true,
  protocol_version = COALESCE((
    SELECT command.protocol_version
    FROM agent_commands AS command
    WHERE command.id = acknowledgement.command_record_id
  ), '1.0'),
  correlation_id = COALESCE((
    SELECT command.correlation_id
    FROM agent_commands AS command
    WHERE command.id = acknowledgement.command_record_id
  ), '00000000-0000-4000-8000-000000000000'),
  sequence = (
    SELECT COUNT(*)
    FROM command_acknowledgements AS preceding
    WHERE preceding.command_record_id = acknowledgement.command_record_id
      AND (
        preceding.occurred_at < acknowledgement.occurred_at
        OR (
          preceding.occurred_at = acknowledgement.occurred_at
          AND preceding.id <= acknowledgement.id
        )
      )
  ),
  status = 'indeterminate',
  message = 'COMMAND_INDETERMINATE',
  evidence = '{"resultEventIds":[],"completedScopes":[],"failedScopes":[],"retrySafe":false,"errorCode":"INTERNAL_ERROR","observedStateVersion":null,"counts":{"accounts":0,"strategies":0,"executions":0}}'::jsonb,
  evidence_hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  acknowledgement_hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  lease_id = '00000000-0000-4000-8000-000000000000'
WHERE sequence IS NULL;

ALTER TABLE command_acknowledgements
  ALTER COLUMN protocol_version SET NOT NULL,
  ALTER COLUMN correlation_id SET NOT NULL,
  ALTER COLUMN sequence SET NOT NULL,
  ALTER COLUMN evidence_hash SET NOT NULL,
  ALTER COLUMN acknowledgement_hash SET NOT NULL,
  ALTER COLUMN lease_id SET NOT NULL,
  ADD CONSTRAINT command_acknowledgements_command_org_fk
    FOREIGN KEY (organization_id, agent_id, command_record_id)
    REFERENCES agent_commands(organization_id, agent_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT command_acknowledgements_sequence_positive CHECK (sequence > 0),
  ADD CONSTRAINT command_acknowledgements_evidence_hash_format
    CHECK (evidence_hash ~ '^sha256:[a-f0-9]{64}$'),
  ADD CONSTRAINT command_acknowledgements_hash_format
    CHECK (acknowledgement_hash ~ '^sha256:[a-f0-9]{64}$'),
  ADD CONSTRAINT command_acknowledgements_credential_required
    CHECK (legacy_unverified OR credential_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_command_ack_sequence
  ON command_acknowledgements(command_record_id, sequence);
CREATE INDEX IF NOT EXISTS idx_agent_commands_poll
  ON agent_commands(agent_id, status, expires_at, created_at);

