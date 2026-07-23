CREATE TABLE IF NOT EXISTS eod_snapshots (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  source_agent_event_record_id text NOT NULL,
  source_event_id text NOT NULL,
  source_sequence bigint NOT NULL CHECK (source_sequence > 0),
  source_state_digest text NOT NULL
    CHECK (source_state_digest ~ '^sha256:[a-f0-9]{64}$'),
  source_as_of timestamptz NOT NULL,
  source_occurred_at timestamptz NOT NULL,
  source_received_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL,
  intended_local_date date NOT NULL,
  time_zone text NOT NULL CHECK (time_zone = 'America/New_York'),
  completeness_overall text NOT NULL
    CHECK (completeness_overall IN ('complete', 'partial', 'unavailable')),
  idempotency_key text NOT NULL
    CHECK (
      char_length(idempotency_key) BETWEEN 16 AND 200
      AND idempotency_key ~ '^[A-Za-z0-9:._-]+$'
    ),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  created_by text NOT NULL,
  FOREIGN KEY (organization_id, agent_id)
    REFERENCES agent_installations(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, agent_id, source_agent_event_record_id)
    REFERENCES agent_events(organization_id, agent_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES users(organization_id, id),
  UNIQUE (organization_id, agent_id, id),
  UNIQUE (organization_id, idempotency_key),
  CHECK (source_as_of <= source_occurred_at),
  CHECK (source_occurred_at <= source_received_at),
  CHECK (source_received_at <= captured_at)
);

CREATE TABLE IF NOT EXISTS eod_snapshot_scopes (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  snapshot_id text NOT NULL,
  scope text NOT NULL
    CHECK (scope IN (
      'process', 'addon', 'connections', 'accounts', 'strategies',
      'positions', 'orders', 'executions', 'pnl'
    )),
  status text NOT NULL CHECK (status IN ('complete', 'partial', 'unavailable')),
  item_count integer NOT NULL CHECK (item_count BETWEEN 0 AND 1000000),
  errors jsonb NOT NULL CHECK (jsonb_typeof(errors) = 'array'),
  FOREIGN KEY (organization_id, agent_id, snapshot_id)
    REFERENCES eod_snapshots(organization_id, agent_id, id) ON DELETE CASCADE,
  UNIQUE (snapshot_id, scope),
  CHECK (
    (status = 'complete' AND jsonb_array_length(errors) = 0)
    OR (status <> 'complete' AND jsonb_array_length(errors) BETWEEN 1 AND 20)
  ),
  CHECK (status <> 'unavailable' OR item_count = 0)
);

CREATE TABLE IF NOT EXISTS eod_snapshot_accounts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  snapshot_id text NOT NULL,
  account_ordinal integer NOT NULL CHECK (account_ordinal BETWEEN 1 AND 500),
  masked_identifier text NOT NULL
    CHECK (masked_identifier ~ '^\*{4,16}[A-Za-z0-9]{2,8}$'),
  display_label text NOT NULL CHECK (char_length(display_label) BETWEEN 1 AND 80),
  classification_environment text NOT NULL
    CHECK (classification_environment IN ('simulation', 'live', 'unknown')),
  classification_authority text NOT NULL
    CHECK (classification_authority IN ('authoritative', 'unavailable')),
  classification_source text
    CHECK (
      classification_source IS NULL
      OR classification_source IN ('ninjatrader_simulation_account', 'ninjatrader_live_account')
    ),
  classification_reason text
    CHECK (
      classification_reason IS NULL
      OR classification_reason IN (
        'ADDON_OFFLINE', 'CLASSIFICATION_UNSUPPORTED',
        'CLASSIFICATION_CONFLICT', 'CLASSIFICATION_UNAVAILABLE'
      )
    ),
  pnl_observed boolean NOT NULL,
  pnl_session_date date,
  FOREIGN KEY (organization_id, agent_id, snapshot_id)
    REFERENCES eod_snapshots(organization_id, agent_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, snapshot_id, id),
  UNIQUE (snapshot_id, account_ordinal),
  CHECK (
    (
      classification_environment IN ('simulation', 'live')
      AND classification_authority = 'authoritative'
      AND classification_source IS NOT NULL
      AND classification_reason IS NULL
    )
    OR
    (
      classification_environment = 'unknown'
      AND classification_authority = 'unavailable'
      AND classification_source IS NULL
      AND classification_reason IS NOT NULL
    )
  ),
  CHECK (
    (pnl_observed = true AND pnl_session_date IS NOT NULL)
    OR (pnl_observed = false AND pnl_session_date IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS eod_snapshot_pnl_values (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_id text NOT NULL,
  snapshot_account_id text NOT NULL,
  metric text NOT NULL
    CHECK (metric IN (
      'daily_realized', 'daily_unrealized', 'daily_total',
      'native_lifetime', 'manager_observed_cumulative'
    )),
  availability text NOT NULL CHECK (availability IN ('available', 'unavailable')),
  currency text NOT NULL CHECK (currency = 'USD'),
  amount_minor bigint CHECK (amount_minor BETWEEN -100000000000 AND 100000000000),
  source text CHECK (
    source IS NULL OR source IN (
      'ninjatrader_account_item', 'ninjatrader_performance',
      'calculated_by_companion', 'manager_ledger'
    )
  ),
  observed_since timestamptz,
  reason text CHECK (
    reason IS NULL OR reason IN (
      'ADDON_OFFLINE', 'ACCOUNT_DISCONNECTED', 'SOURCE_UNSUPPORTED',
      'SOURCE_ERROR', 'NOT_OBSERVED_YET'
    )
  ),
  FOREIGN KEY (organization_id, snapshot_id, snapshot_account_id)
    REFERENCES eod_snapshot_accounts(organization_id, snapshot_id, id) ON DELETE CASCADE,
  UNIQUE (snapshot_account_id, metric),
  CHECK (
    (
      availability = 'available'
      AND amount_minor IS NOT NULL
      AND source IS NOT NULL
      AND reason IS NULL
    )
    OR
    (
      availability = 'unavailable'
      AND amount_minor IS NULL
      AND source IS NULL
      AND reason IS NOT NULL
    )
  ),
  CHECK (
    (metric = 'daily_realized' AND (availability = 'unavailable' OR source IN ('ninjatrader_account_item', 'ninjatrader_performance')))
    OR (metric = 'daily_unrealized' AND (availability = 'unavailable' OR source = 'ninjatrader_account_item'))
    OR (metric = 'daily_total' AND (availability = 'unavailable' OR source = 'calculated_by_companion'))
    OR (metric = 'native_lifetime' AND (availability = 'unavailable' OR source = 'ninjatrader_performance'))
    OR (
      metric = 'manager_observed_cumulative'
      AND (
        (availability = 'available' AND source = 'manager_ledger' AND observed_since IS NOT NULL)
        OR (availability = 'unavailable' AND observed_since IS NULL)
      )
    )
  ),
  CHECK (metric = 'manager_observed_cumulative' OR observed_since IS NULL)
);

CREATE TABLE IF NOT EXISTS eod_snapshot_strategies (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_id text NOT NULL,
  snapshot_account_id text NOT NULL,
  strategy_ordinal integer NOT NULL CHECK (strategy_ordinal BETWEEN 1 AND 10000),
  display_label text NOT NULL CHECK (char_length(display_label) BETWEEN 1 AND 80),
  strategy_type text NOT NULL CHECK (strategy_type ~ '^[A-Za-z][A-Za-z0-9_.-]{0,79}$'),
  instrument text NOT NULL CHECK (
    char_length(instrument) BETWEEN 1 AND 40
    AND instrument ~ '^[A-Z0-9][A-Z0-9 .:/_-]{0,39}$'
  ),
  enabled boolean NOT NULL,
  runtime_state text NOT NULL
    CHECK (runtime_state IN ('disabled', 'enabling', 'waiting_sync', 'running', 'disabling', 'error', 'unknown')),
  synchronization_state text NOT NULL
    CHECK (synchronization_state IN ('synchronized', 'not_synchronized', 'pending', 'not_applicable', 'unknown')),
  FOREIGN KEY (organization_id, snapshot_id, snapshot_account_id)
    REFERENCES eod_snapshot_accounts(organization_id, snapshot_id, id) ON DELETE CASCADE,
  UNIQUE (snapshot_account_id, strategy_ordinal)
);

CREATE INDEX IF NOT EXISTS idx_eod_snapshots_tenant_date
  ON eod_snapshots(organization_id, intended_local_date DESC, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_eod_snapshots_agent_date
  ON eod_snapshots(organization_id, agent_id, intended_local_date DESC, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_eod_snapshots_source
  ON eod_snapshots(organization_id, agent_id, source_sequence DESC);
CREATE INDEX IF NOT EXISTS idx_eod_snapshot_accounts_snapshot
  ON eod_snapshot_accounts(snapshot_id, account_ordinal);
CREATE INDEX IF NOT EXISTS idx_eod_snapshot_strategies_account
  ON eod_snapshot_strategies(snapshot_account_id, strategy_ordinal);
CREATE INDEX IF NOT EXISTS idx_eod_snapshot_pnl_account
  ON eod_snapshot_pnl_values(snapshot_account_id, metric);

CREATE OR REPLACE FUNCTION validate_eod_snapshot_account_pnl()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_account_id text;
  expects_pnl boolean;
  metric_count integer;
  realized_availability text;
  unrealized_availability text;
  total_availability text;
  realized_amount bigint;
  unrealized_amount bigint;
  total_amount bigint;
BEGIN
  IF TG_ARGV[0] = 'account' THEN
    target_account_id := NEW.id;
  ELSIF TG_ARGV[0] = 'value' THEN
    target_account_id := NEW.snapshot_account_id;
  ELSE
    RAISE EXCEPTION 'Unknown EOD P&L consistency trigger source';
  END IF;

  SELECT pnl_observed
  INTO expects_pnl
  FROM eod_snapshot_accounts
  WHERE id = target_account_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    COUNT(*),
    MAX(availability) FILTER (WHERE metric = 'daily_realized'),
    MAX(availability) FILTER (WHERE metric = 'daily_unrealized'),
    MAX(availability) FILTER (WHERE metric = 'daily_total'),
    MAX(amount_minor) FILTER (WHERE metric = 'daily_realized'),
    MAX(amount_minor) FILTER (WHERE metric = 'daily_unrealized'),
    MAX(amount_minor) FILTER (WHERE metric = 'daily_total')
  INTO
    metric_count,
    realized_availability,
    unrealized_availability,
    total_availability,
    realized_amount,
    unrealized_amount,
    total_amount
  FROM eod_snapshot_pnl_values
  WHERE snapshot_account_id = target_account_id;

  IF expects_pnl AND metric_count <> 5 THEN
    RAISE EXCEPTION 'Observed EOD P&L requires exactly five metric rows';
  END IF;
  IF NOT expects_pnl AND metric_count <> 0 THEN
    RAISE EXCEPTION 'Unobserved EOD P&L cannot contain metric rows';
  END IF;
  IF NOT expects_pnl THEN
    RETURN NULL;
  END IF;

  IF realized_availability = 'available' AND unrealized_availability = 'available' THEN
    IF total_availability <> 'available' OR total_amount <> realized_amount + unrealized_amount THEN
      RAISE EXCEPTION 'EOD daily total must equal available realized plus unrealized values';
    END IF;
  ELSIF total_availability <> 'unavailable' THEN
    RAISE EXCEPTION 'EOD daily total must be unavailable when either component is unavailable';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER validate_eod_snapshot_account_pnl_from_account
AFTER INSERT OR UPDATE ON eod_snapshot_accounts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_eod_snapshot_account_pnl('account');

CREATE CONSTRAINT TRIGGER validate_eod_snapshot_account_pnl_from_value
AFTER INSERT OR UPDATE ON eod_snapshot_pnl_values
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_eod_snapshot_account_pnl('value');

CREATE OR REPLACE FUNCTION reject_eod_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'EOD snapshot evidence is append-only; audited database maintenance is required';
END;
$$;

CREATE TRIGGER eod_snapshots_append_only
BEFORE UPDATE OR DELETE ON eod_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_eod_snapshot_mutation();

CREATE TRIGGER eod_snapshot_scopes_append_only
BEFORE UPDATE OR DELETE ON eod_snapshot_scopes
FOR EACH ROW EXECUTE FUNCTION reject_eod_snapshot_mutation();

CREATE TRIGGER eod_snapshot_accounts_append_only
BEFORE UPDATE OR DELETE ON eod_snapshot_accounts
FOR EACH ROW EXECUTE FUNCTION reject_eod_snapshot_mutation();

CREATE TRIGGER eod_snapshot_pnl_values_append_only
BEFORE UPDATE OR DELETE ON eod_snapshot_pnl_values
FOR EACH ROW EXECUTE FUNCTION reject_eod_snapshot_mutation();

CREATE TRIGGER eod_snapshot_strategies_append_only
BEFORE UPDATE OR DELETE ON eod_snapshot_strategies
FOR EACH ROW EXECUTE FUNCTION reject_eod_snapshot_mutation();
