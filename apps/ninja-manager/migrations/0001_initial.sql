CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  kill_switch_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('staff', 'client')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  phone text,
  timezone text NOT NULL DEFAULT 'America/New_York',
  onboarding_status text NOT NULL DEFAULT 'invited' CHECK (onboarding_status IN ('invited', 'in_progress', 'complete')),
  risk_acknowledged_at timestamptz,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_accounts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider text NOT NULL,
  label text NOT NULL,
  account_identifier_masked text NOT NULL,
  account_size integer NOT NULL CHECK (account_size > 0),
  rule_profile text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'healthy', 'attention', 'paused')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS environments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  vps_provider text NOT NULL,
  vps_region text NOT NULL,
  ninja_version text NOT NULL,
  connection_status text NOT NULL DEFAULT 'unknown' CHECK (connection_status IN ('unknown', 'healthy', 'degraded', 'offline')),
  last_check_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategies (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('conservative', 'balanced', 'growth')),
  approved boolean NOT NULL DEFAULT false,
  configuration_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS strategy_configurations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  strategy_id text NOT NULL REFERENCES strategies(id),
  version integer NOT NULL,
  questionnaire jsonb NOT NULL,
  configuration jsonb NOT NULL,
  validation jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'deployment_recorded', 'rolled_back', 'rejected')),
  previous_configuration_id text REFERENCES strategy_configurations(id),
  created_by text NOT NULL REFERENCES users(id),
  approved_by text REFERENCES users(id),
  approved_at timestamptz,
  deployed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, version)
);

CREATE TABLE IF NOT EXISTS approvals (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  configuration_id text NOT NULL REFERENCES strategy_configurations(id) ON DELETE CASCADE,
  requested_by text NOT NULL REFERENCES users(id),
  reviewed_by text REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE TABLE IF NOT EXISTS health_checks (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  environment_id text REFERENCES environments(id) ON DELETE CASCADE,
  connector text NOT NULL,
  status text NOT NULL CHECK (status IN ('healthy', 'degraded', 'offline')),
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incidents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  environment_id text REFERENCES environments(id) ON DELETE SET NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved')),
  title text NOT NULL,
  description text NOT NULL,
  resolution_steps jsonb NOT NULL,
  current_step integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_clients_org ON clients(organization_id);
CREATE INDEX IF NOT EXISTS idx_accounts_client ON trading_accounts(client_id);
CREATE INDEX IF NOT EXISTS idx_configs_client ON strategy_configurations(client_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_health_client ON health_checks(client_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_client ON incidents(client_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_events(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
