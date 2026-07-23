CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_credentials_org_agent_id
  ON agent_credentials(organization_id, agent_id, id);

CREATE TABLE IF NOT EXISTS process_control_approvals (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  interactive_confirmation_id text NOT NULL,
  approved_by text NOT NULL,
  command_type text NOT NULL
    CHECK (command_type IN ('LAUNCH_NINJATRADER', 'REQUEST_NINJATRADER_QUIT')),
  intent_hash text NOT NULL CHECK (intent_hash ~ '^sha256:[a-f0-9]{64}$'),
  expected_process_state_version text NOT NULL
    CHECK (expected_process_state_version ~ '^sha256:[a-f0-9]{64}$'),
  runtime_state_digest text
    CHECK (runtime_state_digest IS NULL OR runtime_state_digest ~ '^sha256:[a-f0-9]{64}$'),
  intent_payload jsonb NOT NULL CHECK (jsonb_typeof(intent_payload) = 'object'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by_command_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, agent_id)
    REFERENCES agent_installations(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, approved_by)
    REFERENCES users(organization_id, id),
  UNIQUE (organization_id, agent_id, id),
  UNIQUE (organization_id, agent_id, interactive_confirmation_id),
  CHECK (expires_at > issued_at),
  CHECK (expires_at <= issued_at + interval '60 seconds'),
  CHECK (
    (command_type = 'LAUNCH_NINJATRADER' AND runtime_state_digest IS NULL)
    OR
    (command_type = 'REQUEST_NINJATRADER_QUIT' AND runtime_state_digest IS NOT NULL)
  ),
  CHECK (
    (consumed_at IS NULL AND consumed_by_command_id IS NULL)
    OR
    (consumed_at IS NOT NULL AND consumed_by_command_id IS NOT NULL
      AND consumed_at >= issued_at AND consumed_at < expires_at)
  )
);

CREATE TABLE IF NOT EXISTS process_control_commands (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  approval_id text NOT NULL UNIQUE,
  command_id text NOT NULL,
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL,
  command_type text NOT NULL
    CHECK (command_type IN ('LAUNCH_NINJATRADER', 'REQUEST_NINJATRADER_QUIT')),
  protocol_version text NOT NULL CHECK (protocol_version = 'process-control/1.0'),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'delivered', 'expired', 'completed', 'blocked',
      'attention_required', 'indeterminate'
    )),
  command jsonb NOT NULL CHECK (jsonb_typeof(command) = 'object'),
  expected_process_state_version text NOT NULL
    CHECK (expected_process_state_version ~ '^sha256:[a-f0-9]{64}$'),
  runtime_state_digest text
    CHECK (runtime_state_digest IS NULL OR runtime_state_digest ~ '^sha256:[a-f0-9]{64}$'),
  approval_intent_hash text NOT NULL CHECK (approval_intent_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  semantic_hash text NOT NULL CHECK (semantic_hash ~ '^sha256:[a-f0-9]{64}$'),
  envelope_hash text NOT NULL CHECK (envelope_hash ~ '^sha256:[a-f0-9]{64}$'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_by text NOT NULL,
  delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts BETWEEN 0 AND 1),
  last_ack_sequence bigint NOT NULL DEFAULT 0 CHECK (last_ack_sequence BETWEEN 0 AND 1),
  delivered_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, agent_id)
    REFERENCES agent_installations(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, agent_id, approval_id)
    REFERENCES process_control_approvals(organization_id, agent_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES users(organization_id, id),
  UNIQUE (organization_id, agent_id, id),
  UNIQUE (organization_id, agent_id, id, approval_id),
  UNIQUE (organization_id, agent_id, command_id),
  UNIQUE (organization_id, agent_id, correlation_id),
  UNIQUE (organization_id, agent_id, idempotency_key),
  CHECK (expires_at > issued_at),
  CHECK (expires_at <= issued_at + interval '60 seconds'),
  CHECK (
    (command_type = 'LAUNCH_NINJATRADER' AND runtime_state_digest IS NULL)
    OR
    (command_type = 'REQUEST_NINJATRADER_QUIT' AND runtime_state_digest IS NOT NULL)
  ),
  CHECK (
    (status = 'queued' AND delivery_attempts = 0 AND delivered_at IS NULL)
    OR
    (status <> 'queued')
  ),
  CHECK (
    (delivery_attempts = 0 AND delivered_at IS NULL)
    OR
    (delivery_attempts = 1 AND delivered_at IS NOT NULL)
  ),
  CHECK (
    (status IN ('queued', 'delivered') AND terminal_at IS NULL)
    OR
    (status IN ('expired', 'completed', 'blocked', 'attention_required', 'indeterminate')
      AND terminal_at IS NOT NULL)
  ),
  CHECK (
    (status = 'delivered' AND delivery_attempts = 1 AND last_ack_sequence = 0)
    OR status <> 'delivered'
  ),
  CHECK (
    (status = 'expired' AND delivery_attempts = 0 AND last_ack_sequence = 0)
    OR status <> 'expired'
  ),
  CHECK (
    (status IN ('completed', 'blocked', 'attention_required')
      AND delivery_attempts = 1 AND last_ack_sequence = 1 AND terminal_at IS NOT NULL)
    OR status NOT IN ('completed', 'blocked', 'attention_required')
  )
);

