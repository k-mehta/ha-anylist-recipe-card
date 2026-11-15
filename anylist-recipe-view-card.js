// anylist-recipe-view-card.js — Recipes card (custom:anylist-recipe-view),
// Phase 2 Wave W7, built from scratch against the settled architecture
// (hidden_files/redesign/architecture-design-settled.md §05).
//
// What this card is: the recipe list + detail for the kitchen hub.
// It reads the exporter's canonical JSON over HTTP (§05.1) — one fetch
// of /local/recipes.json — never the retired get_recipes service. It
// searches locally over a specified index (§05.8), shows a detail view
// with step navigation by tap or voice (§05.19 A6), and starts timers
// from duration chips in the step text (§05.12).
//
// What it is NOT (settled removals, Nov 13): no ingredient/step
// check-offs, no Finish control, no persisted cook state (Q4 settled);
// no refresh control — interval + visibility only (Q6 settled (b));
// no total-time line until I43 resolves the time-unit question
// (RECIPE-V1); no shopping-list button (browse + open only, §05.17).
// The current step is session state only (RecipeSession.step), the
// scaler is memory-only and resets on open, and the step-change
// handler is the ONE entry point for tap and voice.
//
// Intra-file split (one file, named sections, one owner each —
// enforced by the G-10 code read; no section holds state owned by
// another section):
//   A — constants (every value names its reason)
//   B — text normalisation + the specified matcher (RecipeSearchIndex)
//   C — canonical JSON: schema gate + recipe normalisation + headings
//   D — step text: duration chips + serving scaler
//   E — session state (RecipeSession, sessionStorage only)
//   F — freshness (RecipeFreshness — card-side mirror of core/ha.js
//       DataSource recipes behaviour; see the section note)
//   G — the card: list + first screen + detail + navigation
//   H — step navigation: the ONE step-change handler + voice (A6)
//   I — notes / rating: honest save + three states + error slot +
//       60 s re-probe (ERS-1 / ERS-5 / ERS-10)
//   J — recipe → timer contract (RecipeTimerLink)
//
// Nothing here is live-hub proven. Rig legs live in
// hidden_files/redesign/w7-legs/.
//
// ---------------------------------------------------------------------------
// A — Constants. Every value names its reason (§05.19 / design record
// D9–D11 / Nov 13 no-magic-numbers rule). A value taken from core
// names the core file; a value taken from the design names the rule.
// ---------------------------------------------------------------------------

// Export schema version the card accepts (§05.19 A2 — the same value
// as the exporter's canonical.rs SCHEMA_VERSION; bump together).
export const SCHEMA_VERSION = 1;
// The canonical format string the exporter stamps alongside the
// integer (canonical.rs CANONICAL_FORMAT). The integer gates; the
// string is a human-readable cross-check only.
export const CANONICAL_FORMAT = "anylist-canonical/1";

// Default read path (§05.1): the exporter's combined recipes.json,
// placed where HA serves it by the publish step (I48 / R-OQ-17 —
// the publish command is an open item, not an assumed sync; until
// it is recorded, the rig serves its canonicalised fixture here).
// Overridable per card config (recipes_url).
export const DEFAULT_RECIPES_URL = "/local/recipes.json";

// Recipe wall-clock revalidation interval (§05.2): 5 minutes. The
// same value as core/ha.js RECIPE_REVALIDATE_MS.
export const RECIPE_REVALIDATE_MS = 5 * 60 * 1000;

// Search debounce (§05.8): 200–300 ms so the list never flickers
// through intermediate counts. 250 ms is the midpoint.
export const SEARCH_DEBOUNCE_MS = 250;

// Search field weights (§05.8): title 100 / ingredient 60 / step 40 /
// description 20 / notes 10 / source 5.
export const SEARCH_WEIGHTS = Object.freeze({
  title: 100,
  ingredient: 60,
  step: 40,
  description: 20,
  notes: 10,
  source: 5,
});

// ERS-1 (§07.9): the ONE ladder — 4 attempts, delays [2, 8, 30] s.
// The same values as core/ha.js ERS1_ATTEMPTS / ERS1_DELAYS_MS.
export const ERS1_ATTEMPTS = 4;
export const ERS1_DELAYS_MS = Object.freeze([2000, 8000, 30000]);

// Error-slot re-probe (§08 row 41 / ERS-10): 60 s. A persistent
// failure re-appears via this re-probe — the timer MUST exist in
// code (a named re-probe with no code behind it fails the task).
export const REPROBE_MS = 60 * 1000;

// Recipe freshness tick: the card checks the 5-min wall clock once
// a second (the same 1 s tick the Home card uses for its 30 s bound).
export const FRESHNESS_TICK_MS = 1000;

// Voice step-command sensor (design record D9, §05.19 A6): the
// bridge publishes a command record here; the card observes it
// through its HA-state subscription and routes it to the one
// step-change handler. The entity id is PROPOSED by D9 — the
// settled architecture names no bridge sensor for recipe voice
// commands, and the W2-4 sensor contract does not include it yet:
// the bridge-side publish + intent handler is an open follow-up
// (D-W7-08); the card side built here is exactly the recorded
// mechanism (sensor + sequence + one handler).
export const VOICE_STEP_ENTITY_ID = "sensor.family_hub_voice_step_command";

// Session key (§08 row 24): sessionStorage only. The current step
// never survives a fresh page load (the card clears it on first
// mount when the navigation entry says "navigate" — the same
// first-mount rule the Home card uses, D-W6-10).
export const RECIPE_SESSION_KEY = "family-hub:recipe:state";

// PIP "starting…" timeout (§05.4): the PIP leaves `starting`
// within 10 s or is hidden with a warning logged with the entity
// id. The same value as core/pip.js PIP_STARTING_TIMEOUT_MS.
export const PIP_STARTING_TIMEOUT_MS = 10 * 1000;

// Bridge timer duration cap (§05.12 / J-W5-05): a timer runs from 1 s to
// 24 h — bridge const.py MAX_TIMER_DURATION_SECONDS = 86400 (its comment
// says 24 h "is a design choice, not a measured derivation; review may
// change the value, not the existence of the bound"). The W5 timer card
// names the same cap as DURATION_MAX_HOURS = 24 (timer-screen-card.js
// J-W5-05, "the bridge caps duration at 86,400 s (24:00:00)"); a future
// value change updates both cards together. A duration phrase above this
// cap renders as plain text, never as a tappable chip (B1).
export const MAX_TIMER_DURATION_SECONDS = 86400;

// Chip-start confirm settle delay (D-W7-10): the shell's store reads the
// same state_changed stream as the card's subscription, and the two
// listeners race — when the store has not yet processed the event the
// confirm waits this long for it. 250 ms is coincidentally also
// SEARCH_DEBOUNCE_MS's value, not the same reason (NB1).
export const TIMER_CONFIRM_SETTLE_MS = 250;

// Note/rating save debounce: none — saves are explicit (Save button
// for the note, tap for a rating). An explicit save makes
// "confirmation ONLY on backend success" (§05.11) crisp and
// testable; an auto-save would confirm (or fail) text the user
// never asked to save (D-W7-03).

// Chip row: one scrollable row (U13). No sheet at 22 collections;
// the cut-off chip is the scroll affordance — no "more" control.

// ---------------------------------------------------------------------------
// B — Text normalisation + the specified matcher (RecipeSearchIndex)
// ---------------------------------------------------------------------------
// §05.8, verbatim: normalisation NFKD + strip diacritics + lowercase
// + collapse whitespace, pre-computed per recipe, never per keystroke;
// tokens AND-across-words / OR-across-fields; per-token match:
// substring of any normalised word OR Levenshtein ≤ 1; weights title
// 100 / ingredient 60 / step 40 / description 20 / notes 10 / source
// 5; ties by title alphabetical, never deduped by name; NO stemming,
// NO synonyms, NO server ranking.

export function normalizeSearchText(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchWords(value) {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(" ") : [];
}

// Bounded Levenshtein: true when the edit distance between a and b
// is ≤ 1. Plain Levenshtein (insertion, deletion, substitution —
// NOT transposition: the spec says Levenshtein, not Damerau).
// Runs in O(n) with no table: two strings within one edit either
// share a prefix up to the first difference and then match after
// skipping at most one character on one side (length differs) or
// match after skipping one character on both sides (same length).
export function levenshteinWithinOne(a, b) {
  if (a === b) return true;
  const lenDiff = Math.abs(a.length - b.length);
  if (lenDiff > 1) return false;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  let index = 0;
  while (index < short.length && short[index] === long[index]) index += 1;
  if (short.length !== long.length) {
    return short.slice(index) === long.slice(index + 1);
  }
  return short.slice(index + 1) === long.slice(index + 1);
}

// One query token against one field's words: substring of any
// normalised word, or one edit away from any word. `field` is a
// built field object ({ text, byLength } — see
// recipeSearchFields): the substring check runs once against the
// joined text (sound: a spaceless token can only sit inside one
// word, never across the joining space), and the one-edit check
// runs only over the words whose length is within one of the
// token's — the two cuts that keep a keystroke under the 50 ms
// bound at 2,500 recipes (a per-word Levenshtein scan measured
// 52 ms for "pasta" on this machine).
export function tokenMatchesWords(token, words) {
  for (const word of words) {
    if (word.includes(token)) return true;
    if (levenshteinWithinOne(token, word)) return true;
  }
  return false;
}

export function tokenMatchesField(token, field) {
  if (!field) return false;
  if (field.text.includes(token)) return true;
  const lengths = [token.length - 1, token.length, token.length + 1];
  for (const length of lengths) {
    const bucket = field.byLength.get(length);
    if (!bucket) continue;
    for (const word of bucket) {
      if (levenshteinWithinOne(token, word)) return true;
    }
  }
  return false;
}

function buildField(words) {
  const unique = [...new Set(words)];
  const byLength = new Map();
  for (const word of unique) {
    const bucket = byLength.get(word.length) ?? new Set();
    bucket.add(word);
    byLength.set(word.length, bucket);
  }
  return { text: unique.join(" "), byLength };
}

// One ingredient entry as a name: entries are usually objects, but
// the fixture (and a loose export) can carry a bare string — a
// string entry is an ingredient named by that string, never dropped.
export function ingredientEntryName(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") return String(entry.name ?? "");
  return "";
}

function ingredientEntryWords(entry) {
  const words = searchWords(ingredientEntryName(entry));
  if (entry && typeof entry === "object") {
    words.push(...searchWords(entry.raw_ingredient ?? ""));
  }
  return words;
}

// Field text mapping (D-W7-01): the canonical recipe carries no
// `description` field, so the description slot is populated from
// `recipe.description` when a future export carries one, and is
// otherwise empty — it holds its ranked position without inventing
// text. notes ← note; source ← source_name + source_url.
export function recipeSearchFields(recipe) {
  const ingredientWords = [];
  for (const group of ingredientGroups(recipe)) {
    for (const item of group.items) {
      ingredientWords.push(...ingredientEntryWords(item));
    }
  }
  return {
    title: buildField(searchWords(recipe.name ?? "")),
    ingredient: buildField(ingredientWords),
    step: buildField(searchWords((recipe.preparation_steps ?? []).join(" "))),
    description: buildField(searchWords(recipe.description ?? "")),
    notes: buildField(searchWords(recipe.note ?? "")),
    source: buildField([
      ...searchWords(recipe.source_name ?? ""),
      ...searchWords(recipe.source_url ?? ""),
    ]),
  };
}

// RecipeSearchIndex: built ONCE per data load by RecipeData (the
// card's freshness owner, section F). Per-recipe normalised words
// are pre-computed here, never per keystroke.
export class RecipeSearchIndex {
  constructor(recipes = []) {
    this.buildMs = 0;
    this.build(recipes);
  }

  build(recipes) {
    const startedAt = Date.now();
    this.entries = (recipes ?? []).map((recipe) => ({
      recipe,
      fields: recipeSearchFields(recipe),
      titleSort: (recipe.name ?? "").toLowerCase(),
    }));
    this.buildMs = Date.now() - startedAt;
  }

  get size() {
    return this.entries.length;
  }

  // Search: every query token must match in at least one field
  // (AND-across-words, OR-across-fields). Score: per token, the best
  // (highest-weight) field it matches in, summed across tokens.
  // Ties by title alphabetical; a final id tiebreak keeps the order
  // deterministic when two titles match exactly.
  search(query) {
    const tokens = [...new Set(searchWords(query))];
    if (tokens.length === 0) {
      return this.entries.map((entry) => ({ recipe: entry.recipe, score: 0 }));
    }
    const scored = [];
    for (const entry of this.entries) {
      let score = 0;
      let matched = true;
      for (const token of tokens) {
        let best = 0;
        for (const [field, weight] of Object.entries(SEARCH_WEIGHTS)) {
          if (tokenMatchesField(token, entry.fields[field])) {
            if (weight > best) best = weight;
          }
        }
        if (best === 0) {
          matched = false;
          break;
        }
        score += best;
      }
      if (matched) scored.push({ recipe: entry.recipe, score });
    }
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        a.recipe.name.toLowerCase().localeCompare(b.recipe.name.toLowerCase()) ||
        String(a.recipe.id).localeCompare(String(b.recipe.id)),
    );
    return scored;
  }
}

