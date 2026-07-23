ALTER TABLE process_control_commands
  ADD COLUMN IF NOT EXISTS queue_sequence bigint GENERATED ALWAYS AS IDENTITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_process_control_commands_queue_sequence
  ON process_control_commands(queue_sequence);

DROP INDEX IF EXISTS idx_process_control_commands_poll;

CREATE INDEX idx_process_control_commands_poll
  ON process_control_commands(agent_id, status, expires_at, queue_sequence);
