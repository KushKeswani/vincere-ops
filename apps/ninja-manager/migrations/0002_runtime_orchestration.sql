CREATE TABLE IF NOT EXISTS agent_installations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_id text REFERENCES environments(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('offline', 'online', 'degraded', 'disabled')),
  agent_version text NOT NULL,
  protocol_version text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_heartbeat_at timestamptz,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agent_installations(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL CHECK (event_type IN ('agent.heartbeat', 'runtime.snapshot')),
  protocol_version text NOT NULL,
  correlation_id text,
  causation_id text,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, event_id),
  UNIQUE (agent_id, sequence)
);

CREATE TABLE IF NOT EXISTS runtime_account_observations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agent_installations(id) ON DELETE CASCADE,
  agent_event_id text NOT NULL REFERENCES agent_events(id) ON DELETE CASCADE,
  account_ref text NOT NULL,
  masked_identifier text NOT NULL,
  identifier_fingerprint text NOT NULL,
  display_name text NOT NULL,
  connection_name text NOT NULL,
  connection_status text NOT NULL CHECK (connection_status IN ('connected', 'connecting', 'disconnected', 'unknown')),
  observed_at timestamptz NOT NULL,
  UNIQUE (agent_event_id, account_ref)
);

CREATE TABLE IF NOT EXISTS runtime_strategy_observations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agent_installations(id) ON DELETE CASCADE,
  agent_event_id text NOT NULL REFERENCES agent_events(id) ON DELETE CASCADE,
  strategy_ref text NOT NULL,
  account_ref text NOT NULL,
  strategy_name text NOT NULL,
  instrument text NOT NULL,
  timeframe text NOT NULL,
  enabled boolean NOT NULL,
  sync boolean,
  runtime_state text NOT NULL CHECK (runtime_state IN ('disabled', 'waiting_sync', 'running', 'error', 'unknown')),
  state_detail text,
  observed_at timestamptz NOT NULL,
  UNIQUE (agent_event_id, strategy_ref)
);

CREATE TABLE IF NOT EXISTS agent_commands (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agent_installations(id) ON DELETE CASCADE,
  command_id text NOT NULL,
  idempotency_key text NOT NULL,
  command_type text NOT NULL CHECK (command_type IN ('DISCOVER_RUNTIME_STATE', 'COLLECT_ACCOUNT_SNAPSHOT', 'COLLECT_EXECUTIONS')),
  protocol_version text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'accepted', 'rejected', 'started', 'progress', 'completed', 'failed', 'partial', 'expired', 'indeterminate')),
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  dry_run boolean NOT NULL CHECK (dry_run = true),
  expected_state_version text,
  approval_id text,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, command_id),
  UNIQUE (agent_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS command_acknowledgements (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agent_installations(id) ON DELETE CASCADE,
  command_record_id text NOT NULL REFERENCES agent_commands(id) ON DELETE CASCADE,
  command_id text NOT NULL,
  acknowledgement_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted', 'rejected', 'started', 'progress', 'completed', 'failed', 'partial', 'expired', 'indeterminate')),
  message text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, acknowledgement_id)
);

CREATE INDEX IF NOT EXISTS idx_agents_org ON agent_installations(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_events_latest ON agent_events(agent_id, event_type, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_accounts_event ON runtime_account_observations(agent_event_id);
CREATE INDEX IF NOT EXISTS idx_runtime_strategies_event ON runtime_strategy_observations(agent_event_id);
CREATE INDEX IF NOT EXISTS idx_agent_commands_status ON agent_commands(agent_id, status, created_at);