ALTER TABLE process_control_approvals
  DROP CONSTRAINT IF EXISTS process_control_approvals_consumed_command_fk;

ALTER TABLE process_control_approvals
  ADD CONSTRAINT process_control_approvals_consumed_command_fk
  FOREIGN KEY (organization_id, agent_id, consumed_by_command_id, id)
  REFERENCES process_control_commands(organization_id, agent_id, id, approval_id);

CREATE TABLE IF NOT EXISTS process_control_deliveries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  command_record_id text NOT NULL UNIQUE,
  credential_id text NOT NULL,
  lease_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt = 1),
  delivered_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  canonicalization text NOT NULL CHECK (canonicalization = 'RFC8785'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  semantic_hash text NOT NULL CHECK (semantic_hash ~ '^sha256:[a-f0-9]{64}$'),
  envelope_hash text NOT NULL CHECK (envelope_hash ~ '^sha256:[a-f0-9]{64}$'),
  acknowledged_at timestamptz,
  FOREIGN KEY (organization_id, agent_id, command_record_id)
    REFERENCES process_control_commands(organization_id, agent_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, agent_id, credential_id)
    REFERENCES agent_credentials(organization_id, agent_id, id),
  UNIQUE (organization_id, agent_id, lease_id),
  UNIQUE (organization_id, agent_id, id, command_record_id, lease_id, credential_id),
  CHECK (lease_expires_at > delivered_at),
  CHECK (acknowledged_at IS NULL OR acknowledged_at >= delivered_at)
);

CREATE TABLE IF NOT EXISTS process_control_acknowledgements (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  command_record_id text NOT NULL UNIQUE,
  delivery_id text NOT NULL UNIQUE,
  credential_id text NOT NULL,
  acknowledgement_id text NOT NULL,
  command_id text NOT NULL,
  correlation_id text NOT NULL,
  lease_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence = 1),
  command_type text NOT NULL
    CHECK (command_type IN ('LAUNCH_NINJATRADER', 'REQUEST_NINJATRADER_QUIT')),
  status text NOT NULL
    CHECK (status IN ('completed', 'blocked', 'attention_required', 'indeterminate')),
  outcome_code text NOT NULL,
  acknowledgement jsonb NOT NULL CHECK (jsonb_typeof(acknowledgement) = 'object'),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^sha256:[a-f0-9]{64}$'),
  acknowledgement_hash text NOT NULL CHECK (acknowledgement_hash ~ '^sha256:[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, agent_id, command_record_id)
    REFERENCES process_control_commands(organization_id, agent_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, agent_id, delivery_id, command_record_id, lease_id, credential_id)
    REFERENCES process_control_deliveries(
      organization_id, agent_id, id, command_record_id, lease_id, credential_id
    ),
  FOREIGN KEY (organization_id, agent_id, credential_id)
    REFERENCES agent_credentials(organization_id, agent_id, id),
  UNIQUE (organization_id, agent_id, acknowledgement_id),
  UNIQUE (organization_id, agent_id, command_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_process_control_approvals_active
  ON process_control_approvals(organization_id, agent_id, expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_process_control_commands_poll
  ON process_control_commands(agent_id, status, expires_at, created_at);
CREATE INDEX IF NOT EXISTS idx_process_control_commands_tenant
  ON process_control_commands(organization_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_process_control_deliveries_lease
  ON process_control_deliveries(agent_id, lease_id, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_process_control_acknowledgements_command
  ON process_control_acknowledgements(agent_id, command_id);
