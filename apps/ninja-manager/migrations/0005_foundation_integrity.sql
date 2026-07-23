ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS actor_subject_id text;

-- Evidence produced before this canonical schema did not attest its occurrence
-- time and immutable actor subject. Preserve it as history, but never label it
-- as verified evidence.
UPDATE audit_events
SET
  actor_subject_id = COALESCE(actor_subject_id, 'legacy:' || COALESCE(actor_user_id, 'unknown')),
  legacy_unverified = true,
  evidence_hash = NULL;

ALTER TABLE audit_events
  ALTER COLUMN actor_subject_id SET NOT NULL,
  ADD CONSTRAINT audit_events_actor_subject_present
    CHECK (char_length(actor_subject_id) BETWEEN 3 AND 240),
  ADD CONSTRAINT audit_events_evidence_state_consistent
    CHECK (
      (legacy_unverified = true AND evidence_hash IS NULL)
      OR (legacy_unverified = false AND evidence_hash IS NOT NULL)
    );

ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS actor_subject_id text,
  ADD COLUMN IF NOT EXISTS request_hash text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

UPDATE idempotency_keys
SET actor_subject_id = COALESCE(actor_subject_id, 'legacy:unknown')
WHERE actor_subject_id IS NULL;

ALTER TABLE idempotency_keys
  ALTER COLUMN actor_subject_id SET NOT NULL,
  ADD CONSTRAINT idempotency_keys_actor_subject_present
    CHECK (char_length(actor_subject_id) BETWEEN 3 AND 240),
  ADD CONSTRAINT idempotency_keys_request_hash_format
    CHECK (request_hash IS NULL OR request_hash ~ '^sha256:[a-f0-9]{64}$');
