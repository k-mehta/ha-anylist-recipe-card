# Changelog

All notable changes to AnyList Recipe View are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the version numbers follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases
are tagged `vX.Y.Z`.

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
