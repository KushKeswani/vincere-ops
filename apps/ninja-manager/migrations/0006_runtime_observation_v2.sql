ALTER TABLE agent_events
  DROP CONSTRAINT IF EXISTS agent_events_event_type_check;

ALTER TABLE agent_events
  ADD CONSTRAINT agent_events_event_type_check
  CHECK (event_type IN ('agent.heartbeat', 'runtime.snapshot', 'runtime.observation_v2'));
