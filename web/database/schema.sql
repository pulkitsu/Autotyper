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

-- Macros are intentionally separate from legacy one-text scripts. A macro is
-- a portable ordered action document; the client simulation/desktop runner is
-- responsible for executing it, while PostgreSQL owns durable library data.
CREATE TABLE IF NOT EXISTS macros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL CHECK (char_length(btrim(name)) > 0),
  hotkey VARCHAR(100) NOT NULL CHECK (char_length(btrim(hotkey)) > 0),
  folder VARCHAR(120),
  tags JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
  steps JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(steps) = 'array'),
  characters_per_second INTEGER NOT NULL DEFAULT 15
    CHECK (characters_per_second BETWEEN 1 AND 500),
  start_delay_ms INTEGER NOT NULL DEFAULT 1000
    CHECK (start_delay_ms BETWEEN 0 AND 60000),
  click_interval_ms INTEGER NOT NULL DEFAULT 100
    CHECK (click_interval_ms BETWEEN 0 AND 60000),
  repeat_config JSONB NOT NULL DEFAULT '{"mode":"count","count":1}'::jsonb
    CHECK (jsonb_typeof(repeat_config) = 'object'),
  boundary JSONB CHECK (boundary IS NULL OR jsonb_typeof(boundary) = 'object'),
  focus_trigger JSONB CHECK (focus_trigger IS NULL OR jsonb_typeof(focus_trigger) = 'object'),
  mail_merge JSONB CHECK (mail_merge IS NULL OR jsonb_typeof(mail_merge) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS macros_hotkey_lower_unique
  ON macros ((lower(hotkey)));
CREATE INDEX IF NOT EXISTS macros_updated_at_index ON macros (updated_at DESC);
CREATE INDEX IF NOT EXISTS macros_folder_index ON macros (folder);

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

CREATE TABLE IF NOT EXISTS macro_execution_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  macro_id UUID REFERENCES macros(id) ON DELETE SET NULL,
  macro_name VARCHAR(120) NOT NULL,
  hotkey VARCHAR(100) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 0 AND 86400000),
  status VARCHAR(20) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'stopped', 'error', 'rate_limited')),
  steps_completed INTEGER NOT NULL DEFAULT 0 CHECK (steps_completed BETWEEN 0 AND 1000000),
  time_saved_ms INTEGER NOT NULL DEFAULT 0 CHECK (time_saved_ms BETWEEN 0 AND 86400000),
  error_message VARCHAR(500)
);

CREATE INDEX IF NOT EXISTS macro_execution_history_started_at_index
  ON macro_execution_history (started_at DESC);
CREATE INDEX IF NOT EXISTS macro_execution_history_macro_id_index
  ON macro_execution_history (macro_id);

CREATE TABLE IF NOT EXISTS macro_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  macro_id UUID NOT NULL REFERENCES macros(id) ON DELETE CASCADE,
  schedule_type VARCHAR(20) NOT NULL CHECK (schedule_type IN ('once', 'interval')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  run_at TIMESTAMPTZ,
  starts_at TIMESTAMPTZ,
  interval_ms INTEGER CHECK (interval_ms BETWEEN 1000 AND 2592000000),
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (schedule_type = 'once' AND run_at IS NOT NULL AND starts_at IS NULL AND interval_ms IS NULL)
    OR
    (schedule_type = 'interval' AND run_at IS NULL AND starts_at IS NOT NULL AND interval_ms IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS macro_schedules_macro_id_index ON macro_schedules (macro_id);
CREATE INDEX IF NOT EXISTS macro_schedules_next_run_at_index ON macro_schedules (next_run_at)
  WHERE enabled;

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
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'macros_set_updated_at'
      AND tgrelid = 'macros'::regclass
  ) THEN
    CREATE TRIGGER macros_set_updated_at
      BEFORE UPDATE ON macros
      FOR EACH ROW
      EXECUTE FUNCTION autotyper_set_updated_at();
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'macro_schedules_set_updated_at'
      AND tgrelid = 'macro_schedules'::regclass
  ) THEN
    CREATE TRIGGER macro_schedules_set_updated_at
      BEFORE UPDATE ON macro_schedules
      FOR EACH ROW
      EXECUTE FUNCTION autotyper_set_updated_at();
  END IF;
END;
$$;

COMMIT;
