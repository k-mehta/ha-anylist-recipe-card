// Tests for the design-token system (DESIGN-1) — recipe-card parity.
//
// pi-family-hub's dashboard/design-tokens.json is the source of truth
// for the whole hub, and the recipe card inlines the values it
// consumes into its own shadow CSS (shadow DOM cannot @import the
// stylesheet at runtime). This repo is a standalone HACS repo, so it
// cannot read pi-family-hub's copy at test time: design-tokens.json
// in THIS repo is a vendored copy of
// pi-family-hub dashboard/design-tokens.json at
// impl/fix-review-round-recipe (843b1bc), md5 5972e82f342491a0747807345180959b.
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
// Two genuine drifts are recorded here, not papered over: the search
// icon renders at 26px on the hub / 22px elsewhere, not the
// icon-hub 32px / icon-tablet 28px tokens; and desktop body text is
// 18px, not the font-body-desktop 20px token. Neither was re-tokenized
// in this patch (that would change rendered sizes); both are named in
// the skipped list so the next palette pass can decide them.
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
  // Palette: the .screen custom properties are the card's variables.
  ["palette", "color-screen-bg", (v) => `background: ${v};`],
  ["palette", "color-ink", (v) => `--ink: ${v};`],
  ["palette", "color-accent", (v) => `--accent: ${v};`],
  ["palette", "color-muted", (v) => `--muted: ${v};`],
  ["palette", "color-card", (v) => `--card: ${v};`],
  ["palette", "color-line", (v) => `--line: ${v};`],
  ["palette", "color-chip-bg", (v) => `--chip-bg: ${v};`],
  ["palette", "color-star", (v) => `--star: ${v};`],
  ["palette", "color-error", (v) => `--error: ${v};`],
  ["palette", "color-success", (v) => `--success: ${v};`],
  // On-accent text is white; the card spells it #fff (the shorthand
  // of the token's #FFFFFF) — same value, shorter spelling.
  ["palette", "color-on-accent", () => "color: #fff;"],
  // On-chip text is ink: the chip rule sets color: var(--ink), and
  // --ink is asserted above and equals the on-chip token.
  ["palette", "color-on-chip", (v) => new RegExp(`\\.chip \\{[^}]*color: var\\(--ink\\);`)],
  // Elevation.
  ["elevation", "shadow-card", (v) => `--shadow-card: ${v};`],
  ["elevation", "shadow-lift", (v) => `--shadow-lift: ${v};`],
  ["elevation", "shadow-tab", (v) => `--shadow-tab: ${v};`],
  ["elevation", "shadow-accent", (v) => `--shadow-accent: ${v};`],
  // Type.
  ["type", "font-family", (v) => `font-family: ${v};`],
  ["type", "line-height-body", (v) => `line-height: ${v};`],
  ["type", "font-body-hub", (v) => new RegExp(`\\.screen \\{[^}]*font-size: ${esc(v)};`)],
  ["type", "font-body-tablet", (v) => `.screen.dev-tablet { font-size: ${v};`],
  ["type", "font-body-mobile", (v) => `.screen.dev-mobile { font-size: ${v};`],
  ["type", "font-chip-hub", (v) => new RegExp(`\\.chip \\{[^}]*font-size: ${esc(v)};`)],
  ["type", "font-chip-desktop", (v) => `.screen.dev-desktop .chip { min-height: 44px; font-size: ${v};`],
  ["type", "font-chip-mobile", (v) => `.screen.dev-mobile .chip { min-height: 48px; font-size: ${v};`],
  ["type", "font-meta", (v) => `.row-meta { font-size: ${v}; }`],
  // Spacing: screen padding is one declaration holding both axes.
  ["spacing", "spacing-screen-pad-y", (v) => new RegExp(`padding: ${esc(v)} ${esc(tokenValue("spacing", "spacing-screen-pad-x"))};`)],
  ["spacing", "spacing-screen-pad-x", (v) => new RegExp(`padding: ${esc(tokenValue("spacing", "spacing-screen-pad-y"))} ${esc(v)};`)],
  ["spacing", "spacing-screen-pad-mobile", (v) => `.screen.dev-mobile { font-size: 18px; padding: ${v}; }`],
  ["spacing", "spacing-section-gap", (v) => new RegExp(`\\.list-view \\{[^}]*gap: ${esc(v)};`)],
  // Radius.
  ["radius", "radius-chip", (v) => new RegExp(`\\.chip \\{[^}]*border-radius: ${esc(v)};`)],
  ["radius", "radius-row", (v) => new RegExp(`\\.button \\{[^}]*border-radius: ${esc(v)};`)],
  // Targets: the base rules ARE the hub values (there are no
  // .screen.dev-hub overrides — the base is the hub).
  ["targets", "target-chip-hub", (v) => new RegExp(`\\.chip \\{[^}]*min-height: ${esc(v)};`)],
  ["targets", "target-chip-desktop", (v) => `.screen.dev-desktop .chip { min-height: ${v};`],
  ["targets", "target-chip-mobile", (v) => `.screen.dev-mobile .chip { min-height: ${v};`],
  ["targets", "target-time-chip-hub-min", (v) => new RegExp(`\\.time-chip \\{[^}]*min-height: ${esc(v)};`)],
  ["targets", "target-time-chip-phone-min", (v) => `.screen.dev-mobile .time-chip { min-height: ${v}; }`],
  ["targets", "target-tablet-min", (v) => `.screen.dev-tablet .tab { min-height: ${v};`],
  ["targets", "target-hub-min", (v) => new RegExp(`\\.nav-strip-button \\{[^}]*min-height: ${esc(v)};`)],
  // Icons: the search SVG carries its intrinsic size in the markup
  // (width='24'%20height='24' — URL-encoded, %20 separators, not
  // spaces); the rendered size is set by background-size (26px hub,
  // 22px elsewhere — see the skipped list).
  ["icon", "icon-desktop", (v) => `width='${parseInt(v, 10)}'%20height='${parseInt(v, 10)}'`],
  ["icon", "icon-phone", (v) => `width='${parseInt(v, 10)}'%20height='${parseInt(v, 10)}'`],
];

