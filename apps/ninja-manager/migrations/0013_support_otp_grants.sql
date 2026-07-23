CREATE TABLE support_access_challenges (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  created_by text NOT NULL,
  deployment_mode text NOT NULL CHECK (deployment_mode IN ('CENTRAL_CONNECTED', 'LOCAL_ONLY')),
  requested_session_minutes integer NOT NULL CHECK (requested_session_minutes BETWEEN 5 AND 60),
  otp_salt text NOT NULL CHECK (otp_salt ~ '^[a-f0-9]{64}$'),
  otp_verifier text NOT NULL CHECK (otp_verifier ~ '^hmac-sha256:[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9:._-]{16,200}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (organization_id, created_by)
    REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, id, created_by),
  UNIQUE (organization_id, created_by, idempotency_key),
  CHECK (expires_at > created_at),
  CHECK (expires_at <= created_at + interval '10 minutes')
);

CREATE TABLE support_access_challenge_scopes (
  organization_id text NOT NULL,
  challenge_id text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('runtime.read', 'eod.read', 'health.read')),
  FOREIGN KEY (organization_id, challenge_id)
    REFERENCES support_access_challenges(organization_id, id) ON DELETE RESTRICT,
  PRIMARY KEY (challenge_id, scope)
);

CREATE TABLE support_access_challenge_agents (
  organization_id text NOT NULL,
  challenge_id text NOT NULL,
  agent_id text NOT NULL,
  FOREIGN KEY (organization_id, challenge_id)
    REFERENCES support_access_challenges(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, agent_id)
    REFERENCES agent_installations(organization_id, id) ON DELETE RESTRICT,
  PRIMARY KEY (challenge_id, agent_id),
  UNIQUE (organization_id, challenge_id, agent_id)
);

CREATE TABLE support_access_challenge_accounts (
  organization_id text NOT NULL,
  challenge_id text NOT NULL,
  agent_id text NOT NULL,
  account_ref_hash text NOT NULL CHECK (account_ref_hash ~ '^hmac-sha256:[a-f0-9]{64}$'),
  FOREIGN KEY (organization_id, challenge_id, agent_id)
    REFERENCES support_access_challenge_agents(organization_id, challenge_id, agent_id) ON DELETE RESTRICT,
  PRIMARY KEY (challenge_id, agent_id, account_ref_hash)
);

CREATE TABLE support_access_attempts (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  challenge_id text NOT NULL,
  staff_user_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('invalid', 'accepted')),
  failed_attempt_number integer CHECK (failed_attempt_number BETWEEN 1 AND 5),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (organization_id, challenge_id)
    REFERENCES support_access_challenges(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, staff_user_id)
    REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (challenge_id, failed_attempt_number),
  CHECK (
    (outcome = 'invalid' AND failed_attempt_number IS NOT NULL)
    OR (outcome = 'accepted' AND failed_attempt_number IS NULL)
  )
);

CREATE TABLE support_access_redemptions (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  challenge_id text NOT NULL,
  staff_user_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9:._-]{16,200}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  redeemed_at timestamptz NOT NULL,
  FOREIGN KEY (organization_id, challenge_id)
    REFERENCES support_access_challenges(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, staff_user_id)
    REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, id, challenge_id),
  UNIQUE (organization_id, id, challenge_id, staff_user_id),
  UNIQUE (challenge_id),
  UNIQUE (organization_id, staff_user_id, idempotency_key)
);

