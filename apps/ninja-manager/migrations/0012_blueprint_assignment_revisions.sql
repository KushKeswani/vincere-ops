CREATE TABLE IF NOT EXISTS blueprint_preview_stages (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_workbook_hash text NOT NULL CHECK (source_workbook_hash ~ '^sha256:[a-f0-9]{64}$'),
  canonical_preview_hash text NOT NULL CHECK (canonical_preview_hash ~ '^sha256:[a-f0-9]{64}$'),
  data_row_count integer NOT NULL CHECK (data_row_count BETWEEN 1 AND 500),
  assignment_count integer NOT NULL CHECK (assignment_count BETWEEN 1 AND 2000),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 16 AND 200
    AND idempotency_key ~ '^[A-Za-z0-9:._-]+$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  staged_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_by text NOT NULL,
  FOREIGN KEY (organization_id, created_by)
    REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, idempotency_key),
  CHECK (expires_at = staged_at + interval '30 minutes')
);

CREATE TABLE IF NOT EXISTS blueprint_preview_stage_assignments (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  preview_id text NOT NULL,
  assignment_ordinal integer NOT NULL CHECK (assignment_ordinal BETWEEN 1 AND 2000),
  period text NOT NULL CHECK (period IN ('PERIOD_1', 'PERIOD_2')),
  account_label text NOT NULL CHECK (
    char_length(account_label) BETWEEN 1 AND 128
    AND account_label ~ '^[[:alnum:]][[:alnum:] #&''._/-]*$'
  ),
  prop_firm text NOT NULL CHECK (
    char_length(prop_firm) BETWEEN 1 AND 80
    AND prop_firm ~ '^[[:alnum:]][[:alnum:] &''./-]*$'
  ),
  stack_level integer NOT NULL CHECK (stack_level BETWEEN 1 AND 20),
  strategy text NOT NULL CHECK (strategy ~ '^[A-Za-z][A-Za-z0-9._-]{0,63}$'),
  instrument text NOT NULL CHECK (
    char_length(instrument) BETWEEN 1 AND 24
    AND instrument ~ '^[A-Z0-9][A-Z0-9._/-]*$'
  ),
  source_row integer NOT NULL CHECK (source_row BETWEEN 2 AND 501),
  source_slot integer NOT NULL CHECK (source_slot BETWEEN 1 AND 20),
  FOREIGN KEY (organization_id, preview_id)
    REFERENCES blueprint_preview_stages(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (preview_id, assignment_ordinal),
  UNIQUE (organization_id, preview_id, assignment_ordinal)
);

CREATE TABLE IF NOT EXISTS blueprint_assignment_revisions (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  revision_ref text NOT NULL CHECK (revision_ref ~ '^assignment_rev_[a-z0-9]{16,64}$'),
  preview_id text NOT NULL,
  agent_id text NOT NULL,
  source_agent_event_record_id text NOT NULL,
  source_event_id text NOT NULL,
  source_sequence bigint NOT NULL CHECK (source_sequence > 0),
  source_state_digest text NOT NULL CHECK (source_state_digest ~ '^sha256:[a-f0-9]{64}$'),
  source_as_of timestamptz NOT NULL,
  source_occurred_at timestamptz NOT NULL,
  source_received_at timestamptz NOT NULL,
  committed_at timestamptz NOT NULL,
  mapping_count integer NOT NULL CHECK (mapping_count BETWEEN 1 AND 500),
  assignment_count integer NOT NULL CHECK (assignment_count BETWEEN 1 AND 2000),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 16 AND 200
    AND idempotency_key ~ '^[A-Za-z0-9:._-]+$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  created_by text NOT NULL,
  FOREIGN KEY (organization_id, preview_id)
    REFERENCES blueprint_preview_stages(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, agent_id)
    REFERENCES agent_installations(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, agent_id, source_agent_event_record_id)
    REFERENCES agent_events(organization_id, agent_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by)
    REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, id, agent_id),
  UNIQUE (organization_id, revision_ref),
  UNIQUE (organization_id, idempotency_key),
  CHECK (source_as_of <= source_occurred_at),
  CHECK (source_occurred_at <= source_received_at),
  CHECK (source_received_at <= committed_at)
);