// RecipeSearch: the debounced query owner (§05.8). A keystroke
// schedules the filter at SEARCH_DEBOUNCE_MS; the count line shows
// the SETTLED count only — the list never flickers through
// intermediate counts. `applyNow` is the test seam (and the
// debounce-timer callback); callers never filter per keystroke.
export class RecipeSearch {
  constructor(index, { onSettled = () => {}, debounceMs = SEARCH_DEBOUNCE_MS, schedule = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id) } = {}) {
    this.index = index;
    this.onSettled = onSettled;
    this.debounceMs = debounceMs;
    this.schedule = schedule;
    this.cancel = cancel;
    this.query = "";
    this.results = index.search("");
    this.settledCount = this.results.length;
    this.lastFilterMs = 0;
    this.timer = null;
  }

  setQuery(query) {
    this.query = query;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = this.schedule(() => {
      this.timer = null;
      this.applyNow();
    }, this.debounceMs);
  }

  applyNow() {
    const startedAt = Date.now();
    this.results = this.index.search(this.query);
    this.lastFilterMs = Date.now() - startedAt;
    this.settledCount = this.results.length;
    this.onSettled(this.results, { query: this.query, filterMs: this.lastFilterMs });
    return this.results;
  }

  rebuild(recipes) {
    this.index.build(recipes);
    this.applyNow();
  }
}

// ---------------------------------------------------------------------------
// C — Canonical JSON: schema gate + recipe normalisation + headings
// ---------------------------------------------------------------------------
// §05.1 / §05.19 A2 + A5: the card fetches the exporter's combined
// recipes.json and gates on its schema version. The gate is strict:
// a missing, older, or newer schema_version is a version-gate error
// state (named remedy: re-export), never a silent partial render.
// The fixture shape `{recipes: [...]}` with no stamp is NOT
// accepted unstamped — the rig canonicalises its fixture before
// serving (w7 boot), exactly as the exporter stamps it.

export class VersionGateError extends Error {
  constructor(received) {
    super(
      `Recipe data is schema version ${received ?? "unstamped"}; ` +
        `this card reads schema version ${SCHEMA_VERSION}. Re-export ` +
        `from AnyList to get the current format.`,
    );
    this.name = "VersionGateError";
    this.received = received ?? null;
  }
}

export function parseCanonicalRecipes(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  if (!data || typeof data !== "object" || !Array.isArray(data.recipes)) {
    throw new Error(
      "Recipe data is not a canonical export (expected an object with a recipes list).",
    );
  }
  if (data.schema_version !== SCHEMA_VERSION) {
    throw new VersionGateError(data.schema_version ?? null);
  }
  return {
    recipes: data.recipes.map((raw) => normalizeRecipe(raw)),
    exportedAt: typeof data.exported_at === "string" ? data.exported_at : null,
    schemaVersion: data.schema_version,
  };
}

// One recipe, normalised into the shape every section reads. Only
// what the canonical JSON carries: no invented fields, no guessed
// times — prep/cook minutes are carried as data for the I43
// resolution and are NOT displayed (no total-time line until I43
// resolves, §05.17).
export function normalizeRecipe(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const steps = Array.isArray(r.preparation_steps)
    ? r.preparation_steps.map((s) => String(s ?? ""))
    : [];
  return {
    id: String(r.id ?? r.anylist_id ?? ""),
    name: String(r.name ?? ""),
    ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
    ingredient_entries: Array.isArray(r.ingredient_entries)
      ? r.ingredient_entries
      : [],
    ingredients_flat: Array.isArray(r.ingredients_flat) ? r.ingredients_flat : [],
    preparation_steps: steps,
    note: r.note === null || r.note === undefined ? "" : String(r.note),
    source_name: r.source_name === null || r.source_name === undefined ? "" : String(r.source_name),
    source_url: r.source_url === null || r.source_url === undefined ? "" : String(r.source_url),
    description: r.description === null || r.description === undefined ? "" : String(r.description),
    servings: r.servings === null || r.servings === undefined ? "" : String(r.servings),
    prep_time_minutes: typeof r.prep_time_minutes === "number" ? r.prep_time_minutes : null,
    cook_time_minutes: typeof r.cook_time_minutes === "number" ? r.cook_time_minutes : null,
    rating: typeof r.rating === "number" ? r.rating : null,
    photo_urls: Array.isArray(r.photo_urls) ? r.photo_urls.filter((u) => typeof u === "string") : [],
    collections: Array.isArray(r.collections)
      ? r.collections.map((c) => ({ id: String(c?.id ?? ""), name: String(c?.name ?? "") })).filter((c) => c.id || c.name)
      : [],
  };
}

// Headings render from BOTH shapes (§05.17 / G-09 data):
//   (a) upstream PR #15 shape — headings INSIDE `ingredients` with
//       `is_heading: true` + `id` on every entry;
//   (b) fork shape — `ingredient_entries` with `type: "section"` /
//       `"ingredient"` (the exporter's canonical per-recipe files);
//   (c) plain — `ingredients` with no headings at all: one unheaded
//       group.
// Precedence: an is_heading entry anywhere in `ingredients` selects
// (a); else a non-empty `ingredient_entries` selects (b); else (c).
// A heading never consumes an ingredient slot: groups carry the
// heading plus its following items, in order.
export function ingredientGroups(recipe) {
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  const hasUpstreamHeadings = ingredients.some(
    (entry) => entry && typeof entry === "object" && entry.is_heading === true,
  );
  if (hasUpstreamHeadings) {
    const groups = [];
    let current = { heading: null, items: [] };
    for (const entry of ingredients) {
      if (entry && typeof entry === "object" && entry.is_heading === true) {
        if (current.items.length > 0 || current.heading !== null) groups.push(current);
        current = { heading: String(entry.name ?? ""), items: [] };
      } else if (entry) {
        current.items.push(entry);
      }
    }
    groups.push(current);
    return groups.filter((g) => g.items.length > 0 || g.heading !== null);
  }
  const entries = Array.isArray(recipe?.ingredient_entries) ? recipe.ingredient_entries : [];
  if (entries.length > 0) {
    const groups = [];
    let current = { heading: null, items: [] };
    for (const entry of entries) {
      if (entry && typeof entry === "object" && entry.type === "section") {
        if (current.items.length > 0 || current.heading !== null) groups.push(current);
        current = { heading: String(entry.name ?? ""), items: [] };
      } else if (entry) {
        current.items.push(entry);
      }
    }
    groups.push(current);
    return groups.filter((g) => g.items.length > 0 || g.heading !== null);
  }
  return [{ heading: null, items: ingredients.filter((e) => e) }];
}

