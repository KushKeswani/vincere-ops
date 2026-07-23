CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_org_id
  ON clients(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_id
  ON users(organization_id, id);

CREATE TABLE IF NOT EXISTS product_installations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  local_client_id text,
  installation_kind text NOT NULL
    CHECK (installation_kind IN ('central_hub', 'local_node')),
  deployment_mode text NOT NULL
    CHECK (deployment_mode IN ('CENTRAL_CONNECTED', 'LOCAL_ONLY')),
  enrollment_state text NOT NULL
    CHECK (enrollment_state IN ('active', 'standalone', 'enrolled', 'detached')),
  central_peer_id text,
  record_version bigint NOT NULL DEFAULT 1 CHECK (record_version > 0),
  next_outbox_sequence bigint NOT NULL DEFAULT 1 CHECK (next_outbox_sequence > 0),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, local_client_id)
    REFERENCES clients(organization_id, id),
  UNIQUE (organization_id, id),
  CHECK (
    (
      deployment_mode = 'CENTRAL_CONNECTED'
      AND installation_kind = 'central_hub'
      AND local_client_id IS NULL
      AND enrollment_state = 'active'
    )
    OR (
      deployment_mode = 'LOCAL_ONLY'
      AND installation_kind = 'local_node'
      AND local_client_id IS NOT NULL
      AND enrollment_state IN ('standalone', 'enrolled', 'detached')
    )
  ),
  CHECK (
    (enrollment_state IN ('enrolled', 'detached') AND central_peer_id IS NOT NULL)
    OR (enrollment_state NOT IN ('enrolled', 'detached') AND central_peer_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_installations_local_client
  ON product_installations(organization_id, local_client_id)
  WHERE local_client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS portable_record_state (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  installation_id text NOT NULL,
  record_type text NOT NULL CHECK (
    record_type IN ('assignment', 'audit_evidence', 'client', 'operational_case', 'runtime_observation')
  ),
  record_id text NOT NULL,
  origin_installation_id text NOT NULL,
  record_version bigint NOT NULL CHECK (record_version > 0),
  base_version bigint CHECK (base_version IS NULL OR base_version >= 0),
  authority text NOT NULL CHECK (
    authority IN ('central_portal', 'local_installation', 'ninjatrader_addon', 'originating_system_append_only')
  ),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  sync_status text NOT NULL CHECK (sync_status IN ('local_only', 'pending', 'synced', 'conflict')),
  conflict_code text CHECK (
    conflict_code IS NULL OR conflict_code IN (
      'AUTHORITY_MISMATCH',
      'BASE_VERSION_MISMATCH',
      'CONTENT_MISMATCH',
      'SEQUENCE_GAP'
    )
  ),
  modified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, installation_id)
    REFERENCES product_installations(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, origin_installation_id)
    REFERENCES product_installations(organization_id, id),
  UNIQUE (organization_id, installation_id, record_type, record_id),
  UNIQUE (organization_id, installation_id, id),
  CHECK (base_version IS NULL OR base_version < record_version),
  CHECK (
    (sync_status = 'conflict' AND conflict_code IS NOT NULL)
    OR (sync_status <> 'conflict' AND conflict_code IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  installation_id text NOT NULL,
  record_state_id text NOT NULL,
  message_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  schema_version text NOT NULL CHECK (schema_version = '1.0'),
  operation text NOT NULL CHECK (operation IN ('upsert', 'tombstone')),
  envelope jsonb NOT NULL CHECK (jsonb_typeof(envelope) = 'object'),
  envelope_hash text NOT NULL CHECK (envelope_hash ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'delivered', 'acknowledged', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  acknowledged_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, installation_id, record_state_id)
    REFERENCES portable_record_state(organization_id, installation_id, id) ON DELETE CASCADE,
  UNIQUE (installation_id, message_id),
  UNIQUE (installation_id, sequence),
  CHECK (
    (status = 'leased' AND lease_expires_at IS NOT NULL)
    OR (status <> 'leased')
  )
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_delivery
  ON sync_outbox(installation_id, status, available_at, sequence);

CREATE TABLE IF NOT EXISTS sync_inbox (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  installation_id text NOT NULL,
  source_installation_id text NOT NULL,
  message_id text NOT NULL,
  source_sequence bigint NOT NULL CHECK (source_sequence > 0),
  schema_version text NOT NULL CHECK (schema_version = '1.0'),
  envelope_hash text NOT NULL CHECK (envelope_hash ~ '^sha256:[a-f0-9]{64}$'),
  record_type text NOT NULL CHECK (
    record_type IN ('assignment', 'audit_evidence', 'client', 'operational_case', 'runtime_observation')
  ),
  record_id text NOT NULL,
  record_version bigint NOT NULL CHECK (record_version > 0),
  status text NOT NULL CHECK (status IN ('received', 'applied', 'duplicate', 'conflict', 'rejected')),
  conflict_code text CHECK (
    conflict_code IS NULL OR conflict_code IN (
      'AUTHORITY_MISMATCH',
      'BASE_VERSION_MISMATCH',
      'CONTENT_MISMATCH',
      'SEQUENCE_GAP'
    )
  ),
  received_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  FOREIGN KEY (organization_id, installation_id)
    REFERENCES product_installations(organization_id, id) ON DELETE CASCADE,
  UNIQUE (installation_id, source_installation_id, message_id),
  UNIQUE (installation_id, source_installation_id, source_sequence),
  CHECK (
    (status = 'conflict' AND conflict_code IS NOT NULL)
    OR (status <> 'conflict')
  )
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  installation_id text NOT NULL,
  record_type text NOT NULL CHECK (
    record_type IN ('assignment', 'audit_evidence', 'client', 'operational_case', 'runtime_observation')
  ),
  record_id text NOT NULL,
  conflict_code text NOT NULL CHECK (
    conflict_code IN ('AUTHORITY_MISMATCH', 'BASE_VERSION_MISMATCH', 'CONTENT_MISMATCH', 'SEQUENCE_GAP')
  ),
  local_version bigint CHECK (local_version IS NULL OR local_version > 0),
  remote_version bigint CHECK (remote_version IS NULL OR remote_version > 0),
  local_content_hash text CHECK (local_content_hash IS NULL OR local_content_hash ~ '^sha256:[a-f0-9]{64}$'),
  remote_content_hash text CHECK (remote_content_hash IS NULL OR remote_content_hash ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved_local', 'resolved_central', 'rejected')),
  resolution_audit_event_id text REFERENCES audit_events(id),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  FOREIGN KEY (organization_id, installation_id)
    REFERENCES product_installations(organization_id, id) ON DELETE CASCADE,
  CHECK (
    (status = 'open' AND resolved_at IS NULL)
    OR (status <> 'open' AND resolved_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS secret_references (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id text,
  environment_id text,
  provider_key text NOT NULL CHECK (provider_key ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  provider_reference text NOT NULL CHECK (provider_reference ~ '^ref:[A-Za-z0-9._/-]{8,180}$'),
  purpose text NOT NULL CHECK (purpose IN ('vps_access', 'connector_auth', 'notification_delivery')),
  redacted_hint text NOT NULL CHECK (redacted_hint ~ '^\*{4}.{0,28}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotated', 'revoked')),
  record_version bigint NOT NULL DEFAULT 1 CHECK (record_version > 0),
  requires_reauthentication boolean NOT NULL DEFAULT true CHECK (requires_reauthentication = true),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, client_id)
    REFERENCES clients(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, environment_id)
    REFERENCES environments(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, provider_key, provider_reference),
  CHECK (client_id IS NOT NULL OR environment_id IS NOT NULL)
);

ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS origin_installation_id text,
  ADD COLUMN IF NOT EXISTS event_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS evidence_hash text,
  ADD COLUMN IF NOT EXISTS legacy_unverified boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT audit_events_event_version_positive CHECK (event_version > 0),
  ADD CONSTRAINT audit_events_evidence_hash_format
    CHECK (evidence_hash IS NULL OR evidence_hash ~ '^sha256:[a-f0-9]{64}$'),
  ADD CONSTRAINT audit_events_origin_installation_fk
    FOREIGN KEY (organization_id, origin_installation_id)
    REFERENCES product_installations(organization_id, id);

CREATE INDEX IF NOT EXISTS idx_portable_records_sync
  ON portable_record_state(installation_id, sync_status, modified_at);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_open
  ON sync_conflicts(installation_id, status, detected_at);
CREATE INDEX IF NOT EXISTS idx_secret_references_scope
  ON secret_references(organization_id, client_id, environment_id, status);