CREATE TABLE IF NOT EXISTS blueprint_assignment_account_bindings (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  revision_id text NOT NULL,
  agent_id text NOT NULL,
  mapping_ordinal integer NOT NULL CHECK (mapping_ordinal BETWEEN 1 AND 500),
  account_label text NOT NULL CHECK (
    char_length(account_label) BETWEEN 1 AND 128
    AND account_label ~ '^[[:alnum:]][[:alnum:] #&''._/-]*$'
  ),
  account_ref text NOT NULL CHECK (account_ref ~ '^acct_[a-z0-9]{16,64}$'),
  identifier_fingerprint text NOT NULL CHECK (identifier_fingerprint ~ '^hmac-sha256:[a-f0-9]{64}$'),
  masked_identifier text NOT NULL CHECK (masked_identifier ~ '^\*{4,16}[A-Za-z0-9]{2,8}$'),
  display_label text NOT NULL CHECK (char_length(display_label) BETWEEN 1 AND 80),
  runtime_binding_hash text NOT NULL CHECK (runtime_binding_hash ~ '^sha256:[a-f0-9]{64}$'),
  FOREIGN KEY (organization_id, revision_id, agent_id)
    REFERENCES blueprint_assignment_revisions(organization_id, id, agent_id) ON DELETE RESTRICT,
  UNIQUE (revision_id, mapping_ordinal),
  UNIQUE (revision_id, account_label),
  UNIQUE (revision_id, account_ref),
  UNIQUE (organization_id, revision_id, account_label, account_ref)
);

CREATE TABLE IF NOT EXISTS blueprint_assignment_strategy_bindings (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  revision_id text NOT NULL,
  assignment_ordinal integer NOT NULL CHECK (assignment_ordinal BETWEEN 1 AND 2000),
  period text NOT NULL CHECK (period IN ('PERIOD_1', 'PERIOD_2')),
  account_label text NOT NULL,
  prop_firm text NOT NULL CHECK (char_length(prop_firm) BETWEEN 1 AND 80),
  stack_level integer NOT NULL CHECK (stack_level BETWEEN 1 AND 20),
  strategy text NOT NULL CHECK (strategy ~ '^[A-Za-z][A-Za-z0-9._-]{0,63}$'),
  instrument text NOT NULL CHECK (
    char_length(instrument) BETWEEN 1 AND 24
    AND instrument ~ '^[A-Z0-9][A-Z0-9._/-]*$'
  ),
  source_row integer NOT NULL CHECK (source_row BETWEEN 2 AND 501),
  source_slot integer NOT NULL CHECK (source_slot BETWEEN 1 AND 20),
  account_ref text NOT NULL CHECK (account_ref ~ '^acct_[a-z0-9]{16,64}$'),
  strategy_ref text NOT NULL CHECK (strategy_ref ~ '^strat_[a-z0-9]{16,64}$'),
  runtime_binding_hash text NOT NULL CHECK (runtime_binding_hash ~ '^sha256:[a-f0-9]{64}$'),
  FOREIGN KEY (organization_id, revision_id, account_label, account_ref)
    REFERENCES blueprint_assignment_account_bindings(organization_id, revision_id, account_label, account_ref) ON DELETE RESTRICT,
  UNIQUE (revision_id, assignment_ordinal),
  UNIQUE (revision_id, strategy_ref),
  UNIQUE (organization_id, revision_id, assignment_ordinal)
);

CREATE TABLE IF NOT EXISTS blueprint_assignment_revision_states (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  revision_id text NOT NULL,
  agent_id text NOT NULL,
  state_version integer NOT NULL CHECK (state_version BETWEEN 1 AND 2),
  status text NOT NULL CHECK (status IN ('draft', 'approved')),
  previous_state_id text,
  source_agent_event_record_id text NOT NULL,
  source_event_id text NOT NULL,
  source_sequence bigint NOT NULL CHECK (source_sequence > 0),
  source_state_digest text NOT NULL CHECK (source_state_digest ~ '^sha256:[a-f0-9]{64}$'),
  source_as_of timestamptz NOT NULL,
  source_occurred_at timestamptz NOT NULL,
  source_received_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 16 AND 200
    AND idempotency_key ~ '^[A-Za-z0-9:._-]+$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  actor_user_id text NOT NULL,
  FOREIGN KEY (organization_id, revision_id, agent_id)
    REFERENCES blueprint_assignment_revisions(organization_id, id, agent_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, revision_id, previous_state_id)
    REFERENCES blueprint_assignment_revision_states(organization_id, revision_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, revision_id, id),
  UNIQUE (revision_id, state_version),
  UNIQUE (organization_id, idempotency_key),
  CHECK (
    (state_version = 1 AND status = 'draft' AND previous_state_id IS NULL)
    OR (state_version = 2 AND status = 'approved' AND previous_state_id IS NOT NULL)
  ),
  CHECK (source_as_of <= source_occurred_at),
  CHECK (source_occurred_at <= source_received_at),
  CHECK (source_received_at <= recorded_at)
);

