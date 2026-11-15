// Tests for the design-token system (DESIGN-1) — recipe-card parity
// (Phase 2 Wave W7, rewritten from scratch with the card).
//
// pi-family-hub's dashboard/design-tokens.json is the source of truth
// for the whole hub, and the recipe card inlines the values it
// consumes into its own shadow CSS (shadow DOM cannot @import the
// stylesheet at runtime). This repo is a standalone HACS repo, so it
// cannot read pi-family-hub's copy at test time: design-tokens.json
// in THIS repo is a vendored copy of
// pi-family-hub dashboard/design-tokens.json at
// main (6111fe5), md5 c6e0e8b285bf099e31b1c85c33c8e125.
// It must be refreshed when pi-family-hub's tokens change; the
// skipped list below pins the token set, so a token added upstream
// fails this test until it is classified here.
//
// The home agent's installer/dashboard/design-tokens.test.cjs covers
// home/nav-strip/photos (Part B) and the JSON <-> CSS parity (Part
// A); this file is the recipe card's Part B. The expected value always
// comes from the JSON (tokens.<group>.<key>.value) — never a literal
// in the test — so the JSON is the source of truth and the test fails
// when the card drifts from it.
//
// Single scale (D-W7-09): after the Nov 11 ruling the card has no
// device detection and no per-device layout, so it consumes ONE
// value per token family — the desktop/tablet value for type, the
// mobile value for spacing, the 48px phone minimum for targets.
// The per-device variants are skipped as a decision below, not an
// oversight.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

// The card needs a DOM to load (HTMLElement/customElements), so stub
// the browser globals just enough for the module to define itself —
// the same harness the card tests use.
globalThis.HTMLElement = class {
  attachShadow() {
    return { addEventListener: () => {} };
  }
};
globalThis.customElements = { define: () => {} };

const { CARD_CSS: RECIPE_CSS } = require("./anylist-recipe-view-card.js");

const TOKENS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "design-tokens.json"), "utf8")
);

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// -- Part B: the recipe card inlines the tokens it consumes ----------
// Each entry names the token and how to find the inlined value in the
// card's CSS. The expected value always comes from the JSON — never a
// literal in the test — so the JSON is the source of truth.
function tokenValue(group, key) {
  const token = TOKENS[group] && TOKENS[group][key];
  assert.ok(token && token.value !== undefined, `unknown token ${group}.${key}`);
  return String(token.value);
}
function has(css, pattern, label) {
  if (typeof pattern === "string") assert.ok(css.includes(pattern), label);
  else assert.match(css, pattern, label);
}

