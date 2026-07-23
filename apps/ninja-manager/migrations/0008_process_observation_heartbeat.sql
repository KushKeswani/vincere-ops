ALTER TABLE agent_installations
  ADD COLUMN IF NOT EXISTS process_evidence_event_id text,
  ADD COLUMN IF NOT EXISTS process_evidence_sequence bigint,
  ADD COLUMN IF NOT EXISTS process_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS process_evidence_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS process_installation_ref text,
  ADD COLUMN IF NOT EXISTS process_state_version text,
  ADD COLUMN IF NOT EXISTS process_state text,
  ADD COLUMN IF NOT EXISTS process_ref text,
  ADD COLUMN IF NOT EXISTS process_matched_count integer,
  ADD COLUMN IF NOT EXISTS process_unavailable_reason text;

ALTER TABLE agent_installations
  DROP CONSTRAINT IF EXISTS agent_installations_process_evidence_event_fk,
  DROP CONSTRAINT IF EXISTS agent_installations_process_evidence_consistent;

ALTER TABLE agent_installations
  ADD CONSTRAINT agent_installations_process_evidence_event_fk
    FOREIGN KEY (organization_id, id, process_evidence_event_id)
    REFERENCES agent_events(organization_id, agent_id, id),
  ADD CONSTRAINT agent_installations_process_evidence_consistent
    CHECK (
      (
        process_evidence_event_id IS NULL
        AND process_evidence_sequence IS NULL
        AND process_observed_at IS NULL
        AND process_evidence_received_at IS NULL
        AND process_installation_ref IS NULL
        AND process_state_version IS NULL
        AND process_state IS NULL
        AND process_ref IS NULL
        AND process_matched_count IS NULL
        AND process_unavailable_reason IS NULL
      )
      OR
      (
        process_evidence_event_id IS NOT NULL
        AND process_evidence_sequence IS NOT NULL
        AND process_evidence_sequence > 0
        AND process_evidence_sequence <= last_event_sequence
        AND process_observed_at IS NOT NULL
        AND process_evidence_received_at IS NOT NULL
        AND process_installation_ref IS NOT NULL
        AND process_installation_ref ~ '^install_[a-z0-9]{16,64}$'
        AND process_state IS NOT NULL
        AND process_state IN ('running', 'not_running', 'ambiguous', 'unknown')
        AND last_heartbeat_at IS NOT NULL
        AND last_contact_at IS NOT NULL
        AND process_observed_at <= last_heartbeat_at
        AND process_evidence_received_at <= last_contact_at
        AND (
          (
            process_state = 'running'
            AND process_state_version IS NOT NULL
            AND process_state_version ~ '^sha256:[a-f0-9]{64}$'
            AND process_ref IS NOT NULL
            AND process_ref ~ '^process_[a-f0-9]{64}$'
            AND process_matched_count IS NOT NULL
            AND process_matched_count = 1
            AND process_unavailable_reason IS NULL
          )
          OR
          (
            process_state = 'not_running'
            AND process_state_version IS NOT NULL
            AND process_state_version ~ '^sha256:[a-f0-9]{64}$'
            AND process_ref IS NULL
            AND process_matched_count IS NOT NULL
            AND process_matched_count = 0
            AND process_unavailable_reason IS NULL
          )
          OR
          (
            process_state = 'ambiguous'
            AND process_state_version IS NOT NULL
            AND process_state_version ~ '^sha256:[a-f0-9]{64}$'
            AND process_ref IS NULL
            AND process_matched_count IS NOT NULL
            AND process_unavailable_reason IS NOT NULL
            AND (
              (process_matched_count = 1 AND process_unavailable_reason = 'TRANSITIONAL_PROCESS_STATE')
              OR
              (process_matched_count BETWEEN 2 AND 100 AND process_unavailable_reason = 'MULTIPLE_ACTIVE_PROCESSES')
            )
          )
          OR
          (
            process_state = 'unknown'
            AND process_state_version IS NULL
            AND process_ref IS NULL
            AND process_matched_count IS NULL
            AND process_unavailable_reason IS NOT NULL
            AND process_unavailable_reason IN ('OBSERVATION_FAILED', 'OBSERVATION_TIME_INVALID')
          )
        )
      )
    );

CREATE INDEX IF NOT EXISTS idx_agent_installations_process_evidence
  ON agent_installations(organization_id, process_evidence_received_at DESC)
  WHERE process_evidence_event_id IS NOT NULL;
