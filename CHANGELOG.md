# Changelog

All notable changes to AnyList Recipe View are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the version numbers follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases
are tagged `vX.Y.Z`.

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