// Collections, derived from the loaded recipes (no get_collections
// call): deduplicated by id, sorted by name. A collection with no
// recipes has no chip.
export function deriveCollections(recipes) {
  const byId = new Map();
  for (const recipe of recipes ?? []) {
    for (const collection of recipe.collections ?? []) {
      if (!collection.id) continue;
      if (!byId.has(collection.id)) byId.set(collection.id, collection);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// D — Step text: duration chips + serving scaler
// ---------------------------------------------------------------------------
// A step is either a section header ("# Sauce" — renders between
// steps, never consumes a number, never the current step) or a real
// step. Real steps render their time phrases as tappable timer chips
// (§05.12): a range renders as ONE chip for the range, starting the
// UPPER bound ("6 to 8 minutes" → 8 minutes). Only text is touched;
// the HTML is split so no attribute is ever rewritten.

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DURATION_UNIT_SECONDS = Object.freeze({
  second: 1,
  seconds: 1,
  minute: 60,
  minutes: 60,
  hour: 3600,
  hours: 3600,
});

// One duration phrase in step text: { label, seconds }. A range
// ("6 to 8 minutes", "6–8 minutes", "6-8 minutes") yields the upper
// bound; a single phrase yields its own value. Half/unwritten forms
// ("half an hour", "an hour") are not phrases and stay plain text.
const DURATION_RE =
  /(\d+(?:\.\d+)?)\s*(?:-|–|—|\bto\b)\s*(\d+(?:\.\d+)?)\s*(seconds?|minutes?|hours?)|(\d+(?:\.\d+)?)\s*(seconds?|minutes?|hours?)/gi;

export function extractDurations(text) {
  const found = [];
  DURATION_RE.lastIndex = 0;
  let match;
  while ((match = DURATION_RE.exec(String(text ?? ""))) !== null) {
    found.push({ label: match[0], seconds: durationSecondsFromMatch(match) });
  }
  return found;
}

// Seconds for a DURATION_RE match: a range yields the upper bound,
// a single phrase its own value. Kept separate from
// extractDurations so splitStepText can use it inside its own exec
// loop — calling extractDurations there would reset the shared
// regex's lastIndex and loop forever.
function durationSecondsFromMatch(match) {
  if (match[4] !== undefined) {
    return Math.round(Number(match[4]) * DURATION_UNIT_SECONDS[match[5].toLowerCase()]);
  }
  return Math.round(Number(match[2]) * DURATION_UNIT_SECONDS[match[3].toLowerCase()]);
}

// Split step text into { text } / { chip: { label, seconds } }
// segments. A chip is a button in the render; a text segment is
// escaped HTML. The regex is re-run from the start on every call —
// the pattern object is module-shared, so lastIndex is reset.
export function splitStepText(text) {
  const segments = [];
  const source = String(text ?? "");
  DURATION_RE.lastIndex = 0;
  let match;
  let cursor = 0;
  while ((match = DURATION_RE.exec(source)) !== null) {
    if (match.index > cursor) {
      segments.push({ text: source.slice(cursor, match.index) });
    }
    const seconds = durationSecondsFromMatch(match);
    // B1: a phrase above the bridge cap can never start — it renders as
    // plain text, never as a tappable chip. A dead control is worse
    // than no control. (extractDurations stays a pure parser: it still
    // reports the phrase, because parsing and startability are
    // different questions.)
    if (seconds > MAX_TIMER_DURATION_SECONDS) {
      segments.push({ text: match[0] });
    } else {
      segments.push({ chip: { label: match[0], seconds } });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) segments.push({ text: source.slice(cursor) });
  return segments;
}

// Parse one step: { header: boolean, segments }. A "# ..." line is
// a header step (renders as a label, never numbered).
export function parseStep(text) {
  const source = String(text ?? "");
  const headerMatch = /^#\s+(.*)$/.exec(source.trim());
  if (headerMatch) return { header: true, label: headerMatch[1], segments: [] };
  return { header: false, label: "", segments: splitStepText(source) };
}

// The numbered (non-header) steps in order, each with its display
// number (1-based) and its position in the full steps list.
export function navigableSteps(recipe) {
  const steps = [];
  let number = 0;
  (recipe?.preparation_steps ?? []).forEach((step, index) => {
    if (parseStep(step).header) return;
    number += 1;
    steps.push({ number, index });
  });
  return steps;
}

// Serving scaler: transient, client-side, memory-only (D-W7-02).
// The chosen serving count scales only the quantities SHOWN while
// cooking; it never calls update_recipe, so the stored recipe is
// untouched. It resets when the recipe is opened (and on every
// remount — it lives in memory, not in sessionStorage — so there is
// no persisted scaler to go stale, §05.9).
const UNICODE_FRACTIONS = Object.freeze({
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
});

export function parseLeadingAmount(text) {
  const source = String(text ?? "").trim();
  // No \b after the fraction: a fraction glyph is a non-word
  // character, so a word boundary can never sit after it.
  const unicode = /^([¼½¾⅓⅔⅛⅜⅝⅞])/.exec(source);
  if (unicode) {
    return { value: UNICODE_FRACTIONS[unicode[1]], rest: source.slice(unicode[1].length).trim(), matched: unicode[1] };
  }
  const mixed = /^(\d+)\s+(\d+)\/(\d+)\b/.exec(source);
  if (mixed) {
    return {
      value: Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]),
      rest: source.slice(mixed[0].length).trim(),
      matched: mixed[0],
    };
  }
  const simple = /^(\d+\/\d+|\d+(?:\.\d+)?)\b/.exec(source);
  if (simple) {
    const token = simple[1];
    const value = token.includes("/")
      ? Number(token.split("/")[0]) / Number(token.split("/")[1])
      : Number(token);
    if (Number.isFinite(value)) {
      return { value, rest: source.slice(simple[0].length).trim(), matched: simple[0] };
    }
  }
  return { value: null, rest: source, matched: "" };
}

// Format a scaled amount as a fraction where one reads cleanly
// (quarters, thirds, eighths), else a short decimal. Whole numbers
// stay whole ("2", never "2.0").
export function formatAmount(value) {
  if (!Number.isFinite(value) || value < 0) return "";
  const whole = Math.floor(value + 1e-9);
  const frac = value - whole;
  const fractions = [
    [0, ""],
    [0.125, "⅛"],
    [0.25, "¼"],
    [1 / 3, "⅓"],
    [0.375, "⅜"],
    [0.5, "½"],
    [0.625, "⅝"],
    [2 / 3, "⅔"],
    [0.75, "¾"],
    [0.875, "⅞"],
  ];
  let best = fractions[0];
  for (const candidate of fractions) {
    if (Math.abs(frac - candidate[0]) < Math.abs(frac - best[0])) best = candidate;
  }
  if (Math.abs(frac - best[0]) > 0.02 || (whole === 0 && best[0] === 0 && frac > 0)) {
    // A remainder too small for any clean fraction still counts when
    // there is no whole part: 0.02 is "0.02", never "0" (NB5). The
    // 0.02 snap tolerance chooses between nearby fractions; it never
    // erases a quantity.
    const decimal = Math.round(value * 100) / 100;
    return String(decimal);
  }
  if (whole === 0) return best[1] || "0";
  return best[1] ? `${whole} ${best[1]}` : String(whole);
}

// Scale one quantity string by a factor. Ranges scale both ends
// ("2–3 cups" at 2× → "4–6 cups"); compounds scale piece by piece
// ("1 cup + 2 tbsp"). An unparseable piece passes through unchanged
// — a broken quantity is shown as stored, never half-scaled.
export function scaleQuantityText(quantity, factor) {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return String(quantity ?? "");
  const source = String(quantity ?? "");
  return source
    .split("+")
    .map((piece) => {
      const trimmed = piece.trim();
      const range = /^(.+?)\s*(?:-|–|—)\s*(.+)$/.exec(trimmed);
      if (range) {
        const low = parseLeadingAmount(range[1]);
        const high = parseLeadingAmount(range[2]);
        if (low.value !== null && high.value !== null) {
          const lowText = formatAmount(low.value * factor);
          const highText = formatAmount(high.value * factor);
          return `${lowText}${low.rest ? ` ${low.rest}` : ""}–${highText}${high.rest ? ` ${high.rest}` : ""}`;
        }
        return trimmed;
      }
      const parsed = parseLeadingAmount(trimmed);
      if (parsed.value === null) return trimmed;
      const scaled = formatAmount(parsed.value * factor);
      return parsed.rest ? `${scaled} ${parsed.rest}` : scaled;
    })
    .join(" + ");
}

// Base servings from the stored servings string ("4", "4 servings").
// Null when the stored value carries no number — the scaler hides
// instead of guessing.
export function parseServings(servings) {
  const match = /(\d+(?:\.\d+)?)/.exec(String(servings ?? ""));
  return match ? Number(match[1]) : null;
}

// List-row servings display (B2): " servings" is appended ONLY when the
// stored string is a bare number or a range — "4" → "4 servings",
// "4–6" → "4–6 servings". Anything else already carries its own unit
// ("Serves 4", "Makes 24 cookies", "Makes 8 servings") and renders
// as-is — appending again would double the unit.
export function formatServings(servings) {
  const stored = String(servings ?? "").trim();
  if (!stored) return "";
  if (/^\d+(?:\.\d+)?$/.test(stored)) return `${stored} servings`;
  if (/^\d+(?:\.\d+)?\s*(?:-|–|—)\s*\d+(?:\.\d+)?$/.test(stored)) return `${stored} servings`;
  return stored;
}

// ---------------------------------------------------------------------------
// E — Session state (RecipeSession, sessionStorage only)
// ---------------------------------------------------------------------------
// §08 row 24: { openId, step, lastVoiceSequence, scrollY }. Step is
// the 1-based display number (what the tracker shows and what
// PipHost's hard gate reads: non-null means published). The session
// is NOT cook state: no check-offs, no TTL, no wipe message — the
// step is the only per-recipe memory, and it resets on a fresh page
// load (section A note). The scaler is NOT here (memory-only, §D).

export function emptyRecipeSession() {
  return { openId: null, step: 1, lastVoiceSequence: 0, scrollY: 0 };
}

export function parseRecipeSession(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return emptyRecipeSession();
    return {
      openId: typeof parsed.openId === "string" ? parsed.openId : null,
      step: Number.isFinite(parsed.step) && parsed.step >= 1 ? Math.floor(parsed.step) : 1,
      lastVoiceSequence: Number.isFinite(parsed.lastVoiceSequence) ? parsed.lastVoiceSequence : 0,
      scrollY: Number.isFinite(parsed.scrollY) ? parsed.scrollY : 0,
    };
  } catch {
    return emptyRecipeSession();
  }
}

export function serializeRecipeSession(session) {
  return JSON.stringify({
    openId: session.openId ?? null,
    step: session.step ?? 1,
    lastVoiceSequence: session.lastVoiceSequence ?? 0,
    scrollY: session.scrollY ?? 0,
  });
}

// ---------------------------------------------------------------------------
// F — Freshness (RecipeFreshness)
// ---------------------------------------------------------------------------
// Card-side mirror of core/ha.js DataSource for kind "recipes"
// (same cadence, same ladder, same last-good rule — the W6
// HomeFreshness precedent: the deployed core is the old R1 bundle,
// so the card cannot import core/ha.js; the mirror is behaviour-
// identical to core on the shared case table and names core/ha.js
// as its source on every rule below. A second DataSource would be
// a second validation path; this mirror IS the one the card uses,
// and the core suite's DataSource cases are the equivalence check).
//
// Cadence (§05.2): one fetch per view-open + 5-minute wall-clock
// revalidation + visibility-return re-fetch. A view-open load
// retries on the ERS-1 ladder (the user is waiting); a background
// revalidation failure keeps last-good data and retries at the next
// revalidation tick — the tick IS the retry, never a second ladder.
// A failed fetch never blanks: last-good data is kept, the error is
// shown, and the next revalidation retries (G-08 freshness matrix).
// Fetch age is stamped on accept ("Updated 2:14 PM"); export age
// comes only from the file's exported_at stamp — never invented.

// runWithRetry — the ERS-1 ladder, by name (core/ha.js). `operation`
// is attempted up to ERS1_ATTEMPTS times; between attempts it waits
// the ERS-1 delays. Every attempt is logged with its attempt number
// (ERS-9). `shouldRetry` decides whether a failure is retryable; a
// non-retryable failure (the version gate: re-sending the same stale
// file fails identically) throws immediately without consuming the
// ladder.
export async function runWithRetry(operation, {
  label = "operation",
  shouldRetry = () => true,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = () => {},
} = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= ERS1_ATTEMPTS; attempt += 1) {
    try {
      const value = await operation(attempt);
      if (attempt > 1) log("info", `${label} succeeded`, { attempt });
      return value;
    } catch (error) {
      lastError = error;
      log("warn", `${label} failed`, { attempt, error: String(error?.message ?? error) });
      if (attempt === ERS1_ATTEMPTS || !shouldRetry(error, attempt)) break;
      await sleep(ERS1_DELAYS_MS[attempt - 1]);
    }
  }
  throw lastError;
}

export class RecipeFreshness {
  constructor({ fetch, onData, onError, now = () => Date.now(), sleep } = {}) {
    if (typeof fetch !== "function") throw new Error("RecipeFreshness requires a fetch function.");
    this.fetch = fetch;
    this.onData = onData ?? (() => {});
    this.onError = onError ?? (() => {});
    this.now = now;
    this.sleep = sleep;
    this.lastGood = null;
    this.lastFetchMs = null;
    this.visible = true;
  }

  get revalidateMs() {
    return RECIPE_REVALIDATE_MS;
  }

  async load() {
    const data = await runWithRetry(() => this.fetch(), {
      label: "recipes load",
      // The version gate is not retryable: re-fetching the same
      // stale file fails identically, so the ladder would burn ~40 s
      // for nothing. Every other failure retries.
      shouldRetry: (error) => !(error instanceof VersionGateError),
      ...(this.sleep ? { sleep: this.sleep } : {}),
    });
    this.accept(data);
    return data;
  }

  accept(data) {
    this.lastGood = data;
    this.lastFetchMs = this.now();
    this.onData(data, { fresh: true });
  }

  // Returns whether the revalidation itself accepted fresh data.
  // The re-probe's success signal is THIS boolean, not "lastGood
  // exists": a failed revalidation keeps last-good data by design,
  // so lastGood is non-null exactly when a failure was kept — the
  // old probe read that as recovered and cleared the slot while the
  // failure persisted (D-W7-F12).
  async revalidate() {
    try {
      const data = await this.fetch();
      this.accept(data);
      return true;
    } catch (error) {
      this.onError(error, { keptLastGood: this.lastGood !== null });
      return false;
    }
  }

  // The wall-clock tick (called by the card's 1 s timer): refresh
  // when ≥ the revalidation interval has elapsed since the last
  // fetch. Returns true when a revalidation was started.
  tick() {
    if (this.lastFetchMs === null) return false;
    if (this.now() - this.lastFetchMs >= this.revalidateMs) {
      this.lastFetchMs = this.now();
      void this.revalidate();
      return true;
    }
    return false;
  }

  onVisibilityReturn() {
    if (!this.visible) {
      this.visible = true;
      void this.revalidate();
    }
  }

  onVisibilityHidden() {
    this.visible = false;
  }
}

// Fetch age display (§05.2): "Updated 2:14 PM" — the fetch time, in
// the user's locale. Export age is a separate line and appears only
// when exported_at exists (formatExportStamp); until A5 stamps it,
// export age is not invented.
export function formatTimeOfDay(ms) {
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function formatExportStamp(exportedAt) {
  if (typeof exportedAt !== "string" || !exportedAt) return "";
  const ms = Date.parse(exportedAt);
  if (!Number.isFinite(ms)) return "";
  const date = new Date(ms);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) return `Exported ${formatTimeOfDay(ms)}`;
  return `Exported ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${formatTimeOfDay(ms)}`;
}

// ---------------------------------------------------------------------------
// I — Notes / rating: honest save + three states + error slot + re-probe
// ---------------------------------------------------------------------------
// §05.11 / §05.13 / §05.14 + §07.26 (ERS-1) + §07.29 AD-1
// (ERS-BOUNDARY) + §08 row 41 (ERS-5 error slot) + ERS-10.
//
// ERS-BOUNDARY, named per save/load error path (the same boundary
// text rides on every path in this file):
//   retry (inside the operation, bounded): the ERS-1 ladder — 4
//     attempts, delays [2, 8, 30] s — then the honest in-place error
//     with Retry; the text is kept.
//   re-probe (outside the operation, silent): the card's 60 s
//     re-probe, which re-checks the failed path and clears the slot
//     silently on recovery, or re-surfaces the error on persistence.
//     The re-probe never re-issues a user command (it never
//     re-saves a note unasked).
export const ERS_BOUNDARY =
  "Retry: ERS-1 ladder [2 s, 8 s, 30 s], then in-place error with Retry (text kept). " +
  "Re-probe: card 60 s check; clears silently on recovery, re-surfaces on persistence; never re-saves.";

// The card's own error slot (ERS-5, §08 row 41): exactly one slot,
// in-memory, newer-wins, cleared on success, replaced by a newer
// error. A reload clears it (it lives only in memory); a persistent
// failure re-appears via the 60 s re-probe. The slot never holds a
// message that merely reports a failure: every message names the
// recovery (Retry) or the remedy.
export class RecipeErrorSlot {
  constructor() {
    this.current = null;
  }

  set(error) {
    this.current = {
      kind: error.kind ?? "failed-call",
      scope: error.scope ?? "recipes",
      message: error.message ?? "Something went wrong.",
      retry: error.retry ?? null,
      // NB6: a retryable error carries what its retry needs — the
      // timer start's seconds, so "Try again" re-attempts the same
      // start instead of merely clearing the line.
      seconds: Number.isFinite(error.seconds) ? error.seconds : null,
    };
    return this.current;
  }

  clear() {
    this.current = null;
  }

  get present() {
    return this.current !== null;
  }
}

// The 60 s re-probe (ERS-10): a real timer, armed while the error
// slot is set. On each firing it runs the supplied `probe` (a
// read-only check of the failed path — re-fetch for a load error,
// read-back for a save error); on success it clears the slot
// silently; on continued failure it keeps the slot (the error
// re-appears). The probe never re-issues a user command. `schedule`
// / `cancel` are injectable so node tests can fire it by hand.
export class RecipeReProbe {
  constructor({ probe, onRecovered = () => {}, schedule = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id) } = {}) {
    if (typeof probe !== "function") throw new Error("RecipeReProbe requires a probe function.");
    this.probe = probe;
    this.onRecovered = onRecovered;
    this.schedule = schedule;
    this.cancel = cancel;
    this.timer = null;
    this.armed = false;
  }

  arm() {
    if (this.armed) return;
    this.armed = true;
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.fire();
    }, REPROBE_MS);
  }

  disarm() {
    this.armed = false;
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
  }

  async fire() {
    if (!this.armed) return false;
    this.armed = false;
    this.timer = null;
    let recovered = false;
    try {
      recovered = (await this.probe()) === true;
    } catch {
      recovered = false;
    }
    if (recovered) {
      this.onRecovered();
      return true;
    }
    this.arm();
    return false;
  }
}

