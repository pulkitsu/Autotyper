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
