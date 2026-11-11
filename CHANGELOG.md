# Changelog

All notable changes to AnyList Recipe View are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the version numbers follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases
are tagged `vX.Y.Z`.

## [1.5.0] - 2026-11-11

Family Hub redo, Recipes wave 1 (R-IMPL-1–60) against the locked design.

### Added

- Picture-in-picture timer notice (PIP): 5 s auto-hide with a 300 ms fade, swipe-collapse to a restore affordance, tap goes to Timers with the timer pinned first and marked "Just started", finished timers return as a PIP that never auto-hides, most-recent timer plus a "+N more running" count, × dismisses without cancelling the timer. Chip taps start a timer in place and never navigate; a voice-started timer shows the PIP via the sensor-set diff on `started_via`.
- Single horizontally scrollable chip row (the chips wall is gone); first-screen counts hold at the design targets at 390×844, 360×640, 844×390, 667×375, 640×360 and 1920×1080.
- Sticky detail header (back + tabs) with the step tracker pinned beneath it; sticky one-line running-timer summary; timer strip capped at 3 pills plus "+N more running".
- Finish flow: the last step's button reads "Finish", a completion card ("All done!") offers "Cook again" and "← Back to recipe", and "Start over" clears checks and resets to step 1.
- Honest note/rating save: the card only reports "Note saved." / "Rating saved." when the backend returns a usable recipe; otherwise it says "Couldn't save — tap to retry", keeps the draft, and offers a tappable retry.
- Route split: tap-open pushes one detail history entry, strip Recipes closes to the list top and pushes one list entry, system back re-opens a detail at its saved step, and reload re-opens a detail at its saved step with scroll at the top.
- Total-time line ("Total 35 min · Prep 15 min · Cook 20 min") — the wire values are seconds (OQ-9, RECIPE-V1).

### Fixed

- Ingredient rows no longer clip at the right edge on 390 px phones (NAV-O4): names wrap.
- The PIP pin now carries the timer's `timer_id` attribute, which is what the Timers card matches for the pinned-first render and the "Just started" marker (previously it carried the sensor `entity_id`, which never matched).
- A swipe the compositor claims for scrolling (ending in `touchcancel`, not `touchend`) now collapses the PIP and resumes the auto-hide clock instead of leaving the PIP up indefinitely.

## [1.4.1] - 2026-11-08

### Fixed

- Device detection rule 1 catches the kitchen panel signature in
  either orientation (O2-01): 1920×1200 is the hub in landscape, and
  the same panel rotated (1200×1920) is the hub in portrait. Without
  this, Home read hub at 1200×1920 while Recipes read mobile, so the
  portrait-hub layout never triggered in the recipe card. The rule
  still fires first, before any pointer check, so a hub with a mouse
  attached still reads as hub in either orientation; 1080×1920 and
  other non-signature sizes are unaffected.

### Added

- Token parity test (DESIGN-1): `design-tokens.test.cjs` asserts the
  40 design tokens the recipe card inlines (palette, elevation, type,
  spacing, radius, targets, icons) against a vendored copy of
  pi-family-hub's `dashboard/design-tokens.json`, with an explicit
  skipped list for the other 77 tokens. The test runs in CI alongside
  the card tests.

## [1.4.0] - 2026-11-08

### Added

- Serving scaler rewritten (RECIPE-1/2/3): proper fraction arithmetic
  with Unicode fractions ("½", "1½"), mixed numbers, rounding to the
  nearest ⅛ (incl. ⅜, ⅝, ⅞ and ⅓, ⅔) with a "≈" marker, tidy-unit
  conversion (48 tsp → 1 cup, 3 tsp → 1 tbsp, tbsp → cup at ≥¼ cup),
  ranges scaled at both ends, compounds piece by piece, unquantified
  quantities left as written, unparseable quantities flagged "check
  this one", scaled counts get a usable instruction ("½ egg — beat 1
  egg and use half"). The scaler bar shows the factor ("×2") and a
  "Show original" / "Show scaled" toggle. Servings parse by "first
  number ANYWHERE" ("Serves 4", "Makes 12 muffins", "Yield: 8") and
  ranges ("4–6") move both ends on the stepper. Quantities in step
  text scale too (RECIPE-23); time phrases are untouched.
- Details tab restored (RECIPE-7): photo hero (with the initial-letter
  fallback), metadata line, and every stored field — prep, cook,
  total, servings as stored, rating (stars + "4/5"), collections,
  source (link when a URL). The cooking header shows the total time
  ("Total 45 min · Prep 15 min · Cook 30 min").
- Wake Lock (RECIPE-8): requested while the Cook tab is open,
  released on tab change, back, or disconnect; re-requested when the
  page becomes visible again. Any rejection is silent.