// A save response is a CONFIRMED save only when it carries a usable
// recipe (R-IMPL-39, carried: the rig stub's update_recipe returns
// {}, which is NOT a confirmed save). A bare {} — or a recipe echo
// that carries neither the id nor the saved field (the W2 stub's
// {"recipe": {}} shape) — is a failed save: the text is kept and the
// retry message shows. An echo that carries the id is accepted even
// when it omits the saved field (the integration may echo a partial
// recipe); an echo that contradicts the id or the saved field is not.
export function isUsableSaveResponse(response, { recipeId, note, rating } = {}) {
  const recipe = response && typeof response === "object" ? response.recipe : null;
  if (!recipe || typeof recipe !== "object") return false;
  const idMatches = recipeId !== undefined && recipe.id !== undefined && String(recipe.id) === String(recipeId);
  const noteMatches = note !== undefined && recipe.note !== undefined && recipe.note !== null && String(recipe.note) === String(note);
  const ratingMatches =
    rating !== undefined && rating !== null && recipe.rating !== undefined && recipe.rating !== null && Number(recipe.rating) === Number(rating);
  if (recipeId !== undefined && recipe.id !== undefined && !idMatches) return false;
  if (note !== undefined && recipe.note !== undefined && recipe.note !== null && !noteMatches) return false;
  if (rating !== undefined && rating !== null && recipe.rating !== undefined && recipe.rating !== null && !ratingMatches) return false;
  // At least one positive confirmation: the id, or the field saved.
  if (recipeId !== undefined && !idMatches && !noteMatches && !ratingMatches) return false;
  if (recipeId === undefined && !noteMatches && !ratingMatches) return false;
  return true;
}

// RecipeNoteSaver: the one save path for notes and ratings.
// Service: anylist.update_recipe with ONLY the changed field
// (recipe_id + note, or recipe_id + rating) — a note-only or
// rating-only edit never resubmits the whole recipe (the fork made
// name/ingredients/steps optional). Calls go through hass.callWS
// with return_response: true — the same explicit route the old card
// and the Home card's calendar read use (hass.callService carries
// no return_response in this frontend version). Saves retry on the
// ERS-1 ladder (a save is idempotent — same text — so re-sending
// is safe); a non-retryable failure (service not_found:
// bridge-missing) surfaces at once, without burning the ladder.
export class RecipeNoteSaver {
  constructor(callWS, { sleep } = {}) {
    if (typeof callWS !== "function") throw new Error("RecipeNoteSaver requires a callWS function.");
    this.callWS = callWS;
    this.sleep = sleep;
  }

  async saveNote(recipeId, note) {
    return this.save(recipeId, { note });
  }

  async saveRating(recipeId, rating) {
    return this.save(recipeId, { rating });
  }

  async save(recipeId, changed) {
    const hasNote = Object.prototype.hasOwnProperty.call(changed, "note");
    try {
      const response = await runWithRetry(
        async () => {
          const result = await this.callWS({
            type: "call_service",
            domain: "anylist",
            service: "update_recipe",
            service_data: { recipe_id: recipeId, ...(hasNote ? { note: changed.note } : { rating: changed.rating }) },
            target: {},
            return_response: true,
          });
          const unwrapped = result && typeof result === "object" && "response" in result ? result.response : result;
          if (!isUsableSaveResponse(unwrapped, { recipeId, ...(hasNote ? { note: changed.note } : { rating: changed.rating }) })) {
            const error = new Error("Save was not confirmed by the backend.");
            error.kind = "unconfirmed";
            throw error;
          }
          return unwrapped;
        },
        {
          label: hasNote ? "note save" : "rating save",
          // A missing service is not retryable: the server answered
          // that anylist.update_recipe does not exist (bridge-missing
          // state), and re-sending fails identically. An
          // unconfirmed ({} / mismatched echo) answer IS retryable:
          // it may be a transient stub/backend gap.
          shouldRetry: (error) => error?.code !== "not_found" && !/not found/i.test(String(error?.message ?? "")),
          ...(this.sleep ? { sleep: this.sleep } : {}),
        },
      );
      return { ok: true, response };
    } catch (error) {
      const missing = error?.code === "not_found" || /not found/i.test(String(error?.message ?? ""));
      return { ok: false, kind: missing ? "bridge-missing" : "failed-call", error };
    }
  }
}

// The three distinct states (§05.13) for the notes/rating area —
// each renders its own state, none is a blank screen:
//   core-absent — no hass connection, so no save is possible;
//   bridge-missing — the anylist service answered not_found;
//   failed-call — the call failed (or was never confirmed) after
//     the ERS-1 ladder; the text is kept with a retry.
export function noteSaveState({ hasHass, saveResult }) {
  if (!hasHass) return "core-absent";
  if (saveResult && saveResult.ok === false && saveResult.kind === "bridge-missing") return "bridge-missing";
  if (saveResult && saveResult.ok === false) return "failed-call";
  return "ready";
}

// ---------------------------------------------------------------------------
// J — Recipe → timer contract (RecipeTimerLink)
// ---------------------------------------------------------------------------
// §05.12 / §05.18 / §05.19 A4 + §09 C12 + bucket-A A2 (FIXED here):
// the chip tap starts a timer with the upper bound + recipe name,
// returns an entity id, and binds the PIP to it directly via
// PipHost.show — the name + 15 s-window heuristic is DELETED as
// the primary path, and there is NO fallback heuristic that can
// bind the wrong timer (two "Pasta" timers started close together
// pinned the wrong one under the old code). No entity id in the
// response → in-place error, never a name lookup. No card-side
// chip-tap guard (A4): bridge idempotency owns duplicates — every
// tap sends its own command_id, and a retry re-sends the SAME id
// (§03.2), so a double tap cannot double-start.
// The call goes through hass.callWS with return_response: true
// (same route as section I).

export function newCommandId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `recipe-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export class RecipeTimerLink {
  constructor(callWS, { uuid = newCommandId } = {}) {
    if (typeof callWS !== "function") throw new Error("RecipeTimerLink requires a callWS function.");
    this.callWS = callWS;
    this.uuid = uuid;
  }

  // Start the timer and bind the PIP by the RETURNED entity id.
  // Returns { ok: true, entityId } or { ok: false, kind, error }.
  // `pipShow` is PipHost.show (direct function call, never a DOM
  // event, §09 C12); `returnContext` is the recipe location to
  // return to ({ route, openId, step, scrollY }).
  async start({ name, seconds, returnContext = null, pipShow = null }) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return { ok: false, kind: "failed-call", error: new Error("Timer duration must be more than zero.") };
    }
    const commandId = this.uuid();
    let result;
    try {
      result = await this.callWS({
        type: "call_service",
        domain: "satellite_timers",
        service: "start_timer",
        service_data: { command_id: commandId, name, duration_seconds: Math.round(seconds) },
        target: {},
        return_response: true,
      });
    } catch (error) {
      const missing = error?.code === "not_found" || /not found/i.test(String(error?.message ?? ""));
      return { ok: false, kind: missing ? "bridge-missing" : "failed-call", error };
    }
    const response = result && typeof result === "object" && "response" in result ? result.response : result;
    const entityId = response && typeof response.entity_id === "string" ? response.entity_id : null;
    if (!entityId) {
      // A2: no id, no PIP. The timer may still exist, but nothing
      // can bind to it — a name lookup would risk pinning the wrong
      // timer, so the failure is honest and in place instead.
      return { ok: false, kind: "failed-call", error: new Error("The timer started but no timer id came back, so it can't be shown.") };
    }
    if (typeof pipShow === "function") {
      pipShow(entityId, { returnContext, name });
    }
    return { ok: true, entityId, commandId };
  }
}

// ACTIONABLE C3 (preserved, settled form): a start failure names a
// working alternative and the gate re-checks automatically — it
// never says "try voice". The alternative is the Timers view's
// touch entry (always available, §04.3); the re-check is the
// bridge-version subscription (section G) re-evaluating the gate.
export function timerStartFailureText({ kind, seconds, name }) {
  const duration = formatTimerDuration(seconds);
  if (kind === "bridge-missing") {
    return `Couldn't start the ${duration} ${name} timer — the timer service isn't available. Start it from the Timers view instead; this clears on its own when the service is back.`;
  }
  // B1: an invalid request is not a service outage. A duration above
  // the bridge cap (MAX_TIMER_DURATION_SECONDS) can never start — the
  // Timers view stepper caps at the same 24 h and voice hits the same
  // service — so the failure names the rule itself, in the bridge's own
  // words ("A timer can run from 1 second to 24 hours", bridge.py
  // InvalidDuration), and never the generic "service is back" text.
  // The reason is derived from the seconds sent and the settled cap,
  // not parsed out of the service-validation string ("value must be at
  // most 86400 at 'duration_seconds'"), which names a field and a
  // number rather than the rule in plain language.
  if (Number.isFinite(seconds) && seconds > MAX_TIMER_DURATION_SECONDS) {
    return `Couldn't start the ${duration} ${name} timer. A timer can run from 1 second to 24 hours — this one is longer than that.`;
  }
  return `Couldn't start the ${duration} ${name} timer. Start it from the Timers view instead; this clears on its own when the service is back.`;
}

