export const DEFAULT_SCRIPTS = [
  {
    name: "Professional email signature",
    body: "Kind regards,{Enter}Pulkit Sulekh{Enter}Software Engineer",
    hotkey: "ctrl+alt+1",
    charactersPerSecond: 24,
    startDelayMs: 500,
  },
  {
    name: "Contact form details",
    body: "Pulkit Sulekh{Tab}pulkit@example.com{Tab}Interested in learning more about your product.{Tab}",
    hotkey: "ctrl+alt+2",
    charactersPerSecond: 18,
    startDelayMs: 750,
  },
  {
    name: "Friendly greeting",
    body: "Hello! Hope you are having a great day. {Enter}",
    hotkey: "ctrl+alt+3",
    charactersPerSecond: 28,
    startDelayMs: 0,
  },
];

// The macro workspace is the current primary UI. Keep a few realistic,
// harmless examples available on a brand-new local install so it is useful
// before someone has recorded their first automation.
export const DEFAULT_MACROS = [
  {
    name: "Professional email signature",
    hotkey: "ctrl+alt+1",
    folder: "Communication",
    tags: ["email", "signature"],
    steps: [
      { id: "signature-text", type: "typeText", text: "Kind regards,{Enter}Pulkit Sulekh{Enter}Software Engineer" },
    ],
    charactersPerSecond: 24,
    startDelayMs: 500,
    clickIntervalMs: 120,
    repeat: { mode: "count", count: 1 },
    boundary: { x: 0, y: 0, width: 760, height: 270 },
    focusTrigger: null,
    mailMerge: null,
  },
  {
    name: "Contact form details",
    hotkey: "ctrl+alt+2",
    folder: "Forms",
    tags: ["form", "customer"],
    steps: [
      { id: "contact-text", type: "typeText", text: "Pulkit Sulekh{Tab}pulkit@example.com{Tab}Interested in learning more about your product.{Tab}" },
      { id: "form-wait", type: "wait", durationMs: 250 },
    ],
    charactersPerSecond: 18,
    startDelayMs: 750,
    clickIntervalMs: 120,
    repeat: { mode: "count", count: 1 },
    boundary: { x: 0, y: 0, width: 760, height: 270 },
    focusTrigger: null,
    mailMerge: null,
  },
  {
    name: "Daily check-in",
    hotkey: "ctrl+alt+3",
    folder: "Daily",
    tags: ["greeting", "template"],
    steps: [
      { id: "checkin-text", type: "typeText", text: "Good morning — {date}{Enter}" },
      { id: "checkin-move", type: "move", x: 120, y: 80, durationMs: 180 },
      { id: "checkin-click", type: "click", x: 120, y: 80, button: "left", clickType: "single", intervalMs: 120 },
    ],
    charactersPerSecond: 28,
    startDelayMs: 0,
    clickIntervalMs: 120,
    repeat: { mode: "count", count: 1 },
    boundary: { x: 0, y: 0, width: 760, height: 270 },
    focusTrigger: null,
    mailMerge: null,
  },
];