- Cooking state persists (RECIPE-9): check-off and current step are
  saved to localStorage (`family-hub:recipe:<id>:cook-state`) and
  restored on open, with a 24h expiry. The scaler stays transient by
  design.
- Photo fallback (RECIPE-10): a failed photo load (list row or detail
  hero) is replaced by the initial-letter tile via a capture-phase
  error listener, instead of the image silently disappearing.
- Flat-string ingredients now render (RECIPE-24): `ingredients` lists
  are parsed and merged with `ingredient_entries` (RECIPE-11), entries
  first, deduped by normalized text across lists only.
- Running-timer strip (RECIPE-22): every running timer (name +
  remaining) at the top of the cooking view; tapping one goes to the
  Timers view. The remaining times tick once a second in place, never
  by full re-render, so a note draft is never wiped.
- Sort control (RECIPE-19): name, rating, cook time, prep time.
- Voice hint (RECIPE-20): "Say 'Okay Nabu, start a 9 minute timer'"
  sits next to the timer chips.
- Navigation strip (NAV-1): Home / Timers / Photos / Recipes on every
  view (list and detail), DOM-first, sticky at the bottom, hidden on
  desktop only, navigating via history.pushState + location-changed.
- Deep link (Phase 3 contract): `?recipe=<id>&step=<n>` (and
  `?from_recipe=<id>&step=<n>`) opens the recipe at the given step.
- Time-unit resolution (RECIPE-V1): prep/cook times are SECONDS — the
  card was right, the audit fixture stored minutes. Times now render
  correctly against live-shaped data.

### Changed

