BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL CHECK (char_length(btrim(name)) > 0),
  body TEXT NOT NULL,
  hotkey VARCHAR(100) NOT NULL CHECK (char_length(btrim(hotkey)) > 0),
  characters_per_second INTEGER NOT NULL DEFAULT 15
    CHECK (characters_per_second BETWEEN 1 AND 500),
  start_delay_ms INTEGER NOT NULL DEFAULT 1000
    CHECK (start_delay_ms BETWEEN 0 AND 60000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- PostgreSQL's normal UNIQUE constraint is case-sensitive; shortcuts are not.
CREATE UNIQUE INDEX IF NOT EXISTS scripts_hotkey_lower_unique
  ON scripts ((lower(hotkey)));

CREATE INDEX IF NOT EXISTS scripts_updated_at_index ON scripts (updated_at DESC);

CREATE TABLE IF NOT EXISTS execution_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id UUID REFERENCES scripts(id) ON DELETE SET NULL,
  script_name VARCHAR(120) NOT NULL,
  hotkey VARCHAR(100) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 0 AND 86400000),
  status VARCHAR(20) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'stopped', 'error'))
);

CREATE INDEX IF NOT EXISTS execution_history_started_at_index
  ON execution_history (started_at DESC);
CREATE INDEX IF NOT EXISTS execution_history_script_id_index
  ON execution_history (script_id);

CREATE OR REPLACE FUNCTION autotyper_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'scripts_set_updated_at'
      AND tgrelid = 'scripts'::regclass
  ) THEN
    CREATE TRIGGER scripts_set_updated_at
      BEFORE UPDATE ON scripts
      FOR EACH ROW
      EXECUTE FUNCTION autotyper_set_updated_at();
  END IF;
END;
$$;

COMMIT;