export function formatTimerDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${Math.round(seconds)} second${Math.round(seconds) === 1 ? "" : "s"}`;
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.round((seconds / 3600) * 10) / 10;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// G — The card: list + first screen + detail + navigation
// ---------------------------------------------------------------------------
// The header is exactly three bands (G-09): (1) title + age, (2)
// search + settled count, (3) collections chip row. The count line
// lives inside band 2 — it is not a fourth band. The chip row is
// ONE row tall at 50 collections (U13): a single horizontally
// scrollable row; the cut-off chip is the scroll affordance.
//
// First-screen guarantee (§05.7): recipes visible with zero scroll
// at 382 recipes, at the five leg viewports (two phones, landscape
// phone, the wall in both orientations). The header is compact (three short bands) and the
// list starts immediately below it — at least one recipe row is
// visible without scrolling at every listed viewport. The list is
// a single column at every viewport (no column breakpoint: the
// two-column breakpoint is a gated re-probe, I37 — it is not
// decided here, so no breakpoint is built).
//
// Return-to-list split (§05.10) — the detail route shape is owned
// here (strip.js defers it to W7): a detail is the Recipes route
// carrying a query, `/family-hub/recipes?recipe=<id>`; the plain
// route `/family-hub/recipes` is the list. Exactly one history entry
// per detail open; no same-URL pushState. All four return routes
// funnel into `_applyRoute()`, which reads the live URL:
//   back (in-detail ← Back) → history.back() → popstate → list;
//   system back → popstate → list;
//   HA tab (leave + return) → mount reads the plain route → list;
//   strip Recipes → navigateTo the plain route → route publish →
//     list.
// Returning from Timers via the PIP back button lands on the detail
// URL — the session step survived (disconnect never clears it), so
// the detail re-opens at the same step (the hard gate, §05.12).

const CARD_CSS = `
:host { display: block; font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
.recipes { display: flex; flex-direction: column; min-height: 100%; background: #FAF7F4; color: #1C1917; font-size: 20px; line-height: 1.45; }
.bands { flex: none; }
.band { padding: 8px 16px; }
.band-title { display: flex; align-items: baseline; gap: 12px; border-bottom: 1px solid #EDE8E3; }
.band-title h1 { margin: 0; font-size: 24px; line-height: 28px; }
.age { font-size: 17px; color: #57534E; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.band-search { display: flex; align-items: center; gap: 8px; }
.band-search input { flex: 1; min-width: 0; height: 44px; font-size: 17px; padding: 0 12px; border: 1px solid #EDE8E3; border-radius: 12px; background: #FFFFFF; color: #1C1917; }
.band-search .clear { flex: none; min-width: 44px; height: 44px; font-size: 18px; border: 1px solid #EDE8E3; border-radius: 12px; background: #FFFFFF; color: #1C1917; cursor: pointer; }
.count { flex: none; font-size: 17px; color: #57534E; white-space: nowrap; }
.band-chips { padding-top: 0; }
.chips { display: flex; flex-direction: row; gap: 8px; overflow-x: auto; overflow-y: hidden; height: 48px; align-items: center; scrollbar-width: thin; }
.chip { flex: none; min-height: 48px; padding: 0 14px; border-radius: 999px; border: 1px solid #EDE8E3; background: #F1ECE6; color: #1C1917; font-size: 17px; cursor: pointer; white-space: nowrap; }
.chip[aria-pressed="true"] { background: #C2410C; color: #FFFFFF; border-color: transparent; }
/* The window is the scroll container (Lovelace and the leg page
   alike — the Home card pattern, and the plan's own legs measure
   window scrollY). An internal scroller here would only engage if
   something constrained the host's height, which nothing does, so
   overflow-y: auto was dead CSS that misled the rig legs into
   scrolling .list/.detail instead of the window — and a sticky
   tracker can only stick against the container that actually
   scrolls (D-W7-F11). */
.list { flex: 1; }
.row { display: block; width: 100%; min-height: 64px; text-align: left; padding: 10px 16px; border: none; border-bottom: 1px solid #EDE8E3; background: #FFFFFF; color: #1C1917; cursor: pointer; }
.row .name { font-size: 20px; line-height: 1.45; }
.row .meta { font-size: 17px; color: #57534E; margin-top: 2px; }
.empty { padding: 32px 16px; text-align: center; color: #57534E; }
.error-slot { flex: none; padding: 12px 16px; border-top: 1px solid #B71C1C; }
.error-slot .msg { font-size: 17px; color: #B71C1C; }
.error-slot button { margin-top: 8px; min-height: 48px; padding: 0 16px; cursor: pointer; border-radius: 16px; border: 1px solid #EDE8E3; background: #FFFFFF; color: #1C1917; }
.detail { flex: 1; }
.detail-inner { padding: 0 16px 32px; }
.detail .back { min-height: 48px; margin: 8px 0; font-size: 17px; cursor: pointer; background: #FFFFFF; color: #1C1917; border: 1px solid #EDE8E3; border-radius: 16px; padding: 0 16px; }
.detail h2 { margin: 4px 0; font-size: 24px; line-height: 28px; }
.detail .meta { font-size: 17px; color: #57534E; }
.detail .photo { max-width: 100%; border-radius: 20px; margin: 12px 0; box-shadow: 0 1px 2px rgba(28, 25, 23, 0.05), 0 8px 20px rgba(28, 25, 23, 0.06); }
.tracker { position: sticky; top: 0; display: flex; align-items: center; gap: 8px; padding: 8px 0; background: #FFFFFF; z-index: 2; box-shadow: 0 1px 3px rgba(28, 25, 23, 0.12); }
.tracker .step-label { flex: 1; font-size: 17px; font-weight: 600; }
.tracker button { min-width: 48px; min-height: 48px; font-size: 17px; cursor: pointer; border-radius: 16px; border: 1px solid #EDE8E3; background: #FFFFFF; color: #1C1917; }
.tracker button:disabled { opacity: 0.4; cursor: default; }
.steps { display: flex; flex-direction: column; gap: 24px; margin: 0; padding: 0; }
.steps .step { padding: 12px 12px; border-radius: 16px; font-size: 20px; line-height: 1.45; }
.steps .step.current { background: #C2410C; color: #FFFFFF; }
.steps .step-header { font-size: 17px; font-weight: 700; color: #57534E; padding: 16px 12px 4px; }
.steps .step-num { font-weight: 700; margin-right: 6px; }
.time-chip { min-height: 48px; padding: 4px 12px; margin: 0 2px; border-radius: 999px; border: 1px solid currentColor; background: #FFFFFF; color: #C2410C; font-size: 17px; cursor: pointer; }
/* B3: the current step's chip keeps the orange text on the white pill — the
   white pill on the orange step is the tap target. A white label on the
   white pill is unreadable; do not re-add a color here. */
.steps .step.current .time-chip { border-color: #FFFFFF; }
.ingredients h3 { margin: 16px 0 4px; font-size: 24px; }
.ingredients ul { margin: 0; padding: 0; list-style: none; }
.ingredients li { font-size: 20px; line-height: 1.45; padding: 4px 0; }
.scaler { display: flex; align-items: center; gap: 8px; margin: 12px 0; }
.scaler button { min-width: 48px; min-height: 48px; font-size: 18px; cursor: pointer; border-radius: 16px; border: 1px solid #EDE8E3; background: #FFFFFF; color: #1C1917; }
.notes { margin-top: 20px; }
.notes textarea { width: 100%; min-height: 88px; font-size: 17px; padding: 8px; border: 1px solid #EDE8E3; border-radius: 12px; background: #FFFFFF; color: #1C1917; box-sizing: border-box; }
.notes .save { min-height: 48px; margin-top: 8px; padding: 0 20px; font-size: 17px; cursor: pointer; border: none; border-radius: 16px; background: #C2410C; color: #FFFFFF; }
.notes .status { font-size: 17px; margin-top: 8px; min-height: 20px; }
.notes .status.saved { color: #166534; }
.notes .status.error { color: #B71C1C; }
.stars { display: flex; gap: 4px; margin: 8px 0; }
.stars button { min-width: 48px; min-height: 48px; font-size: 22px; cursor: pointer; border: none; background: inherit; color: #57534E; }
.stars button.on { color: #B45309; }
.timer-status { font-size: 17px; color: #57534E; margin-top: 8px; min-height: 20px; }
`;

let _recipeMountedThisPage = false;

function isFreshPageLoad() {
  try {
    const entries = typeof performance !== "undefined" ? performance.getEntriesByType?.("navigation") : null;
    return Array.isArray(entries) && entries.length > 0 && entries[0].type === "navigate";
  } catch {
    return false;
  }
}

class AnylistRecipeView extends HTMLElement {
  constructor() {
    super();
    // The shadow root is the card's whole render surface: without it
    // connectedCallback returns on its first line and the card never
    // loads, renders, or fetches (D-W7-F10 — caught by the rig legs,
    // invisible to the node suite, which never mounts the element).
    // Guarded like the Home card so a DOM-less test host does not
    // throw here.
    if (typeof this.attachShadow === "function") {
      this.attachShadow({ mode: "open" });
    }
    this._config = { recipes_url: DEFAULT_RECIPES_URL, title: "Recipes" };
    this._hass = null;
    this._shell = null;
    this._shellResolved = false;
    this._voiceUnsubscribe = null;
    this._routeUnsubscribe = null;
    this._recipes = [];
    this._collections = [];
    this._activeCollection = null;
    this._search = new RecipeSearch(new RecipeSearchIndex([]), {
      onSettled: () => this._render(),
    });
    this._freshness = null;
    this._session = emptyRecipeSession();
    this._stepsById = new Map();
    this._noteDrafts = new Map();
    this._savedState = new Map();
    this._errorSlot = new RecipeErrorSlot();
    this._reProbe = null;
    this._timerStatus = "";
    this._timerStatusKind = null;
    this._noteStatus = "";
    this._noteStatusKind = "";
    this._noteSaveState = "ready";
    this._timerLink = null;
    this._timerConfirmUnsubscribe = null;
    this._timerConfirmSettleTimer = null;
    this._noteSaver = null;
    this._tickTimer = null;
    this._historyPushed = false;
    this._loaded = false;
    this._loading = true;
    this._onClickBound = (event) => this._onClick(event);
    this._onInputBound = (event) => this._onInput(event);
    this._onPopStateBound = () => this._applyRoute();
    this._onLocationChangedBound = () => this._applyRoute();
    this._onVisibilityBound = () => {
      if (typeof document !== "undefined" && document.hidden) this._freshness?.onVisibilityHidden();
      else this._freshness?.onVisibilityReturn();
    };
  }

  // -- config + hass ---------------------------------------------------------
  setConfig(config) {
    const next = config && typeof config === "object" ? config : {};
    this._config = {
      recipes_url: typeof next.recipes_url === "string" && next.recipes_url ? next.recipes_url : DEFAULT_RECIPES_URL,
      title: typeof next.title === "string" && next.title ? next.title : "Recipes",
    };
  }

  set hass(hass) {
    this._hass = hass ?? null;
    if (this._hass) {
      void this._ensureShell();
      this._timerLink = new RecipeTimerLink((message) => this._hass.callWS(message));
      this._noteSaver = new RecipeNoteSaver((message) => this._hass.callWS(message));
    }
  }

  get hass() {
    return this._hass;
  }

  // -- test seams ------------------------------------------------------------
  _setShellForTests(shell) {
    this._shell = shell ?? null;
    this._shellResolved = true;
    this._afterShellResolved();
  }

  _setFreshnessForTests(freshness) {
    this._freshness = freshness;
  }

  // -- shell resolution (J-W6-01 — same order as the Home card) -------------
  // (1) an injected shell (test seam above); (2) the shell registry on
  // window.__familyHub.shell; (3) a dynamic import of the shell module
  // found through lovelace/resources/list by bare path
  // /local/family-hub-shell.js, then ensureShell({hass}). If none
  // resolves, the list still renders from its HTTP fetch — the shell
  // is needed only for the PIP, the strip, and the voice-step
  // subscription. The notes area renders the core-absent state
  // (§05.13) until a hass connection exists.
  async _ensureShell() {
    if (this._shellResolved) return;
    const registry = globalThis?.window?.__familyHub?.shell ?? globalThis?.__familyHub?.shell;
    if (registry) {
      this._shell = registry;
      this._shellResolved = true;
      this._afterShellResolved();
      return;
    }
    if (!this._hass || typeof this._hass.callWS !== "function") return;
    try {
      const resources = await this._hass.callWS({ type: "lovelace/resources/list" });
      const shellResource = (resources ?? []).find(
        (r) => typeof r?.url === "string" && r.url.endsWith("/family-hub-shell.js"),
      );
      if (!shellResource) return;
      const mod = await import(shellResource.url);
      if (mod && typeof mod.ensureShell === "function") {
        this._shell = mod.ensureShell({ hass: this._hass });
        this._shellResolved = true;
        this._afterShellResolved();
      }
    } catch {
      // No shell module deployed (OQ-W5-01): the list renders, the
      // timer link degrades in place (section J). A failed import
      // is not an error state for the list.
    }
  }

  _afterShellResolved() {
    if (!this._shell) return;
    const haClient = this._shell.haClient ?? null;
    if (haClient && typeof haClient.subscribeEntity === "function" && !this._voiceUnsubscribe) {
      try {
        this._voiceUnsubscribe = haClient.subscribeEntity(
          VOICE_STEP_ENTITY_ID,
          (state) => this._handleVoiceStepRecord(state),
        );
      } catch {
        this._voiceUnsubscribe = null;
      }
    }
    if (haClient && typeof haClient.subscribeBridgeVersion === "function") {
      try {
        haClient.subscribeBridgeVersion(() => {
          // C3 auto re-check: the timer service is back — a
          // bridge-missing timer error clears on its own.
          if (this._timerStatusKind === "bridge-missing") {
            this._timerStatus = "";
            this._timerStatusKind = null;
            this._renderDetailStatus();
          }
        });
      } catch {
        // The re-check is best-effort; the Retry button remains.
      }
    }
    if (this._shell.navigation && typeof this._shell.navigation.subscribe === "function" && !this._routeUnsubscribe) {
      try {
        this._routeUnsubscribe = this._shell.navigation.subscribe(() => this._applyRoute());
      } catch {
        this._routeUnsubscribe = null;
      }
    }
  }

  // -- session ---------------------------------------------------------------
  _sessionStorage() {
    try {
      return globalThis?.sessionStorage ?? null;
    } catch {
      return null;
    }
  }

  _readSession() {
    const storage = this._sessionStorage();
    const session = parseRecipeSession(storage ? storage.getItem(RECIPE_SESSION_KEY) : null);
    const stepsRaw = storage ? storage.getItem(`${RECIPE_SESSION_KEY}:steps`) : null;
    try {
      const steps = stepsRaw ? JSON.parse(stepsRaw) : {};
      this._stepsById = new Map(Object.entries(steps ?? {}).map(([k, v]) => [k, Number(v) || 1]));
    } catch {
      this._stepsById = new Map();
    }
    return session;
  }

  _writeSession() {
    const storage = this._sessionStorage();
    if (!storage) return;
    try {
      storage.setItem(RECIPE_SESSION_KEY, serializeRecipeSession(this._session));
      storage.setItem(
        `${RECIPE_SESSION_KEY}:steps`,
        JSON.stringify(Object.fromEntries(this._stepsById)),
      );
    } catch {
      // sessionStorage full or unavailable: the session is
      // memory-only then. The step still changes in this view.
    }
  }

  _clearSession() {
    this._session = emptyRecipeSession();
    this._stepsById = new Map();
    this._writeSession();
  }

  // The published recipe state (§05.19 A7 note / §09 C8): what the
  // shell's PipHost hard gate reads through `getRecipeState` when
  // the shell was built with a reader over this session (D-W7-06 —
  // the reader wiring is a pi-family-hub follow-up; until it lands
  // the gate reads null and degrades open, and the returnContext
  // path still returns to the same step).
  _publishedRecipeState() {
    if (!this._session.openId) return null;
    return {
      openId: this._session.openId,
      step: this._session.step,
      scrollY: this._session.scrollY ?? 0,
    };
  }

  // -- lifecycle -------------------------------------------------------------
  connectedCallback() {
    if (!this.shadowRoot) return;
    if (!_recipeMountedThisPage) {
      _recipeMountedThisPage = true;
      if (isFreshPageLoad()) {
        this._clearSession();
      } else {
        this._session = this._readSession();
      }
    } else {
      this._session = this._readSession();
    }
    this._buildSkeleton();
    try {
      globalThis?.addEventListener?.("popstate", this._onPopStateBound);
      globalThis?.addEventListener?.("location-changed", this._onLocationChangedBound);
      globalThis?.document?.addEventListener?.("visibilitychange", this._onVisibilityBound);
    } catch {
      // No window/document: nothing to listen to.
    }
    if (!this._freshness) {
      this._freshness = new RecipeFreshness({
        fetch: () => this._fetchRecipes(),
        onData: (data) => this._onData(data),
        onError: (error, info) => this._onFreshnessError(error, info),
      });
    }
    if (!this._loaded) {
      this._loaded = true;
      void this._loadInitial();
    } else {
      // A remount is a view-open: revalidate in the background
      // (keeps last-good data; the tick covers the rest).
      void this._freshness.revalidate();
    }
    this._applyRoute();
    this._startTick();
    void this._ensureShell();
    this._render();
  }

  disconnectedCallback() {
    this._stopTick();
    try {
      globalThis?.removeEventListener?.("popstate", this._onPopStateBound);
      globalThis?.removeEventListener?.("location-changed", this._onLocationChangedBound);
      globalThis?.document?.removeEventListener?.("visibilitychange", this._onVisibilityBound);
    } catch {
      // Listeners were never attached.
    }
    if (this._voiceUnsubscribe) {
      try { this._voiceUnsubscribe(); } catch { /* already gone */ }
      this._voiceUnsubscribe = null;
    }
    if (this._routeUnsubscribe) {
      try { this._routeUnsubscribe(); } catch { /* already gone */ }
      this._routeUnsubscribe = null;
    }
    this._dropTimerConfirm?.();
    this._reProbe?.disarm();
  }

  _startTick() {
    if (this._tickTimer !== null) return;
    this._tickTimer = setInterval(() => {
      this._freshness?.tick();
      this._renderAge();
    }, FRESHNESS_TICK_MS);
  }

  _stopTick() {
    if (this._tickTimer !== null) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }

  // -- data ------------------------------------------------------------------
  async _fetchRecipes() {
    const fetchFn = typeof fetch === "function" ? fetch : null;
    if (!fetchFn) throw new Error("No fetch available for the recipe data.");
    const response = await fetchFn(this._config.recipes_url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Recipe data fetch failed (HTTP ${response.status}).`);
    }
    const text = await response.text();
    return parseCanonicalRecipes(text);
  }

  async _loadInitial() {
    try {
      await this._freshness.load();
    } catch (error) {
      this._onFreshnessError(error, { keptLastGood: false });
    }
  }

  // A3: a list-only refresh never disturbs an open detail. The data
  // lands, the index rebuilds with the query preserved, the list
  // re-renders — the open detail keeps its step, its scroll, its
  // scaler, and its unsaved note draft. The only disturbance is an
  // honest one: if the open recipe vanished from the export, the
  // detail closes to the list with the slot saying so. A
  // revalidation also never clobbers a locally saved note/rating:
  // the export is a snapshot, so a note saved after the export
  // still reads as saved until the next export (D-W7-04).
  _onData(data) {
    this._loading = false;
    this._recipes = data.recipes ?? [];
    for (const recipe of this._recipes) {
      const saved = this._savedState.get(recipe.id);
      if (saved) {
        if (saved.note !== undefined) recipe.note = saved.note;
        if (saved.rating !== undefined) recipe.rating = saved.rating;
      }
    }
    this._collections = deriveCollections(this._recipes);
    this._search.rebuild(this._recipes);
    this._errorSlot.clear();
    this._reProbe?.disarm();
    if (this._currentUrl().searchParams.get("recipe")) {
      // A direct-loaded detail URL (or a return) resolves now that
      // the data is here. _applyRoute renders.
      this._applyRoute();
      return;
    }
    if (this._session.openId) {
      const open = this._recipes.find((r) => r.id === this._session.openId);
      if (!open) {
        this._errorSlot.set({
          kind: "failed-call",
          scope: "detail",
          message: "That recipe is no longer in the export.",
          retry: null,
        });
        this._clearSession();
        this._historyPushed = false;
        this._render();
        return;
      }
    }
    this._render();
  }

  // §05.14: load failure keeps last good data + error + bounded
  // retry. The view-open load already spent the ERS-1 ladder; the
  // slot's Retry re-runs it. A background revalidation failure keeps
  // last-good data and retries at the next tick — the tick IS the
  // retry, never a second ladder.
  _onFreshnessError(error, info) {
    this._loading = false;
    const isGate = error instanceof VersionGateError;
    this._errorSlot.set({
      kind: "failed-call",
      scope: "load",
      message:
        (isGate ? error.message : `Couldn't load recipes. ${info?.keptLastGood ? "Showing the last good data." : "Nothing loaded yet."}`) +
        (isGate ? "" : " Try again — the next check runs on its own."),
      retry: "retry-load",
    });
    this._armReProbe("load");
    this._render();
  }

  _armReProbe(scope) {
    if (!this._reProbe) {
      this._reProbe = new RecipeReProbe({
        probe: async () => {
          try {
            if (scope === "save") {
              if (!this._hass || typeof this._hass.callWS !== "function") return false;
              const recipe = this._openRecipe();
              await this._hass.callWS({
                type: "call_service",
                domain: "anylist",
                service: "get_recipe",
                service_data: { recipe_id: recipe?.id ?? "" },
                target: {},
                return_response: true,
              });
              return true;
            }
            // The probe's success signal is the revalidation's own
            // boolean (D-W7-F12): lastGood is non-null after a KEPT
            // failure too, so it can never mean "recovered".
            return (await this._freshness.revalidate()) === true;
          } catch {
            return false;
          }
        },
        onRecovered: () => {
          this._errorSlot.clear();
          this._render();
        },
      });
    }
    this._reProbe.arm();
  }

  // -- route -----------------------------------------------------------------
  _currentUrl() {
    try {
      return new URL(globalThis?.location?.href ?? "http://family-hub.local/family-hub/recipes");
    } catch {
      return new URL("http://family-hub.local/family-hub/recipes");
    }
  }

  _detailUrlFor(recipeId) {
    const url = this._currentUrl();
    url.searchParams.set("recipe", recipeId);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  _listUrl() {
    const url = this._currentUrl();
    url.searchParams.delete("recipe");
    return `${url.pathname}${url.search}${url.hash}`;
  }

  // The one route reader: the live URL decides list vs detail.
  // A detail URL with an unknown id closes to the list (the id
  // names nothing in the data). A plain route closes the detail
  // and clears the OPEN session — including a return from another
  // HA tab and a strip Recipes tap. It does NOT wipe the
  // per-recipe step memory: that memory is the PIP-return memory
  // (D-W7-F21). Navigating away to Timers via the PIP runs this
  // branch, and the Timers back button then returns to the
  // detail URL — if the step were wiped here, the return would
  // land on step 1. Only a fresh open from the list resets a
  // recipe's step (see _openDetail).
  _applyRoute() {
    const url = this._currentUrl();
    const recipeId = url.searchParams.get("recipe");
    if (!recipeId) {
      if (this._session.openId) {
        // NB3: the plain route ends the open detail but keeps the voice
        // watermark (like _stepsById below) — a re-delivery of a command
        // already observed must not apply on the return. The detail
        // branch and _openDetail already preserve it; the plain branch
        // was the odd one out.
        this._session = { ...emptyRecipeSession(), lastVoiceSequence: this._session.lastVoiceSequence ?? 0 };
        this._historyPushed = false;
        this._writeSession();
      }
      this._render();
      return;
    }
    const recipe = this._recipes.find((r) => r.id === recipeId);
    if (!recipe) {
      if (this._loaded) {
        if (this._session.openId) {
          this._errorSlot.set({
            kind: "failed-call",
            scope: "detail",
            message: "That recipe is no longer in the export.",
            retry: null,
          });
          this._clearSession();
        }
        this._historyPushed = false;
        this._historyReplace(this._listUrl());
        this._render();
      }
      return;
    }
    const knownStep = this._stepsById.get(recipeId);
    const wasOpenId = this._session.openId;
    this._session = {
      openId: recipeId,
      step: knownStep ?? 1,
      lastVoiceSequence: this._session.lastVoiceSequence ?? 0,
      scrollY: 0,
    };
    // The scaler resets on a fresh open, never on a revalidation
    // that re-applies the same detail route (A3).
    if (recipeId !== wasOpenId) {
      this._scaleServings = parseServings(recipe.servings);
    }
    this._writeSession();
    this._render();
    this._scrollListToTop();
  }

  _historyReplace(url) {
    try {
      globalThis?.history?.replaceState?.(globalThis.history.state, "", url);
    } catch {
      // No history in node tests.
    }
  }

  _scrollListToTop() {
    try {
      const list = this.shadowRoot?.querySelector?.(".list, .detail");
      if (list) list.scrollTop = 0;
      if (typeof globalThis?.scrollTo === "function") globalThis.scrollTo(0, 0);
    } catch {
      // No window to scroll.
    }
  }

  // -- rendering -------------------------------------------------------------
  _buildSkeleton() {
    const root = this.shadowRoot;
    root.innerHTML = `<style>${CARD_CSS}</style>
      <div class="recipes">
        <header class="bands">
          <div class="band band-title"><h1>${escapeHtml(this._config.title)}</h1><span class="age"></span></div>
          <div class="band band-search"><input type="search" class="search" placeholder="Search recipes" aria-label="Search recipes"><button class="clear" data-action="clear-search" aria-label="Clear search">×</button><span class="count"></span></div>
          <div class="band band-chips"><div class="chips" role="group" aria-label="Collections"></div></div>
        </header>
        <div class="error-slot" hidden></div>
        <main class="view"></main>
      </div>`;
    try {
      root.addEventListener("click", this._onClickBound);
      root.addEventListener("input", this._onInputBound);
      // A photo the browser cannot render is removed, never shown
      // broken (the photo rule of §06 C13, applied here: a failed
      // frame is skipped, not displayed).
      root.addEventListener(
        "error",
        (event) => {
          const target = event?.target;
          if (target && target.classList?.contains?.("photo")) target.remove();
        },
        true,
      );
    } catch {
      // The test stub root has no listener support.
    }
  }

  _render() {
    if (!this.shadowRoot) return;
    this._renderAge();
    this._renderChips();
    this._renderErrorSlot();
    if (this._session.openId) this._renderDetail();
    else this._renderList();
  }

  _renderAge() {
    const age = this.shadowRoot?.querySelector?.(".age");
    if (!age) return;
    const parts = [];
    if (this._freshness?.lastFetchMs) parts.push(`Updated ${formatTimeOfDay(this._freshness.lastFetchMs)}`);
    const exported = formatExportStamp(this._freshness?.lastGood?.exportedAt ?? null);
    if (exported) parts.push(exported);
    age.textContent = parts.join(" · ");
  }

  _renderChips() {
    const wrap = this.shadowRoot?.querySelector?.(".chips");
    if (!wrap) return;
    const chips = [{ id: null, name: "All" }, ...this._collections];
    wrap.innerHTML = chips
      .map(
        (c) =>
          `<button class="chip" data-action="chip" data-collection="${escapeHtml(c.id ?? "")}" aria-pressed="${this._activeCollection === c.id}">${escapeHtml(c.name)}</button>`,
      )
      .join("");
  }

  _renderErrorSlot() {
    const slot = this.shadowRoot?.querySelector?.(".error-slot");
    if (!slot) return;
    const error = this._errorSlot.current;
    if (!error) {
      slot.hidden = true;
      slot.innerHTML = "";
      return;
    }
    slot.hidden = false;
    slot.innerHTML = `<div class="msg">${escapeHtml(error.message)}</div>` +
      (error.retry
        ? `<button data-action="${escapeHtml(error.retry)}">Try again</button>`
        : "");
  }

  _visibleRecipes() {
    let recipes = this._search.results.map((r) => r.recipe);
    if (this._activeCollection) {
      recipes = recipes.filter((r) =>
        (r.collections ?? []).some((c) => c.id === this._activeCollection),
      );
    }
    return recipes;
  }

  _renderList() {
    const view = this.shadowRoot?.querySelector?.(".view");
    if (!view) return;
    // A list render never replaces an open detail (A3): the settled
    // search callback funnels through _render, which dispatches —
    // but a direct _renderList call must not clobber the detail
    // either. Only the count line moves while a detail is open.
    if (this._session.openId) {
      const countOnly = this.shadowRoot?.querySelector?.(".count");
      if (countOnly) countOnly.textContent = `${this._recipes.length} recipes`;
      return;
    }
    if (this._loading) {
      view.innerHTML = `<div class="empty">Loading recipes…</div>`;
      return;
    }
    const count = this.shadowRoot?.querySelector?.(".count");
    if (count) {
      const total = this._recipes.length;
      count.textContent = this._search.query
        ? `${this._search.settledCount} of ${total} recipes`
        : `${total} recipes`;
    }
    const recipes = this._visibleRecipes();
    if (this._recipes.length === 0 && !this._errorSlot.present) {
      view.innerHTML = `<div class="empty">No recipes yet — the export hasn't arrived.</div>`;
      return;
    }
    if (recipes.length === 0) {
      view.innerHTML = `<div class="empty">No recipes match “${escapeHtml(this._search.query)}”. Try a different search.</div>`;
      return;
    }
    view.innerHTML = `<div class="list">${recipes
      .map((r) => {
        const collections = (r.collections ?? []).map((c) => c.name).join(", ");
        const stars = typeof r.rating === "number" && r.rating > 0 ? ` ${"★".repeat(Math.min(5, r.rating))}` : "";
        const meta = [collections, r.servings ? formatServings(r.servings) : ""].filter(Boolean).join(" · ");
        return `<button class="row" data-action="open-recipe" data-recipe-id="${escapeHtml(r.id)}"><div class="name">${escapeHtml(r.name)}${stars}</div><div class="meta">${escapeHtml(meta)}</div></button>`;
      })
      .join("")}</div>`;
  }

  _openRecipe() {
    return this._recipes.find((r) => r.id === this._session.openId) ?? null;
  }

  _renderDetail() {
    const view = this.shadowRoot?.querySelector?.(".view");
    if (!view) return;
    const recipe = this._openRecipe();
    if (!recipe) {
      view.innerHTML = `<div class="empty">That recipe isn't in the export any more.</div>`;
      return;
    }
    const steps = navigableSteps(recipe);
    const total = steps.length;
    const step = Math.min(Math.max(this._session.step, 1), Math.max(total, 1));
    this._session.step = step;
    const current = steps[step - 1];
    const baseServings = parseServings(recipe.servings);
    const chosenServings = this._scaleServings ?? baseServings;
    const factor = baseServings && chosenServings ? chosenServings / baseServings : 1;
    const groups = ingredientGroups(recipe);
    const photo = recipe.photo_urls[0] ?? null;
    view.innerHTML = `<div class="detail"><div class="detail-inner">
      <button class="back" data-action="back">← Recipes</button>
      <h2>${escapeHtml(recipe.name)}</h2>
      <div class="meta">${escapeHtml((recipe.collections ?? []).map((c) => c.name).join(", "))}${recipe.rating ? ` · ${"★".repeat(Math.min(5, recipe.rating))}` : ""}</div>
      ${photo ? `<img class="photo" src="${escapeHtml(photo)}" alt="">` : ""}
      ${baseServings ? `<div class="scaler"><span>Servings</span><button data-action="servings-down" aria-label="Fewer servings">−</button><span>${chosenServings}</span><button data-action="servings-up" aria-label="More servings">+</button><span>${factor !== 1 ? `${formatAmount(factor)}×` : ""}</span></div>` : ""}
      <div class="ingredients">${groups
        .map(
          (g) =>
            `${g.heading ? `<h3>${escapeHtml(g.heading)}</h3>` : ""}<ul>${g.items
              .map((item) => {
                const isObject = item && typeof item === "object";
                const quantity = scaleQuantityText(isObject ? item.quantity ?? "" : "", factor);
                const note = isObject && item.note ? ` <span>(${escapeHtml(item.note)})</span>` : "";
                return `<li>${quantity ? `${escapeHtml(quantity)} ` : ""}${escapeHtml(ingredientEntryName(item))}${note}</li>`;
              })
              .join("")}</ul>`,
        )
        .join("")}</div>
      <div class="tracker"><button data-action="prev-step" ${step <= 1 ? "disabled" : ""} aria-label="Previous step">‹ Prev</button><span class="step-label">Step ${step} of ${total}</span><button data-action="next-step" ${step >= total ? "disabled" : ""} aria-label="Next step">Next ›</button><button data-action="start-over">Start over</button></div>
      <div class="steps">${recipe.preparation_steps
        .map((text, index) => {
          const parsed = parseStep(text);
          if (parsed.header) return `<div class="step-header">${escapeHtml(parsed.label)}</div>`;
          const entry = steps.find((s) => s.index === index);
          const isCurrent = entry && entry.number === step;
          const inner = parsed.segments
            .map((seg) =>
              seg.chip
                ? `<button class="time-chip" data-action="start-timer" data-seconds="${seg.chip.seconds}" data-label="${escapeHtml(seg.chip.label)}">${escapeHtml(seg.chip.label)}</button>`
                : escapeHtml(seg.text),
            )
            .join("");
          return `<div class="step${isCurrent ? " current" : ""}" data-step-number="${entry ? entry.number : ""}"><span class="step-num">${entry ? entry.number : ""}.</span>${inner}</div>`;
        })
        .join("")}</div>
      <div class="timer-status">${escapeHtml(this._timerStatus)}</div>
      <div class="notes">
        <h3>Notes</h3>
        <div class="stars" role="group" aria-label="Rating">${[1, 2, 3, 4, 5]
          .map(
            (value) =>
              `<button data-action="save-rating" data-value="${value}"${value <= (recipe.rating ?? 0) ? ' class="on"' : ""} aria-label="Rate ${value} star${value === 1 ? "" : "s"}" aria-pressed="${recipe.rating === value}">${value <= (recipe.rating ?? 0) ? "★" : "☆"}</button>`,
          )
          .join("")}</div>
        <textarea class="note-text" aria-label="Recipe note" placeholder="Add a note…">${escapeHtml(this._noteDrafts.get(recipe.id) ?? recipe.note ?? "")}</textarea>
        <button class="save" data-action="save-note">Save note</button>
        <div class="status${this._noteStatusKind ? " " + this._noteStatusKind : ""}">${escapeHtml(this._noteStatus)}</div>
      </div>
    </div></div>`;
    this._renderDetailStatus();
  }

  _renderDetailStatus() {
    const timerEl = this.shadowRoot?.querySelector?.(".timer-status");
    if (timerEl) timerEl.textContent = this._timerStatus;
    const statusEl = this.shadowRoot?.querySelector?.(".notes .status");
    if (statusEl) {
      statusEl.textContent = this._noteStatus;
      statusEl.className = "status" + (this._noteStatusKind ? " " + this._noteStatusKind : "");
    }
  }

  // -- events ---------------------------------------------------------------
  _onInput(event) {
    const target = event?.target;
    if (!target) return;
    if (target.classList?.contains?.("search") || target.className === "search") {
      this._search.setQuery(target.value ?? "");
      return;
    }
    if (target.classList?.contains?.("note-text") || target.className === "note-text") {
      const recipe = this._openRecipe();
      if (!recipe) return;
      this._noteDrafts.set(recipe.id, target.value ?? "");
      this._writeNoteDraft(recipe.id, target.value ?? "");
    }
  }

  _onClick(event) {
    const target = event?.target?.closest?.("[data-action]");
    if (!target) return;
    const action = target.getAttribute("data-action");
    const id = target.getAttribute("data-recipe-id");
    switch (action) {
      case "open-recipe":
        if (id) this._openDetail(id);
        break;
      case "back":
        this._closeDetail();
        break;
      case "chip": {
        const collection = target.getAttribute("data-collection");
        this._activeCollection = collection ? collection : null;
        this._render();
        break;
      }
      case "clear-search": {
        const input = this.shadowRoot?.querySelector?.(".search");
        if (input) input.value = "";
        this._search.setQuery("");
        this._search.applyNow();
        this._renderList();
        break;
      }
      case "prev-step":
        this._changeStep(this._session.step - 1);
        break;
      case "next-step":
        this._changeStep(this._session.step + 1);
        break;
      case "start-over":
        this._changeStep(1);
        break;
      case "servings-down":
        this._changeServings(-1);
        break;
      case "servings-up":
        this._changeServings(1);
        break;
      case "start-timer": {
        const seconds = Number(target.getAttribute("data-seconds"));
        void this._startTimerFromChip(seconds);
        break;
      }
      case "save-note":
        void this._saveNote();
        break;
      case "save-rating": {
        const value = Number(target.getAttribute("data-value"));
        void this._saveRating(value);
        break;
      }
      case "retry-load":
        void this._loadInitial();
        break;
      case "retry-note":
        void this._saveNote();
        break;
      case "retry-timer": {
        // NB6: "Try again" re-attempts the same start with the seconds
        // the slot carries — the codebase's retry convention (retry-load
        // re-runs the load, retry-note re-runs the save). A slot with no
        // seconds falls back to clearing the status line.
        const retrySeconds = this._errorSlot.current?.seconds;
        if (Number.isFinite(retrySeconds)) {
          void this._startTimerFromChip(retrySeconds);
        } else {
          this._timerStatus = "";
          this._renderDetailStatus();
        }
        break;
      }
      default:
        break;
    }
  }

  _changeServings(delta) {
    const recipe = this._openRecipe();
    if (!recipe) return;
    const base = parseServings(recipe.servings);
    if (!base) return;
    const current = this._scaleServings ?? base;
    const next = Math.max(1, current + delta);
    this._scaleServings = next;
    this._renderDetail();
  }

  // -- detail open / close ----------------------------------------------------
  // A fresh open from the list (a row tap) always starts at
  // step 1 and records it — a fresh open is a new cooking
  // session, never a resume (D-W7-F21). The step a PIP return
  // restores lives in _stepsById and is read by _applyRoute, not
  // here: a return re-applies the detail URL, it does not tap a
  // row. Keeping the two paths distinct is what lets the
  // cook-state leg ("step resets to 1 on a fresh open") and the
  // PIP-return leg ("the return re-opens at the same step") both
  // hold.
  _openDetail(recipeId) {
    const recipe = this._recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    this._stepsById.set(recipeId, 1);
    this._session = {
      openId: recipeId,
      step: 1,
      lastVoiceSequence: this._session.lastVoiceSequence ?? 0,
      scrollY: 0,
    };
    // A fresh open resets the scaler (the serving count returns to
    // the stored servings; §08 row 27) and restores a kept note
    // draft (§05.11 — a failed save's text is never lost).
    this._scaleServings = parseServings(recipe.servings);
    const keptDraft = this._readNoteDraft(recipeId);
    if (keptDraft !== null) this._noteDrafts.set(recipeId, keptDraft);
    this._timerStatus = "";
    this._noteStatus = "";
    this._writeSession();
    const url = this._detailUrlFor(recipeId);
    try {
      const current = `${globalThis?.location?.pathname ?? ""}${globalThis?.location?.search ?? ""}`;
      if (current !== url) {
        globalThis?.history?.pushState?.({ recipeId }, "", url);
        this._historyPushed = true;
      }
    } catch {
      // No history in node tests.
    }
    this._render();
    this._scrollListToTop();
  }

  _closeDetail() {
    this._clearSession();
    this._timerStatus = "";
    this._noteStatus = "";
    if (this._historyPushed) {
      this._historyPushed = false;
      try {
        globalThis?.history?.back?.();
        return;
      } catch {
        // Fall through to the direct render.
      }
    }
    this._historyReplace(this._listUrl());
    this._render();
    this._scrollListToTop();
  }
}

// ---------------------------------------------------------------------------
// H — Step navigation: the ONE step-change handler + voice (A6)
// ---------------------------------------------------------------------------
// §05.9 / §05.19 A6 + D9: the current step changes through exactly
// one handler — by tap (Next / previous / Start over) or by voice
// command. There is no separate voice path in the card: the voice
// record is observed, deduped by sequence, and handed to this same
// handler. A missed/undelivered step command is NOT auto-retried
// (D9: re-issuing could double-step); the user repeats the command
// or taps Next/previous — the touch path is always present.

// NB2: the step-change handler takes no `source` — no consumer reads a
// step-change attribution, and a log nobody reads is noise, not a use.
// The one handler stays the single entry point for tap and voice.
AnylistRecipeView.prototype._changeStep = function (next) {
  const recipe = this._openRecipe();
  if (!recipe) return false;
  const total = navigableSteps(recipe).length;
  if (total <= 0) return false;
  const clamped = Math.min(Math.max(Math.floor(next) || 1, 1), total);
  const changed = clamped !== this._session.step;
  this._session.step = clamped;
  this._stepsById.set(recipe.id, clamped);
  this._writeSession();
  if (changed) {
    this._renderDetail();
    this._scrollStepIntoView();
  }
  return true;
};

AnylistRecipeView.prototype._scrollStepIntoView = function () {
  try {
    const current = this.shadowRoot?.querySelector?.(".step.current");
    if (current && typeof current.scrollIntoView === "function") {
      current.scrollIntoView({ block: "nearest" });
    }
  } catch {
    // No DOM to scroll.
  }
};

// Voice step command (D9, exact recorded mechanism):
// 1. the bridge publishes a command record on the dedicated sensor
//    (state = next / previous; attributes sequence + received_at);
// 2. the card observes it through its existing HA-state subscription
//    (shell.haClient.subscribeEntity — the channel every card uses);
// 3. the observed command routes to the ONE step-change handler;
//    the applied sequence is recorded in the session, so a
//    re-observation (reload, restore, re-render) never re-applies it.
// No recipe open → no-op, not an error. An unknown direction →
// no-op. A record with no sequence cannot be deduped (a bridge bug
// — the bridge MUST send a sequence); it is applied once per
// delivery rather than dropped, and the gap is logged.
AnylistRecipeView.prototype._handleVoiceStepRecord = function (record) {
  const state = record && typeof record === "object" ? record : {};
  const direction = typeof state.state === "string" ? state.state : typeof record === "string" ? record : "";
  const attributes = state.attributes && typeof state.attributes === "object" ? state.attributes : {};
  const sequence = Number(attributes.sequence);
  const hasSequence = Number.isFinite(sequence);
  if (direction !== "next" && direction !== "previous") return false;
  // NB3: record the sequence before the no-open check. The dedupe
  // defends against a re-delivery of a command the card already saw —
  // a command observed with no recipe open is exactly the one it must
  // remember, or its re-delivery after opening a recipe applies it.
  // The sequence is the tab's dedupe watermark, not part of the open
  // recipe's session: it is written even with no recipe open.
  if (hasSequence) {
    if (sequence <= (this._session.lastVoiceSequence ?? 0)) return false;
    this._session.lastVoiceSequence = sequence;
    this._writeSession();
  }
  if (!this._session.openId) return false;
  if (!hasSequence && typeof console !== "undefined") {
    console.warn("Family Hub: voice step command arrived without a sequence; applying once.", { direction });
  }
  const delta = direction === "next" ? 1 : -1;
  const applied = this._changeStep(this._session.step + delta);
  if (applied) this._writeSession();
  return applied;
};

// ---------------------------------------------------------------------------
// I (card methods) — notes / rating save wiring
// ---------------------------------------------------------------------------

AnylistRecipeView.prototype._noteDraftKey = function (recipeId) {
  return `family-hub:recipe:note-draft:${recipeId}`;
};

AnylistRecipeView.prototype._readNoteDraft = function (recipeId) {
  try {
    return this._sessionStorage()?.getItem?.(this._noteDraftKey(recipeId));
  } catch {
    return null;
  }
};

AnylistRecipeView.prototype._writeNoteDraft = function (recipeId, text) {
  try {
    if (text === null || text === undefined || text === "") {
      this._sessionStorage()?.removeItem?.(this._noteDraftKey(recipeId));
    } else {
      this._sessionStorage()?.setItem?.(this._noteDraftKey(recipeId), text);
    }
  } catch {
    // Drafts are memory-first; storage is a convenience.
  }
};

AnylistRecipeView.prototype._saveNote = async function () {
  const recipe = this._openRecipe();
  if (!recipe) return;
  const textarea = this.shadowRoot?.querySelector?.(".note-text");
  const text = textarea ? textarea.value : (this._noteDrafts.get(recipe.id) ?? recipe.note ?? "");
  if (!this._hass || !this._noteSaver) {
    this._noteSaveState = "core-absent";
    this._noteStatus = "No hub connection — the note is kept here until the connection is back.";
    this._noteDrafts.set(recipe.id, text);
    this._renderDetailStatus();
    return;
  }
  this._noteStatus = "Saving…";
  this._noteStatusKind = "";
  this._renderDetailStatus();
  const result = await this._noteSaver.saveNote(recipe.id, text);
  if (result.ok) {
    recipe.note = text;
    this._savedState.set(recipe.id, {
      ...(this._savedState.get(recipe.id) ?? {}),
      note: text,
    });
    this._noteDrafts.delete(recipe.id);
    this._writeNoteDraft(recipe.id, null);
    this._errorSlot.clear();
    this._reProbe?.disarm();
    this._noteSaveState = "ready";
    this._noteStatus = "Saved.";
    this._noteStatusKind = "saved";
  } else {
    this._noteSaveState = noteSaveState({ hasHass: true, saveResult: result });
    this._noteDrafts.set(recipe.id, text);
    this._writeNoteDraft(recipe.id, text);
    this._noteStatus = "Couldn't save — tap to retry";
    this._noteStatusKind = "error";
    this._errorSlot.set({
      kind: result.kind,
      scope: "save",
      message:
        result.kind === "bridge-missing"
          ? "Couldn't save — AnyList isn't connected. Your text is kept; try again once it's back."
          : "Couldn't save — tap to retry",
      retry: "retry-note",
    });
    this._armReProbe("save");
  }
  this._renderDetailStatus();
  this._renderErrorSlot();
};

AnylistRecipeView.prototype._saveRating = async function (value) {
  const recipe = this._openRecipe();
  if (!recipe) return;
  const next = value === recipe.rating ? 0 : value;
  if (!this._hass || !this._noteSaver) {
    this._noteSaveState = "core-absent";
    this._noteStatus = "No hub connection — the rating can't be saved yet.";
    this._renderDetailStatus();
    return;
  }
  const previous = recipe.rating;
  recipe.rating = next;
  this._renderDetail();
  const result = await this._noteSaver.saveRating(recipe.id, next);
  if (result.ok) {
    this._savedState.set(recipe.id, {
      ...(this._savedState.get(recipe.id) ?? {}),
      rating: next,
    });
    this._errorSlot.clear();
    this._reProbe?.disarm();
    this._noteSaveState = "ready";
    this._noteStatus = next === 0 ? "Rating cleared." : `Rated ${next} star${next === 1 ? "" : "s"}.`;
    this._noteStatusKind = "saved";
  } else {
    recipe.rating = previous;
    this._noteSaveState = noteSaveState({ hasHass: true, saveResult: result });
    this._noteStatus = "Couldn't save — tap to retry";
    this._noteStatusKind = "error";
    this._errorSlot.set({
      kind: result.kind,
      scope: "save",
      message:
        result.kind === "bridge-missing"
          ? "Couldn't save — AnyList isn't connected. Your rating is unchanged; try again once it's back."
          : "Couldn't save — tap to retry",
      retry: "retry-note",
    });
    this._armReProbe("save");
    this._renderDetail();
  }
  this._renderDetailStatus();
  this._renderErrorSlot();
};

// ---------------------------------------------------------------------------
// J (card method) — recipe → timer contract wiring
// ---------------------------------------------------------------------------

AnylistRecipeView.prototype._startTimerFromChip = async function (seconds) {
  const recipe = this._openRecipe();
  if (!recipe) return;
  const name = recipe.name || "Recipe timer";
  if (!this._hass || !this._timerLink) {
    this._timerStatusKind = "core-absent";
    this._timerStatus = "No hub connection — the timer can't be started yet.";
    this._renderDetailStatus();
    return;
  }
  // The PIP is shown by the shell's PipHost (direct function call,
  // never a DOM event — §09 C12). No PipHost yet (OQ-W5-01: the
  // shell module is not deployed): the timer still starts — a start
  // is never blocked on the shell loading — and the status line
  // confirms it. With a PipHost, the chip start shows the PIP and
  // the D-W7-10 confirm below flips it from "starting" to running
  // once the sensor reports active.
  const pip = this._shell?.pip ?? null;
  const returnContext = {
    route: "/family-hub/recipes",
    openId: recipe.id,
    step: this._session.step,
    scrollY: 0,
  };
  const result = await this._timerLink.start({
    name,
    seconds,
    returnContext,
    pipShow: pip && typeof pip.show === "function" ? (entityId, options) => pip.show(entityId, options) : null,
  });
  if (result.ok) {
    this._timerStatusKind = null;
    this._timerStatus = `Timer started: ${name} (${formatTimerDuration(seconds)}).`;
    this._errorSlot.clear();
    this._confirmTimerStart(result.entityId, returnContext);
  } else {
    this._timerStatusKind = result.kind;
    this._timerStatus = timerStartFailureText({ kind: result.kind, seconds, name });
    // B1 + NB6: the failure belongs in the timer error slot (ERS-5),
    // not only in the status line. A retryable failure carries the
    // seconds so "Try again" re-attempts the same start; a duration
    // above the bridge cap carries no retry — no re-attempt can ever
    // succeed, so no button is rendered for it.
    const overCap = Number.isFinite(seconds) && seconds > MAX_TIMER_DURATION_SECONDS;
    this._errorSlot.set({
      kind: result.kind,
      scope: "timer",
      message: this._timerStatus,
      retry: overCap ? null : "retry-timer",
      seconds: overCap ? null : seconds,
    });
  }
  this._renderDetailStatus();
  this._renderErrorSlot();
};


// D-W7-10 — confirm a chip-started timer's PIP (W7-7, A7 entry).
//
// PipHost.show renders "starting" until confirmTimerStarted
// verifies the timer against the sensor — and no caller in the
// core or the timer card ever calls confirmTimerStarted, and
// PipHost.onSnapshot never flips a local "starting" PIP to
// running on its own. Without this call a chip-started PIP would
// sit on "starting" for 10 s and then hide with a warning, and
// the W7-7 leg ("leaves starting within 10 s") could never pass
// with core/pip.js untouched. So the caller that started the
// timer confirms it: when the shell's timer store already reports
// the sensor active, confirm at once; otherwise subscribe to the
// sensor (the same HaClient channel the voice step path uses) and
// confirm on the first active state. The confirm runs after the
// store has processed the same event (the shell feeds its store
// from the same state_changed stream, and the two listeners race),
// so a handler that finds the store not yet current retries once
// after a short settle delay. The 10 s starting timeout in
// PipHost stays the backstop: a confirm that never lands hides
// the PIP with a warning naming the entity id.
AnylistRecipeView.prototype._confirmTimerStart = function (entityId, returnContext) {
  const pip = this._shell?.pip ?? null;
  if (!pip || typeof pip.confirmTimerStarted !== "function") return;
  // One confirm channel at a time (the same rule as the unsubscribe):
  // a new start drops any pending confirm from the previous one, so a
  // settle timer can never outlive the start it belongs to.
  this._dropTimerConfirm();
  const store = this._shell?.timerStore ?? null;
  const record = store && typeof store.byEntityId === "function" ? store.byEntityId(entityId) : null;
  const confirm = () => {
    this._timerConfirmSettleTimer = null;
    try {
      // NB9: the confirm carries the full returnContext, not just the
      // route — after the 10 s starting timeout hid the PIP, the core
      // has no live PIP to read the return from, so the confirm must
      // supply it or the resurrected PIP has no way back.
      pip.confirmTimerStarted(entityId, { originView: returnContext?.route ?? null, returnContext: returnContext ?? null });
    } catch {
      // A confirm that fails is not a start failure: the timer is
      // running; the PIP's own 10 s timeout is the backstop.
    }
  };
  if (record && record.state === "active") {
    confirm();
    return;
  }
  const haClient = this._shell?.haClient ?? null;
  if (!haClient || typeof haClient.subscribeEntity !== "function") return;
  try {
    this._timerConfirmUnsubscribe = haClient.subscribeEntity(entityId, (state) => {
      if (!state || state.state !== "active") return;
      this._dropTimerConfirm();
      // Let the shell's store process the same event first; if it
      // already has the record, confirm at once.
      const current = store && typeof store.byEntityId === "function" ? store.byEntityId(entityId) : null;
      if (current && current.state === "active") confirm();
      // NB1: the settle timer is tracked (TIMER_CONFIRM_SETTLE_MS), so
      // a disconnect drops it instead of confirming up to 250 ms after
      // the card is gone.
      else this._timerConfirmSettleTimer = setTimeout(confirm, TIMER_CONFIRM_SETTLE_MS);
    });
  } catch {
    this._timerConfirmUnsubscribe = null;
  }
};

AnylistRecipeView.prototype._dropTimerConfirm = function () {
  if (typeof this._timerConfirmUnsubscribe === "function") {
    try {
      this._timerConfirmUnsubscribe();
    } catch {
      // Already unsubscribed; nothing to drop.
    }
  }
  this._timerConfirmUnsubscribe = null;
  // NB1: a pending settle-delayed confirm is dropped with the
  // subscription — it must not fire after disconnect.
  if (this._timerConfirmSettleTimer !== null && this._timerConfirmSettleTimer !== undefined) {
    try {
      clearTimeout(this._timerConfirmSettleTimer);
    } catch {
      // Already fired; nothing to drop.
    }
  }
  this._timerConfirmSettleTimer = null;
};

export { CARD_CSS, AnylistRecipeView };

if (typeof customElements !== "undefined" && typeof customElements.define === "function") {
  try {
    customElements.define("anylist-recipe-view", AnylistRecipeView);
  } catch {
    // Already defined (re-import in tests): the class is the export.
  }
}