- Timer chips now call the bridge's `start_timer` with
  `{name, duration}` (duration in seconds) (RECIPE-5). A range ("6 to
  8 minutes") is ONE chip starting the upper bound (RECIPE-6).
- Search now searches everywhere — title, ingredients, steps, notes,
  source — with all query words required and title > ingredient >
  step ranking (RECIPE-4). Empty state: "Try an ingredient or a dish
  name."
- Timer failure text keeps the honest reason and offers the voice
  alternative (RECIPE-17).
- Collection chips toggle off when tapped again (RECIPE-12).
- Non-current steps dim to 0.8 (RECIPE-13). Muted text #57534E, stars
  #B45309, error #B71C1C (RECIPE-14); time chips ≥56px hub / ≥48px
  phone (RECIPE-15); step tracker pins at top: 0 in kiosk mode
  (RECIPE-16); `.search` gets `min-width: 0` (RECIPE-18).
- Collection chips and row pills wrap at ALL viewports; the list grid
  uses `minmax(0, 1fr)` tracks and rows carry `min-width: 0` (RECIPE-25,
  D-RECIPE-2, ORIENT-9). The desktop 3-column breakpoint at 1200px is
  removed (it spilled 166px past a 1200px-wide portrait viewport).
- Device detection is the unified rule (spec §3.7, P8-16): the exact
  1920×1200 panel signature first, then tablet user agents, mobile
  UA, width <768px, the 768–1024px touch band (tablet), fine pointer
  + width ≥1024px (desktop — a touchscreen laptop is desktop, OQ-7),
  coarse with no fine pointer (mobile). The old touch + ≥1600px =
  hub rule is deleted: only the exact panel signature is the hub, so
  a 1920×1080 touchscreen laptop no longer reads as the hub (V1080-01).

### Fixed

- The running-timer strip read `hass.states` as an array; the live
  frontend (HA 2026.10.4) hands cards the states as a plain object
  keyed by entity_id, so the strip rendered zero timers live
  (RECIPE-22). It now accepts both shapes.
- Flat-string-only recipes with a repeated ingredient line rendered
  the duplicate rows (RECIPE-11): the entries/flat merge now always
  runs, so a flat-only recipe's internal duplicates collapse
  ("Garlic 2 cloves" twice renders 3 rows, not 5).

## [1.3.0] - 2026-11-03

### Added

- Notes are editable in the Notes tab: a big textarea pre-filled
  with the saved note, a Save button (enabled only when the text
  actually changed), and a "Saved." confirmation. Saving calls the
  AnyList integration's `update_recipe` with the note only — name,
  ingredients and steps are never resubmitted. An empty note clears
  it. A failed save keeps the typed note and says so honestly instead
  of dropping it. An unsaved draft survives leaving the recipe (or
  the tab) and coming back. (Requires the fork, k-mehta/ha-anylist
  0.11.1, which added the `note` field to `update_recipe`.)
- Rating in the Notes tab: five big tappable stars plus Clear.
  Tapping a star saves the rating at once (`update_recipe` with the
  rating only); Clear un-rates the recipe (rating 0). A failed save
  keeps the old rating displayed and says so honestly.
- Serving scaler in the Cook tab: a "Serves − N +" stepper above the
  ingredients that scales the displayed quantities for this cooking
  session only (500 g at 6 from 4 becomes 750 g; a quantity with no
  leading number, like "1/2 tsp" or "a pinch", is left alone). It
  never calls the server and never changes the stored recipe — it
  resets to the recipe's stored servings when the recipe is
  re-opened. It shows only when the recipe lists servings as a bare
  number; a freeform servings string ("4 servings") has no clean
  base to scale from, so there is no scaler.

### Fixed

- Typing a note no longer loses focus when Home Assistant pushes a
  state update: the draft keeps the text and the caret is restored
  after a re-render.

### Known gaps (backend work, not the card)

- Timer chips need a `start_timer` service on the Satellite Timers
  bridge before they can start a timer.

## [1.2.0] - 2026-11-03

### Changed

- Cooking mode: the detail view is now a cooking tool, not a recipe
  page. Ingredients and steps are visible together — two columns on
  the hub (ingredients left, steps right), stacked on a phone
  (ingredients above steps) with the step tracker sticky, so your
  place stays visible while you scroll. The photo is gone from the
  cooking view entirely (it stays in the list, where it helps you
  pick a recipe) and the always-on metadata line is gone too; there
  is no Details tab. Two tabs: Cook and Notes.
- Ingredients are checkable: tap one to cross it off (tap again to
  un-cross), with a "N of M gathered" count and a Start over button.
  Checked ingredients and the current step survive leaving the
  recipe and coming back.
- Steps are a guided walkthrough: the current step is a raised card
  with a filled number, the rest are dimmed, with a "Step N of M"
  indicator, Prev/Next buttons, and tap-any-step to make it current.
- Times in a step ("simmer for 10 minutes") are tappable timer chips
  that start a timer on the kitchen voice satellite. The Satellite
  Timers bridge has no `start_timer` service yet, so until it does
  the tap reports that honestly in the view instead of pretending a
  timer started.
- The hub is now a real design, not a 2 px difference: base type is
  24 px (steps 26 px), targets are 72 px, and the detail view is
  1500 px wide. A hub-sized landscape touch screen is detected as
  the hub even when a mouse is also attached (the kiosk has one —
  checking the mouse first mis-detected it as a desktop).
- Recipes without a photo get a deliberate tile in the list (warm
  terracotta-tinted gradient with the initial in the accent colour)
  instead of a grey placeholder.

### Fixed

- The step tracker no longer slides underneath Home Assistant's
  header when scrolling: it pins below the 56 px header via HA's
  own `--header-height` variable.
- Opening a recipe resets to the Cook tab (it previously reset to a
  tab id that no longer exists).

### Known gaps (backend work, not the card)

- Notes are read-only in the card: the AnyList integration's
  `update_recipe` has no note field, so there is no way to save a
  note from the hub. The Notes tab shows the note and says so in
  plain words; no Save button is shipped, because a button that can
  never persist the note would be a broken half-feature. The
  integration needs a `note` field on `update_recipe` (or a
  dedicated `set_recipe_note` action) before editing can be added.
- Timer chips need a `start_timer` service on the Satellite Timers
  bridge before they can start a timer.

## [1.1.0] - 2026-11-02

### Added

- Adaptive layout: the card detects whether it runs on the hub kiosk
  (1920×1200 touch display), a desktop, or a phone/tablet, in portrait
  or landscape, and changes control sizes and layout for that device
  (see ADAPTIVE-LAYOUT.md). The hub layout is unchanged; desktop gets a
  denser layout with smaller targets and a wider detail view; mobile
  gets a single column (two in landscape), large touch targets,
  full-width detail, and collection chips that wrap onto a second row.
  Detection re-runs on resize/rotation. The detection mechanism is
  shared verbatim with the Satellite Timers card
  (`k-mehta/ha-satellite-timers`).

## [1.0.0] - 2026-11-01

### Added

- First release: a Lovelace card (`custom:anylist-recipe-view`) that
  browses AnyList recipes.
- Searchable recipe list in a landscape-first multi-column grid, with
  collection chips and local search (partial words match; typing never
  downloads anything).
- Tabbed detail view: Ingredients, Recipe (steps), Details (times,
  servings, rating, source), and Notes.
- Ingredient headings render as headings, never as ingredients.
- Prep/cook times shown in minutes (AnyList stores them in seconds).
- One `get_recipes` call per view-open; everything after that reads
  from memory.
- No shopping-list button, on purpose.