CREATE TABLE support_access_sessions (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  challenge_id text NOT NULL,
  redemption_id text NOT NULL,
  staff_user_id text NOT NULL,
  client_user_id text NOT NULL,
  bearer_hash text NOT NULL UNIQUE CHECK (bearer_hash ~ '^hmac-sha256:[a-f0-9]{64}$'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (organization_id, challenge_id)
    REFERENCES support_access_challenges(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, challenge_id, client_user_id)
    REFERENCES support_access_challenges(organization_id, id, created_by) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, redemption_id)
    REFERENCES support_access_redemptions(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, redemption_id, challenge_id)
    REFERENCES support_access_redemptions(organization_id, id, challenge_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, redemption_id, challenge_id, staff_user_id)
    REFERENCES support_access_redemptions(organization_id, id, challenge_id, staff_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, staff_user_id)
    REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, client_user_id)
    REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, id, staff_user_id),
  UNIQUE (organization_id, id, client_user_id),
  UNIQUE (challenge_id),
  UNIQUE (redemption_id),
  CHECK (expires_at > issued_at),
  CHECK (expires_at <= issued_at + interval '60 minutes')
);

CREATE TABLE support_access_session_scopes (
  organization_id text NOT NULL,
  session_id text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('runtime.read', 'eod.read', 'health.read')),
  FOREIGN KEY (organization_id, session_id)
    REFERENCES support_access_sessions(organization_id, id) ON DELETE RESTRICT,
  PRIMARY KEY (session_id, scope),
  UNIQUE (organization_id, session_id, scope)
);

CREATE TABLE support_access_session_agents (
  organization_id text NOT NULL,
  session_id text NOT NULL,
  agent_id text NOT NULL,
  FOREIGN KEY (organization_id, session_id)
    REFERENCES support_access_sessions(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, agent_id)
    REFERENCES agent_installations(organization_id, id) ON DELETE RESTRICT,
  PRIMARY KEY (session_id, agent_id),
  UNIQUE (organization_id, session_id, agent_id)
);

CREATE TABLE support_access_session_accounts (
  organization_id text NOT NULL,
  session_id text NOT NULL,
  agent_id text NOT NULL,
  account_ref_hash text NOT NULL CHECK (account_ref_hash ~ '^hmac-sha256:[a-f0-9]{64}$'),
  FOREIGN KEY (organization_id, session_id, agent_id)
    REFERENCES support_access_session_agents(organization_id, session_id, agent_id) ON DELETE RESTRICT,
  PRIMARY KEY (session_id, agent_id, account_ref_hash),
  UNIQUE (organization_id, session_id, agent_id, account_ref_hash)
);

CREATE TABLE support_access_revocations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  created_by text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('challenge', 'session', 'tenant_sessions')),
  challenge_id text,
  session_id text,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9:._-]{16,200}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  revoked_at timestamptz NOT NULL,
  FOREIGN KEY (organization_id, created_by)
    REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, challenge_id)
    REFERENCES support_access_challenges(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, challenge_id, created_by)
    REFERENCES support_access_challenges(organization_id, id, created_by) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, session_id)
    REFERENCES support_access_sessions(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, session_id, created_by)
    REFERENCES support_access_sessions(organization_id, id, client_user_id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, created_by, idempotency_key),
  CHECK (
    (target_type = 'challenge' AND challenge_id IS NOT NULL AND session_id IS NULL)
    OR (target_type = 'session' AND challenge_id IS NULL AND session_id IS NOT NULL)
    OR (target_type = 'tenant_sessions' AND challenge_id IS NULL AND session_id IS NULL)
  )
);

CREATE TABLE support_access_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  session_id text NOT NULL,
  staff_user_id text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('runtime.read', 'eod.read', 'health.read')),
  agent_id text NOT NULL,
  account_ref_hash text CHECK (account_ref_hash IS NULL OR account_ref_hash ~ '^hmac-sha256:[a-f0-9]{64}$'),
  accessed_at timestamptz NOT NULL,
  FOREIGN KEY (organization_id, session_id)
    REFERENCES support_access_sessions(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, session_id, staff_user_id)
    REFERENCES support_access_sessions(organization_id, id, staff_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, staff_user_id)
    REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, agent_id)
    REFERENCES agent_installations(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, session_id, scope)
    REFERENCES support_access_session_scopes(organization_id, session_id, scope) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, session_id, agent_id)
    REFERENCES support_access_session_agents(organization_id, session_id, agent_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, session_id, agent_id, account_ref_hash)
    REFERENCES support_access_session_accounts(organization_id, session_id, agent_id, account_ref_hash) ON DELETE RESTRICT
);

