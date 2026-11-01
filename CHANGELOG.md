# Changelog

All notable changes to AnyList Recipe View are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the version numbers follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases
are tagged `vX.Y.Z`.

## [Unreleased]

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
