-- Safe to re-run: each example is identified by its case-insensitive hotkey.
INSERT INTO scripts (name, body, hotkey, characters_per_second, start_delay_ms)
SELECT
  'Professional email signature',
  'Kind regards,{Enter}Pulkit Sulekh{Enter}Software Engineer',
  'ctrl+alt+1',
  24,
  500
WHERE NOT EXISTS (
  SELECT 1 FROM scripts WHERE lower(hotkey) = 'ctrl+alt+1'
);

INSERT INTO scripts (name, body, hotkey, characters_per_second, start_delay_ms)
SELECT
  'Contact form details',
  'Pulkit Sulekh{Tab}pulkit@example.com{Tab}Interested in learning more about your product.{Tab}',
  'ctrl+alt+2',
  18,
  750
WHERE NOT EXISTS (
  SELECT 1 FROM scripts WHERE lower(hotkey) = 'ctrl+alt+2'
);

INSERT INTO scripts (name, body, hotkey, characters_per_second, start_delay_ms)
SELECT
  'Friendly greeting',
  'Hello! Hope you are having a great day. {Enter}',
  'ctrl+alt+3',
  28,
  0
WHERE NOT EXISTS (
  SELECT 1 FROM scripts WHERE lower(hotkey) = 'ctrl+alt+3'
);

-- The macro screen is the primary local UI. Seed the equivalent ordered
-- examples so a fresh PostgreSQL-backed install has an immediately usable
-- library as well as the legacy one-text scripts above.
INSERT INTO macros (
  name, hotkey, folder, tags, steps, characters_per_second, start_delay_ms,
  click_interval_ms, repeat_config, boundary
)
SELECT
  'Professional email signature',
  'ctrl+alt+1',
  'Communication',
  '["email", "signature"]'::jsonb,
  '[{"id":"signature-text","type":"typeText","text":"Kind regards,{Enter}Pulkit Sulekh{Enter}Software Engineer"}]'::jsonb,
  24,
  500,
  120,
  '{"mode":"count","count":1}'::jsonb,
  '{"x":0,"y":0,"width":760,"height":270}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM macros WHERE lower(hotkey) = 'ctrl+alt+1'
);

INSERT INTO macros (
  name, hotkey, folder, tags, steps, characters_per_second, start_delay_ms,
  click_interval_ms, repeat_config, boundary
)
SELECT
  'Contact form details',
  'ctrl+alt+2',
  'Forms',
  '["form", "customer"]'::jsonb,
  '[{"id":"contact-text","type":"typeText","text":"Pulkit Sulekh{Tab}pulkit@example.com{Tab}Interested in learning more about your product.{Tab}"},{"id":"form-wait","type":"wait","durationMs":250}]'::jsonb,
  18,
  750,
  120,
  '{"mode":"count","count":1}'::jsonb,
  '{"x":0,"y":0,"width":760,"height":270}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM macros WHERE lower(hotkey) = 'ctrl+alt+2'
);

INSERT INTO macros (
  name, hotkey, folder, tags, steps, characters_per_second, start_delay_ms,
  click_interval_ms, repeat_config, boundary
)
SELECT
  'Daily check-in',
  'ctrl+alt+3',
  'Daily',
  '["greeting", "template"]'::jsonb,
  '[{"id":"checkin-text","type":"typeText","text":"Good morning — {date}{Enter}"},{"id":"checkin-move","type":"move","x":120,"y":80,"durationMs":180},{"id":"checkin-click","type":"click","x":120,"y":80,"button":"left","clickType":"single","intervalMs":120}]'::jsonb,
  28,
  0,
  120,
  '{"mode":"count","count":1}'::jsonb,
  '{"x":0,"y":0,"width":760,"height":270}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM macros WHERE lower(hotkey) = 'ctrl+alt+3'
);