CREATE INDEX idx_support_challenges_rate
  ON support_access_challenges(organization_id, created_by, created_at DESC);
CREATE INDEX idx_support_attempts_challenge
  ON support_access_attempts(challenge_id, outcome, occurred_at);
CREATE UNIQUE INDEX idx_support_attempts_one_accepted
  ON support_access_attempts(challenge_id)
  WHERE outcome = 'accepted';
CREATE INDEX idx_support_attempts_staff_rate
  ON support_access_attempts(organization_id, staff_user_id, occurred_at DESC)
  WHERE outcome = 'invalid';
CREATE INDEX idx_support_sessions_active
  ON support_access_sessions(organization_id, staff_user_id, expires_at);
CREATE INDEX idx_support_revocations_lookup
  ON support_access_revocations(organization_id, target_type, revoked_at DESC);
CREATE INDEX idx_support_events_session
  ON support_access_events(session_id, accessed_at DESC);

CREATE OR REPLACE FUNCTION reject_support_access_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'support access evidence is append-only';
END;
$$;

CREATE TRIGGER support_access_challenges_append_only
  BEFORE UPDATE OR DELETE ON support_access_challenges
  FOR EACH ROW EXECUTE FUNCTION reject_support_access_evidence_mutation();
CREATE TRIGGER support_access_challenge_scopes_append_only
  BEFORE UPDATE OR DELETE ON support_access_challenge_scopes
  FOR EACH ROW EXECUTE FUNCTION reject_support_access_evidence_mutation();
CREATE TRIGGER support_access_challenge_agents_append_only
  BEFORE UPDATE OR DELETE ON support_access_challenge_agents
  FOR EACH ROW EXECUTE FUNCTION reject_support_access_evidence_mutation();
CREATE TRIGGER support_access_challenge_accounts_append_only
  BEFORE UPDATE OR DELETE ON support_access_challenge_accounts
  FOR EACH ROW EXECUTE FUNCTION reject_support_access_evidence_mutation();
CREATE TRIGGER support_access_attempts_append_only
  BEFORE UPDATE OR DELETE ON support_access_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_support_access_evidence_mutation();
CREATE TRIGGER support_access_redemptions_append_only
  BEFORE UPDATE OR DELETE ON support_access_redemptions
  FOR EACH ROW EXECUTE FUNCTION reject_support_access_evidence_mutation();
CREATE TRIGGER support_access_sessions_append_only
  BEFORE UPDATE OR DELETE ON support_access_sessions
  FOR EACH ROW EXECUTE FUNCTION reject_support_access_evidence_mutation();
CREATE TRIGGER support_access_session_scopes_append_only
  BEFORE UPDATE OR DELETE ON support_access_session_scopes
  FOR EACH ROW EXECUTE FUNCTION reject_support_access_evidence_mutation();
CREATE TRIGGER support_access_session_agents_append_only
  BEFORE UPDATE OR DELETE ON support_access_session_agents
  FOR EACH ROW EXECUTE FUNCTION reject_support_access_evidence_mutation();
CREATE TRIGGER support_access_session_accounts_append_only
  BEFORE UPDATE OR DELETE ON support_access_session_accounts
  FOR EACH ROW EXECUTE FUNCTION reject_support_access_evidence_mutation();
CREATE TRIGGER support_access_revocations_append_only
  BEFORE UPDATE OR DELETE ON support_access_revocations
  FOR EACH ROW EXECUTE FUNCTION reject_support_access_evidence_mutation();
CREATE TRIGGER support_access_events_append_only
  BEFORE UPDATE OR DELETE ON support_access_events
  FOR EACH ROW EXECUTE FUNCTION reject_support_access_evidence_mutation();