ALTER TABLE blueprint_assignment_revision_states
  ADD CONSTRAINT blueprint_assignment_state_event_fk
  FOREIGN KEY (organization_id, agent_id, source_agent_event_record_id)
  REFERENCES agent_events(organization_id, agent_id, id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_blueprint_preview_stage_expiry
  ON blueprint_preview_stages(organization_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_blueprint_revision_agent
  ON blueprint_assignment_revisions(organization_id, agent_id, committed_at DESC);
CREATE INDEX IF NOT EXISTS idx_blueprint_revision_states_latest
  ON blueprint_assignment_revision_states(revision_id, state_version DESC);

CREATE OR REPLACE FUNCTION validate_blueprint_preview_stage_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_preview_id text;
  expected_count integer;
  actual_count integer;
BEGIN
  IF TG_TABLE_NAME = 'blueprint_preview_stages' THEN
    target_preview_id := NEW.id;
  ELSE
    target_preview_id := NEW.preview_id;
  END IF;
  SELECT assignment_count INTO expected_count FROM blueprint_preview_stages WHERE id = target_preview_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COUNT(*) INTO actual_count FROM blueprint_preview_stage_assignments WHERE preview_id = target_preview_id;
  IF actual_count <> expected_count THEN
    RAISE EXCEPTION 'Blueprint staged assignment count is inconsistent';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER validate_blueprint_preview_count_from_stage
AFTER INSERT ON blueprint_preview_stages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_blueprint_preview_stage_count('stage');

CREATE CONSTRAINT TRIGGER validate_blueprint_preview_count_from_assignment
AFTER INSERT ON blueprint_preview_stage_assignments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_blueprint_preview_stage_count('assignment');

CREATE OR REPLACE FUNCTION validate_blueprint_revision_counts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_revision_id text;
  expected_mappings integer;
  expected_assignments integer;
  actual_mappings integer;
  actual_assignments integer;
BEGIN
  IF TG_TABLE_NAME = 'blueprint_assignment_revisions' THEN
    target_revision_id := NEW.id;
  ELSE
    target_revision_id := NEW.revision_id;
  END IF;
  SELECT mapping_count, assignment_count
  INTO expected_mappings, expected_assignments
  FROM blueprint_assignment_revisions
  WHERE id = target_revision_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COUNT(*) INTO actual_mappings FROM blueprint_assignment_account_bindings WHERE revision_id = target_revision_id;
  SELECT COUNT(*) INTO actual_assignments FROM blueprint_assignment_strategy_bindings WHERE revision_id = target_revision_id;
  IF actual_mappings <> expected_mappings OR actual_assignments <> expected_assignments THEN
    RAISE EXCEPTION 'Blueprint assignment revision counts are inconsistent';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER validate_blueprint_revision_counts_from_revision
AFTER INSERT ON blueprint_assignment_revisions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_blueprint_revision_counts('revision');

CREATE CONSTRAINT TRIGGER validate_blueprint_revision_counts_from_account
AFTER INSERT ON blueprint_assignment_account_bindings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_blueprint_revision_counts('account');

CREATE CONSTRAINT TRIGGER validate_blueprint_revision_counts_from_strategy
AFTER INSERT ON blueprint_assignment_strategy_bindings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_blueprint_revision_counts('strategy');

CREATE OR REPLACE FUNCTION reject_blueprint_assignment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Blueprint assignment evidence is append-only; audited database maintenance is required';
END;
$$;

CREATE TRIGGER blueprint_preview_stages_append_only
BEFORE UPDATE OR DELETE ON blueprint_preview_stages
FOR EACH ROW EXECUTE FUNCTION reject_blueprint_assignment_mutation();

CREATE TRIGGER blueprint_preview_stage_assignments_append_only
BEFORE UPDATE OR DELETE ON blueprint_preview_stage_assignments
FOR EACH ROW EXECUTE FUNCTION reject_blueprint_assignment_mutation();

CREATE TRIGGER blueprint_assignment_revisions_append_only
BEFORE UPDATE OR DELETE ON blueprint_assignment_revisions
FOR EACH ROW EXECUTE FUNCTION reject_blueprint_assignment_mutation();

CREATE TRIGGER blueprint_assignment_account_bindings_append_only
BEFORE UPDATE OR DELETE ON blueprint_assignment_account_bindings
FOR EACH ROW EXECUTE FUNCTION reject_blueprint_assignment_mutation();

CREATE TRIGGER blueprint_assignment_strategy_bindings_append_only
BEFORE UPDATE OR DELETE ON blueprint_assignment_strategy_bindings
FOR EACH ROW EXECUTE FUNCTION reject_blueprint_assignment_mutation();

CREATE TRIGGER blueprint_assignment_revision_states_append_only
BEFORE UPDATE OR DELETE ON blueprint_assignment_revision_states
FOR EACH ROW EXECUTE FUNCTION reject_blueprint_assignment_mutation();