const RECIPE = [
  // Palette: the values are inlined as literals in the card's CSS.
  ["palette", "color-screen-bg", (v) => new RegExp(`\\.recipes \\{[^}]*background: ${esc(v)};`)],
  ["palette", "color-ink", (v) => new RegExp(`\\.recipes \\{[^}]*color: ${esc(v)};`)],
  ["palette", "color-accent", (v) => new RegExp(`\\.chip\\[aria-pressed="true"\\] \\{[^}]*background: ${esc(v)};`)],
  ["palette", "color-muted", (v) => new RegExp(`\\.age \\{[^}]*color: ${esc(v)};`)],
  ["palette", "color-card", (v) => new RegExp(`\\.row \\{[^}]*background: ${esc(v)};`)],
  ["palette", "color-line", (v) => new RegExp(`\\.band-title \\{[^}]*border-bottom: 1px solid ${esc(v)};`)],
  ["palette", "color-chip-bg", (v) => new RegExp(`\\.chip \\{[^}]*background: ${esc(v)};`)],
  ["palette", "color-star", (v) => `.stars button.on { color: ${v}; }`],
  ["palette", "color-error", (v) => new RegExp(`\\.error-slot \\.msg \\{[^}]*color: ${esc(v)};`)],
  ["palette", "color-success", (v) => `.notes .status.saved { color: ${v}; }`],
  ["palette", "color-on-accent", (v) => new RegExp(`\\.chip\\[aria-pressed="true"\\] \\{[^}]*color: ${esc(v)};`)],
  // On-chip text is ink: the chip rule sets color to the ink value,
  // which equals the on-chip token.
  ["palette", "color-on-chip", (v) => new RegExp(`\\.chip \\{[^}]*color: ${esc(v)};`)],
  // Elevation: the tracker carries the tab shadow; the detail photo
  // carries the card shadow.
  ["elevation", "shadow-card", (v) => new RegExp(`\\.detail \\.photo \\{[^}]*box-shadow: ${esc(v)};`)],
  ["elevation", "shadow-tab", (v) => new RegExp(`\\.tracker \\{[^}]*box-shadow: ${esc(v)};`)],
  // Type: one scale — the desktop value (D-W7-09).
  ["type", "font-family", (v) => `font-family: ${v};`],
  ["type", "line-height-body", (v) => new RegExp(`\\.recipes \\{[^}]*line-height: ${esc(v)};`)],
  ["type", "font-body-desktop", (v) => new RegExp(`\\.recipes \\{[^}]*font-size: ${esc(v)};`)],
  ["type", "font-chip-desktop", (v) => new RegExp(`\\.chip \\{[^}]*font-size: ${esc(v)};`)],
  ["type", "font-meta", (v) => `.row .meta { font-size: ${v};`],
  ["type", "font-section-title-desktop", (v) => new RegExp(`\\.detail h2 \\{[^}]*font-size: ${esc(v)};`)],
  // Spacing: the mobile pad is the single horizontal pad (D-W7-09);
  // the section gap separates the steps.
  ["spacing", "spacing-screen-pad-mobile", (v) => `.band { padding: 8px ${v}; }`],
  ["spacing", "spacing-section-gap", (v) => new RegExp(`\\.steps \\{[^}]*gap: ${esc(v)};`)],
  // Radius.
  ["radius", "radius-chip", (v) => new RegExp(`\\.chip \\{[^}]*border-radius: ${esc(v)};`)],
  ["radius", "radius-input", (v) => new RegExp(`\\.band-search input \\{[^}]*border-radius: ${esc(v)};`)],
  ["radius", "radius-row", (v) => new RegExp(`\\.tracker button \\{[^}]*border-radius: ${esc(v)};`)],
  ["radius", "radius-section", (v) => new RegExp(`\\.detail \\.photo \\{[^}]*border-radius: ${esc(v)};`)],
  // Targets: one value — the 48px phone minimum — everywhere (D-W7-09).
  ["targets", "target-chip-mobile", (v) => new RegExp(`\\.chip \\{[^}]*min-height: ${esc(v)};`)],
  ["targets", "target-time-chip-phone-min", (v) => new RegExp(`\\.time-chip \\{[^}]*min-height: ${esc(v)};`)],
  ["targets", "target-phone-min", (v) => new RegExp(`\\.tracker button \\{[^}]*min-height: ${esc(v)};`)],
  ["targets", "target-desktop-min", (v) => new RegExp(`\\.band-search input \\{[^}]*height: ${esc(v)};`)],
  ["targets", "target-hub-min", (v) => new RegExp(`\\.row \\{[^}]*min-height: ${esc(v)};`)],
];

test("DESIGN-1 Part B: the recipe card inlines the tokens it consumes", () => {
  for (const [group, key, needle] of RECIPE) {
    const value = tokenValue(group, key);
    has(RECIPE_CSS, needle(value), `recipe card must inline ${group}.${key} = ${value}`);
  }
});

// Nov 11 ruling guard: no device classes and no exact-size checks
// anywhere in the card — the layout is one column at every viewport.
test("DESIGN-1 Part B: no device classes or exact-size checks in the card", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "anylist-recipe-view-card.js"),
    "utf8",
  );
  for (const forbidden of ["dev-mobile", "dev-tablet", "dev-desktop", "dev-hub", "1920", "1200"]) {
    assert.ok(!source.includes(forbidden), `card must not contain ${forbidden}`);
  }
  assert.doesNotMatch(source, /@media/);
});

