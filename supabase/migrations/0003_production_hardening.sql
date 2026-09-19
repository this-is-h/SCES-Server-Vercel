-- Production hardening migration.
-- The column is nullable for existing batches created before keyId became part
-- of the public contract; new writes require it at the application layer.
ALTER TABLE batch ADD COLUMN IF NOT EXISTS key_id TEXT;
ALTER TABLE unit ADD COLUMN IF NOT EXISTS config_template_id TEXT;

CREATE TABLE IF NOT EXISTS rate_limit_bucket (
    bucket_key TEXT NOT NULL PRIMARY KEY,
    window_start BIGINT NOT NULL,
    hit_count INTEGER NOT NULL CHECK (hit_count >= 0)
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_window_start ON rate_limit_bucket (window_start);
ALTER TABLE rate_limit_bucket ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_unit_config_template_id
    ON unit (config_template_id);

CREATE INDEX IF NOT EXISTS idx_batch_unit_key_id
    ON batch (unit_id, key_id);

-- Only one live token may exist for an installation. This closes the race where
-- two concurrent authorize requests both revoke an empty snapshot and insert a
-- token. Retain the newest live token before adding the constraint so the
-- migration remains applicable to databases created before this hardening.
WITH duplicates AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY unit_id, install_id ORDER BY created_at DESC, id DESC) AS rn
    FROM unit_token
    WHERE status = 'active'
)
UPDATE unit_token
SET status = 'revoked'
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_unit_token_active_install
    ON unit_token (unit_id, install_id) WHERE status = 'active';
