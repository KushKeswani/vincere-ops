CREATE OR REPLACE FUNCTION valid_operator_weekdays(days text[])
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  item text;
  previous_ordinal integer := 0;
  current_ordinal integer;
BEGIN
  IF days IS NULL OR cardinality(days) < 1 OR cardinality(days) > 5 THEN RETURN false; END IF;
  FOREACH item IN ARRAY days LOOP
    current_ordinal := CASE item
      WHEN 'MON' THEN 1 WHEN 'TUE' THEN 2 WHEN 'WED' THEN 3 WHEN 'THU' THEN 4 WHEN 'FRI' THEN 5
      ELSE 0
    END;
    IF current_ordinal <= previous_ordinal THEN RETURN false; END IF;
    previous_ordinal := current_ordinal;
  END LOOP;
  RETURN true;
END;
$$;

CREATE TABLE IF NOT EXISTS operator_schedules (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  agent_id text NOT NULL,
  timezone text NOT NULL CHECK (timezone = 'America/New_York'),
  created_at timestamptz NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 200 AND idempotency_key ~ '^[A-Za-z0-9:._-]+$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  created_by text NOT NULL,
  FOREIGN KEY (organization_id, agent_id)
    REFERENCES agent_installations(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by)
    REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, id, agent_id),
  UNIQUE (organization_id, agent_id),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS operator_schedule_settings_revisions (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  schedule_id text NOT NULL,
  agent_id text NOT NULL,
  settings_revision integer NOT NULL CHECK (settings_revision > 0),
  previous_settings_id text,
  timezone text NOT NULL CHECK (timezone = 'America/New_York'),
  operating_weekdays text[] NOT NULL CHECK (valid_operator_weekdays(operating_weekdays)),
  enable_local_time text NOT NULL CHECK (enable_local_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  eod_local_time text NOT NULL CHECK (eod_local_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  friday_stop_local_time text NOT NULL CHECK (friday_stop_local_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  renewal_policy text NOT NULL CHECK (renewal_policy = 'explicit_arm_each_week'),
  dst_policy text NOT NULL CHECK (dst_policy = 'reject_ambiguous_or_nonexistent'),
  enable_missed_policy text NOT NULL CHECK (enable_missed_policy = 'skip_after_due_window_no_catch_up'),
  eod_missed_policy text NOT NULL CHECK (eod_missed_policy = 'run_once_same_local_day'),
  friday_stop_policy text NOT NULL CHECK (friday_stop_policy = 'revoke_then_latch_until_verified'),
  recorded_at timestamptz NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 200 AND idempotency_key ~ '^[A-Za-z0-9:._-]+$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  actor_user_id text NOT NULL,
  FOREIGN KEY (organization_id, schedule_id, agent_id)
    REFERENCES operator_schedules(organization_id, id, agent_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, schedule_id, previous_settings_id)
    REFERENCES operator_schedule_settings_revisions(organization_id, schedule_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, schedule_id, id),
  UNIQUE (schedule_id, settings_revision),
  UNIQUE (organization_id, idempotency_key),
  CHECK (enable_local_time < eod_local_time AND eod_local_time < friday_stop_local_time),
  CHECK ((settings_revision = 1 AND previous_settings_id IS NULL) OR (settings_revision > 1 AND previous_settings_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS operator_weekly_authorities (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  schedule_id text NOT NULL,
  agent_id text NOT NULL,
  settings_id text NOT NULL,
  settings_revision integer NOT NULL CHECK (settings_revision > 0),
  assignment_revision_id text NOT NULL,
  assignment_revision_ref text NOT NULL CHECK (assignment_revision_ref ~ '^assignment_rev_[a-z0-9]{16,64}$'),
  assignment_state_id text NOT NULL,
  week_start_local_date date NOT NULL CHECK (EXTRACT(ISODOW FROM week_start_local_date) = 1),
  armed_at timestamptz NOT NULL,
  enable_authority_expires_at timestamptz NOT NULL,
  source_agent_event_record_id text NOT NULL,
  source_event_id text NOT NULL,
  source_sequence bigint NOT NULL CHECK (source_sequence > 0),
  source_state_digest text NOT NULL CHECK (source_state_digest ~ '^sha256:[a-f0-9]{64}$'),
  source_as_of timestamptz NOT NULL,
  source_occurred_at timestamptz NOT NULL,
  source_received_at timestamptz NOT NULL,
  target_binding_hash text NOT NULL CHECK (target_binding_hash ~ '^sha256:[a-f0-9]{64}$'),
  account_count integer NOT NULL CHECK (account_count BETWEEN 1 AND 500),
  strategy_count integer NOT NULL CHECK (strategy_count BETWEEN 1 AND 10000),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 200 AND idempotency_key ~ '^[A-Za-z0-9:._-]+$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  actor_user_id text NOT NULL,
  FOREIGN KEY (organization_id, schedule_id, agent_id)
    REFERENCES operator_schedules(organization_id, id, agent_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, schedule_id, settings_id)
    REFERENCES operator_schedule_settings_revisions(organization_id, schedule_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, assignment_revision_id, agent_id)
    REFERENCES blueprint_assignment_revisions(organization_id, id, agent_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, assignment_revision_id, assignment_state_id)
    REFERENCES blueprint_assignment_revision_states(organization_id, revision_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, agent_id, source_agent_event_record_id)
    REFERENCES agent_events(organization_id, agent_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, id, schedule_id, agent_id),
  UNIQUE (schedule_id, week_start_local_date),
  UNIQUE (organization_id, idempotency_key),
  CHECK (source_as_of <= source_occurred_at AND source_occurred_at <= source_received_at AND source_received_at <= armed_at),
  CHECK (armed_at < enable_authority_expires_at)
);

CREATE TABLE IF NOT EXISTS operator_weekly_authority_targets (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  authority_id text NOT NULL,
  schedule_id text NOT NULL,
  agent_id text NOT NULL,
  target_ordinal integer NOT NULL CHECK (target_ordinal BETWEEN 1 AND 10000),
  account_ref text NOT NULL CHECK (account_ref ~ '^acct_[a-z0-9]{16,64}$'),
  expected_account_type text NOT NULL CHECK (expected_account_type = 'simulation'),
  account_binding_hash text NOT NULL CHECK (account_binding_hash ~ '^sha256:[a-f0-9]{64}$'),
  strategy_ref text NOT NULL CHECK (strategy_ref ~ '^strat_[a-z0-9]{16,64}$'),
  strategy_binding_hash text NOT NULL CHECK (strategy_binding_hash ~ '^sha256:[a-f0-9]{64}$'),
  FOREIGN KEY (organization_id, authority_id, schedule_id, agent_id)
    REFERENCES operator_weekly_authorities(organization_id, id, schedule_id, agent_id) ON DELETE RESTRICT,
  UNIQUE (authority_id, target_ordinal),
  UNIQUE (authority_id, strategy_ref)
);

CREATE TABLE IF NOT EXISTS operator_weekly_authority_transitions (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  authority_id text NOT NULL,
  schedule_id text NOT NULL,
  agent_id text NOT NULL,
  transition_version integer NOT NULL CHECK (transition_version BETWEEN 1 AND 3),
  previous_transition_id text,
  from_state text CHECK (from_state IN ('armed', 'revoked')),
  to_state text NOT NULL CHECK (to_state IN ('armed', 'revoked', 'disarmed')),
  reason_code text NOT NULL CHECK (reason_code IN ('EXPLICIT_WEEKLY_ARM', 'MANUAL_OPERATOR', 'SETTINGS_REVISION_CHANGED', 'FRIDAY_STOP', 'EXACT_DISABLE_VERIFIED')),
  source_agent_event_record_id text,
  recorded_at timestamptz NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 200 AND idempotency_key ~ '^[A-Za-z0-9:._-]+$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  actor_user_id text NOT NULL,
  FOREIGN KEY (organization_id, authority_id, schedule_id, agent_id)
    REFERENCES operator_weekly_authorities(organization_id, id, schedule_id, agent_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, authority_id, previous_transition_id)
    REFERENCES operator_weekly_authority_transitions(organization_id, authority_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, agent_id, source_agent_event_record_id)
    REFERENCES agent_events(organization_id, agent_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, authority_id, id),
  UNIQUE (authority_id, transition_version),
  UNIQUE (organization_id, idempotency_key),
  CHECK (
    (transition_version = 1 AND previous_transition_id IS NULL AND from_state IS NULL AND to_state = 'armed' AND reason_code = 'EXPLICIT_WEEKLY_ARM')
    OR (transition_version > 1 AND previous_transition_id IS NOT NULL AND from_state IS NOT NULL AND from_state <> to_state)
  ),
  CHECK (to_state <> 'disarmed' OR from_state = 'revoked')
);

CREATE TABLE IF NOT EXISTS operator_schedule_occurrences (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  occurrence_key text NOT NULL CHECK (occurrence_key ~ '^schedule_occurrence:sha256:[a-f0-9]{64}$'),
  authority_id text NOT NULL,
  schedule_id text NOT NULL,
  agent_id text NOT NULL,
  settings_revision integer NOT NULL CHECK (settings_revision > 0),
  assignment_revision_ref text NOT NULL CHECK (assignment_revision_ref ~ '^assignment_rev_[a-z0-9]{16,64}$'),
  target_binding_hash text NOT NULL CHECK (target_binding_hash ~ '^sha256:[a-f0-9]{64}$'),
  week_start_local_date date NOT NULL,
  local_date date NOT NULL,
  local_time text NOT NULL CHECK (local_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone text NOT NULL CHECK (timezone = 'America/New_York'),
  kind text NOT NULL CHECK (kind IN ('RECONCILE_AND_ENABLE_SIM_STACK', 'CAPTURE_EOD_SNAPSHOT', 'REVOKE_ENABLE_AUTHORITY', 'DISABLE_EXACT_SIM_STACK', 'DISARM_WEEKLY_SCHEDULE')),
  friday_sequence integer CHECK (friday_sequence BETWEEN 0 AND 2),
  scheduled_at timestamptz NOT NULL,
  deadline_at timestamptz,
  retry_policy text NOT NULL CHECK (retry_policy IN ('never', 'same_local_day_once', 'operator_reconcile_until_verified')),
  created_at timestamptz NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  FOREIGN KEY (organization_id, authority_id, schedule_id, agent_id)
    REFERENCES operator_weekly_authorities(organization_id, id, schedule_id, agent_id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, occurrence_key),
  UNIQUE (authority_id, kind, local_date)
);

CREATE TABLE IF NOT EXISTS operator_schedule_occurrence_transitions (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  occurrence_id text NOT NULL,
  occurrence_key text NOT NULL,
  agent_id text NOT NULL,
  transition_version integer NOT NULL CHECK (transition_version > 0),
  previous_transition_id text,
  from_status text CHECK (from_status IN ('planned', 'due', 'leased', 'completed', 'skipped', 'failed', 'indeterminate', 'latched', 'superseded')),
  to_status text NOT NULL CHECK (to_status IN ('planned', 'due', 'leased', 'completed', 'skipped', 'failed', 'indeterminate', 'latched', 'superseded')),
  reason_code text,
  source_agent_event_record_id text,
  recorded_at timestamptz NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 200 AND idempotency_key ~ '^[A-Za-z0-9:._-]+$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  actor_user_id text NOT NULL,
  FOREIGN KEY (organization_id, occurrence_id)
    REFERENCES operator_schedule_occurrences(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, occurrence_key)
    REFERENCES operator_schedule_occurrences(organization_id, occurrence_key) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, occurrence_id, previous_transition_id)
    REFERENCES operator_schedule_occurrence_transitions(organization_id, occurrence_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, agent_id, source_agent_event_record_id)
    REFERENCES agent_events(organization_id, agent_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, occurrence_id, id),
  UNIQUE (occurrence_id, transition_version),
  UNIQUE (organization_id, idempotency_key),
  CHECK ((transition_version = 1 AND previous_transition_id IS NULL AND from_status IS NULL) OR (transition_version > 1 AND previous_transition_id IS NOT NULL AND from_status IS NOT NULL)),
  CHECK (reason_code IS NULL OR reason_code IN (
    'ARMED_AFTER_DUE',
    'AUTHORITY_REVOKED',
    'EXACT_TARGETS_ALREADY_DISABLED',
    'MANUAL_DISARM_RECORDED'
  ))
);

CREATE OR REPLACE FUNCTION validate_operator_authority_approved_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  assignment_status text;
  latest_state_id text;
BEGIN
  SELECT status INTO assignment_status
  FROM blueprint_assignment_revision_states
  WHERE organization_id = NEW.organization_id
    AND revision_id = NEW.assignment_revision_id
    AND id = NEW.assignment_state_id;
  SELECT id INTO latest_state_id
  FROM blueprint_assignment_revision_states
  WHERE organization_id = NEW.organization_id
    AND revision_id = NEW.assignment_revision_id
  ORDER BY state_version DESC
  LIMIT 1;
  IF assignment_status IS DISTINCT FROM 'approved' OR latest_state_id IS DISTINCT FROM NEW.assignment_state_id THEN
    RAISE EXCEPTION 'Weekly authority requires the current approved Blueprint assignment state';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operator_weekly_authority_approved_assignment
BEFORE INSERT ON operator_weekly_authorities
FOR EACH ROW EXECUTE FUNCTION validate_operator_authority_approved_assignment();

CREATE OR REPLACE FUNCTION validate_operator_settings_revision_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest_id text;
  latest_revision integer;
BEGIN
  PERFORM id FROM operator_schedules
  WHERE organization_id = NEW.organization_id AND id = NEW.schedule_id
  FOR UPDATE;
  SELECT id, settings_revision INTO latest_id, latest_revision
  FROM operator_schedule_settings_revisions
  WHERE organization_id = NEW.organization_id AND schedule_id = NEW.schedule_id
  ORDER BY settings_revision DESC
  LIMIT 1;
  IF latest_id IS NULL THEN
    IF NEW.settings_revision <> 1 OR NEW.previous_settings_id IS NOT NULL THEN
      RAISE EXCEPTION 'Initial operator settings revision must be revision 1 without a predecessor';
    END IF;
  ELSIF NEW.settings_revision <> latest_revision + 1 OR NEW.previous_settings_id IS DISTINCT FROM latest_id THEN
    RAISE EXCEPTION 'Operator settings revision must extend the current latest revision';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operator_settings_revision_continuity
BEFORE INSERT ON operator_schedule_settings_revisions
FOR EACH ROW EXECUTE FUNCTION validate_operator_settings_revision_insert();

CREATE OR REPLACE FUNCTION operator_event_is_authenticated(
  target_organization_id text,
  target_agent_id text,
  target_event_record_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM agent_events event
    JOIN agent_credentials credential
      ON credential.id = event.credential_id
      AND credential.organization_id = event.organization_id
      AND credential.agent_id = event.agent_id
    WHERE event.organization_id = target_organization_id
      AND event.agent_id = target_agent_id
      AND event.id = target_event_record_id
      AND event.event_type = 'runtime.observation_v2'
      AND event.legacy_unverified = false
      AND event.envelope_hash IS NOT NULL
  );
$$;

CREATE OR REPLACE FUNCTION validate_operator_authority_transition_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest operator_weekly_authority_transitions%ROWTYPE;
BEGIN
  PERFORM id FROM operator_weekly_authorities
  WHERE organization_id = NEW.organization_id
    AND id = NEW.authority_id
    AND schedule_id = NEW.schedule_id
    AND agent_id = NEW.agent_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Weekly authority transition parent is invalid'; END IF;

  SELECT * INTO latest
  FROM operator_weekly_authority_transitions
  WHERE organization_id = NEW.organization_id AND authority_id = NEW.authority_id
  ORDER BY transition_version DESC
  LIMIT 1;

  IF latest.id IS NULL THEN
    IF NEW.transition_version <> 1
      OR NEW.previous_transition_id IS NOT NULL
      OR NEW.from_state IS NOT NULL
      OR NEW.to_state <> 'armed'
      OR NEW.reason_code <> 'EXPLICIT_WEEKLY_ARM'
      OR NEW.source_agent_event_record_id IS NOT NULL THEN
      RAISE EXCEPTION 'Initial weekly authority transition is invalid';
    END IF;
  ELSE
    IF NEW.transition_version <> latest.transition_version + 1
      OR NEW.previous_transition_id IS DISTINCT FROM latest.id
      OR NEW.from_state IS DISTINCT FROM latest.to_state THEN
      RAISE EXCEPTION 'Weekly authority transition must extend the current latest transition';
    END IF;
    IF latest.to_state = 'armed' THEN
      IF NEW.to_state <> 'revoked'
        OR NEW.reason_code NOT IN ('MANUAL_OPERATOR', 'SETTINGS_REVISION_CHANGED', 'FRIDAY_STOP')
        OR NEW.source_agent_event_record_id IS NOT NULL THEN
        RAISE EXCEPTION 'Armed authority may only be revoked without runtime source evidence';
      END IF;
    ELSIF latest.to_state = 'revoked' THEN
      IF NEW.to_state <> 'disarmed'
        OR NEW.reason_code <> 'EXACT_DISABLE_VERIFIED'
        OR NEW.source_agent_event_record_id IS NULL
        OR NOT operator_event_is_authenticated(NEW.organization_id, NEW.agent_id, NEW.source_agent_event_record_id) THEN
        RAISE EXCEPTION 'Revoked authority may only become disarmed with authenticated exact-disable evidence';
      END IF;
    ELSE
      RAISE EXCEPTION 'Disarmed authority is terminal';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operator_authority_transition_continuity
BEFORE INSERT ON operator_weekly_authority_transitions
FOR EACH ROW EXECUTE FUNCTION validate_operator_authority_transition_insert();

CREATE OR REPLACE FUNCTION valid_operator_occurrence_transition(previous_status text, next_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE previous_status
    WHEN 'planned' THEN next_status IN ('due', 'skipped', 'superseded', 'latched')
    WHEN 'due' THEN next_status IN ('leased', 'skipped', 'latched', 'superseded')
    WHEN 'leased' THEN next_status IN ('failed', 'indeterminate', 'latched')
    WHEN 'latched' THEN next_status IN ('due', 'skipped', 'superseded')
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION validate_operator_occurrence_transition_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent operator_schedule_occurrences%ROWTYPE;
  latest operator_schedule_occurrence_transitions%ROWTYPE;
BEGIN
  SELECT * INTO parent
  FROM operator_schedule_occurrences
  WHERE organization_id = NEW.organization_id
    AND id = NEW.occurrence_id
    AND occurrence_key = NEW.occurrence_key
  FOR UPDATE;
  IF parent.id IS NULL OR NEW.agent_id IS DISTINCT FROM parent.agent_id THEN
    RAISE EXCEPTION 'Occurrence transition parent or agent is invalid';
  END IF;

  SELECT * INTO latest
  FROM operator_schedule_occurrence_transitions
  WHERE organization_id = NEW.organization_id AND occurrence_id = NEW.occurrence_id
  ORDER BY transition_version DESC
  LIMIT 1;

  IF latest.id IS NULL THEN
    IF NEW.transition_version <> 1
      OR NEW.previous_transition_id IS NOT NULL
      OR NEW.from_status IS NOT NULL
      OR NEW.to_status NOT IN ('planned', 'skipped')
      OR (NEW.to_status = 'planned' AND (NEW.reason_code IS NOT NULL OR NEW.source_agent_event_record_id IS NOT NULL))
      OR (NEW.to_status = 'skipped' AND (NEW.reason_code <> 'ARMED_AFTER_DUE' OR NEW.source_agent_event_record_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'Initial occurrence transition is invalid';
    END IF;
  ELSE
    IF NEW.transition_version <> latest.transition_version + 1
      OR NEW.previous_transition_id IS DISTINCT FROM latest.id
      OR NEW.from_status IS DISTINCT FROM latest.to_status
      OR NOT valid_operator_occurrence_transition(latest.to_status, NEW.to_status) THEN
      RAISE EXCEPTION 'Occurrence transition must extend the current valid state';
    END IF;
    IF NEW.to_status = 'completed' THEN
      RAISE EXCEPTION 'Occurrence completion requires a future authenticated worker integration';
    END IF;
    IF NEW.reason_code IN ('EXACT_TARGETS_ALREADY_DISABLED', 'MANUAL_DISARM_RECORDED') THEN
      IF NEW.to_status <> 'skipped'
        OR NEW.source_agent_event_record_id IS NULL
        OR NOT operator_event_is_authenticated(NEW.organization_id, NEW.agent_id, NEW.source_agent_event_record_id) THEN
        RAISE EXCEPTION 'Manual shutdown occurrence evidence requires an authenticated runtime event';
      END IF;
    ELSIF NEW.reason_code = 'AUTHORITY_REVOKED' THEN
      IF NEW.to_status <> 'superseded' OR NEW.source_agent_event_record_id IS NOT NULL THEN
        RAISE EXCEPTION 'Authority-revoked occurrence evidence is invalid';
      END IF;
    ELSE
      RAISE EXCEPTION 'Occurrence transition reason is not available in persistence-only v1';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operator_occurrence_transition_continuity
BEFORE INSERT ON operator_schedule_occurrence_transitions
FOR EACH ROW EXECUTE FUNCTION validate_operator_occurrence_transition_insert();

CREATE INDEX IF NOT EXISTS idx_operator_settings_latest
  ON operator_schedule_settings_revisions(organization_id, schedule_id, settings_revision DESC);
CREATE INDEX IF NOT EXISTS idx_operator_authority_agent_week
  ON operator_weekly_authorities(organization_id, agent_id, week_start_local_date DESC);
CREATE INDEX IF NOT EXISTS idx_operator_authority_transitions_latest
  ON operator_weekly_authority_transitions(authority_id, transition_version DESC);
CREATE INDEX IF NOT EXISTS idx_operator_occurrences_due
  ON operator_schedule_occurrences(organization_id, agent_id, scheduled_at, kind);
CREATE INDEX IF NOT EXISTS idx_operator_occurrence_transitions_latest
  ON operator_schedule_occurrence_transitions(occurrence_id, transition_version DESC);

CREATE OR REPLACE FUNCTION reject_operator_schedule_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Operator schedule evidence is append-only';
END;
$$;

CREATE TRIGGER operator_schedules_append_only
BEFORE UPDATE OR DELETE ON operator_schedules
FOR EACH ROW EXECUTE FUNCTION reject_operator_schedule_evidence_mutation();
CREATE TRIGGER operator_schedule_settings_append_only
BEFORE UPDATE OR DELETE ON operator_schedule_settings_revisions
FOR EACH ROW EXECUTE FUNCTION reject_operator_schedule_evidence_mutation();
CREATE TRIGGER operator_weekly_authorities_append_only
BEFORE UPDATE OR DELETE ON operator_weekly_authorities
FOR EACH ROW EXECUTE FUNCTION reject_operator_schedule_evidence_mutation();
CREATE TRIGGER operator_weekly_authority_targets_append_only
BEFORE UPDATE OR DELETE ON operator_weekly_authority_targets
FOR EACH ROW EXECUTE FUNCTION reject_operator_schedule_evidence_mutation();
CREATE TRIGGER operator_weekly_authority_transitions_append_only
BEFORE UPDATE OR DELETE ON operator_weekly_authority_transitions
FOR EACH ROW EXECUTE FUNCTION reject_operator_schedule_evidence_mutation();
CREATE TRIGGER operator_schedule_occurrences_append_only
BEFORE UPDATE OR DELETE ON operator_schedule_occurrences
FOR EACH ROW EXECUTE FUNCTION reject_operator_schedule_evidence_mutation();
CREATE TRIGGER operator_schedule_occurrence_transitions_append_only
BEFORE UPDATE OR DELETE ON operator_schedule_occurrence_transitions
FOR EACH ROW EXECUTE FUNCTION reject_operator_schedule_evidence_mutation();