// Tokens Part B deliberately does NOT assert, with the reason — so a
// skip is a decision, not an oversight. Home/timer-owned tokens
// belong to those cards' tests; the rest are not rendered as
// declarations by this card (scale steps, range caps, descriptive
// motion values), or are per-device variants of a token the single
// scale already consumes (D-W7-09).
test("DESIGN-1 Part B: the skipped-token list is explicit and complete", () => {
  const asserted = new Set(RECIPE.map(([g, k]) => `${g}.${k}`));
  const all = [];
  for (const [group, tokens] of Object.entries(TOKENS)) {
    if (group === "meta" || group === "open_questions" || group === "decided_questions") continue;
    for (const [key, token] of Object.entries(tokens)) {
      if (!token || typeof token !== "object" || token.value === undefined) continue;
      if (typeof token.value !== "string" && typeof token.value !== "number") continue;
      if (group === "motion" && key === "rules") continue; // prose; see below
      all.push(`${group}.${key}`);
    }
  }
  const skipped = all.filter((t) => !asserted.has(t));
  assert.deepEqual(skipped.sort(), [
    "elevation.shadow-accent", // no accent-shadow surface in this card
    "elevation.shadow-lift", // no lifted surface in this card
    "icon.icon-desktop", // no SVG search icon; the search field is a plain input
    "icon.icon-hub",
    "icon.icon-phone",
    "icon.icon-tablet",
    "motion.motion-cancel-arm-pulse", // timer card
    "motion.motion-screensaver-enter", // descriptive value; no screensaver in this card
    "motion.motion-screensaver-exit", // descriptive value; no screensaver in this card
    "motion.motion-soon-pulse", // timer card
    "palette.color-danger", // timer card (semantic alias of error)
    "palette.color-on-error", // no white-on-error fill; errors are text-only
    "palette.color-on-paper", // no paper surface in this card
    "palette.color-on-success", // no white-on-success fill; success is text-only
    "palette.color-on-warning", // timer card
    "palette.color-paper", // no paper surface in this card
    "palette.color-paper-line", // no paper surface in this card
    "palette.color-scrim", // no scrim in this card
    "palette.color-timer-finished", // timer card
    "palette.color-timer-running", // timer card
    "palette.color-timer-soon", // timer card
    "palette.color-timer-track", // timer card
    "palette.color-warning", // timer card (semantic alias of soon/finished)
    "palette.state-paused-opacity", // timer card
    "radius.radius-dial", // timer card (circles)
    "spacing.space-1", // scale steps; actual use is asserted via the named spacing tokens
    "spacing.space-2",
    "spacing.space-3",
    "spacing.space-4",
    "spacing.space-5",
    "spacing.space-6",
    "spacing.space-7",
    "spacing.spacing-inner-gap", // no named inner-gap declaration
    "spacing.spacing-row-gap", // no named row-gap declaration
    "spacing.spacing-screen-pad-x", // single scale uses the mobile pad (D-W7-09)
    "spacing.spacing-screen-pad-y", // single scale uses the mobile pad (D-W7-09)
    "spacing.spacing-section-pad", // no section-padding declaration in this card
    "spacing.spacing-section-pad-mobile", // no section-padding declaration in this card
    "state.state-active-bg", // var(--hub-...) refs; this card inlines tokens, not var(--hub-*)
    "state.state-active-fg",
    "state.state-error",
    "state.state-finished",
    "state.state-offline",
    "state.state-paused",
    "state.state-running",
    "state.state-soon",
    "targets.target-chip-desktop", // single scale uses the 48px phone minimum (D-W7-09)
    "targets.target-chip-hub", // single scale uses the 48px phone minimum (D-W7-09)
    "targets.target-desktop-max", // range cap; no declaration caps targets at 48px
    "targets.target-dial-min-hub", // timer card
    "targets.target-hub-max", // range cap; no 80px declaration in this card
    "targets.target-note-delete-min", // no note-delete control in this card
    "targets.target-phone-max", // range cap; no declaration caps phone targets at 56px
    "targets.target-tablet-max", // range cap; no 64px tablet declaration
    "targets.target-tablet-min", // single scale uses the 48px phone minimum (D-W7-09)
    "targets.target-time-chip-hub-min", // single scale uses the 48px phone minimum (D-W7-09)
    "type.font-body-hub", // single scale uses the desktop value (D-W7-09)
    "type.font-body-mobile", // single scale uses the desktop value (D-W7-09)
    "type.font-body-tablet", // single scale uses the desktop value (D-W7-09)
    "type.font-chip-hub", // single scale uses the desktop value (D-W7-09)
    "type.font-chip-mobile", // single scale uses the desktop value (D-W7-09)
    "type.font-clock-desktop", // home card
    "type.font-clock-hub",
    "type.font-clock-mobile",
    "type.font-clock-tablet",
    "type.font-date-desktop", // home card
    "type.font-date-hub",
    "type.font-date-mobile",
    "type.font-date-tablet",
    "type.font-dial-hint-hub", // timer card
    "type.font-dial-name-hub",
    "type.font-dial-state-hub",
    "type.font-dial-time-hub",
    "type.font-section-title-hub", // single scale uses the desktop value (D-W7-09)
    "type.font-section-title-mobile", // single scale uses the desktop value (D-W7-09)
    "type.font-section-title-tablet", // single scale uses the desktop value (D-W7-09)
    "type.font-timer-detail-desktop", // timer card
    "type.font-timer-detail-hub",
    "type.font-timer-detail-mobile",
    "type.font-timer-detail-tablet",
    "type.font-timer-name-desktop", // timer card
    "type.font-timer-name-hub",
    "type.font-timer-name-mobile",
    "type.font-timer-name-tablet",
    "type.line-height-clock", // home card
    "type.line-height-timer-name", // timer card
  ]);
});