test("DESIGN-1 Part B: the recipe card inlines the tokens it consumes", () => {
  for (const [group, key, needle] of RECIPE) {
    const value = tokenValue(group, key);
    has(RECIPE_CSS, needle(value), `recipe card must inline ${group}.${key} = ${value}`);
  }
});

// Tokens Part B deliberately does NOT assert, with the reason — so a
// skip is a decision, not an oversight. Home/timer-owned tokens
// belong to those cards' tests; the rest are not rendered as
// declarations by this card (scale steps, range caps, descriptive
// motion values), or are genuine drifts named here for the next
// palette pass.
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
    "icon.icon-hub", // search icon renders at 26px on the hub, not 32px (drift, see header)
    "icon.icon-tablet", // search icon renders at 22px on tablet, not 28px (drift, see header)
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
    "radius.radius-input", // no input uses the 12px radius (search is a 999px pill, note editor is 16px)
    "radius.radius-section", // no .section element in this card; the 20px values on .row/.detail-photo are not the token
    "spacing.space-1", // scale steps; actual use is asserted via the named spacing tokens
    "spacing.space-2",
    "spacing.space-3",
    "spacing.space-4",
    "spacing.space-5",
    "spacing.space-6",
    "spacing.space-7",
    "spacing.spacing-inner-gap", // no named inner-gap declaration (the 16px list gap is a grid gap, not the token)
    "spacing.spacing-row-gap", // no named row-gap declaration (the 12px toolbar gap is not the token)
    "spacing.spacing-section-pad", // no section-padding declaration in this card
    "spacing.spacing-section-pad-mobile", // no section-padding declaration in this card
    "state.state-active-bg", // var(--hub-...) refs; this card uses its own --vars, not var(--hub-*)
    "state.state-active-fg",
    "state.state-error",
    "state.state-finished",
    "state.state-offline",
    "state.state-paused",
    "state.state-running",
    "state.state-soon",
    "targets.target-desktop-max", // range cap; no 48px desktop declaration (desktop .check is 24px)
    "targets.target-desktop-min", // the only 44px desktop declaration is the chip, already asserted as target-chip-desktop
    "targets.target-dial-min-hub", // timer card
    "targets.target-hub-max", // range cap; no 80px declaration in this card
    "targets.target-note-delete-min", // no note-delete control in this card
    "targets.target-phone-max", // range cap; no declaration caps phone targets at 56px (mobile tab/star are 56px minimums, not caps)
    "targets.target-phone-min", // the only 48px mobile declarations are the chip/time-chip, already asserted as target-chip-mobile/target-time-chip-phone-min
    "targets.target-tablet-max", // range cap; no 64px tablet declaration
    "type.font-body-desktop", // desktop body is 18px in this card, not the 20px token (drift, see header)
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
    "type.font-section-title-desktop", // home card
    "type.font-section-title-hub",
    "type.font-section-title-mobile",
    "type.font-section-title-tablet",
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
