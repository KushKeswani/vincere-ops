CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_credentials_org_agent_id
  ON agent_credentials(organization_id, agent_id, id);

ALTER TABLE agent_events
  ADD CONSTRAINT agent_events_credential_provenance_fk
  FOREIGN KEY (organization_id, agent_id, credential_id)
  REFERENCES agent_credentials(organization_id, agent_id, id)
  ON DELETE RESTRICT;
