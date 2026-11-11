// AnyList Recipe View — a custom Lovelace card for the kitchen hub.
//
// Browse the household's AnyList recipes and open one to cook from:
// ingredients (with quantities and notes), preparation steps, notes,
// photos and the usual metadata. That is all it does: there is no
// shopping-list button anywhere on this screen, on purpose.
//
// Data comes from the AnyList integration already installed on this
// Home Assistant (AnyList by moryoav, repo moryoav/ha-anylist, v0.11.0),
// which exposes recipes only as actions — no browsable entities. The
// card makes ONE call per view-open — anylist.get_recipes with
// ingredients and steps included — and everything after that reads
// from memory: the list, the collection chips (derived from the
// recipes themselves, so no get_collections call), the local search,
// and the detail view. No per-search download, no per-recipe download.
// The one exception is a save: editing a note or a rating calls
// anylist.update_recipe with only the changed field (recipe_id +
// note, or recipe_id + rating) — the fork (k-mehta/ha-anylist
// 0.11.1) made name/ingredients/steps optional so a note-only or
// rating-only edit never resubmits the whole recipe. Serving scaling
// is transient and client-side: it changes only the quantities shown
// while cooking and never calls update_recipe, so the stored recipe
// is untouched.
//
// Response shapes are taken from the integration's own source
// (custom_components/anylist/__init__.py `_serialize_recipe` and
// `recipe_search.py`); see README.md for the exact shapes and what is
// still unconfirmed against a live account. The card renders only what
// a response actually carries and tolerates every field being absent.
//
// Kitchen-grade, same bar as the timer screen: big touch targets,
// legible at a distance, usable with wet or dirty hands — no fine
// control, no hidden menus. It styles itself like a modern recipe app
// (warm palette, soft cards, segmented tabs) rather than borrowing
// Home Assistant's theme, so it does not read as a stock HA card.
// The card is one file with no dependencies and no backend of its own,
// so removing it later is deleting the file and its Lovelace resource
// (see README.md).
//
// Version 1.5.0 — see CHANGELOG.md.

// How long to wait after the last keystroke before searching, so one
// search runs per pause in typing instead of one per letter.
const SEARCH_DEBOUNCE_MS = 300;
// PIP (D3, R-IMPL-17–22): the floating timer indicator auto-hides
// 5 s after it appears, fading out over 300 ms; a finished timer's
// PIP never auto-hides. A touch on the PIP suspends the 5 s clock
// until the touch ends. A swipe of ≥40 px in any direction collapses
// the PIP to its restore affordance.
const PIP_AUTO_HIDE_MS = 5000;
const PIP_FADE_MS = 300;
const PIP_SWIPE_PX = 40;
// The Timers card's pin key (T-IMPL-20, published by the Timers
// wave): the recipe card writes {timerId} here when the user taps a
// PIP; the Timers card reads it once per mount and clears it.
const TIMERS_PIN_KEY = "family-hub:timers:pin";
// Tap targets: search field, tabs and row buttons are 64px tall; chips
// never go below 56px. The pixel values live in the CSS below.

function asString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function asTrimmed(value) {
  return asString(value).trim();
}

function asInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function escapeHtml(value) {
  return asString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Steps arrive as plain strings, but AnyList lets authors write them
// with light markdown: "# Header" for a section header inside the
// steps, **bold** and _italic_ inline. Render that instead of showing
// the markers literally. HTML is escaped first, so a step can never
// inject markup; only the three documented markers are interpreted.
// Returns { header: boolean, html: string } — a header step renders
// as a sub-heading and does not consume a step number.
function renderStepText(value) {
  const text = asTrimmed(value);
  const headerMatch = /^#\s+(.*)$/.exec(text);
  const body = headerMatch ? headerMatch[1] : text;
  let html = escapeHtml(body);
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/_([^_]+)_/g, "<em>$1</em>");
  // A real step (not a section header) gets its times as tappable
  // timer chips: "simmer for 10 minutes" becomes a chip that starts
  // a 10-minute timer. Headers are labels, never actionable.
  if (!headerMatch) html = linkDurations(html);
  return { header: Boolean(headerMatch), html };
}

// Time phrases in step text, as tappable timer chips. Matches a
// number (integer or decimal) or "a"/"an" with a unit — hours,
// minutes or seconds, singular/plural/abbreviated ("10 minutes",
// "1 hour", "30 sec", "a minute"). A range ("6 to 8 minutes",
// "6-8 minutes") renders as ONE chip for the range ("6–8 minutes"),
// starting the upper bound. Combined durations ("1 hour 30 minutes")
// become one chip per part. Only text is touched: the HTML is split
// into tags and text first, so a time-looking string inside a tag or
// attribute is never rewritten. Each chip carries the total seconds;
// the card starts a timer for that long when it is tapped.
const DURATION_RE =
  /\b(?:(\d+(?:\.\d+)?)\s*(?:to|-|–|—)\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)|(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)|(a|an)\s+(hour|minute|second))\b/gi;

// A time unit as the kitchen reads it in full, plural ("min" →
// "minutes"), for range chips ("6–8 minutes").
function pluralTimeUnit(unit) {
  const u = String(unit).toLowerCase();
  if (u.startsWith("h")) return "hours";
  if (u.startsWith("m")) return "minutes";
  return "seconds";
}

function durationSeconds(amount, unit) {
  const n = amount === null ? 1 : Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = String(unit).toLowerCase();
  if (u.startsWith("h")) return Math.round(n * 3600);
  if (u.startsWith("m")) return Math.round(n * 60);
  return Math.round(n);
}

function linkDurations(html) {
  // Split into tags (left alone) and text (time phrases become chips).
  const parts = String(html).split(/(<[^>]*>)/g);
  return parts
    .map((part) => {
      if (!part || part.startsWith("<")) return part;
      DURATION_RE.lastIndex = 0;
      let out = "";
      let last = 0;
      let match;
      while ((match = DURATION_RE.exec(part)) !== null) {
        let seconds = null;
        let label = match[0];
        if (match[1] !== undefined) {
          // A range: one chip for the range, starting the upper bound.
          seconds = durationSeconds(match[2], match[3]);
          label = `${match[1]}–${match[2]} ${pluralTimeUnit(match[3])}`;
        } else if (match[4] !== undefined) {
          seconds = durationSeconds(match[4], match[5]);
        } else {
          seconds = durationSeconds(null, match[7]);
        }
        if (seconds === null) continue;
        out += part.slice(last, match.index);
        out += `<button class="time-chip" data-action="start-timer" data-seconds="${seconds}" aria-label="Start a ${escapeHtml(label)} timer">${escapeHtml(label)}</button>`;
        last = match.index + match[0].length;
      }
      out += part.slice(last);
      return out;
    })
    .join("");
}

// One ingredient row: quantity, name, optional note. Section headings
// are rendered by the caller, not here.
function renderIngredientRow(item) {
  const display = item.name || item.raw;
  const qty = item.quantity
    ? `<span class="qty">${escapeHtml(item.quantity)}</span>`
    : `<span class="qty"></span>`;
  const note = item.note ? ` <span class="ing-note">${escapeHtml(item.note)}</span>` : "";
  return `<div class="ingredient">${qty}<span class="ing-name">${escapeHtml(display)}${note}</span></div>`;
}

// A flat-string ingredient ("Flour 200 g", "Garlic 2 cloves") as a
// parsed item. The quantity is the first number anywhere, with the
// unit word right after it; the rest is the name. No number means an
// unquantified item ("Salt to taste" keeps its whole text as the
// name). Returns null for an empty string.
const FLAT_UNIT_WORDS = [
  "g", "kg", "mg", "ml", "l", "tsp", "tbsp", "cup", "cups",
  "teaspoon", "teaspoons", "tablespoon", "tablespoons",
  "oz", "lb", "lbs", "clove", "cloves", "slice", "slices",
  "piece", "pieces", "pinch", "can", "cans", "bunch", "bunches",
];
function parseFlatIngredient(value) {
  const raw = asTrimmed(value);
  if (!raw) return null;
  const match =
    /(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞])\s*([A-Za-z]+)?/.exec(raw);
  if (!match) return { name: raw, quantity: "", note: "", raw };
  const amountText = match[1];
  const unitWord = match[2] || "";
  const unit = FLAT_UNIT_WORDS.includes(unitWord.toLowerCase()) ? unitWord : "";
  const quantity = unit ? `${amountText} ${unit}` : amountText;
  const span = unit ? `${amountText} ${unit}` : amountText;
  let name = raw
    .replace(span, "")
    .trim()
    .replace(/^of\s+/i, "")
    .replace(/,\s*$/, "")
    .trim();
  if (!name) name = raw;
  return { name, quantity, note: "", raw };
}

// The dedup key for the entries/flat merge: normalized name +
// quantity + note, so the same ingredient written the same way in
// both lists counts once.
function ingredientKey(item) {
  return [item.name, item.quantity, item.note]
    .map((part) => normalizeSearchText(part || ""))
    .join("|");
}

// Merge the ordered entries with the flat list (RECIPE-11): entries
// first, then every flat ingredient that is not already an entry.
// Dedup is across the two lists only — duplicates inside one list
// are kept.
function mergeIngredientEntries(entries, flat) {
  const merged = [...entries];
  const seen = new Set(
    entries
      .filter((item) => item.type === "ingredient")
      .map((item) => ingredientKey(item)),
  );
  for (const item of flat) {
    const key = ingredientKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      type: "ingredient",
      name: item.name,
      quantity: item.quantity,
      note: item.note,
      raw: item.raw,
    });
  }
  return merged;
}

// A recipe as the card understands it, normalised once from whatever
// the action returned so the rendering code never has to guess at
// shapes. Every field is optional except id and name: the card shows
// what is there and skips what is not.
function normalizeRecipe(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  // The flat ingredient list. Headings are never ingredients: the
  // upstream format (PR #15) carries them inside `ingredients` with
  // `is_heading: true`, so they are filtered out here. A flat STRING
  // item ("Flour 200 g") is a real ingredient too (RECIPE-24): its
  // quantity is the first number anywhere, with the unit word right
  // after it; the rest is the name. Without this, a recipe whose
  // ingredients are flat strings renders "No ingredients listed."
  const parsedIngredients = Array.isArray(source.ingredients)
    ? source.ingredients
        .map((item) => {
          if (typeof item === "string") return parseFlatIngredient(item);
          if (item && typeof item === "object") {
            return {
              name: asTrimmed(item.name),
              quantity: asTrimmed(item.quantity),
              note: asTrimmed(item.note),
              // The integration also carries raw_ingredient (the original
              // unparsed line). It is kept as a fallback display only:
              // the card prefers the parsed name/quantity.
              raw: asTrimmed(item.raw_ingredient),
              // Upstream headings format (PR #15): a heading is an entry
              // inside `ingredients` with is_heading set. The entry id
              // is never shown anywhere.
              isHeading: item.is_heading === true,
            };
          }
          return null;
        })
        .filter(Boolean)
    : [];
  const ingredients = parsedIngredients
    .filter((item) => !item.isHeading && (item.name || item.raw))
    .map(({ isHeading, ...item }) => item);
  const steps = Array.isArray(source.preparation_steps)
    ? source.preparation_steps.map((step) => asTrimmed(step)).filter(Boolean)
    : [];
  // Ordered ingredient list: section headings interleaved with the plain
  // ingredients, exactly as AnyList stores them. Two shapes, in order:
  // the fork's `ingredient_entries` key (type section/ingredient), then
  // the upstream format (PR #15) where headings are `is_heading`
  // entries inside `ingredients`. The fork shape wins when it carries
  // anything; an empty or absent `ingredient_entries` falls through to
  // the upstream shape. Entries the card does not recognise are
  // dropped, never guessed at. Responses with neither have no entries;
  // the detail view then falls back to the flat `ingredients` list.
  const forkEntries = Array.isArray(source.ingredient_entries)
    ? source.ingredient_entries
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          if (asTrimmed(item.type) === "section") {
            return { type: "section", name: asTrimmed(item.name) };
          }
          if (asTrimmed(item.type) === "ingredient") {
            return {
              type: "ingredient",
              name: asTrimmed(item.name),
              quantity: asTrimmed(item.quantity),
              note: asTrimmed(item.note),
              raw: asTrimmed(item.raw_ingredient),
            };
          }
          return null;
        })
        .filter(
          (item) =>
            item &&
            (item.type === "section" ? item.name : item.name || item.raw),
        )
    : [];
  const baseEntries =
    forkEntries.length > 0
      ? forkEntries
      : parsedIngredients.some((item) => item.isHeading)
        ? parsedIngredients
            .map((item) =>
              item.isHeading
                ? { type: "section", name: item.name }
                : {
                    type: "ingredient",
                    name: item.name,
                    quantity: item.quantity,
                    note: item.note,
                    raw: item.raw,
                  },
            )
            .filter(
              (item) =>
                item.type === "section" ? item.name : item.name || item.raw,
            )
        : [];
  // Merge (RECIPE-11/RECIPE-24): when the ordered entries exist but
  // are a partial subset of the flat list, the flat-only ingredients
  // are appended after the entries instead of silently dropped.
  // Dedup is by normalized text, entries first. Duplicates INSIDE
  // the entries are kept verbatim (they are authoritative ordered
  // rows — toggling one of two identical rows checks only that
  // row); duplicates inside the flat list are collapsed (the flat
  // list is a reconstruction, and a repeated identical line is one
  // ingredient listed twice). The merge ALWAYS runs, even with no
  // entries: a flat-only recipe still needs its internal dupes
  // collapsed (rec-t9: "Garlic 2 cloves" twice renders 3 rows, not
  // 5). When there are no entries at all the merged flat list is
  // the list (RECIPE-24's flat-string recipes render from it).
  const entries = mergeIngredientEntries(baseEntries, ingredients);
  const collections = Array.isArray(source.collections)
    ? source.collections
        .filter((item) => item && typeof item === "object" && asTrimmed(item.id))
        .map((item) => ({ id: asTrimmed(item.id), name: asTrimmed(item.name) }))
    : [];
  const photos = Array.isArray(source.photo_urls)
    ? source.photo_urls.map((url) => asTrimmed(url)).filter(Boolean)
    : [];
  return {
    id: asTrimmed(source.id),
    name: asTrimmed(source.name) || "Untitled recipe",
    ingredients,
    entries,
    steps,
    note: asTrimmed(source.note),
    sourceName: asTrimmed(source.source_name),
    sourceUrl: asTrimmed(source.source_url),
    servings: asTrimmed(source.servings),
    // Times arrive as plain numbers of SECONDS (protobuf fields 18/19).
    // OQ-9 (RECIPE-V1) — RESOLVED in the Recipes wave-1 build
    // (Nov 11, 2026), three independent sources: (a) the AnyList
    // integration source — client.py:870 reads fields 18/19 raw with
    // no conversion, sync.py:124 stores them as prep_time_seconds,
    // store.py:64-65 names the columns prep_time_seconds /
    // cook_time_seconds, __init__.py:428 serializes them as
    // "prep_time"; (b) the rig fixture generator's header, "prep_time
    // / cook_time in SECONDS"; (c) the design's own R4 step 2 expects
    // "Total 35 min · Prep 15 min · Cook 20 min" for the 900/1200
    // recipe — true only in seconds. The exporter's canonical-JSON
    // label "prep_time_minutes" (canonical.rs:82) passes the raw
    // value through unconverted — the label is the misnomer, not the
    // value. The total-time line ships on the strength of this.
    // The model keeps seconds; formatDuration converts at display
    // time.
    prepTime: asInt(source.prep_time),
    cookTime: asInt(source.cook_time),
    // Rating is a whole number from 1 to 5 (anylist_rs clamps it).
    rating: asInt(source.rating),
    photoUrls: photos,
    collections,
  };
}

// Search text, normalised the way the integration normalises it
// (custom_components/anylist/recipe_search.py normalize_search_text):
// accents folded, case folded, punctuation split into words. The card
// reproduces the server's matching locally, so a search costs no
// download.
function normalizeSearchText(value) {
  return asString(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function searchWords(value) {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(" ") : [];
}

// One edit: a single insertion, deletion, substitution, or transposition
// of adjacent characters. Short words (under 4 characters) need an
// exact match — a one-edit difference there is a different word, not a
// typo. Mirrors the integration's _is_minor_typo.
function isMinorTypo(first, second) {
  if (Math.min(first.length, second.length) < 4) return false;
  if (Math.abs(first.length - second.length) > 1) return false;
  const [short, long] =
    first.length <= second.length ? [first, second] : [second, first];
  let index = 0;
  while (index < short.length && short[index] === long[index]) index++;
  if (short.length !== long.length) {
    return short.slice(index) === long.slice(index + 1);
  }
  return (
    short.slice(index + 1) === long.slice(index + 1) ||
    (index + 1 < short.length &&
      short[index] === long[index + 1] &&
      short[index + 1] === long[index] &&
      short.slice(index + 2) === long.slice(index + 2))
  );
}

// How well one query word matches one title word: an exact word, a
// word the user is still typing (prefix), a one-edit typo, or a word
// containing the query. A query word that matches none of these does
// not match the title word at all.
const WORD_WEIGHT_EXACT = 1;
const WORD_WEIGHT_PREFIX = 0.85;
const WORD_WEIGHT_TYPO = 0.8;
const WORD_WEIGHT_SUBSTRING = 0.5;

function wordWeight(queryWord, titleWord) {
  if (queryWord === titleWord) return WORD_WEIGHT_EXACT;
  if (titleWord.startsWith(queryWord)) return WORD_WEIGHT_PREFIX;
  if (isMinorTypo(queryWord, titleWord)) return WORD_WEIGHT_TYPO;
  if (titleWord.includes(queryWord)) return WORD_WEIGHT_SUBSTRING;
  return 0;
}

// How well the query words match one field's words: which words
// match, and how well (exact 1, prefix 0.85, typo 0.8, substring
// 0.5), each field word used at most once. Mirrors the matching the
// old title-only search did, applied to one field at a time.
function fieldMatch(queryWords, fieldText) {
  const fieldWords = new Set(searchWords(fieldText));
  const matchedWords = new Set();
  let weighted = 0;
  for (const word of queryWords) {
    if (fieldWords.has(word)) {
      fieldWords.delete(word);
      matchedWords.add(word);
      weighted += WORD_WEIGHT_EXACT;
    }
  }
  for (const word of queryWords) {
    if (matchedWords.has(word)) continue;
    let bestWord = null;
    let bestWeight = 0;
    for (const candidate of fieldWords) {
      const weight = wordWeight(word, candidate);
      if (weight > bestWeight) {
        bestWeight = weight;
        bestWord = candidate;
      }
    }
    if (bestWord !== null) {
      fieldWords.delete(bestWord);
      matchedWords.add(word);
      weighted += bestWeight;
    }
  }
  return { matchedWords, weighted };
}

// Everything a search looks at, per recipe: title, ingredients
// (name, quantity, note, raw — structured entries and flat list),
// steps, the note (description/notes), and the source (name + URL).
function recipeSearchText(recipe) {
  const ingredientText = [
    ...(recipe.ingredients || []).map(
      (item) => `${item.name || ""} ${item.quantity || ""} ${item.note || ""} ${item.raw || ""}`,
    ),
    ...(recipe.entries || [])
      .filter((item) => item.type === "ingredient")
      .map(
        (item) => `${item.name || ""} ${item.quantity || ""} ${item.note || ""} ${item.raw || ""}`,
      ),
  ].join(" ");
  return {
    title: recipe.name || "",
    ingredient: ingredientText,
    step: (recipe.steps || []).join(" "),
    note: recipe.note || "",
    source: `${recipe.sourceName || ""} ${recipe.sourceUrl || ""}`,
  };
}

// Local search over the loaded recipes, everywhere — not just the
// title. A multi-word query matches only when EVERY word matches
// somewhere (not necessarily in the same field). Ranking is by match
// quality with the field order title > ingredient > step > note /
// source: a title match always outranks an ingredient match, which
// outranks a step match. Typo tolerance is kept from the old
// title-only search. Search costs no download: it reads the loaded
// list.
function searchRecipes(recipes, query) {
  const queryWords = [...new Set(searchWords(query))];
  const total = queryWords.length;
  if (total === 0) return [];
  const scored = [];
  for (const recipe of recipes) {
    const fields = recipeSearchText(recipe);
    const title = fieldMatch(queryWords, fields.title);
    const ingredient = fieldMatch(queryWords, fields.ingredient);
    const step = fieldMatch(queryWords, fields.step);
    const note = fieldMatch(queryWords, fields.note);
    const source = fieldMatch(queryWords, fields.source);
    const matchedAnywhere = new Set([
      ...title.matchedWords,
      ...ingredient.matchedWords,
      ...step.matchedWords,
      ...note.matchedWords,
      ...source.matchedWords,
    ]);
    if (matchedAnywhere.size < total) continue;
    // An exact title match outranks every partial title match: a
    // search for "Carrot Soup" surfaces the recipe actually called
    // that first, ahead of "Carrot Ginger Soup".
    const exactTitle =
      normalizeSearchText(fields.title) === normalizeSearchText(query);
    const score =
      (exactTitle ? 10000 : 0) +
      (title.weighted / total) * 1000 +
      (ingredient.weighted / total) * 100 +
      (step.weighted / total) * 10 +
      (note.weighted / total) +
      (source.weighted / total);
    scored.push({ recipe, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.recipe.name.toLowerCase().localeCompare(b.recipe.name.toLowerCase()) ||
      a.recipe.id.localeCompare(b.recipe.id),
  );
  return scored.map((entry) => entry.recipe);
}

// A duration in seconds as the kitchen reads it: rounded to the nearest
// minute, hours once it reaches an hour. Null, zero, negative, and
// anything that rounds to zero minutes (under 30 seconds) render as
// nothing — the caller omits the part entirely.
function formatDuration(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return "";
  const minutes = Math.round(n / 60);
  if (minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

// Servings arrives as a freeform string: a bare number gets "Serves",
// a string that already says it ("4 servings", "2 (bowls)") is shown
// as it came.
function formatServings(servings) {
  if (!servings) return "";
  return /^\d+$/.test(servings) ? `Serves ${servings}` : servings;
}

// -- Fractions and scaling (RECIPE-1, RECIPE-2) ---------------------------
//
// A quantity is an amount plus the rest ("500 g", "1 1/2 cups",
// "2–3 tbsp"). Amounts parse as mixed numbers, fractions (ASCII or
// Unicode), decimals and integers; results format as fractions, never
// decimals, rounded to the nearest value in the rounding set below
// (nearest ⅛, plus ⅓ and ⅔, which "nearest ⅛" alone would miss). A
// value that had to be rounded carries the ≈ marker, so the cook can
// see it is approximate ("≈⅛ cup", not "⅛ cup").

const UNICODE_FRACTION_VALUES = {
  "½": 1 / 2,
  "¼": 1 / 4,
  "¾": 3 / 4,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 1 / 8,
  "⅜": 3 / 8,
  "⅝": 5 / 8,
  "⅞": 7 / 8,
};
const UNICODE_FRACTION_TEXT = {
  "1/8": "⅛",
  "1/4": "¼",
  "3/8": "⅜",
  "1/3": "⅓",
  "1/2": "½",
  "5/8": "⅝",
  "2/3": "⅔",
  "3/4": "¾",
  "7/8": "⅞",
};
// Round to the nearest of these — the set "round to nearest ⅛"
// produces, plus ⅓ and ⅔.
const ROUNDING_FRACTIONS = [0, 1 / 8, 1 / 4, 3 / 8, 1 / 3, 1 / 2, 5 / 8, 2 / 3, 3 / 4, 7 / 8, 1];
const FRACTION_WORDS = {
  "1/2": "half",
  "1/3": "a third",
  "1/4": "a quarter",
  "2/3": "two thirds",
  "3/4": "three quarters",
  "1/8": "an eighth",
  "3/8": "three eighths",
  "5/8": "five eighths",
  "7/8": "seven eighths",
};
// Units counted as whole items, not measured amounts ("1 egg" is a
// count; "500 g" is not). A fractional count always gets a usable
// instruction (see countNoteFor).
const COUNT_UNITS = ["egg", "eggs", "clove", "cloves", "piece", "pieces", "slice", "slices"];

// The amount at the start of a quantity string: mixed number
// ("1 1/2"), fraction ("1/2"), Unicode fraction ("½", "1½"),
// decimal or integer. Returns { value, length } (length = how many
// characters the amount took) or null when there is no amount — or
// when the leading token is malformed ("1/0", "1..2", "1/2/3"), so a
// broken quantity is flagged instead of half-scaled.
function parseAmountAt(text) {
  const s = String(text);
  let match = /^(\d+)\s+(\d+)\s*\/\s*(\d+)/.exec(s);
  if (match) {
    const den = Number(match[3]);
    if (den > 0 && !/[0-9./]/.test(s[match[0].length] || "")) {
      return { value: Number(match[1]) + Number(match[2]) / den, length: match[0].length };
    }
    return null;
  }
  match = /^(\d+)?\s*([½¼¾⅓⅔⅛⅜⅝⅞])/.exec(s);
  if (match) {
    if (!/[0-9./]/.test(s[match[0].length] || "")) {
      const whole = match[1] ? Number(match[1]) : 0;
      return { value: whole + UNICODE_FRACTION_VALUES[match[2]], length: match[0].length };
    }
    return null;
  }
  match = /^(\d+)\s*\/\s*(\d+)/.exec(s);
  if (match) {
    const den = Number(match[2]);
    if (den > 0 && !/[0-9./]/.test(s[match[0].length] || "")) {
      return { value: Number(match[1]) / den, length: match[0].length };
    }
    return null;
  }
  match = /^(\d+(?:\.\d+)?)/.exec(s);
  if (match) {
    if (!/[0-9./]/.test(s[match[0].length] || "")) {
      return { value: Number(match[1]), length: match[0].length };
    }
    return null;
  }
  return null;
}

function fractionKey(fraction) {
  const known = [
    [1 / 8, "1/8"],
    [1 / 4, "1/4"],
    [3 / 8, "3/8"],
    [1 / 3, "1/3"],
    [1 / 2, "1/2"],
    [5 / 8, "5/8"],
    [2 / 3, "2/3"],
    [3 / 4, "3/4"],
    [7 / 8, "7/8"],
  ];
  for (const [value, key] of known) {
    if (Math.abs(value - fraction) < 1e-9) return key;
  }
  return "";
}

// An amount as the kitchen reads it: whole + Unicode fraction
// ("1 ½", "⅓"). Returns { text, approximate } — approximate is true
// when the value had to be rounded to the nearest value in the
// rounding set. Ties round up: a little more food beats a little less
// when the true value sits exactly between two fractions.
function formatAmount(value) {
  if (!Number.isFinite(value) || value < 0) return { text: "", approximate: false };
  const whole = Math.floor(value + 1e-9);
  const frac = value - whole;
  let best = ROUNDING_FRACTIONS[0];
  let bestDiff = Infinity;
  for (const candidate of ROUNDING_FRACTIONS) {
    const diff = Math.abs(frac - candidate);
    if (
      diff < bestDiff - 1e-9 ||
      (Math.abs(diff - bestDiff) <= 1e-9 && candidate > best)
    ) {
      best = candidate;
      bestDiff = diff;
    }
  }
  const approximate = bestDiff > 1e-9;
  let shownWhole = whole;
  let shownFrac = best;
  if (shownFrac === 1) {
    shownWhole += 1;
    shownFrac = 0;
  }
  if (shownFrac === 0) return { text: String(shownWhole), approximate };
  const fracText = UNICODE_FRACTION_TEXT[fractionKey(shownFrac)];
  return {
    text: shownWhole > 0 ? `${shownWhole} ${fracText}` : fracText,
    approximate,
  };
}

// Tidy-unit conversion (RECIPE-2): convert only when the result is
// cleaner — 48 tsp → 1 cup, 24 tsp → ½ cup, 12 tsp → ¼ cup,
// 3 tsp → 1 tbsp. A teaspoon amount converts to tablespoons when the
// tablespoon amount is exact and at least 1; tablespoons convert to
// cups when the cup amount is exact and at least ¼ cup. Anything
// else stays in its own unit ("2 tsp" never becomes "⅛ cup").
function tidyUnit(amount, unit) {
  const lower = String(unit).toLowerCase();
  const isTsp = lower === "tsp" || lower === "teaspoon" || lower === "teaspoons";
  const isTbsp =
    lower === "tbsp" || lower === "tbsps" || lower === "tablespoon" || lower === "tablespoons";
  let value = amount;
  let name = unit;
  if (isTsp && value >= 3) {
    const tbsp = value / 3;
    if (!formatAmount(tbsp).approximate) {
      value = tbsp;
      name = "tbsp";
    }
  }
  if ((isTbsp || name === "tbsp") && value >= 4) {
    const cups = value / 16;
    if (!formatAmount(cups).approximate) {
      value = cups;
      name = "cup";
    }
  }
  return { amount: value, unit: name };
}

// Scale one amount with its rest ("g", "cups", "large bunch").
// Returns { text, amountText, approximate }: text is the full scaled
// quantity ("1 ½ cups"), amountText is just the scaled amount
// ("1 ½") for ranges, where the unit belongs to the upper end only.
function scaleSingleAmount(scaledValue, rest) {
  const unitMatch = /^(\S+)\s*(.*)$/.exec(rest || "");
  const unit = unitMatch ? unitMatch[1] : "";
  const tail = unitMatch ? unitMatch[2] : "";
  const lower = unit.toLowerCase();
  const tidyUnits = ["tsp", "teaspoon", "teaspoons", "tbsp", "tbsps", "tablespoon", "tablespoons"];
  if (tidyUnits.includes(lower)) {
    const tidied = tidyUnit(scaledValue, lower);
    const formatted = formatAmount(tidied.amount);
    const unitText =
      tidied.unit === "cup" ? (tidied.amount > 1 ? "cups" : "cup") : tidied.unit;
    const text = [formatted.text, unitText, tail].filter(Boolean).join(" ");
    return {
      text: formatted.approximate ? `≈${text}` : text,
      amountText: formatted.approximate ? `≈${formatted.text}` : formatted.text,
      approximate: formatted.approximate,
    };
  }
  const formatted = formatAmount(scaledValue);
  // Cups and counted items read singular at exactly one ("1 cup",
  // "1 egg", not "1 cups" / "1 eggs") and plural otherwise.
  let shownUnit = unit;
  if (lower === "cup" || lower === "cups") {
    shownUnit = scaledValue > 1 ? "cups" : "cup";
  } else if (COUNT_UNITS.includes(lower)) {
    const singular = lower.replace(/s$/, "");
    shownUnit = scaledValue === 1 ? singular : `${singular}s`;
  }
  const shownRest = [shownUnit, tail].filter(Boolean).join(" ");
  const text = [formatted.text, shownRest].filter(Boolean).join(" ");
  return {
    text: formatted.approximate ? `≈${text}` : text,
    amountText: formatted.approximate ? `≈${formatted.text}` : formatted.text,
    approximate: formatted.approximate,
  };
}

// Scale one quantity string. Returns { text, unparseable, approximate }.
// - Fractions and mixed numbers scale and format as fractions.
// - Ranges scale both ends ("2–3 cups" at 2× → "4–6 cups").
// - Compounds scale piece by piece ("1 cup + 2 tbsp").
// - Unquantified items ("salt to taste", "a pinch") are left as written.
// - A leading token that looks numeric but cannot be parsed ("1/0")
//   is flagged unparseable — never silently left or silently dropped.
// - An invalid factor (0, negative, non-numeric) leaves the quantity
//   unchanged; the stepper cannot produce one, and the guard keeps a
//   bad factor from ever reaching the cook. Metric/imperial
//   conversion is deferred by the spec and is not done here.
function scaleQuantityDetail(quantity, scale) {
  const text = asTrimmed(quantity);
  if (!text) return { text: asString(quantity), unparseable: false, approximate: false };
  if (!Number.isFinite(scale) || scale <= 0) {
    return { text: asString(quantity), unparseable: false, approximate: false };
  }
  // Scaling by exactly 1 is the identity: the quantity is shown as
  // stored, with no tidy-unit conversion — tidying only applies when
  // an amount actually changes.
  if (scale === 1) {
    return { text: asString(quantity), unparseable: false, approximate: false };
  }
  if (text.includes(" + ")) {
    const parts = text.split(" + ");
    const scaled = parts.map((part) => scaleQuantityDetail(part.trim(), scale));
    return {
      text: scaled.map((part) => part.text).join(" + "),
      unparseable: scaled.some((part) => part.unparseable),
      approximate: scaled.some((part) => part.approximate),
    };
  }
  const range = /^(.+?)\s*(?:[–—-]|\bto\b)\s*(.+)$/.exec(text);
  if (range) {
    const low = parseAmountAt(range[1].trim());
    const high = parseAmountAt(range[2].trim());
    if (low && high) {
      const lowRest = range[1].trim().slice(low.length).trim();
      const highRest = range[2].trim().slice(high.length).trim();
      const lowScaled = scaleSingleAmount(low.value * scale, lowRest || highRest);
      const highScaled = scaleSingleAmount(high.value * scale, highRest);
      return {
        text: `${lowScaled.amountText}–${highScaled.text}`,
        unparseable: false,
        approximate: lowScaled.approximate || highScaled.approximate,
      };
    }
  }
  const parsed = parseAmountAt(text);
  if (!parsed) {
    // A leading digit or fraction character that does not parse is a
    // broken quantity, not an unquantified one.
    const looksNumeric = /^[\d½¼¾⅓⅔⅛⅜⅝⅞]/.test(text);
    return { text: asString(quantity), unparseable: looksNumeric, approximate: false };
  }
  const rest = text.slice(parsed.length).trim();
  const scaled = scaleSingleAmount(parsed.value * scale, rest);
  return { ...scaled, unparseable: false };
}

// Scale a quantity string for display (RECIPE-1/RECIPE-2). See
// scaleQuantityDetail for the rules; this keeps the plain-string
// shape the rest of the card uses.
function scaleQuantity(quantity, scale) {
  return scaleQuantityDetail(quantity, scale).text;
}

// A usable instruction for a fractional COUNT ("½ egg — beat 1 egg
// and use half"). Silence is not an option: a fractional count
// always gets one. Returns "" when the scaled count is whole or the
// item is measured, not counted.
function countNoteFor(item, scaledText) {
  if (!item || !item.name) return "";
  const parsed = parseAmountAt(asTrimmed(item.quantity));
  if (!parsed) return "";
  const rest = asTrimmed(item.quantity).slice(parsed.length).trim();
  const unitWord = (rest.split(/\s+/)[0] || "").toLowerCase();
  const isCount = !unitWord || COUNT_UNITS.includes(unitWord);
  if (!isCount) return "";
  const scaled = parseAmountAt(scaledText.replace(/^≈/, ""));
  if (!scaled || Number.isInteger(scaled.value)) return "";
  const whole = Math.ceil(scaled.value);
  const fracValue = scaled.value - Math.floor(scaled.value);
  const fracText = formatAmount(fracValue).text;
  const fractionWord = FRACTION_WORDS[fractionKey(fracValue)] || fracText;
  // The counted thing is the UNIT word ("cloves"), not the ingredient
  // name ("garlic" — "prepare 2 garlics" is not a sentence). A bare
  // number with no unit falls back to the name ("1 egg" has no unit
  // word of its own; the name is the count).
  const counted = unitWord
    ? unitWord.replace(/s$/, "")
    : item.name.replace(/s$/, "").toLowerCase();
  const name = whole === 1 ? counted : `${counted}s`;
  const verb = /egg/i.test(item.name) || unitWord === "egg" || unitWord === "eggs" ? "beat" : "prepare";
  if (scaled.value < 1) return `— ${verb} ${whole} ${name} and use ${fractionWord}`;
  return `— ${verb} ${whole} ${name} and use ${fracText} of them`;
}

// The recipe's stored servings as a range, or null. "First number
// ANYWHERE": "Serves 4" → 4; "Makes 12 muffins" → 12; "Yield: 8" →
// 8; "2 (bowls)" → 2; "4 servings" → 4. A range ("4-6") uses the
// lower bound as the scaling base and renders the scaled range
// ("4–6" at 2× → "8–12"). A string with no number has no base.
function parseServings(servings) {
  const text = asTrimmed(servings);
  if (!text) return null;
  const range = /(\d+(?:\.\d+)?)\s*(?:[–—-]|\bto\b)\s*(\d+(?:\.\d+)?)/.exec(text);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    if (Number.isFinite(low) && low > 0 && Number.isFinite(high) && high > low) {
      return { low, high };
    }
  }
  const single = /(?:^|[^\d\-])(\d+(?:\.\d+)?)/.exec(text);
  if (!single) return null;
  const value = Number(single[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { low: value, high: value };
}

// A servings range as the kitchen reads it: "4", or "4–6".
function formatServingsRange(servings) {
  if (!servings) return "";
  return servings.high > servings.low ? `${servings.low}–${servings.high}` : String(servings.low);
}

// Quantities inside step text, scaled with the same rules as the
// ingredient list (RECIPE-23): "add 2 cups of stock" at 0.5× says
// "add 1 cup of stock". Only cooking amounts are touched — time
// phrases ("cook for 9 minutes") are durations, not quantities, and
// are left for the timer chips. Ranges scale both ends.
const STEP_AMOUNT_RE =
  /\b(?:(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞])\s*[–—-]\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞])|(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞]))\s*(cups?|tablespoons?|tbsps?|teaspoons?|tsps?|grams?|kilograms?|kg|milliliters?|millilitres?|ml|liters?|litres?|l|ounces?|oz|pounds?|lbs?|eggs?|cloves?|pieces?|slices?)\b/gi;
function scaleStepText(text, factor) {
  if (!factor || factor === 1 || !text) return text;
  STEP_AMOUNT_RE.lastIndex = 0;
  return String(text).replace(STEP_AMOUNT_RE, (match) => {
    const scaled = scaleQuantityDetail(match, factor);
    return scaled.unparseable ? match : scaled.text;
  });
}

function formatStars(rating) {
  if (rating === null || rating === undefined || rating <= 0) return "";
  const stars = Math.min(5, rating);
  return "★".repeat(stars) + "☆".repeat(5 - stars);
}

// The rating as stars AND text ("★★★★☆ 4/5") — stars alone have
// no text alternative.
function formatStarsText(rating) {
  const stars = formatStars(rating);
  if (!stars) return "";
  return `${stars} ${Math.min(5, rating)}/5`;
}

// One line of metadata under a recipe name, as segments: only the
// parts that exist. Times are seconds in the model (see
// normalizeRecipe); rating is stars out of 5, shown as stars + text.
// Each segment is one unbreakable unit ("Prep 5 min", "Serves 4") —
// the renderer keeps segments whole and wraps only between them, so
// a value never splits across lines.
function formatMeta(recipe) {
  const parts = [];
  const prep = formatDuration(recipe.prepTime);
  if (prep) parts.push(`Prep ${prep}`);
  const cook = formatDuration(recipe.cookTime);
  if (cook) parts.push(`Cook ${cook}`);
  const servings = formatServings(recipe.servings);
  if (servings) parts.push(servings);
  const stars = formatStarsText(recipe.rating);
  if (stars) parts.push(stars);
  return parts;
}

// The metadata line as HTML: each segment wrapped so it cannot break
// inside, joined by a middot that sits between segments only. The
// rating segment is stars + text; it gets the stars class so it
// renders amber instead of grey metadata text.
function formatMetaHtml(recipe) {
  const parts = formatMeta(recipe);
  if (parts.length === 0) return "";
  return parts
    .map((part) => {
      const isStars = part.includes("★") || part.includes("☆");
      return `<span class="meta-seg${isStars ? " stars" : ""}">${escapeHtml(part)}</span>`;
    })
    .join(`<span class="meta-sep" aria-hidden="true">·</span>`);
}

// Sort keys the list offers (RECIPE-19): name, rating, cook time,
// prep time only. "Most-cooked" needs cooked-history, "recent" needs
// a date, "favorites" needs a favorites store — none exists, so those
// are not offered. Rating sorts highest first (unrated last); times
// sort shortest first (no time last); ties break by name.
function sortRecipes(recipes, sortKey) {
  const key = sortKey || "name";
  const byName = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  const copy = [...recipes];
  if (key === "rating") {
    copy.sort(
      (a, b) => (b.rating || 0) - (a.rating || 0) || byName(a, b),
    );
  } else if (key === "cook" || key === "prep") {
    const field = key === "cook" ? "cookTime" : "prepTime";
    copy.sort((a, b) => {
      const aTime = a[field];
      const bTime = b[field];
      if (aTime === null && bTime === null) return byName(a, b);
      if (aTime === null) return 1;
      if (bTime === null) return -1;
      return aTime - bTime || byName(a, b);
    });
  } else {
    copy.sort(byName);
  }
  return copy;
}

function filterByCollection(recipes, collectionId) {
  if (!collectionId) return recipes;
  return recipes.filter((recipe) =>
    recipe.collections.some((item) => item.id === collectionId)
  );
}

// Collection chips come from the loaded recipes, not a separate
// get_collections call: every collection a recipe carries becomes a
// chip, deduplicated by id and sorted by name. A collection with no
// recipes has no chip — it would list zero recipes anyway.
function deriveCollections(recipes) {
  const byId = new Map();
  for (const recipe of recipes) {
    for (const collection of recipe.collections) {
      if (!byId.has(collection.id)) byId.set(collection.id, collection);
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );
}

// -- Device detection (SHARED MECHANISM) ----------------------------------
//
// The same detection runs in the AnyList recipe card
// (k-mehta/ha-anylist-recipe-card), the Satellite Timers card
// (k-mehta/ha-satellite-timers), the home card and the standalone
// nav strip. It is ONE mechanism, copied verbatim into each card
// file: each card is a single standalone file with no imports, so the
// code cannot be shared by import — the copies must stay identical.
// If you change the signals, the precedence, or the category names
// here, change them in the other cards too, and update
// ADAPTIVE-LAYOUT.md (which is also identical in both repos).
//
// Signals (all read from the browser the card is running in):
//   viewport width/height — the strongest signal; the layout follows
//     the viewport, not the device name.
//   pointer type — matchMedia("(pointer: coarse)") is a finger/touch
//     screen; "(pointer: fine)" is a mouse/trackpad.
//   touch — "ontouchstart" in window, or navigator.maxTouchPoints > 0.
//   user agent — only as a tiebreaker for phones/tablets, never alone:
//     a desktop browser can spoof it, and a kiosk can strip it.
//
// Precedence (first match wins) — the unified rule (spec §3.7),
// with the DESIGN-9 tablet category (Phase 7):
//   1. The exact 1920x1200 panel signature, either orientation, is
//      the hub — FIRST, before any pointer check, so a hub with a
//      mouse attached (or a bench test with mouse only) still reads
//      as the hub. The same panel rotated (1200x1920) is the hub in
//      portrait (O2-01). A bare "width >= 1600 + landscape → hub"
//      rule is FORBIDDEN: it classifies every 1920x1080 desktop
//      monitor as a hub.
//   2. An iPad user agent is a tablet; an Android tablet ("Android"
//      with no "Mobi"/"Mobile" token, viewport at least 768px) is a
//      tablet.
//   3. A phone/tablet user agent ("Mobi", "Android", "iPhone",
//      "iPod") is mobile.
//   4. A viewport narrower than 768px is mobile (a narrow desktop
//      window gets the single-column layout too — the layout follows
//      the viewport).
//   5. A touch screen in the tablet band (768-1024px wide, either
//      orientation) is a tablet.
//   6. A coarse pointer on anything but a huge landscape screen is
//      mobile (phones).
//   7. A touch screen that is hub-sized and landscape IS the hub,
//      even when a mouse is also attached: the kiosk has a mouse, so
//      a fine pointer is present too, and checking fine first would
//      mis-detect the hub as a desktop. Touch + hub size wins over
//      fine pointer.
//   8. A coarse pointer on a huge landscape screen is the hub.
//   9. A fine pointer is desktop.
//   10. With no pointer information: a viewport at least 1024px wide
//      is desktop; anything else is mobile.
//
// Known limits (every fallback still renders a usable layout, never a
// broken one):
//   - A 1920x1200 laptop reads as the hub, and so does a 1200x1920
//     one: the panel signature is the only discriminator, and a
//     laptop that size is indistinguishable from the wall panel by
//     size alone. That is fine: the hub layout is just big targets
//     on a wide screen.
//   - A phone in desktop mode (no mobile user agent) still reads as
//     mobile by width (rule 4).
//   - A touchscreen laptop at 1366x768 (coarse, outside the tablet
//     band) still reads as mobile — open question OQ-7 (Phase 7 log).
//   - The hub is recognised by size + touch + landscape, not by name:
//     if the kiosk display changes size, the thresholds above are the
//     place to adjust.
//
// Orientation is separate from category: landscape is width >= height,
// portrait is width < height. The category picks the control sizes and
// the base layout; orientation picks the grid (e.g. one column in
// portrait, two in landscape on mobile).

const HUB_PANEL_WIDTH_PX = 1920;
const HUB_PANEL_HEIGHT_PX = 1200;
const MOBILE_MAX_WIDTH_PX = 768;
const DESKTOP_MIN_WIDTH_PX = 1024;
const MOBILE_USER_AGENT = /Mobi|Android|iPhone|iPad|iPod/i;
const TABLET_MAX_WIDTH_PX = 1024;
const TABLET_USER_AGENT = /iPad/i;
const ANDROID_USER_AGENT = /Android/i;
const MOBILE_TOKEN = /Mobi/i;

// The device the card is running on, from a plain environment object
// (width/height in CSS pixels, pointer flags, touch flag, user agent).
// Pure — no browser access — so it is unit-testable in node. Returns
// { category: "hub" | "desktop" | "tablet" | "mobile", orientation:
// "landscape" | "portrait" }.
function detectDevice(env) {
  const width = Number((env && env.width) || 0);
  const height = Number((env && env.height) || 0);
  const orientation = width >= height ? "landscape" : "portrait";
  const userAgent = String((env && env.userAgent) || "");
  const coarse = Boolean(env && env.coarsePointer);
  const fine = Boolean(env && env.finePointer);
  const touch = Boolean(env && env.touch);
  let category;
  // Rule 1 — the kitchen panel, either orientation: the exact
  // 1920x1200 signature is the hub in landscape, and the same panel
  // rotated (1200x1920) is the hub in portrait (O2-01 — the portrait
  // wall needs its OWN layout, not the phone layout). A 1920x1200
  // laptop reads as hub too — the documented residual (spec §3.7):
  // the panel signature is the only discriminator.
  if (
    (width === HUB_PANEL_WIDTH_PX && height === HUB_PANEL_HEIGHT_PX) ||
    (width === HUB_PANEL_HEIGHT_PX && height === HUB_PANEL_WIDTH_PX)
  )
    category = "hub";
  // A tablet user agent is a tablet, whatever the viewport: an iPad
  // in split view is still a tablet (its narrow width only changes
  // the column count, via the <900px override in the CSS).
  else if (TABLET_USER_AGENT.test(userAgent)) category = "tablet";
  // An Android tablet reports "Android" with no "Mobi"/"Mobile"
  // token; an Android phone reports "Mobile". The width guard keeps
  // a narrow Android phone in desktop mode from reading as a tablet.
  else if (
    ANDROID_USER_AGENT.test(userAgent) &&
    !MOBILE_TOKEN.test(userAgent) &&
    width >= MOBILE_MAX_WIDTH_PX
  )
    category = "tablet";
  else if (MOBILE_USER_AGENT.test(userAgent)) category = "mobile";
  else if (width < MOBILE_MAX_WIDTH_PX) category = "mobile";
  // A touch screen in the tablet band (768-1024px wide, either
  // orientation) is a tablet - 1024x768 must NOT fall to desktop and
  // 768x1024 must NOT fall to mobile (DESIGN-9).
  else if (
    (coarse || touch) &&
    width >= MOBILE_MAX_WIDTH_PX &&
    width <= TABLET_MAX_WIDTH_PX
  )
    category = "tablet";
  // A device with a fine pointer (a mouse) is desktop-class at
  // desktop widths — this is what a touchscreen laptop is. It must
  // come before the coarse check: the old order read a touchscreen
  // laptop as mobile (coarse fired before fine was ever checked),
  // and the old touch + >=1600px = hub rule (now deleted) mis-read
  // the same laptop as the hub. The hub itself is already caught by
  // the exact-signature rule above, so deleting that rule loses no
  // legitimate case (P8-16, review 3 §4).
  else if (fine && width >= DESKTOP_MIN_WIDTH_PX) category = "desktop";
  // A coarse pointer with no fine pointer is a touch-only device:
  // mobile outside the tablet band above.
  else if (coarse) category = "mobile";
  else if (width >= DESKTOP_MIN_WIDTH_PX) category = "desktop";
  else category = "mobile";
  return { category, orientation };
}

// The environment the card is actually running in, read from the
// browser. Returns null outside a browser (node tests), where the card
// keeps its base layout and detectDevice is never called.
function readDeviceEnv() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return null;
  }
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const fine =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: fine)").matches;
  const touch =
    "ontouchstart" in window ||
    (typeof navigator.maxTouchPoints === "number" &&
      navigator.maxTouchPoints > 0);
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    coarsePointer: coarse,
    finePointer: fine,
    touch,
    userAgent: navigator.userAgent || "",
  };
}

// -- Running timers (RECIPE-22) ----------------------------------------
//
// The running-timer strip in the cooking view reads the same bridge
// sensors the timer card reads (sensor.satellite_timer_*, states
// active/paused/finished, attributes timer_name / remaining /
// finishes_at / finished_at). The helpers below are the home card's
// formatRemaining / timerRemainingSeconds / timerName, copied with
// the same semantics: remaining ticks from finishes_at (never from a
// local countdown), a finished timer has nothing left, and the name
// comes from timer_name — never from friendly_name, which the bridge
// prefixes with "kitchen_hub ".

// The voice alternative, word for word (RECIPE-17, RECIPE-20): the
// last-resort fallback in the timer-failure message when the chip
// carries no duration phrase of its own. The hint near the timer
// chips is computed per step now (voiceHintForStep, N-IMPL-19c) —
// this constant is NOT the detail hint any more.
const VOICE_HINT = "Say 'Okay Nabu, start a 9 minute timer'";

// Seconds left as the kitchen reads it: "7:32" under an hour,
// "1:05:12" once it reaches an hour.
function formatRemaining(seconds) {
  const n = Number(seconds);
  const total = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

// Seconds left on one timer sensor, from finishes_at when present
// (it stays right even if the sensor's remaining value is a second
// stale), else the remaining attribute. A finished timer has nothing
// left. Null when neither source gives a usable number.
function timerRemainingSeconds(timer, nowMs) {
  const state = timer && timer.state;
  if (state === "finished") return 0;
  const attrs = (timer && timer.attributes) || {};
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  if (attrs.finishes_at) {
    const finishMs = Date.parse(attrs.finishes_at);
    if (Number.isFinite(finishMs)) {
      return Math.max(0, Math.floor((finishMs - now) / 1000));
    }
  }
  const remaining = Number(attrs.remaining);
  if (Number.isFinite(remaining)) return Math.max(0, Math.floor(remaining));
  return null;
}

// The name a timer shows: the bridge's timer_name attribute first.
// Only when timer_name is absent does it fall back to the friendly
// name with a leading "kitchen_hub " stripped, then to the entity id.
function timerName(timer) {
  const attrs = (timer && timer.attributes) || {};
  const named = asTrimmed(attrs.timer_name);
  if (named) return named;
  const friendly = asTrimmed(attrs.friendly_name);
  if (friendly) return friendly.replace(/^kitchen_hub\s+/i, "");
  return (timer && timer.entity_id) || "";
}

// The running (active or paused) timers in a hass states list,
// soonest finish first. The states arrive in either shape: the
// array the docs and the unit tests assume, or the plain object
// keyed by entity_id that the live frontend actually hands cards
// (measured on the rig, HA 2026.2.3: hass.states is an Object with
// one key per entity, NOT an array — the array-only version of this
// helper silently returned no timers live, RECIPE-22). Both shapes
// are accepted so the strip works whichever the frontend gives.
// The timer sensors as a list, whatever shape hass.states arrives
// in: an array on most setups, a plain object keyed by entity_id on
// the live rig (HA 2026.2.3) — the array-only strip rendered zero
// items live while the unit tests (array states) passed. Every
// sensor iteration in the card goes through here.
function timerSensorList(states) {
  if (Array.isArray(states)) return states;
  if (states && typeof states === "object") return Object.values(states);
  return [];
}

function runningTimers(states) {
  const list = timerSensorList(states);
  const timers = list.filter(
    (item) =>
      item &&
      typeof item.entity_id === "string" &&
      item.entity_id.indexOf("sensor.satellite_timer_") === 0 &&
      (item.state === "active" || item.state === "paused"),
  );
  timers.sort((a, b) => {
    const aFinish = a.attributes && a.attributes.finishes_at ? Date.parse(a.attributes.finishes_at) : NaN;
    const bFinish = b.attributes && b.attributes.finishes_at ? Date.parse(b.attributes.finishes_at) : NaN;
    if (Number.isFinite(aFinish) && Number.isFinite(bFinish)) return aFinish - bFinish;
    if (Number.isFinite(aFinish)) return -1;
    if (Number.isFinite(bFinish)) return 1;
    return timerName(a).localeCompare(timerName(b));
  });
  return timers;
}

// -- Navigation strip (NAV-1) --------------------------------------------
//
// The same strip on every view (see the NAV-STRIP CONTRACT in the
// implementation log; family-hub-nav-strip.js is the reference
// implementation). Noun labels, Home first, the current view marked
// with the accent background, heavier weight, and aria-current.
// Navigation is history.pushState + a location-changed dispatch —
// no reload.
const NAV_STRIP_VIEWS = [
  { key: "home", label: "Home", path: "/family-hub" },
  { key: "timers", label: "Timers", path: "/family-hub/timers" },
  { key: "photos", label: "Photos", path: "/family-hub/family-photos" },
  { key: "recipes", label: "Recipes", path: "/family-hub/recipes" },
];

// Kiosk mode is the ?kiosk URL the wall runs under. In kiosk mode
// Home Assistant's header is hidden, so the step tracker pins at
// top: 0 instead of below the 56px header (RECIPE-16).
function isKioskMode(search) {
  const query = typeof search === "string" ? search : "";
  return /(?:^|[?&])kiosk(?:[=&]|$)/.test(query);
}

// -- shared helpers (wave 1) --------------------------------------------
//
// Kiosk as a session property (N-IMPL-10 / ambiguity E): every in-app
// navigation carries ?kiosk in the URL (primary — a same-tab reload
// URL already has it); the flag is stored in sessionStorage key
// family-hub:kiosk (per-tab) as backstop; on load, if the flag is set
// but the URL lacks ?kiosk, the card does ONE location.replace adding
// ?kiosk. Card JS cannot hide HA chrome before first paint, so a
// bare-URL paint may flash chrome once before the re-apply reload —
// that is the honest bound, not a defect to hide. A fresh tab, browser
// restart, or second device re-establishes kiosk only via the WIZ-8
// start URL (http://homeassistant.local:8123/family-hub?kiosk, launcher
// ~/.local/bin/family-hub-kiosk.sh). The same block is duplicated in
// the reference strip, the Home card, and the Timers card — the four
// copies must stay identical; if you change the key, the storage, or
// the re-apply, change them in the other cards too.
const KIOSK_SESSION_KEY = "family-hub:kiosk";

function readKioskFlag() {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(KIOSK_SESSION_KEY) === "1";
  } catch (_err) {
    return false;
  }
}

function storeKioskFlag() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(KIOSK_SESSION_KEY, "1");
  } catch (_err) {
    // Storage blocked: kiosk still works for this load (the URL has
    // ?kiosk); only the same-tab reload re-apply is lost.
  }
}

// True when this tab session is a kiosk session: the URL says so, or
// the stored flag says so.
function isKioskSession(search) {
  return isKioskMode(search) || readKioskFlag();
}

// Append ?kiosk to an in-app path when this tab session is kiosk,
// preserving any query string already on the path. Never adds a second
// kiosk param.
function withKioskQuery(path) {
  const target = String(path || "/family-hub");
  if (!isKioskSession(typeof window !== "undefined" && window.location ? window.location.search || "" : "")) return target;
  const [base, query] = target.split("?");
  if (!query) return `${base}?kiosk`;
  const params = query.split("&");
  if (params.some((part) => part === "kiosk" || part.indexOf("kiosk=") === 0)) return target;
  return `${base}?${query}&kiosk`;
}

// Re-apply kiosk on load when the stored flag is set but the URL lacks
// ?kiosk. Returns true when a re-apply reload was started.
function reapplyKioskIfNeeded() {
  if (typeof window === "undefined" || !window.location) return false;
  if (!readKioskFlag()) return false;
  if (isKioskMode(window.location.search || "")) return false;
  const url = withKioskQuery(
    `${window.location.pathname || "/family-hub"}${window.location.search || ""}${window.location.hash || ""}`
  );
  try {
    window.location.replace(url);
  } catch (_err) {
    return false;
  }
  return true;
}

// -- Timers count badge (D-N1 / N-IMPL-5) ---------------------------------
//
// The badge counts ACTIVE + PAUSED timers (coordinator decision #25-D:
// a paused timer still needs the user's attention; excluding it would
// make the badge lie by omission). Colour is driven by running/finished
// only: amber = a RUNNING timer in its last 60 s; red = any finished
// timer. Finished-only reading (recorded, flagged for the implementation
// review): when active+paused is 0 but a finished timer exists, the
// badge shows the finished count in red — the only reading under which
// both "counts ACTIVE + PAUSED" and "red when a timer has finished"
// hold. Returns null when there is nothing to show (no badge at zero).
// `timers` is [{state, remaining}] with remaining in live seconds.
function timerBadgeState(timers) {
  let count = 0;
  let finished = 0;
  let soon = false;
  for (const timer of timers || []) {
    if (!timer || typeof timer.state !== "string") continue;
    if (timer.state === "active" || timer.state === "paused") count += 1;
    if (timer.state === "finished") finished += 1;
    // Soon is a RUNNING timer in its last 60 s — a paused timer with
    // 30 s left is paused, not soon.
    if (timer.state === "active" && Number(timer.remaining) <= 60) soon = true;
  }
  if (count === 0 && finished === 0) return null;
  const shown = count === 0 ? finished : count;
  return {
    count: shown,
    tone: finished > 0 ? "finished" : soon ? "soon" : "count",
  };
}

// Badge input from hass states: the bridge sensors
// sensor.satellite_timer_* carry state active/paused/finished and a
// `remaining` attribute in seconds.
function timerBadgeFromHassStates(states) {
  if (!states) return null;
  const timers = [];
  for (const key of Object.keys(states)) {
    if (key.indexOf("sensor.satellite_timer_") !== 0) continue;
    const state = states[key];
    if (!state) continue;
    const attrs = state.attributes || {};
    timers.push({ state: state.state, remaining: Number(attrs.remaining) || 0 });
  }
  return timerBadgeState(timers);
}

// -- Night mode (D-N10 / N-IMPL-24) ---------------------------------------
//
// Night mode is a setting with a schedule; the user sets the hours —
// there are NO default hours. Stored in localStorage
// family-hub:night-mode = {"start":"HH:MM","end":"HH:MM"}; absent or
// invalid means night mode is off. The strip stays usable at night
// (dimmed palette, same targets, same labels, same active state);
// night mode never changes navigation behaviour. A finished timer
// still wakes and rings at night; a finished-but-not-ringing timer
// does NOT suppress firing at night (user ruling §2 item 1) — that
// half is the screensaver guard's job, not the strip's.
const NIGHT_SETTING_KEY = "family-hub:night-mode";

function parseNightSetting(raw) {
  if (typeof raw !== "string" || !raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_err) {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const toMinutes = (value) => {
    if (typeof value !== "string") return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  };
  const start = toMinutes(parsed.start);
  const end = toMinutes(parsed.end);
  if (start === null || end === null || start === end) return null;
  return { start, end };
}

function readNightSetting() {
  if (typeof localStorage === "undefined") return null;
  try {
    return parseNightSetting(localStorage.getItem(NIGHT_SETTING_KEY));
  } catch (_err) {
    return null;
  }
}

// Pure: is `date` inside the night schedule? Handles overnight spans
// (start > end, e.g. 22:00–06:00) and same-day spans (e.g. 00:00–06:00).
function isNightNow(setting, date) {
  if (!setting) return false;
  const now = date instanceof Date ? date : new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (setting.start < setting.end) {
    return minutes >= setting.start && minutes < setting.end;
  }
  return minutes >= setting.start || minutes < setting.end;
}

// -- Recipe voice hint (N-IMPL-19c) ---------------------------------------
//
// The hint is computed from the CURRENT step, never hardcoded: if the
// step has a time chip, "Say 'Okay Nabu, start a {duration} timer'"
// with the chip's duration — the upper bound for a range ("6–8
// minutes" → "8 minute timer"; "60 seconds" → "60 second timer").
// If the step has NO time chip, there is no hint (null). The first
// duration phrase in the step wins. The same function reads a timer
// chip's label for the _startTimer failure message, so the fallback
// never names a duration the chip does not have.
function voiceHintForStep(stepText) {
  const text = asTrimmed(stepText);
  if (!text) return null;
  DURATION_RE.lastIndex = 0;
  const match = DURATION_RE.exec(text);
  if (!match) return null;
  let amount = null;
  let unit = null;
  if (match[1] !== undefined) {
    // A range: the upper bound.
    amount = match[2];
    unit = match[3];
  } else if (match[4] !== undefined) {
    amount = match[4];
    unit = match[5];
  } else {
    amount = "1";
    unit = match[7];
  }
  const n = Number(amount);
  const amountText = Number.isFinite(n) && Number.isInteger(n) ? String(n) : String(amount).trim();
  const singular = pluralTimeUnit(unit).replace(/s$/, "");
  return `Say 'Okay Nabu, start a ${amountText} ${singular} timer'`;
}

function readLocationSearch() {
  if (typeof window === "undefined" || !window.location) return "";
  return String(window.location.search || "");
}

// -- session persistence (DESIGN-7, Phase 7) ----------------------------
//
// The screensaver return must restore the EXACT state, not just the
// view: which recipe was open, and where the list / detail was
// scrolled. Saved in sessionStorage — it survives the screensaver
// round-trip and view switches within the tab; a fresh tab starts at
// the list top. A deep link (?recipe=<id>) owns the state and wins
// over the session. Check-off and the current step already persist
// per recipe in localStorage (RECIPE-9); this is the view-level
// session around them. Every read/write is guarded: a browser
// without storage behaves exactly as before.
const RECIPE_SESSION_KEY = "family-hub:recipe:state";

function sanitizeRecipeScroll(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// The session step is 1-based ("Step N of M", the number the cook
// sees, the same form as ?step= in the URL). Anything else is null
// (no saved step).
function sanitizeRecipeStep(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

// Parse a stored session; garbage and wrong shapes become null
// (nothing saved), a valid object becomes a clean state. An openId
// that is not a non-empty string becomes null (list view).
// Fields (R-IMPL-14): openId, step (1-BASED — the "Step N of M" number
// the cook sees, the same numbering as ?step= in the URL and as the
// Timers card's readBackRecipeContext passes through; the spec's
// "0-based" contradicts the merged cross-area contract, so 1-based
// stands — see the implementation report, resolution #13),
// listScrollY, detailScrollY (written, NEVER read for a restore —
// D2d), query, collectionId, sort.
function parseRecipeSession(raw) {
  if (typeof raw !== "string" || !raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_err) {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const openId = typeof parsed.openId === "string" && parsed.openId.trim() ? parsed.openId.trim() : null;
  const query = typeof parsed.query === "string" ? parsed.query : "";
  const collectionId = typeof parsed.collectionId === "string" ? parsed.collectionId : "";
  const sort = typeof parsed.sort === "string" && ["name", "rating", "cook", "prep"].includes(parsed.sort) ? parsed.sort : "name";
  return {
    openId,
    step: sanitizeRecipeStep(parsed.step),
    listScrollY: sanitizeRecipeScroll(parsed.listScrollY),
    detailScrollY: sanitizeRecipeScroll(parsed.detailScrollY),
    query,
    collectionId,
    sort,
  };
}

function serializeRecipeSession(state) {
  return JSON.stringify({
    openId:
      state && typeof state.openId === "string" && state.openId.trim()
        ? state.openId.trim()
        : null,
    step: sanitizeRecipeStep(state && state.step),
    listScrollY: sanitizeRecipeScroll(state && state.listScrollY),
    detailScrollY: sanitizeRecipeScroll(state && state.detailScrollY),
    query: state && typeof state.query === "string" ? state.query : "",
    collectionId:
      state && typeof state.collectionId === "string" ? state.collectionId : "",
    sort:
      state && typeof state.sort === "string" &&
      ["name", "rating", "cook", "prep"].includes(state.sort)
        ? state.sort
        : "name",
  });
}

const CARD_CSS = `
  :host { display: block; }
  /* Design tokens: one warm, food-app palette for the whole card. The
     card renders in shadow DOM and deliberately does NOT borrow Home
     Assistant's theme colours — that is what makes it read as a modern
     recipe app rather than a stock HA card. One accent (warm
     terracotta); everything else is warm neutrals. */
  .screen {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    padding: 28px 36px;
    background: #FAF7F4;
    color: #1C1917;
    /* Sticky-band heights (D2c, R-IMPL-7): the sticky detail header
       (back row + tabs row) and the step tracker, per device class.
       The tracker pins directly under the header, so its top is the
       header height (+ the 56 px HA bar in non-kiosk). Base (hub):
       header = 16 pad + 72 button + 12 gap + (72 tab + 12 tabbar
       pad) = 184 px; tracker = 72 button + 24 pad + 2 border = 98 px.
       Mobile/tablet: 152/82 px; desktop: 144/78 px (52 px buttons
       and tabs). The per-class rules below override these. */
    --detail-header-h: 184px;
    --tracker-h: 98px;
    --accent: #C2410C;
    --ink: #1C1917;
    --muted: #57534E;
    --card: #FFFFFF;
    --line: #EDE8E3;
    --chip-bg: #F1ECE6;
    --star: #B45309;
    --error: #B71C1C;
    /* Success green (OQ-1, decided in Phase 7): the "Saved." status
       lines. 7.13:1 on card as text (AA normal). */
    --success: #166534;
    /* Shadow scale: restrained, one per elevation. Cards sit low;
       hover lifts a row; the active tab segment floats on its bar. */
    --shadow-card: 0 1px 2px rgba(28, 25, 23, 0.05), 0 8px 20px rgba(28, 25, 23, 0.06);
    --shadow-lift: 0 2px 4px rgba(28, 25, 23, 0.06), 0 14px 28px rgba(28, 25, 23, 0.10);
    --shadow-tab: 0 1px 3px rgba(28, 25, 23, 0.12);
    --shadow-accent: 0 2px 8px rgba(194, 65, 12, 0.35);
    /* Type: one deliberate system stack for the whole card (no webfont —
       the hub must render identically offline), one scale, weights that
       mean something: 700 for titles, labels and quantities, 600 for
       chips, tabs and secondary labels, 400 for body. Nothing at
       display size; the largest text on the card is the recipe title. */
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 24px;
    line-height: 1.45;
  }
  /* Vertical rhythm: each view is a flex column with one shared gap;
     inner elements carry no vertical margins, so the spacing between
     sections is even by construction. */
  .list-view { display: flex; flex-direction: column; gap: 24px; }
  /* The views toggle with the hidden attribute; the flex rule above
     would otherwise override the browser's built-in [hidden] hiding,
     so a hidden view must stay hidden. The detail view has no display
     rule of its own, but the same guard keeps it hidden if one is
     ever added. */
  .list-view[hidden], .detail-view[hidden] { display: none; }
  /* The detail column is capped so long lines stay readable; the list
     grid takes the full width instead (see .list). The cap is wide
     enough for the cooking view's two columns (ingredients + steps)
     on the hub. */
  .detail {
    width: 100%;
    max-width: 1500px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  /* Fixed-strip reserves (N-IMPL-20): content bottom padding is the
     strip height + 8px, so the last row scrolls clear of the strip. */
  .screen.dev-hub .list,
  .screen.dev-hub .detail { padding-bottom: 104px; }
  .title {
    font-size: 36px;
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: -0.02em;
    margin: 0;
    color: var(--ink);
  }
  .toolbar { display: flex; gap: 12px; align-items: stretch; }
  .search {
    flex: 1;
    min-width: 0;
    min-height: 72px;
    padding: 12px 24px 12px 58px;
    font-size: 24px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background-color: var(--card);
    background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='24'%20height='24'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%2357534E'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Ccircle%20cx='11'%20cy='11'%20r='7'/%3E%3Cpath%20d='m21%2021-4.3-4.3'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: 20px center;
    background-size: 26px 26px;
    box-shadow: var(--shadow-card);
    color: var(--ink);
    font-family: inherit;
  }
  .search::placeholder { color: var(--muted); }
  .search:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* The sort control sits next to the search field: name, rating,
     cook time, prep time only (RECIPE-19). Same size as a button so
     it is a real touch target, not a desktop-only affordance. */
  .sort {
    flex: 0 0 auto;
    min-height: 72px;
    min-width: 0;
    padding: 12px 16px;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: var(--card);
    box-shadow: var(--shadow-card);
    color: var(--ink);
    font-size: 22px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
  }
  .sort:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .button {
    min-height: 72px;
    min-width: 72px;
    padding: 12px 24px;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: var(--card);
    box-shadow: var(--shadow-card);
    color: var(--ink);
    font-size: 22px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
  }
  .button:active { transform: scale(0.98); }
  .button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  /* Ghost button: borderless accent text, for the back link. Still
     64px tall, so the touch target is the same as every button. */
  .button.ghost {
    background: transparent;
    border-color: transparent;
    box-shadow: none;
    color: var(--accent);
    padding-left: 4px;
  }
  /* Small button: an inline action inside a section header (e.g.
     "Start over" next to the ingredient count). Same shape as a
     button, but compact — it sits in a header, not on its own row. */
  .button.small {
    min-height: 48px;
    min-width: 0;
    padding: 8px 18px;
    font-size: 18px;
    border-radius: 12px;
  }
  .button:disabled { opacity: 0.5; cursor: default; }
  /* Collection chips are ONE horizontally scrollable row (D1, R-IMPL-1):
     flex-wrap: nowrap, overflow-x: auto, min-width: 0. The wrap rule
     (D-RECIPE-2) is DEAD — it produced the chips wall (22 chips, zero
     recipes on the first screen) and must never be re-applied at any
     viewport. A cut-off chip at the right edge is the scroll
     affordance, kept deliberately; the fade below marks it. */
  .chips {
    display: flex;
    flex-wrap: nowrap;
    gap: 10px;
    overflow-x: auto;
    min-width: 0;
    scrollbar-width: none;
    -ms-overflow-style: none;
    padding: 2px;
  }
  .chips::-webkit-scrollbar { display: none; }
  .chips.scrollable {
    /* Fade the last 48px of the row: wide enough that a cut-off chip
       edge reads as "there is more", narrow enough that the visible
       chips stay readable. */
    -webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 48px), transparent 100%);
    mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 48px), transparent 100%);
  }
  .chip {
    flex: 0 0 auto;
    max-width: 100%;
    min-height: 60px;
    padding: 8px 22px;
    border-radius: 999px;
    border: 1px solid transparent;
    background: var(--chip-bg);
    color: var(--ink);
    font-size: 21px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    white-space: normal;
    overflow-wrap: break-word;
  }
  .chip[aria-pressed="true"] {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    box-shadow: var(--shadow-accent);
  }
  /* Count line: wraps to two lines; a long query in quotes wraps,
     never clips (D7). */
  .status { font-size: 20px; color: var(--muted); padding: 0; overflow-wrap: anywhere; }
  .error { font-size: 22px; color: var(--error); padding: 0; }
  /* The list is a grid that uses the width it is given: one column on
     narrow screens, two from 1000px, three from 1500px. The Recipes
     view is a panel view, so on the 1920px hub display the grid has
     the full dashboard width to work with. Tracks are minmax(0, 1fr)
     and rows carry min-width: 0, so a long unbroken string inside a
     row (a 43-character collection pill) can never force a column
     wider than the viewport (RECIPE-25, ORIENT-9). */
  .list {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  @media (min-width: 1000px) { .list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (min-width: 1500px) { .list { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .row {
    display: flex;
    gap: 20px;
    align-items: center;
    width: 100%;
    min-width: 0;
    min-height: 112px;
    padding: 16px 20px;
    box-sizing: border-box;
    text-align: left;
    border-radius: 20px;
    border: 1px solid var(--line);
    background: var(--card);
    box-shadow: var(--shadow-card);
    color: var(--ink);
    cursor: pointer;
    font-family: inherit;
  }
  .row:hover { box-shadow: var(--shadow-lift); }
  .row:active { transform: scale(0.99); }
  .thumb {
    flex: 0 0 auto;
    width: 96px;
    height: 96px;
    border-radius: 16px;
    object-fit: cover;
    background: var(--chip-bg);
  }
  /* A recipe without a photo gets a deliberate tile, not a cheap
     placeholder: a warm terracotta-tinted gradient with the initial
     in the accent colour, so it reads as designed and matches the
     photo thumbnails instead of looking like a missing image. */
  .thumb.missing {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 42px;
    font-weight: 700;
    color: var(--accent);
    background: linear-gradient(135deg, #FDF0E6, #FBE3D3);
    border: 1px solid #F3D9C8;
  }
  .row-text { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 6px; }
  /* Names wrap to two lines, never a single-line ellipsis: a long name
     gets a second line before anything is cut. */
  .row-name {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 24px;
    font-weight: 700;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }
  /* Meta segments are unbreakable units (see formatMetaHtml); the line
     wraps only between them. The meta line lives on list rows only —
     the cooking view has no metadata. */
  .row-meta {
    display: flex;
    flex-wrap: wrap;
    column-gap: 10px;
    align-items: baseline;
    color: var(--muted);
    line-height: 1.4;
  }
  .row-meta { font-size: 17px; }
  .meta-seg { white-space: nowrap; }
  .meta-sep { color: var(--muted); }
  /* The rating reads as a rating, not more grey metadata: amber stars
     with breathing room between them. */
  .stars { color: var(--star); letter-spacing: 2px; }
  .row-collections { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
  .mini-pill {
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--chip-bg);
    color: var(--muted);
    font-size: 14px;
    font-weight: 600;
    line-height: 1.5;
    /* A long collection name wraps inside its pill instead of
       forcing the row (and the grid column) wider than the viewport
       (ORIENT-9: the 43-character pill made rows 418px wide). */
    white-space: normal;
    overflow-wrap: break-word;
    max-width: 100%;
  }
  /* The cooking view has no photo and no metadata line: the photo
     lives only in the list (where it helps you pick a recipe) and
     the metadata does not belong while cooking. So there is no
     .detail-photo and no .detail-meta rule at all. */
  /* The detail header — back button + tabs — is STICKY (D2c, R-IMPL-7):
     no scroll position can put back or the tabs off-screen. The title
     sits below it and scrolls away (a title can wrap to five lines,
     so it cannot live in a fixed-height sticky band — see the
     implementation report, resolution #14). The header pins below
     Home Assistant's 56 px bar in non-kiosk, at top: 0 in kiosk. */
  .detail-header {
    position: sticky;
    top: var(--header-height, 56px);
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: #FAF7F4;
    padding-bottom: 4px;
  }
  .screen.kiosk .detail-header { top: 0; }
  .detail-name {
    font-size: 40px;
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: -0.02em;
    margin: 0;
    color: var(--ink);
  }
  /* The Notes tab: an editable note, a rating, and a plain status
     line. The note is a big textarea (wet/dirty hands, readable
     from the counter); Save is a full 72 px button, enabled only
     when the text actually changed, and disabled while a save is in
     flight. The status line says "Saved." or an honest error — a
     failed save never drops the typed note, so the text stays in
     the editor to try again. The rating is five big star buttons
     plus Clear; tapping one saves it at once. The serving scaler
     lives in the Cook tab, not here. Bottom padding: the detail
     already reserves strip + 8 px; the Notes tab adds 16 px more,
     so the action row clears the strip by ≥ strip + 16 px (D6b). */
  .note-view { display: flex; flex-direction: column; gap: 24px; padding-bottom: 16px; }
  .note-label,
  .rating-label,
  .scaler-label {
    font-size: 22px;
    font-weight: 700;
    color: var(--ink);
  }
  .note-editor {
    width: 100%;
    min-height: 180px;
    box-sizing: border-box;
    padding: 16px 20px;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: var(--card);
    box-shadow: var(--shadow-card);
    color: var(--ink);
    font-size: 24px;
    line-height: 1.6;
    font-family: inherit;
    resize: vertical;
  }
  .note-editor:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .note-editor::placeholder { color: var(--muted); }
  .note-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .note-status,
  .rating-status {
    font-size: 20px;
    font-weight: 600;
    /* Success green (OQ-1, decided in Phase 7): a "Saved." line is
       success text, not accent text — terracotta is for actions and
       the recipe identity, not for confirmation. Errors stay red
       (see the .error rule below). */
    color: var(--success);
  }
  /* An unconfirmed save (R-IMPL-39) renders the status as a tappable
     retry button: same type as the span, underlined so it reads as a
     control, no button chrome. */
  button.note-status,
  button.rating-status {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--error);
    text-decoration: underline;
    cursor: pointer;
    text-align: left;
  }
  .note-status.error,
  .rating-status.error { color: var(--error); }
  /* The rating is its own section, separated from the note by a
     divider — it is a "what did you think" annotation like the
     note, and it belongs in the Notes tab rather than as metadata
     in the cooking view. */
  .rating-block {
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-top: 1px solid var(--line);
    padding-top: 24px;
  }
  .rating-stars { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .star {
    flex: 0 0 auto;
    min-width: 72px;
    min-height: 72px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: 44px;
    line-height: 1;
    cursor: pointer;
    font-family: inherit;
  }
  .star:active { transform: scale(0.94); }
  .star.filled { color: var(--star); }
  .star:disabled { opacity: 0.5; cursor: default; }
  /* The serving scaler: a soft bar above the ingredient list, in
     the Cook tab. "Serves" with a − / + stepper and the current
     serving count; Reset (labelled with the recipe's stored
     servings) appears only while scaled. It changes only the
     quantities shown while cooking — nothing is saved, so there is
     no save button and no status line. */
  .scaler {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 12px 16px;
    margin-bottom: 16px;
    background: var(--chip-bg);
    border-radius: 16px;
  }
  .scaler-count {
    min-width: 48px;
    text-align: center;
    font-size: 26px;
    font-weight: 700;
    color: var(--ink);
  }
  .scaler-btn { min-width: 72px; padding: 12px 16px; font-size: 28px; }
  /* Tabs are a segmented control: one soft bar, the active segment a
     white pill floating on it — the modern tab pattern, not four
     separate bordered buttons. */
  .tabbar {
    display: flex;
    gap: 6px;
    padding: 6px;
    border-radius: 18px;
    background: var(--chip-bg);
  }
  .tab {
    flex: 1;
    min-height: 72px;
    padding: 8px 12px;
    border-radius: 14px;
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: 22px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .tab:active { transform: scale(0.98); }
  .tab[aria-selected="true"] {
    background: var(--card);
    color: var(--ink);
    font-weight: 700;
    box-shadow: var(--shadow-tab);
  }
  /* -- Cooking mode ---------------------------------------------------
     Ingredients are checkable full-row buttons: a checkbox square, a
     quantity in the accent colour, and the name. Tap to cross off
     (tap again to un-cross). A checked row is struck through and
     dimmed; its checkbox fills with a tick. */
  .ingredients { display: flex; flex-direction: column; }
  .ingredient {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    width: 100%;
    min-height: 76px;
    padding: 16px 12px;
    border: none;
    border-bottom: 1px solid var(--line);
    border-radius: 12px;
    background: transparent;
    color: var(--ink);
    font-size: 24px;
    line-height: 1.45;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
  }
  .ingredient:last-child { border-bottom: none; }
  .ingredient:active { transform: scale(0.99); }
  .ingredient .check {
    flex: 0 0 auto;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    border: 2px solid var(--muted);
    background: var(--card);
    color: #fff;
    font-size: 22px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 2px;
  }
  .ingredient.checked .check {
    background: var(--accent);
    border-color: var(--accent);
  }
  .ingredient.checked .ing-name,
  .ingredient.checked .qty {
    text-decoration: line-through;
    opacity: 0.5;
  }
  /* Quantities take the accent colour: they separate from the name at
     a glance, and the colour is the card's single restrained accent. */
  .ingredient .qty { flex: 0 0 auto; font-weight: 700; white-space: nowrap; color: var(--accent); }
  /* Ingredient names wrap at word boundaries (D5a); overflow-wrap:
     anywhere breaks mid-word only for a token longer than the line. */
  .ingredient .ing-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .ingredient .ing-note { color: var(--muted); font-size: 20px; }
  /* Section headings are set apart from the rows: smaller, uppercase,
     letterspaced, secondary colour — a label, not another ingredient. */
  .ingredient-section {
    font-size: 19px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 22px 0 4px;
  }
  .ingredient-section:first-child { padding-top: 0; }
  /* Steps are a guided walkthrough: one current step, the rest dimmed.
     The current step is a raised card with a filled accent number; the
     others are plain text, dimmed modestly (0.8 — RECIPE-13: 0.75–0.85,
     never 0.5). Tap any step to make it current. Step numbers are rendered in the markup (span.step-num),
     not a CSS counter, so a headed step list numbers only the
     navigable steps. */
  .steps { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .step {
    display: flex;
    gap: 18px;
    align-items: flex-start;
    min-width: 0;
    min-height: 76px;
    padding: 18px 16px;
    font-size: 26px;
    line-height: 1.55;
    border-radius: 16px;
    border: 1px solid transparent;
    cursor: pointer;
    opacity: 0.8;
    /* A step change scrolls the step just below the sticky tracker
       (D2b, R-IMPL-6): the margin is the tracker band + 16 px gap,
       so the step's top never hides under the tracker. */
    scroll-margin-top: calc(var(--header-height, 56px) + var(--detail-header-h, 184px) + var(--tracker-h, 98px) + 16px);
  }
  .step.current {
    opacity: 1;
    background: var(--card);
    border-color: var(--line);
    box-shadow: var(--shadow-card);
  }
  .step-num {
    flex: 0 0 auto;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--chip-bg);
    color: var(--muted);
    font-size: 26px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 2px;
  }
  .step.current .step-num {
    background: var(--accent);
    color: #fff;
  }
  /* Step text wraps at word boundaries inside the viewport (D4 rule 8):
     overflow-wrap: anywhere breaks mid-word ONLY when a single token is
     longer than the line itself — the fallback for a genuinely
     unbreakable string (ambiguity #7), never the normal path. */
  .step-text { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .step-header {
    padding: 18px 4px 4px;
    font-size: 24px;
    font-weight: 700;
    color: var(--ink);
  }
  /* A time inside a step is a tappable chip: warm tint, accent text,
     pill shape — it reads as an action, not body text. Sized in em so
     it scales with the step text on every device. At least 56px tall
     on the hub (RECIPE-15): the most-used mid-cooking control is no
     longer the smallest target in the view. */
  .time-chip {
    display: inline-flex;
    align-items: center;
    min-height: 56px;
    padding: 4px 14px;
    border-radius: 999px;
    border: 1px solid #F3D9C8;
    background: #FDEFE6;
    color: var(--accent);
    font-size: 0.92em;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    line-height: 1.4;
  }
  .time-chip:active { transform: scale(0.97); }
  /* The timer outcome line: one line under the step tracker, accent
     colour, so a failed start is visible in the cooking view. */
  .timer-status {
    font-size: 20px;
    font-weight: 600;
    color: var(--accent);
    padding: 4px 4px 8px;
  }
  /* The cooking view puts ingredients and steps together. Whether it
     is two-column is keyed on VIEWPORT WIDTH and the hub-panel
     signature, not device class (D9, R-IMPL-49): phone widths (<900 px)
     are single column always; tablet widths (900–~1100 px) are
     two-column (ingredients left, tracker + steps right); wider
     non-hub viewports (>~1100 px) are single column; the hub panel
     (dev-hub, either orientation) is two-column. The exact ~1100 px
     boundary is unmeasured (OQ-2) — the media query below is the
     starting hypothesis, to be re-decided from measurement if it
     contradicts. The ingredient column is never narrower than ~220 px:
     in the 900–1100 px band the 5fr share is ≥328 px by construction,
     so the minimum never binds there; it is stated here as the guard,
     not a second breakpoint. */
  .cook-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 40px;
    align-items: start;
  }
  @media (min-width: 900px) and (max-width: 1100px) {
    .cook-grid { grid-template-columns: minmax(220px, 5fr) minmax(0, 7fr); }
  }
  .screen.dev-hub .cook-grid { grid-template-columns: minmax(220px, 5fr) minmax(0, 7fr); }
  /* Every grid/flex item in the detail chain carries min-width: 0
     (D4 rule 1), so no item's min-content can force the detail wider
     than the viewport. */
  .cook-ingredients, .cook-steps { min-width: 0; }
  .timer-strip { min-width: 0; }
  .cook-head {
    display: flex;
    align-items: baseline;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .section-title {
    font-size: 26px;
    font-weight: 700;
    margin: 0;
    color: var(--ink);
  }
  .cook-count {
    font-size: 20px;
    font-weight: 600;
    color: var(--muted);
  }
  /* The step tracker is the "Step N of M" bar with Prev/Next. It is
     sticky, so your place in the steps stays visible while the steps
     scroll — on a phone, where the ingredients sit above the steps,
     it pins to the top once you reach the steps. It pins directly
     under the sticky detail header (D2c): below Home Assistant's own
     header plus the header band in non-kiosk, below the header band
     alone in kiosk (RECIPE-16's bare top: 0 is the pre-header value —
     with a sticky header above it the tracker pins at the header's
     bottom; see the implementation report, resolution #15). It is a
     card on the screen background, so content scrolling under it
     stays hidden. */
  .step-tracker {
    position: sticky;
    top: calc(var(--header-height, 56px) + var(--detail-header-h, 184px));
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
    margin-bottom: 12px;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 16px;
    box-shadow: var(--shadow-card);
  }
  /* Tracker label: min-width: 0 (D4 rule 7) so the row is Prev + label
     + Next and fits at 360 px — the label never forces the tracker
     wider than the viewport. */
  .step-position {
    flex: 1;
    min-width: 0;
    text-align: center;
    font-size: 22px;
    font-weight: 700;
    color: var(--ink);
    white-space: nowrap;
  }
  .step-nav { flex: 0 0 auto; }
  .screen.kiosk .step-tracker { top: var(--detail-header-h, 184px); }
  /* In kiosk there is no 56 px HA bar, so the step scroll-margin
     drops it too. */
  .screen.kiosk .step { scroll-margin-top: calc(var(--detail-header-h, 184px) + var(--tracker-h, 98px) + 16px); }
  /* -- Navigation strip (NAV-1, D-N1; wave 1) ---------------------------
     The persistent strip, FIRST in the DOM (tab order) and visually
     last (fixed to the viewport bottom). The reference strip
     (family-hub-nav-strip.js) is the base; this card mirrors it:
     a solid dark bar, white labels, inactive labels at 70% opacity,
     the current view with the accent background, heavier weight, and
     aria-current. Bar heights: hub 96px, tablet 72px, phone 64px +
     safe-area, desktop 56px (desktop hides the strip — NAV-1 — so
     no height rule there). Buttons are the full bar height, flush
     (no gap, no radius, no border, no shadow). The timer-count badge
     (N-IMPL-5, decision #25-D: ACTIVE + PAUSED; amber = a running
     timer in its last 60 s, red = any finished timer) sits on the
     Timers button; it is updated by _updateStripBadge. */
  .nav-strip {
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 96px;
    z-index: 60;
    padding: 0;
    background: #171717;
  }
  .nav-strip-buttons { display: flex; gap: 0; height: 100%; }
  .nav-strip-button {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    color: rgba(255, 255, 255, 0.7);
    font-size: 24px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    overflow-wrap: break-word;
    position: relative;
    transition: transform 100ms ease-out;
  }
  .nav-strip-button:active { transform: scale(0.97); }
  .nav-strip-button.active { background: var(--accent); color: #fff; font-weight: 800; }
  .nav-strip-button:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
  .nav-strip .timer-badge {
    position: absolute;
    top: 8px;
    right: calc(50% - 44px);
    min-width: 24px;
    height: 24px;
    padding: 0 6px;
    border-radius: 12px;
    background: #fff;
    color: #171717;
    font-size: 14px;
    font-weight: 800;
    line-height: 24px;
    text-align: center;
    pointer-events: none;
  }
  .nav-strip .timer-badge.soon { background: #B45309; color: #fff; }
  .nav-strip .timer-badge.finished { background: #B91C1C; color: #fff; }
  /* Night (N-IMPL-24): the strip stays usable — same targets, dimmed
     palette. Hours are a defined setting, not a default (see
     readNightSetting); absent = off. */
  .screen.night .nav-strip { background: #0A0A0A; }
  .screen.night .nav-strip-button { color: rgba(255, 255, 255, 0.55); }
  .screen.night .nav-strip-button.active { background: #7C2D12; }
  /* Total time in the cooking view header (RECIPE-7): prep + cook,
     with the breakdown beside it. Only rendered when at least one
     time exists. */
  .cook-total {
    font-size: 24px;
    font-weight: 700;
    color: var(--ink);
    padding: 4px 4px 0;
  }
  .cook-total-sub { font-weight: 600; color: var(--muted); }
  /* The running-timer strip (RECIPE-22): every running timer, name +
     remaining, at the top of the cooking view, above the steps.
     Tapping one goes to the Timers view. */
  .timer-strip {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 0 8px;
  }
  .timer-strip-item {
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: 64px;
    padding: 12px 20px;
    box-sizing: border-box;
    border-radius: 16px;
    border: 1px solid #F3D9C8;
    background: #FDEFE6;
    color: var(--ink);
    font-size: 22px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    text-align: left;
  }
  .timer-strip-item:active { transform: scale(0.99); }
  /* Pill names may break anywhere (D4 rule 2: overflow-wrap: anywhere
     is the only value that reduces min-content, so a 58-char name can
     never force the layout wider); the countdown never clips — the name
     takes the ellipsis, the time does not. */
  .timer-strip-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .timer-strip-remaining {
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }
  .timer-strip-item.paused .timer-strip-remaining { color: var(--muted); }
  /* The voice hint (RECIPE-20): exact wording, next to the timer
     chips — a hint, not a mic affordance. */
  .voice-hint {
    font-size: 20px;
    font-weight: 600;
    color: var(--muted);
    padding: 4px 4px 8px;
  }
  /* The Details tab (RECIPE-7): the photo hero, the metadata line,
     and every stored field — prep, cook, total, servings as stored,
     rating, collections, source. */
  .details-view { display: flex; flex-direction: column; gap: 24px; }
  .detail-photo {
    width: 100%;
    max-height: 480px;
    object-fit: cover;
    border-radius: 20px;
    background: var(--chip-bg);
  }
  .detail-photo.missing {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 240px;
    font-size: 96px;
    font-weight: 700;
    color: var(--accent);
    background: linear-gradient(135deg, #FDF0E6, #FBE3D3);
    border: 1px solid #F3D9C8;
  }
  .detail-meta { font-size: 20px; color: var(--muted); line-height: 1.4; }
  .detail-rows {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 12px 24px;
    font-size: 22px;
    line-height: 1.45;
  }
  .detail-rows dt { font-weight: 700; color: var(--ink); }
  .detail-rows dd { margin: 0; color: var(--ink); overflow-wrap: break-word; }
  .detail-rows a { color: var(--accent); overflow-wrap: break-word; }
  /* The scaler factor ("×2") and the original-amount toggle
     (RECIPE-1/RECIPE-2): the factor is shown whenever the recipe is
     scaled, and the toggle switches the list between scaled and
     original amounts. */
  .scaler-factor {
    font-size: 26px;
    font-weight: 700;
    color: var(--accent);
  }
  /* A quantity the scaler could not parse is flagged, never silently
     left or silently dropped (RECIPE-2). */
  .ing-flag {
    color: var(--error);
    font-size: 20px;
    font-weight: 600;
  }
  /* Empty states are typographic, not a bare line: a title, one line of
     guidance, and the way out. Generous padding makes the whitespace
     intentional rather than a hole in the page. */
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 72px 24px;
    gap: 12px;
  }
  .empty-title { font-size: 26px; font-weight: 700; line-height: 1.25; color: var(--ink); }
  .empty-sub { font-size: 19px; line-height: 1.5; color: var(--muted); max-width: 560px; }
  .empty .button { margin-top: 12px; }
  /* First load shows skeleton rows in the same grid as the list, so
     the page takes its final shape before the data arrives instead of
     flashing a bare "Loading…" line. Six rows fill the first screen. */
  .skeleton-row {
    display: flex;
    gap: 20px;
    align-items: center;
    min-height: 112px;
    padding: 16px 20px;
    box-sizing: border-box;
    border-radius: 20px;
    border: 1px solid var(--line);
    background: var(--card);
    box-shadow: var(--shadow-card);
  }
  .skeleton-thumb { flex: 0 0 auto; width: 96px; height: 96px; border-radius: 16px; background: var(--chip-bg); }
  .skeleton-lines { flex: 1; display: flex; flex-direction: column; gap: 10px; }
  .skeleton-line { height: 18px; border-radius: 9px; background: var(--chip-bg); }
  .skeleton-line.short { width: 55%; }
  .skeleton-thumb, .skeleton-line { animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
  /* -- Adaptive layout --------------------------------------------------
     The card detects its device (see detectDevice) and carries the
     category + orientation as classes on .screen: dev-hub, dev-desktop,
     dev-tablet or dev-mobile, and orient-landscape or orient-portrait.
     The rules above ARE the hub layout (1920x1200 kitchen kiosk: big
     touch targets, multi-column grid); the rules below only adjust for
     desktop, tablet and mobile. A card with no device classes (no
     browser environment) renders the hub layout. */
  /* Desktop: a mouse is precise, so targets shrink and the grid gets
     denser — three columns from 1500px (D1920 = 3 columns, 12 cards;
     there is no four-column rule — R-IMPL-3 deleted the 1700px one).
     Hover states from the base rules still apply. The cooking view
     keeps two columns (the desktop is wide), at desktop type sizes. */
  .screen.dev-desktop { font-size: 18px; padding: 20px 28px; }
  /* Sticky-band heights, desktop (R-IMPL-7): header 144 px, tracker
     78 px (52 px buttons and tabs). Kept as a separate rule so the
     one-line device rule above stays byte-identical for the token
     tests. */
  .screen.dev-desktop { --detail-header-h: 144px; --tracker-h: 78px; }
  .screen.dev-desktop .title { font-size: 28px; }
  .screen.dev-desktop .search { min-height: 52px; font-size: 19px; padding: 10px 20px 10px 52px; background-size: 22px 22px; }
  .screen.dev-desktop .button { min-height: 52px; font-size: 18px; padding: 10px 20px; }
  .screen.dev-desktop .chip { min-height: 44px; font-size: 17px; padding: 6px 18px; }
  .screen.dev-desktop .row { min-height: 88px; padding: 12px 16px; }
  .screen.dev-desktop .thumb { width: 68px; height: 68px; }
  .screen.dev-desktop .skeleton-row { min-height: 88px; }
  .screen.dev-desktop .skeleton-thumb { width: 68px; height: 68px; }
  .screen.dev-desktop .row-name { font-size: 20px; }
  .screen.dev-desktop .detail { max-width: 1200px; }
  .screen.dev-desktop .detail-name { font-size: 32px; }
  .screen.dev-desktop .tab { min-height: 52px; font-size: 18px; }
  .screen.dev-desktop .ingredient { min-height: 56px; font-size: 19px; padding: 12px 8px; }
  .screen.dev-desktop .ingredient .check { width: 24px; height: 24px; font-size: 16px; border-radius: 7px; }
  .screen.dev-desktop .ingredient .ing-note { font-size: 16px; }
  .screen.dev-desktop .step { min-height: 56px; font-size: 20px; padding: 12px 10px; }
  .screen.dev-desktop .step-num { width: 40px; height: 40px; font-size: 20px; }
  .screen.dev-desktop .step-header { font-size: 20px; }
  .screen.dev-desktop .section-title { font-size: 22px; }
  .screen.dev-desktop .cook-count { font-size: 17px; }
  .screen.dev-desktop .step-position { font-size: 19px; }
  .screen.dev-desktop .timer-status { font-size: 17px; }
  .screen.dev-desktop .note-editor { min-height: 140px; font-size: 19px; padding: 12px 16px; }
  .screen.dev-desktop .note-label,
  .screen.dev-desktop .rating-label,
  .screen.dev-desktop .scaler-label { font-size: 18px; }
  .screen.dev-desktop .note-status,
  .screen.dev-desktop .rating-status { font-size: 17px; }
  .screen.dev-desktop .star { min-width: 52px; min-height: 52px; font-size: 32px; }
  .screen.dev-desktop .scaler { padding: 10px 12px; margin-bottom: 12px; }
  .screen.dev-desktop .scaler-count { font-size: 20px; min-width: 36px; }
  .screen.dev-desktop .scaler-btn { min-width: 52px; min-height: 52px; font-size: 22px; padding: 8px 12px; }
  .screen.dev-desktop .cook-grid { gap: 32px; }
  /* Desktop: the nav strip is hidden (HA tabs already exist and work
     there — NAV-1) ONLY when NOT in kiosk mode: in kiosk mode HA tabs
     do not exist, so a desktop-class viewport in kiosk mode would have
     ZERO navigation with the strip hidden (the kiosk-desktop hole,
     same as the timer card's). The strip therefore shows in kiosk
     mode at 56px, with the 64px reserve (56 + 8). The list grid keeps
     the base breakpoints: three columns from 1500px (no four-column
     rule — R-IMPL-3). A three-column grid at 1200px spilled 166px past
     a 1200px-wide portrait viewport (RECIPE-25) — the breakpoint is
     the viewport, the content is narrower, so the grid must not go
     three-wide until 1500px. */
  .screen.dev-desktop .nav-strip { display: none; }
  .screen.dev-desktop.kiosk .nav-strip { display: block; height: 56px; }
  .screen.dev-desktop.kiosk .list,
  .screen.dev-desktop.kiosk .detail { padding-bottom: 64px; }
  .screen.dev-desktop .sort { min-height: 52px; font-size: 18px; padding: 10px 16px; }
  /* Desktop list grid: three columns from 1500px (D1920 = 3 columns,
     12 cards — R-IMPL-3). There is no four-column rule: the old
     1700px four-column grid contradicts the design's first-screen
     table, so it is deleted, not widened. */
  /* Tablet (DESIGN-9; OQ-4 confirmed by Phase 7): tablet type =
     desktop type (the recipe card has no clock, so OQ-4's clock
     exception does not apply here); targets 56-64px (spec §3.2) —
     every tap target the desktop rules leave below 56px is raised
     to 56px here (chips 44->56, tabs 52->56, sort 52->56, stars
     52->56, scaler buttons 52->56, search/buttons 52->56). The nav
     strip is SHOWN on tablet (hidden on desktop only, NAV-1). The
     strip is fixed to the viewport bottom, so the list and the
     detail carry bottom padding equal to the strip height + 8px
     (80px for the 72px tablet strip) — otherwise the strip covers
     the last row's buttons at the viewport's bottom edge. */
  .screen.dev-tablet { font-size: 20px; padding: 20px 28px; }
  /* Sticky-band heights, tablet (R-IMPL-7): header 152 px, tracker
     82 px (56 px buttons and tabs). Separate rule, as above. */
  .screen.dev-tablet { --detail-header-h: 152px; --tracker-h: 82px; }
  .screen.dev-tablet .title { font-size: 28px; }
  .screen.dev-tablet .search { min-height: 56px; font-size: 19px; padding: 10px 20px 10px 52px; background-size: 22px 22px; }
  .screen.dev-tablet .button { min-height: 56px; font-size: 18px; padding: 10px 20px; }
  .screen.dev-tablet .chip { min-height: 56px; font-size: 18px; padding: 6px 18px; }
  .screen.dev-tablet .row { min-height: 88px; padding: 12px 16px; }
  .screen.dev-tablet .thumb { width: 68px; height: 68px; }
  .screen.dev-tablet .skeleton-row { min-height: 88px; }
  .screen.dev-tablet .skeleton-thumb { width: 68px; height: 68px; }
  .screen.dev-tablet .row-name { font-size: 20px; }
  .screen.dev-tablet .detail { max-width: 1200px; padding-bottom: 80px; }
  .screen.dev-tablet .list { padding-bottom: 80px; }
  .screen.dev-tablet .detail-name { font-size: 32px; }
  .screen.dev-tablet .tab { min-height: 56px; font-size: 18px; }
  .screen.dev-tablet .ingredient { min-height: 56px; font-size: 19px; padding: 12px 8px; }
  .screen.dev-tablet .ingredient .check { width: 24px; height: 24px; font-size: 16px; border-radius: 7px; }
  .screen.dev-tablet .ingredient .ing-note { font-size: 16px; }
  .screen.dev-tablet .step { min-height: 56px; font-size: 20px; padding: 12px 10px; }
  .screen.dev-tablet .step-num { width: 40px; height: 40px; font-size: 20px; }
  .screen.dev-tablet .step-header { font-size: 20px; }
  .screen.dev-tablet .section-title { font-size: 22px; }
  .screen.dev-tablet .cook-count { font-size: 17px; }
  .screen.dev-tablet .step-position { font-size: 19px; }
  .screen.dev-tablet .timer-status { font-size: 17px; }
  .screen.dev-tablet .note-editor { min-height: 140px; font-size: 19px; padding: 12px 16px; }
  .screen.dev-tablet .note-label,
  .screen.dev-tablet .rating-label,
  .screen.dev-tablet .scaler-label { font-size: 18px; }
  .screen.dev-tablet .note-status,
  .screen.dev-tablet .rating-status { font-size: 17px; }
  .screen.dev-tablet .star { min-width: 56px; min-height: 56px; font-size: 32px; }
  .screen.dev-tablet .scaler { padding: 10px 12px; margin-bottom: 12px; }
  .screen.dev-tablet .scaler-count { font-size: 20px; min-width: 36px; }
  .screen.dev-tablet .scaler-btn { min-width: 56px; min-height: 56px; font-size: 22px; padding: 8px 12px; }
  .screen.dev-tablet .cook-grid { gap: 32px; }
  .screen.dev-tablet .sort { min-height: 56px; font-size: 18px; padding: 10px 16px; }
  .screen.dev-tablet .time-chip { min-height: 56px; }
  .screen.dev-tablet .timer-strip-item { min-height: 56px; font-size: 19px; padding: 10px 16px; }
  .screen.dev-tablet .nav-strip { height: 72px; }
  .screen.dev-tablet .nav-strip-button { font-size: 20px; }
  /* Mobile: touch targets stay large (a finger is not a mouse), the
     type stays readable, and the grid is one column in portrait so
     nothing overflows or clips. The detail view takes the full width;
     the cooking view stacks (ingredients above steps) with the step
     tracker sticky, so your place stays visible while you scroll. */
  .screen.dev-mobile { font-size: 18px; padding: 16px; }
  /* Sticky-band heights, mobile (R-IMPL-7): header 152 px, tracker
     82 px (56 px buttons and tabs). Separate rule, as above. */
  .screen.dev-mobile { --detail-header-h: 152px; --tracker-h: 82px; }
  .screen.dev-mobile .title { font-size: 26px; }
  .screen.dev-mobile .search { min-height: 56px; font-size: 18px; padding: 10px 16px 10px 48px; background-size: 22px 22px; background-position: 14px center; }
  .screen.dev-mobile .button { min-height: 56px; font-size: 18px; padding: 10px 18px; }
  .screen.dev-mobile .chip { min-height: 48px; font-size: 17px; padding: 6px 16px; }
  /* On a phone the collection chips are one scrollable row (D1): the
     wrap override that produced the chips wall is deleted with it —
     a cut-off chip at the screen edge is the scroll affordance, and
     the row is exactly one chip tall. */
  .screen.dev-mobile .chips.scrollable { -webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 48px), transparent 100%); mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 48px), transparent 100%); }
  .screen.dev-mobile .row { min-height: 88px; padding: 12px 14px; gap: 12px; }
  .screen.dev-mobile .thumb { width: 64px; height: 64px; }
  .screen.dev-mobile .skeleton-row { min-height: 88px; }
  .screen.dev-mobile .skeleton-thumb { width: 64px; height: 64px; }
  .screen.dev-mobile .row-name { font-size: 19px; }
  .screen.dev-mobile .row-meta { font-size: 15px; }
  .screen.dev-mobile .detail { max-width: none; }
  .screen.dev-mobile .detail-name { font-size: 28px; }
  .screen.dev-mobile .tab { min-height: 56px; font-size: 18px; padding: 8px 6px; }
  .screen.dev-mobile .cook-grid { gap: 32px; }
  .screen.dev-mobile .section-title { font-size: 22px; }
  .screen.dev-mobile .cook-count { font-size: 17px; }
  .screen.dev-mobile .ingredient { min-height: 60px; font-size: 19px; padding: 12px 8px; }
  .screen.dev-mobile .ingredient .check { width: 28px; height: 28px; font-size: 18px; }
  .screen.dev-mobile .ingredient .ing-note { font-size: 16px; }
  .screen.dev-mobile .step { min-height: 60px; font-size: 20px; padding: 12px 10px; }
  .screen.dev-mobile .step-num { width: 44px; height: 44px; font-size: 20px; }
  .screen.dev-mobile .step-header { font-size: 20px; }
  .screen.dev-mobile .step-position { font-size: 19px; }
  .screen.dev-mobile .step-tracker { padding: 10px 12px; gap: 10px; }
  .screen.dev-mobile .timer-status { font-size: 17px; }
  .screen.dev-mobile .note-editor { min-height: 160px; font-size: 19px; padding: 12px 16px; }
  .screen.dev-mobile .note-label,
  .screen.dev-mobile .rating-label,
  .screen.dev-mobile .scaler-label { font-size: 18px; }
  .screen.dev-mobile .note-status,
  .screen.dev-mobile .rating-status { font-size: 17px; }
  .screen.dev-mobile .star { min-width: 56px; min-height: 56px; font-size: 36px; }
  .screen.dev-mobile .scaler { padding: 10px 12px; margin-bottom: 12px; }
  .screen.dev-mobile .scaler-count { font-size: 22px; min-width: 40px; }
  .screen.dev-mobile .scaler-btn { min-width: 56px; min-height: 56px; font-size: 24px; padding: 8px 12px; }
  .screen.dev-mobile .empty { padding: 48px 16px; }
  .screen.dev-mobile .list { grid-template-columns: minmax(0, 1fr); }
  .screen.dev-mobile .sort { min-height: 56px; font-size: 18px; padding: 10px 14px; }
  /* Phone timer chips are at least 48px tall (RECIPE-15). */
  .screen.dev-mobile .time-chip { min-height: 48px; }
  /* Phone nav strip (NAV-1, D-N1 wave 1): 64px bar + safe-area,
     16px labels, nowrap — four 18px labels wrapped mid-word at
     390px ("Timer s" / "Photo s" / "Recip es"), so the strip is
     16px + nowrap. */
  .screen.dev-mobile .nav-strip { height: calc(64px + env(safe-area-inset-bottom, 0px)); }
  .screen.dev-mobile .nav-strip-button { font-size: 16px; white-space: nowrap; }
  /* Bottom-edge fix (mobile strip is 64px + safe-area): the list
     and the detail carry bottom padding equal to the strip height
     + 8px, so the last row can scroll clear of the fixed strip. */
  .screen.dev-mobile .list { padding-bottom: 72px; }
  .screen.dev-mobile .detail { padding-bottom: 72px; }
  .screen.dev-mobile .timer-strip-item { min-height: 56px; font-size: 19px; padding: 10px 16px; }
  .screen.dev-mobile .cook-total { font-size: 20px; }
  .screen.dev-mobile .detail-rows { font-size: 19px; }
  .screen.dev-mobile .detail-photo { max-height: 320px; }
  .screen.dev-mobile .detail-photo.missing { min-height: 180px; font-size: 72px; }
  /* Landscape phone/tablet: two columns, but only when the viewport is
     wide enough for two readable columns — a narrow landscape phone
     keeps the single column. Tracks are minmax(0, 1fr) (D4 rule 1):
     a bare 1fr is minmax(auto, 1fr) and the auto minimum is the widest
     item's min-content. */
  @media (min-width: 640px) { .screen.dev-mobile.orient-landscape .list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  /* Phone landscape: a single 48 px header row (R-IMPL-2) — the
     "Recipes" heading is omitted (the strip already says where you
     are); the search field on the left, the single scrollable chip
     row filling the middle, and the count ("382 recipes") inlined as
     compact text at the right end of that same row, never on its own
     line. Content height = viewport − 56 px top bar − 60 px strip;
     the 48 px header leaves ≥1 full recipe row at every landscape
     size. The sort control rides inside the toolbar next to the
     search field. */
  .screen.dev-mobile.orient-landscape .title { display: none; }
  .screen.dev-mobile.orient-landscape .list-view {
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr) auto;
    grid-template-areas: "toolbar chips status" "body body body";
    gap: 8px 12px;
    align-items: center;
  }
  .screen.dev-mobile.orient-landscape .toolbar { grid-area: toolbar; min-width: 0; }
  .screen.dev-mobile.orient-landscape .chips { grid-area: chips; }
  .screen.dev-mobile.orient-landscape .status { grid-area: status; white-space: nowrap; font-size: 16px; }
  .screen.dev-mobile.orient-landscape .body { grid-area: body; min-width: 0; }
  .screen.dev-mobile.orient-landscape .search { min-height: 48px; }
  .screen.dev-mobile.orient-landscape .sort { min-height: 48px; }
  .screen.dev-mobile.orient-landscape .chip { min-height: 48px; }
  /* -- PIP: the floating timer indicator (D3, R-IMPL-17–22) -----------
     One floating card: timer name (ellipsised to fit, never clipped
     mid-word without an ellipsis), remaining time ticking (mm:ss,
     always fully visible — the time is never the part that gets cut),
     state, and a "+N more" count when several timers run. Bottom-centre
     above the nav strip on phones (thumb zone), bottom-right above the
     strip on wall/desktop, above the safe-area band; never covering
     the tracker or the current step — steps scroll beneath it. Max
     width 80% of the viewport on phones (312 px at 390 px), 360 px on
     wall/desktop. The × is a ≥48 px tap target on phones (56–64 px
     hub) at the right end, after the remaining time, inside the PIP
     bounds. */
  .pip, .pip-affordance {
    position: fixed;
    z-index: 70;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(64px + env(safe-area-inset-bottom, 0px) + 16px);
  }
  .pip {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 80vw;
    min-height: 56px;
    padding: 6px 6px 6px 18px;
    box-sizing: border-box;
    border-radius: 999px;
    border: 1px solid #F3D9C8;
    background: #FDEFE6;
    color: var(--ink);
    box-shadow: var(--shadow-lift);
    cursor: pointer;
    font-family: inherit;
    transition: opacity 300ms ease-out;
  }
  .pip.hide { opacity: 0; pointer-events: none; }
  .pip-icon { flex: 0 0 auto; font-size: 22px; }
  .pip-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 20px; font-weight: 700; }
  .pip-time { flex: 0 0 auto; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--accent); white-space: nowrap; }
  .pip-more { flex: 0 0 auto; font-size: 18px; font-weight: 700; color: var(--muted); white-space: nowrap; }
  .pip-dismiss {
    flex: 0 0 auto;
    width: 48px;
    height: 48px;
    min-width: 48px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
    font-size: 22px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    font-family: inherit;
  }
  .pip-dismiss:active { transform: scale(0.94); }
  /* Wall/desktop: bottom-right, max 360 px. Tablet: above the 72 px
     strip. Desktop non-kiosk has no strip, so the PIP sits 16 px
     above the viewport bottom; desktop kiosk has the 56 px strip. */
  .screen.dev-hub .pip, .screen.dev-hub .pip-affordance { left: auto; right: 24px; transform: none; bottom: 112px; }
  .screen.dev-hub .pip { max-width: 360px; }
  .screen.dev-hub .pip-dismiss, .screen.dev-tablet .pip-dismiss { width: 56px; height: 56px; min-width: 56px; }
  .screen.dev-tablet .pip, .screen.dev-tablet .pip-affordance { bottom: 88px; }
  .screen.dev-desktop .pip, .screen.dev-desktop .pip-affordance { left: auto; right: 24px; transform: none; bottom: 16px; }
  .screen.dev-desktop .pip { max-width: 360px; }
  .screen.dev-desktop.kiosk .pip, .screen.dev-desktop.kiosk .pip-affordance { bottom: 72px; }
  /* Minimized restore affordance (R-IMPL-22): a small floating pill
     showing the timer icon + remaining time (or "Done" for a finished
     timer), in the same corner as the PIP. Tap it to restore the full
     PIP; it never navigates and never cancels the timer. */
  .pip-affordance {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 6px 18px;
    box-sizing: border-box;
    border-radius: 999px;
    border: 1px solid #F3D9C8;
    background: #FDEFE6;
    color: var(--ink);
    box-shadow: var(--shadow-lift);
    cursor: pointer;
    font-family: inherit;
    font-size: 20px;
    font-weight: 700;
  }
  .pip-affordance .pip-time { font-size: 20px; }
  /* -- Sticky strip summary (D4 rule 6, R-IMPL-28) ----------------------
     When the user scrolls past the running-timer strip, it collapses
     to this one-line sticky summary pinned directly under the sticky
     tracker ("⏱ 2 running · nearest 12:34"). It sits in the tracker's
     sticky band, not over content. Tapping it goes to the Timers view
     (ambiguity #5: "expands in place OR goes to Timers" — this build
     picks Timers, as RECIPE-22 strip taps do). Hidden
     until the strip has scrolled past (JS toggles .visible). */
  .timer-strip-summary {
    position: sticky;
    top: calc(var(--header-height, 56px) + var(--detail-header-h, 184px) + var(--tracker-h, 98px));
    z-index: 2;
    display: none;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 48px;
    padding: 8px 16px;
    box-sizing: border-box;
    border-radius: 12px;
    border: 1px solid #F3D9C8;
    background: #FDEFE6;
    color: var(--ink);
    font-size: 20px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    text-align: left;
  }
  .timer-strip-summary.visible { display: flex; }
  .screen.kiosk .timer-strip-summary { top: calc(var(--detail-header-h, 184px) + var(--tracker-h, 98px)); }
  /* The completion card (R-IMPL-8): shown after "Finish" at the last
     step, below the steps. Same card treatment as the rest of the
     detail; the buttons stack full-width. Its scroll margin matches
     the steps', so scrolling it into view lands it below the tracker. */
  .completion-card {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 24px;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: var(--card);
    box-shadow: var(--shadow-card);
    scroll-margin-top: calc(var(--header-height, 56px) + var(--detail-header-h, 184px) + var(--tracker-h, 98px) + 16px);
  }
  .screen.kiosk .completion-card { scroll-margin-top: calc(var(--detail-header-h, 184px) + var(--tracker-h, 98px) + 16px); }
  .completion-title { font-size: 28px; font-weight: 700; }
  .completion-sub { font-size: 20px; color: var(--muted); }
  /* A bridge-missing timer error (R-IMPL-25): the same slot as the
     voice hint, in the error colour — one line, never hint + error. */
  .timer-error { color: var(--error); }
  /* The PIP's paused state word (R-IMPL-17): small, muted, after
     the remaining time. */
  .pip-state { flex: 0 0 auto; font-size: 18px; font-weight: 600; color: var(--muted); white-space: nowrap; }
  /* Reduced motion (DESIGN-6, WCAG 2.2): the skeleton pulse stops
     (the skeleton rows themselves still show) and press feedback is
     instant (no scale). */
  @media (prefers-reduced-motion: reduce) {
    .skeleton-thumb, .skeleton-line { animation: none; }
    .nav-strip-button { transition: none; }
    .button:active, .row:active, .star:active, .tab:active,
    .ingredient:active, .time-chip:active, .nav-strip-button:active,
    .timer-strip-item:active { transform: none; }
  }
`;

class AnyListRecipeViewCard extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._config = {};
    this._title = "Recipes";
    this._recipes = []; // All recipes from get_recipes (full: ingredients and steps included).
    this._collections = [];
    this._query = "";
    this._searchResults = null; // Ranked results from the local search, or null.
    this._collectionId = "";
    this._selected = null; // The open recipe, from the loaded list, or null (list view).
    this._detailTab = "cook"; // Active tab of the open recipe: cook or notes.
    this._loading = false;
    this._error = "";
    this._loaded = false;
    // Cooking state, per recipe id, kept for the card's lifetime so a
    // cook can leave a recipe and come back without losing their place
    // (Paprika keeps the highlighted step and crossed-off ingredients
    // the same way). Checked ingredients are a set of row indexes;
    // the current step is an index into the numbered (non-header)
    // steps. The timer status line holds the last timer-start outcome.
    this._checked = new Map();
    this._currentStep = new Map();
    this._timerStatus = "";
    // Note editing: an unsaved draft per recipe id, so typing
    // survives leaving the tab (or the recipe) and coming back, and
    // so a re-render mid-typing never drops the text. The draft is
    // cleared only by a successful save. The status is the feedback
    // line under the editor ("Note saved." or an honest error); a
    // failed save keeps the draft, so nothing typed is ever lost. An
    // unconfirmed save carries retry:"retry-note", and the status
    // renders as a tappable retry button (R-IMPL-39).
    this._noteDrafts = new Map();
    this._noteStatus = null; // { text, error, retry? } or null
    this._savingNote = false;
    // Rating: a tap saves at once (no separate Save button). The
    // status is the feedback line under the stars. _ratingBusy
    // blocks double-taps while a save is in flight. _pendingRating
    // holds the rating a failed save was trying to set, so the
    // retry button can re-attempt exactly that value (R-IMPL-39).
    this._ratingStatus = null; // { text, error, retry? } or null
    this._ratingBusy = false;
    this._pendingRating = null;
    // Serving scaling is transient by design: the chosen serving
    // count per recipe id, for this cooking session only. It resets
    // when the recipe is opened (see _openRecipe) and never calls
    // update_recipe — it only changes the quantities shown.
    // _showOriginal lists the recipes whose quantities are currently
    // shown as stored (the original-amount toggle); the scaler bar
    // still shows the chosen servings and factor.
    this._scaleServings = new Map();
    this._showOriginal = new Set();
    // List sort (RECIPE-19): name, rating, cook time or prep time.
    this._sort = "name";
    // Wake Lock (RECIPE-8): the screen sentinel while a recipe's
    // Cook tab is open, or null. _wakeLockRequested blocks parallel
    // requests while one is in flight.
    this._wakeLock = null;
    this._wakeLockRequested = false;
    this._visibilityBound = null;
    // Running-timer strip (RECIPE-22): the 1s tick that refreshes
    // the strip's remaining times in place (never a full re-render,
    // so it cannot wipe a note draft mid-typing).
    this._stripTick = null;
    // PIP (D3, R-IMPL-17–22): the floating timer indicator. _pip is
    // null when hidden, else { timerId, name, state, remaining,
    // startedAt, finishedAt, more, collapsed }. _pipKnown tracks every
    // timer sensor the card has seen (entity_id → { state, startedVia,
    // startedAt }) so a hass push can tell a just-started voice timer
    // from a pre-existing one. _pipDismissed remembers finished timers
    // whose notice the user dismissed, so a later hass push does not
    // re-show them; a NEW finish still shows.
    this._pip = null;
    this._pipKnown = new Map();
    this._pipDismissed = new Set();
    this._pipHideTimer = null;
    this._pipFadeTimer = null;
    this._pipTick = null;
    this._pipTouch = null; // { x, y } of the active PIP touch, for swipe
    this._pipHideLeftMs = 0;
    this._pipHideEndsAt = 0;
    // Completion card (R-IMPL-8): shown after "Finish" at the last step.
    this._finishShown = false;
    // Timer-start error (R-IMPL-25): the bridge-missing error, shown
    // IN PLACE OF the voice hint (same slot) while it stands.
    this._timerError = "";
    // Deep link (Phase 3 contract): applied once, after the first
    // load, so opening a recipe from ?recipe=<id>&step=<n> does not
    // yank the cook back on a later re-render.
    this._deepLinkApplied = false;
    this._searchTimer = null;
    // Session persistence (DESIGN-7): the open recipe + list/detail
    // scroll, restored once per mount after the list loads. _interacted
    // is set by any scroll/tap/typing before the restore runs — if the
    // user has already done something, their state wins and the
    // restore is skipped.
    this._sessionRestored = false;
    this._interacted = false;
    this._scrollSaveTimer = null;
    this._windowScrollBound = null;
    this._shell = null; // Built once: title, toolbar, chips, status, body.
    this._detailEl = null;
    this._device = null; // { category, orientation } from detectDevice, or null outside a browser.
    this._resizeBound = null;
    this._popstateBound = null;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
    this.shadowRoot.addEventListener("input", (event) => this._onInput(event));
    this.shadowRoot.addEventListener("change", (event) => this._onChange(event));
    // PIP touch (R-IMPL-19/22): a touch on the PIP suspends its 5 s
    // auto-hide clock until the touch ends, and a swipe collapses it
    // to the restore affordance. Delegated on the shadow root like
    // the click handler; the handlers no-op unless the touch is on
    // the PIP or its affordance.
    this.shadowRoot.addEventListener("touchstart", (event) => this._onPipTouchStart(event), { passive: true });
    this.shadowRoot.addEventListener("touchend", (event) => this._onPipTouchEnd(event), { passive: true });
    // A swipe the compositor claims for scrolling ends in touchcancel,
    // not touchend — treat it as an end too. Without this, a cancelled
    // touch leaves the auto-hide clock suspended (cleared in
    // _pipTouchStart, resumed only in _pipTouchEnd) and the PIP never
    // hides, and the swipe itself never collapses it.
    this.shadowRoot.addEventListener("touchcancel", (event) => this._onPipTouchEnd(event), { passive: true });
    // A failed photo load falls back to the initial-letter tile
    // (RECIPE-10). Image errors do not bubble, but they do travel
    // the capture phase — one capture listener on the shadow root
    // catches every photo in the card, list rows and detail hero.
    this.shadowRoot.addEventListener("error", (event) => this._onPhotoError(event), true);
  }

  setConfig(config) {
    this._config = config || {};
    if (typeof this._config.title === "string" && this._config.title.trim()) {
      this._title = this._config.title.trim();
    }
    this._render();
  }

  set hass(hass) {
    const hadHass = this._hass !== null;
    this._hass = hass;
    if (hass && !hadHass) {
      // First time a Home Assistant object arrives, load the recipes.
      // Later hass updates only re-render; the list is reloaded when
      // the view opens (see connectedCallback), never on every state
      // change, and never by a manual control.
      this._loadAll();
      // Seed the known-sensor set: timers already running when the
      // card first loads are pre-existing, not "just started by
      // voice" — the diff must not show a PIP for them.
      this._pipSeedKnown();
    } else {
      // Every later hass push diffs the timer sensors (a voice-started
      // timer or a finish shows the PIP) before the re-render.
      this._pipOnHassPush();
      this._render();
    }
  }

  connectedCallback() {
    // Lovelace attaches the card each time its view opens, so this is
    // the fresh-load trigger: every time the Recipes view is shown,
    // the list and collections come straight from AnyList. There is no
    // Refresh button on purpose — a list that is current on open does
    // not need one. _loadAll is a no-op while a load is already in
    // flight, so the attach that follows the first hass object does
    // not double-load.
    if (this._hass) this._loadAll();
    this._render();
    // A deep link opened on an already-loaded list applies here; the
    // _loadAll path applies it when the load finishes.
    // Kiosk re-apply (N-IMPL-10d): a same-tab reload whose URL lost
    // ?kiosk gets it back with one replace (the flag is the backstop).
    reapplyKioskIfNeeded();
    if (this._loaded) this._applyDeepLink();
    // Session restore (DESIGN-7): re-open the recipe that was open
    // and restore the scroll; a deep link owns recipe+step, the
    // session owns the scroll (N-IMPL-21b).
    if (this._loaded) this._restoreSession();
    // System-back / forward within Recipes (decision F).
    if (
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function" &&
      !this._popstateBound
    ) {
      this._popstateBound = (event) => this._onPopState(event);
      window.addEventListener("popstate", this._popstateBound);
    }
    // The layout follows the viewport: a resize or an orientation
    // change re-detects the device and re-applies the classes. The
    // classes drive the CSS, so no re-render is needed.
    if (
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function" &&
      !this._resizeBound
    ) {
      this._resizeBound = () => this._onResize();
      window.addEventListener("resize", this._resizeBound);
    }
    // Scroll persistence (DESIGN-7): the window scroll is the list /
    // detail scroll (the card itself does not scroll internally).
    if (
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function" &&
      !this._windowScrollBound
    ) {
      this._windowScrollBound = () => {
        this._interacted = true;
        this._scheduleSessionSave();
        // The sticky strip summary appears once the strip scrolls
        // past the tracker (R-IMPL-28).
        this._syncStripSummary();
      };
      window.addEventListener("scroll", this._windowScrollBound, { passive: true });
    }
    // A Wake Lock is released when the page hides; re-request it on
    // return while a recipe's Cook tab is still open (RECIPE-8).
    if (
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function" &&
      typeof document !== "undefined" &&
      !this._visibilityBound
    ) {
      this._visibilityBound = () => this._onVisibilityChange();
      window.addEventListener("visibilitychange", this._visibilityBound);
    }
  }

  disconnectedCallback() {
    if (
      typeof window !== "undefined" &&
      this._resizeBound &&
      typeof window.removeEventListener === "function"
    ) {
      window.removeEventListener("resize", this._resizeBound);
      this._resizeBound = null;
    }
    if (
      typeof window !== "undefined" &&
      this._visibilityBound &&
      typeof window.removeEventListener === "function"
    ) {
      window.removeEventListener("visibilitychange", this._visibilityBound);
      this._visibilityBound = null;
    }
    if (
      typeof window !== "undefined" &&
      this._windowScrollBound &&
      typeof window.removeEventListener === "function"
    ) {
      window.removeEventListener("scroll", this._windowScrollBound);
      this._windowScrollBound = null;
    }
    if (
      typeof window !== "undefined" &&
      this._popstateBound &&
      typeof window.removeEventListener === "function"
    ) {
      window.removeEventListener("popstate", this._popstateBound);
      this._popstateBound = null;
    }
    if (this._scrollSaveTimer !== null) {
      clearTimeout(this._scrollSaveTimer);
      this._scrollSaveTimer = null;
    }
    this._sessionRestored = false;
    this._interacted = false;
    this._releaseWakeLock();
    this._clearStripTick();
    // The PIP's timers (auto-hide, fade, 1 s tick) stop with the card;
    // a hidden PIP never fires after disconnect.
    this._pipClearHideTimers();
    this._clearPipTick();
  }

  _onResize() {
    this._applyDevice();
    this._updateChipsFade();
    this._syncSortLabels();
  }

  // The sort labels (R-IMPL-4): at ≤390 px the sort control is
  // compact — "⇅ Name", "⇅ Rating", "⇅ Cook time", "⇅ Prep time" —
  // so the toolbar fits beside the search field. Above 390 px the
  // plain labels return. The values never change, only the text.
  _syncSortLabels() {
    const sortEl = this._shell ? this._shell.querySelector('[data-role="sort"]') : null;
    if (!sortEl || !sortEl.options) return;
    const narrow =
      typeof window !== "undefined" &&
      typeof window.innerWidth === "number" &&
      window.innerWidth <= 390;
    const labels = narrow
      ? { name: "⇅ Name", rating: "⇅ Rating", cook: "⇅ Cook time", prep: "⇅ Prep time" }
      : { name: "Name", rating: "Rating", cook: "Cook time", prep: "Prep time" };
    for (const option of sortEl.options) {
      const label = labels[option.value];
      if (label && option.textContent !== label) option.textContent = label;
    }
  }

  // Detect the device and carry it as classes on the screen element:
  // dev-hub, dev-desktop or dev-mobile, plus orient-landscape or
  // orient-portrait, plus kiosk when the URL carries ?kiosk. The CSS
  // below keys the adaptive layout off these classes; the base rules
  // are the hub layout. Outside a browser (node tests) there is no
  // environment to read, so the classes are left off and the base
  // layout stands.
  _applyDevice() {
    if (!this._shell) return;
    const env = readDeviceEnv();
    if (!env) return;
    const device = detectDevice(env);
    const changed =
      !this._device ||
      this._device.category !== device.category ||
      this._device.orientation !== device.orientation;
    this._device = device;
    this._shell.classList.remove(
      "dev-hub",
      "dev-desktop",
      "dev-tablet",
      "dev-mobile",
      "orient-landscape",
      "orient-portrait",
      "kiosk"
    );
    this._shell.classList.add(
      `dev-${device.category}`,
      `orient-${device.orientation}`
    );
    if (isKioskMode(readLocationSearch())) {
      this._shell.classList.add("kiosk");
      // Kiosk as a session property (N-IMPL-10): remember the flag so
      // a same-tab reload can re-apply ?kiosk (N-IMPL-10d).
      storeKioskFlag();
    }
    // Night mode (N-IMPL-24): dimmed strip, same targets.
    this._shell.classList.toggle("night", isNightNow(readNightSetting()));
    if (changed) this._updateChipsFade();
  }

  // -- AnyList actions (over the websocket API) ---------------------------
  //
  // The card calls the integration's actions with return_response so the
  // response data comes back in the call result. hass.callWS is the
  // stable websocket path; hass.callService has no documented
  // return-response form from a Lovelace card.

  async _callAction(service, data) {
    if (!this._hass || typeof this._hass.callWS !== "function") {
      throw new Error("Home Assistant connection is not available");
    }
    const result = await this._hass.callWS({
      type: "call_service",
      domain: "anylist",
      service,
      service_data: data || {},
      return_response: true,
    });
    // The websocket API wraps a service response as { response: {...} }.
    // Tolerate a bare response too, so a future shape change fails
    // soft instead of blanking the screen.
    if (result && typeof result === "object" && "response" in result) {
      return result.response;
    }
    return result;
  }

  async _loadAll() {
    if (this._loading) return;
    this._loading = true;
    this._error = "";
    this._render();
    try {
      // One download per view-open: the full recipe list, ingredients
      // and steps included. Everything after this — list, collection
      // chips, search, detail — reads from memory, so opening a
      // recipe or typing a search makes no further server call.
      const all = await this._callAction("get_recipes", {
        include_ingredients: true,
        include_steps: true,
      });
      const recipes = Array.isArray(all && all.recipes) ? all.recipes : [];
      this._recipes = sortRecipes(recipes.map((item) => normalizeRecipe(item)));
      this._collections = deriveCollections(this._recipes);
      this._loaded = true;
      // A deep link (?recipe=<id>&step=<n>) opens its recipe once
      // the list it names has loaded.
      this._applyDeepLink();
      // Session restore (DESIGN-7): re-open the recipe that was open
      // and restore the scroll, unless a deep link owns the state.
      this._restoreSession();
    } catch (err) {
      this._error = this._friendlyError(err);
    } finally {
      this._loading = false;
      this._render();
    }
  }

  // Local search over the recipes already loaded — no server call.
  // _search owns the query state: typing sets it via _onInput, but a
  // direct call must keep the empty state and the count line honest.
  _search(query) {
    const trimmed = asTrimmed(query);
    this._query = trimmed;
    if (!trimmed) {
      // Empty query means browse: back to the full list.
      this._searchResults = null;
      this._render();
      this._saveSession();
      return;
    }
    this._searchResults = searchRecipes(this._recipes, trimmed);
    this._render();
    this._saveSession();
  }

  // Detail reads from the loaded list: the view-open download already
  // brought ingredients and steps, so opening a recipe makes no
  // server call and needs no cache.
  // options.pushHistory: a tap-open pushes ONE history entry
  // {fhNav:"detail", openId} at the same URL (decision F), so
  // system-back from the list returns to the detail exactly once.
  // Restore and deep-link opens do NOT push — they are already at a
  // history position.
  // Scroll the current step into view (D2b, R-IMPL-6): its top sits
  // just below the sticky tracker (scroll-margin-top on .step), its
  // full text visible. No-op when the detail is not open or the step
  // element is not in the DOM (the DOM tests). The page scrolls as a
  // unit — the steps column does not scroll independently (see the
  // implementation report); the observable contract (current step
  // visible below the tracker, tracker agreeing) holds either way.
  _scrollCurrentStepIntoView() {
    if (!this._detailEl || !this._selected) return;
    const steps = this._navigableSteps(this._selected);
    if (steps.length === 0) return;
    const current = this._currentStepIndex(this._selected.id, steps.length);
    const el = this._detailEl.querySelector(`[data-step-index="${current}"]`);
    if (!el || typeof el.scrollIntoView !== "function") return;
    try {
      el.scrollIntoView({ block: "start", behavior: "auto" });
    } catch (_err) {
      // A scroll failure never breaks the step change.
    }
  }

  _openRecipe(recipeId, options) {
    const id = asTrimmed(recipeId);
    if (!id) return;
    const recipe = this._recipes.find((item) => item.id === id);
    if (!recipe) return;
    this._selected = recipe;
    this._detailTab = "cook";
    // Fresh open, fresh session: the serving scaler resets to the
    // recipe's stored servings (it is transient by design), and the
    // save feedback lines clear. The note draft is NOT cleared — an
    // unsaved note survives leaving the recipe and coming back, the
    // same way checked ingredients and the current step do.
    this._scaleServings.delete(id);
    this._showOriginal.delete(id);
    this._noteStatus = null;
    this._ratingStatus = null;
    this._savingNote = false;
    this._ratingBusy = false;
    this._finishShown = false;
    this._timerError = "";
    // Cooking state survives a reload (RECIPE-9): restore the saved
    // check-off and step when they are younger than 24h.
    this._loadCookState(id);
    this._render();
    // M1 (N-IMPL-29): a detail ALWAYS opens at the top — the list's
    // scroll is never inherited by the detail, and "← All recipes"
    // is visible on open at every viewport.
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      try {
        window.scrollTo(0, 0);
      } catch (_err) {
        // A scroll failure never breaks the open.
      }
    }
    // Session persistence (DESIGN-7): remember the open recipe.
    this._saveSession();
    if (options && options.pushHistory) this._pushDetailHistory(id);
  }

  // ONE history entry for a tap-opened detail (decision F): a
  // state-carrying push at the same URL, never a bare same-URL push.
  _pushDetailHistory(recipeId) {
    if (typeof window === "undefined" || !window.history) return;
    if (typeof window.history.pushState !== "function") return;
    try {
      const url = `${window.location.pathname || "/family-hub/recipes"}${window.location.search || ""}`;
      window.history.pushState({ fhNav: "detail", openId: recipeId }, "", url);
    } catch (_err) {
      // A pushState failure never breaks the open.
    }
  }

  // -- detail close + history (N-IMPL-7/9, decision F) ----------------------
  //
  // Strip Recipes from a detail is list intent: close the detail, show
  // the list at scrollY 0, clear the saved open detail (openId + step
  // + both scroll buckets — the next restore starts at list top), and
  // push exactly ONE history entry ({fhNav:"list", openId:null}) so
  // system-back from the list returns to the detail exactly once.
  // A reload is restore intent and keeps the saved detail; an explicit
  // Recipes tap from a detail is list intent and clears it — the two
  // intents are distinguished by the action, not the URL.
  _closeDetailToListTop() {
    this._selected = null;
    this._hidePip();
    this._render();
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      try {
        window.scrollTo(0, 0);
      } catch (_err) {
        // A scroll failure never breaks the close.
      }
    }
    this._clearRecipeSession();
    if (typeof window !== "undefined" && window.history && typeof window.history.pushState === "function") {
      try {
        window.history.pushState(
          { fhNav: "list", openId: null },
          "",
          withKioskQuery("/family-hub/recipes")
        );
      } catch (_err) {
        // A pushState failure never breaks the close.
      }
    }
  }

  // Write the clean list-top session state (no open detail, no step,
  // both scroll buckets zero). The search query, filter and sort are
  // KEPT — a strip-Recipes tap clears the open detail, not the
  // list the user was browsing.
  _clearRecipeSession() {
    if (typeof sessionStorage === "undefined") return;
    try {
      sessionStorage.setItem(
        RECIPE_SESSION_KEY,
        serializeRecipeSession({
          openId: null,
          step: null,
          listScrollY: 0,
          detailScrollY: 0,
          query: this._query || "",
          collectionId: this._collectionId || "",
          sort: this._sort || "name",
        })
      );
    } catch (_err) {
      // Storage full or blocked: the view still works, it just is
      // not remembered. Never throw from a cosmetic feature.
    }
  }

  // System-back / forward while this card is mounted (decision F):
  // the card keys rendering off history.state + the session store,
  // not the URL alone. A detail entry re-opens that detail at the
  // saved step and scrolls the current step into view (D2b —
  // ambiguity #3 resolution (a): "restores the saved step + scroll"
  // means the step + a scroll TO the current step, never the raw
  // detailScrollY, which D2d forbids restoring ever); a list entry
  // (or an entry with no Navigation state, e.g. the initial list
  // entry) shows the list at the saved list scroll. No history entry
  // is pushed here — the entries already exist.
  _onPopState(event) {
    if (!this._loaded) return;
    const state =
      (event && event.state) ||
      (typeof window !== "undefined" && window.history ? window.history.state : null);
    const saved = this._readSavedSession();
    if (state && typeof state === "object" && state.fhNav === "detail" && typeof state.openId === "string" && state.openId) {
      if (this._selected && this._selected.id === state.openId) return;
      const recipe = this._recipes.find((item) => item.id === state.openId);
      if (!recipe) return;
      this._openRecipe(state.openId);
      if (saved && saved.openId === state.openId && typeof saved.step === "number" && saved.step > 0) {
        const steps = this._navigableSteps(recipe);
        if (steps.length > 0) {
          this._currentStep.set(state.openId, Math.min(saved.step - 1, steps.length - 1));
          this._saveCookState(state.openId);
          this._render();
        }
      }
      this._saveSession();
      this._scrollCurrentStepIntoView();
      return;
    }
    // List entry (or no Navigation state): the list, at the saved
    // list scroll (N-IMPL-9).
    if (this._selected) {
      this._selected = null;
      this._render();
      if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
        try {
          window.scrollTo(0, saved ? saved.listScrollY : 0);
        } catch (_err) {
          // A scroll failure never breaks the return.
        }
      }
      this._saveSession();
    }
  }

  // -- deep link (Phase 3 contract) --------------------------------------
  //
  // Honour ?recipe=<id>&step=<n> (and the timer-jump form
  // ?from_recipe=<id>&step=<n>): open the recipe at the given step.
  // Step is the 1-based "Step N of M" number the cook sees. Applied
  // once, after the first load — never again, so the cook's own step
  // navigation is never yanked back by a re-render.
  _applyDeepLink() {
    if (this._deepLinkApplied || !this._loaded) return;
    this._deepLinkApplied = true;
    if (typeof window === "undefined" || !window.location) return;
    let search = "";
    try {
      search = String(window.location.search || "");
    } catch (_err) {
      return;
    }
    const params = new URLSearchParams(search);
    const recipeId = asTrimmed(params.get("recipe") || params.get("from_recipe"));
    if (!recipeId) return;
    const recipe = this._recipes.find((item) => item.id === recipeId);
    if (!recipe) return;
    // Compose (N-IMPL-21b): the deep link owns the recipe + step; the
    // session owns nothing here — the open saves the session, and the
    // arrival scrolls to the current step (D2b). The saved
    // detailScrollY is NEVER restored (D2d).
    this._openRecipe(recipeId);
    const step = Number(params.get("step"));
    if (Number.isFinite(step) && step > 0) {
      const steps = this._navigableSteps(recipe);
      if (steps.length > 0) {
        this._currentStep.set(recipeId, Math.min(step - 1, steps.length - 1));
        this._saveCookState(recipeId);
        this._render();
        // The session step follows the URL step, so the PIP contract
        // and the next restore agree with the deep link.
        this._saveSession();
      }
    }
    // A deep-link arrival (including the Timers "← Back to recipe"
    // return) restores the saved step + a scroll TO the current step
    // (D2b — ambiguity #3 resolution (a)). The saved detailScrollY
    // is NEVER restored (D2d).
    this._scrollCurrentStepIntoView();
  }

  // -- session persistence (DESIGN-7) --------------------------------------
  //
  // Restore once per mount, after the list loads (or immediately when
  // the list is already loaded). A deep link owns the recipe + step:
  // when the URL carries ?recipe= or ?from_recipe=, _applyDeepLink
  // (which runs first) owns the open, and the session's scroll is
  // applied there (N-IMPL-21b) — the session is no longer ignored
  // wholesale. If the user has already scrolled, tapped or typed
  // before the restore runs, their state wins instead. A saved recipe
  // id that is no longer in the list is ignored (the list scroll is
  // still restored).
  // Reload restore (N-IMPL-21a). A deep link wins over the session
  // (so "← Back to recipe" and fresh loads with ?recipe= never
  // re-open the previous detail). The list state — the search query,
  // the active filter, the sort — restores alongside the detail
  // (R-IMPL-14b/43): the list re-opens as the user left it, and the
  // search field keeps the query for editing. A reload re-opens a
  // saved detail at scrollY 0 with the saved step + checks restored
  // (D2d, R-IMPL-15) — the saved detailScrollY is NEVER restored.
  // No open detail: with a filter/search active the list re-opens
  // at the top (R2 step 7); otherwise at the saved list scroll.
  _restoreSession() {
    if (this._sessionRestored || !this._loaded) return;
    this._sessionRestored = true;
    if (this._interacted) return;
    try {
      const params = new URLSearchParams(readLocationSearch());
      if (asTrimmed(params.get("recipe") || params.get("from_recipe"))) return;
    } catch (_err) {
      // A URL that cannot be parsed cannot carry a deep link; restore.
    }
    const state = this._readSavedSession();
    if (!state) return;
    if (state.query || state.collectionId || state.sort !== "name") {
      this._query = state.query || "";
      this._collectionId = state.collectionId || "";
      this._sort = state.sort || "name";
      this._searchResults = this._query ? searchRecipes(this._recipes, this._query) : null;
      const input = this.shadowRoot.querySelector('[data-role="search"]');
      if (input) input.value = this._query;
      this._render();
    }
    if (state.openId) {
      const recipe = this._recipes.find((item) => item.id === state.openId);
      if (recipe) {
        this._openRecipe(state.openId);
        // The session step (N-IMPL-21a, N-IMPL-8): the detail re-opens
        // at the saved step. The session is the newer publication —
        // it wins over the per-recipe cook-state step on disagreement
        // (both are updated on every step change, so they agree in
        // practice).
        if (typeof state.step === "number" && state.step > 0) {
          const steps = this._navigableSteps(recipe);
          if (steps.length > 0) {
            this._currentStep.set(state.openId, Math.min(state.step - 1, steps.length - 1));
            this._saveCookState(state.openId);
            this._render();
            this._saveSession();
          }
        }
        // Reload heals: the detail re-opens at scrollY 0 (_openRecipe
        // scrolled there) with the saved step + checks restored. The
        // saved detailScrollY is NEVER read for a restore.
        return;
      }
    }
    if (typeof window !== "undefined" && state.listScrollY > 0 && !state.query && !state.collectionId) {
      window.scrollTo(0, state.listScrollY);
      this._saveSession();
    }
  }

  _readSavedSession() {
    if (typeof sessionStorage === "undefined") return null;
    try {
      return parseRecipeSession(sessionStorage.getItem(RECIPE_SESSION_KEY));
    } catch (_err) {
      return null;
    }
  }

  // Save the open recipe + the current step + the current scroll
  // into its own bucket (list or detail), keeping the other bucket's
  // saved value. The step is 1-based, updated on every step change,
  // and cleared (null) when the detail closes (N-IMPL-21a). The
  // search query, the active filter and the sort persist alongside
  // (R-IMPL-14b) so a reload re-opens the list as the user left it.
  _saveSession() {
    if (typeof sessionStorage === "undefined" || typeof window === "undefined") return;
    const prev = this._readSavedSession() || { openId: null, step: null, listScrollY: 0, detailScrollY: 0, query: "", collectionId: "", sort: "name" };
    const scrollY = sanitizeRecipeScroll(window.scrollY);
    const step = this._selected
      ? this._currentStepIndex(this._selected.id, this._navigableSteps(this._selected).length) + 1
      : null;
    const state = {
      openId: this._selected ? this._selected.id : null,
      step,
      listScrollY: this._selected ? prev.listScrollY : scrollY,
      detailScrollY: this._selected ? scrollY : prev.detailScrollY,
      query: this._query || "",
      collectionId: this._collectionId || "",
      sort: this._sort || "name",
    };
    try {
      sessionStorage.setItem(RECIPE_SESSION_KEY, serializeRecipeSession(state));
    } catch (_err) {
      // Storage full or blocked: the view still works, it just is
      // not remembered. Never throw from a cosmetic feature.
    }
  }

  _scheduleSessionSave() {
    if (this._scrollSaveTimer !== null) return;
    if (typeof setTimeout !== "function") return;
    this._scrollSaveTimer = setTimeout(() => {
      this._scrollSaveTimer = null;
      this._saveSession();
    }, 150);
  }

  // -- cooking state persistence (RECIPE-9) ------------------------------
  //
  // Check-off and current step persist per recipe in localStorage,
  // key family-hub:recipe:<id>:cook-state, value {checked, step,
  // savedAt}. State older than 24h is discarded. The scaler stays
  // TRANSIENT by design (it is never written here). localStorage is
  // per-device, so a toddler's taps on the wall do not spread to the
  // phone. Every read/write is guarded: a browser without storage
  // (or with it disabled) cooks exactly like before, in memory only.
  _cookStateKey(recipeId) {
    return `family-hub:recipe:${recipeId}:cook-state`;
  }

  _saveCookState(recipeId) {
    if (typeof localStorage === "undefined") return;
    try {
      const checked = [...(this._checked.get(recipeId) || new Set())];
      const steps = this._selected && this._selected.id === recipeId
        ? this._navigableSteps(this._selected).length
        : 0;
      const step = this._currentStepIndex(recipeId, Math.max(steps, 1));
      localStorage.setItem(
        this._cookStateKey(recipeId),
        JSON.stringify({ checked, step, savedAt: new Date().toISOString() }),
      );
    } catch (_err) {
      // Storage is best-effort; cooking never fails because a save did.
    }
  }

  _loadCookState(recipeId) {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(this._cookStateKey(recipeId));
      if (!raw) return;
      const state = JSON.parse(raw);
      if (!state || typeof state !== "object") return;
      const savedAt = Date.parse(state.savedAt);
      if (!Number.isFinite(savedAt) || Date.now() - savedAt > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(this._cookStateKey(recipeId));
        return;
      }
      if (Array.isArray(state.checked)) {
        this._checked.set(
          recipeId,
          new Set(state.checked.filter((index) => Number.isFinite(index) && index >= 0)),
        );
      }
      if (typeof state.step === "number" && state.step >= 0) {
        this._currentStep.set(recipeId, state.step);
      }
    } catch (_err) {
      // A corrupt entry is dropped, never fatal.
      try {
        localStorage.removeItem(this._cookStateKey(recipeId));
      } catch (_ignored) {}
    }
  }

  // -- Wake Lock (RECIPE-8) ----------------------------------------------
  //
  // Requested while a recipe's Cook tab is open, released the moment
  // the cook leaves it. A rejection (headless Chrome, an insecure
  // context, a browser without the API) is silent: the screen may
  // sleep, but cooking never errors over it. The live-hub check on a
  // real phone is a §13 item — a Wake Lock cannot be screenshotted.
  async _acquireWakeLock() {
    if (this._wakeLock || this._wakeLockRequested) return;
    if (
      typeof navigator === "undefined" ||
      !navigator.wakeLock ||
      typeof navigator.wakeLock.request !== "function"
    ) {
      return;
    }
    this._wakeLockRequested = true;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      this._wakeLock = sentinel;
      if (sentinel && typeof sentinel.addEventListener === "function") {
        sentinel.addEventListener("release", () => {
          if (this._wakeLock === sentinel) this._wakeLock = null;
        });
      }
    } catch (_err) {
      this._wakeLock = null;
    } finally {
      this._wakeLockRequested = false;
    }
  }

  _releaseWakeLock() {
    if (!this._wakeLock) return;
    try {
      const release = this._wakeLock.release;
      if (typeof release === "function") release.call(this._wakeLock);
    } catch (_err) {
      // Releasing is best-effort.
    }
    this._wakeLock = null;
  }

  _syncWakeLock() {
    if (this._selected && this._detailTab === "cook") {
      this._acquireWakeLock();
    } else {
      this._releaseWakeLock();
    }
  }

  _onVisibilityChange() {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "visible") this._syncWakeLock();
  }

  // -- nav-strip timer badge (N-IMPL-5) --------------------------------------
  //
  // The Timers button carries the count badge (ACTIVE + PAUSED;
  // amber last-60 s, red finished — decision #25-D). The strip is
  // built once, so the badge is updated in place on every render
  // from the live hass states.
  _updateStripBadge() {
    if (!this._shell) return;
    // Exactly one badge exists in this card (on the Timers button),
    // so the plain class selector is the lookup — no compound
    // selector, which the DOM test harness cannot match.
    const badge = this._shell.querySelector(".timer-badge");
    if (!badge) return;
    const states = this._hass && this._hass.states;
    // hass.states may be an array (classic) or an object keyed by
    // entity id (HA 2026.2+) — the badge helper takes the object form.
    const badgeState = timerBadgeFromHassStates(
      Array.isArray(states)
        ? Object.fromEntries(states.map((s) => [s.entity_id, s]))
        : states || null
    );
    if (!badgeState) {
      badge.hidden = true;
      badge.textContent = "";
      badge.className = "timer-badge";
      return;
    }
    badge.hidden = false;
    badge.textContent = String(badgeState.count);
    badge.className =
      "timer-badge" + (badgeState.tone === "count" ? "" : ` ${badgeState.tone}`);
    badge.setAttribute("aria-label", `${badgeState.count} timers`);
  }

  // -- running-timer strip tick (RECIPE-22) ------------------------------
  //
  // Once a second, refresh the strip's remaining times in place from
  // the live sensor states. Membership (which timers exist) refreshes
  // on hass pushes via _render; the tick only rewrites the text, so
  // it can never wipe a note draft or steal focus.
  _ensureStripTick() {
    if (this._stripTick !== null) return;
    if (typeof window === "undefined" || typeof setInterval !== "function") return;
    if (!this._selected || this._detailTab !== "cook") return;
    if (this._runningTimers().length === 0) return;
    this._stripTick = setInterval(() => this._tickStrip(), 1000);
  }

  _clearStripTick() {
    if (this._stripTick === null) return;
    if (typeof clearInterval === "function") clearInterval(this._stripTick);
    this._stripTick = null;
  }

  _tickStrip() {
    if (!this._detailEl || !this._selected || this._detailTab !== "cook") {
      this._clearStripTick();
      return;
    }
    const now = Date.now();
    const timers = this._shownStripTimers();
    if (timers.length === 0) {
      this._clearStripTick();
      return;
    }
    for (const timer of timers) {
      const el = this._detailEl.querySelector(`[data-remaining-for="${timer.entity_id}"]`);
      if (!el) continue;
      const remaining = timerRemainingSeconds(timer, now);
      el.textContent = remaining === null ? "" : formatRemaining(remaining);
    }
    // The sticky summary's "nearest" time ticks with the strip.
    this._syncStripSummary();
  }

  // The running timers for the strip, from the hass states.
  _runningTimers() {
    if (!this._hass) return [];
    return runningTimers(this._hass.states || []);
  }

  // The timers the strip actually shows (R-IMPL-26): at most 3,
  // most-recently-started first. The 1s tick and the strip share
  // this list, so the tick updates only shown pills.
  _shownStripTimers() {
    return this._runningTimers()
      .slice()
      .sort((a, b) => {
        const aStart =
          a.attributes && a.attributes.started_at
            ? Date.parse(a.attributes.started_at)
            : NaN;
        const bStart =
          b.attributes && b.attributes.started_at
            ? Date.parse(b.attributes.started_at)
            : NaN;
        if (Number.isFinite(aStart) && Number.isFinite(bStart)) return bStart - aStart;
        if (Number.isFinite(aStart)) return -1;
        if (Number.isFinite(bStart)) return 1;
        return 0;
      })
      .slice(0, 3);
  }

  // -- floating timer PIP (D3, R-IMPL-17–23) -----------------------------
  //
  // One floating card confirming the timer that just started (chip or
  // voice), with the timer name, the ticking remaining time, and the
  // state. It auto-hides after 5 s with a 300 ms fade; a finished
  // timer's PIP NEVER auto-hides (the return never silently drops
  // away). Tapping the PIP pins the timer and goes to the Timers
  // view; the × dismisses it without cancelling the timer; swiping
  // it collapses it to a small restore affordance, and tapping the
  // affordance restores the full PIP. A finished timer that arrives
  // while the PIP is collapsed comes back as the full PIP.
  //
  // Voice detection (ambiguity #4): on every hass push, the card
  // diffs the timer sensor set against what it has seen before. A
  // sensor that appears with started_via == "voice" while a detail
  // is open shows the PIP (the cook is cooking and just asked for a
  // timer by voice). A chip-started timer (started_via == "service")
  // is shown by the chip-tap path directly and is ignored by the
  // diff, so the same timer never double-shows. A sensor whose state
  // becomes "finished" shows the finished PIP (unless the user
  // dismissed that timer's notice). started_at is available for a
  // freshness check, but the sensor-set diff is the mechanism.
  //
  // OQ-7 hard gate: the PIP does NOT navigate until the step field
  // is published + verified. The step field IS published (Navigation
  // N-IMPL-21: the session state carries openId + step, and Timers
  // reads it back verbatim into &step=). The gate closes only when
  // the re-match verifies PIP tap → Timers pinned + back → same step
  // at phone portrait AND wall landscape, with the real PIP.

  // The PIP's current timer, as a live sensor (or null when the
  // sensor has not appeared yet — the chip-tap path shows the PIP
  // optimistically, and the sensor binds on the next hass push).
  _pipSensor() {
    if (!this._pip || !this._pip.entityId || !this._hass) return null;
    const states = timerSensorList(this._hass.states);
    for (const sensor of states) {
      if (sensor && sensor.entity_id === this._pip.entityId) return sensor;
    }
    return null;
  }

  // Bind an optimistic PIP (no entityId yet) to the sensor the chip
  // tap just created: the sensor whose name matches, started by the
  // service, within 15 s of the tap. Returns the entity_id, or null.
  // The sensor for the optimistic PIP (chip tap): the most recent
  // service-started sensor with the PIP's name, started within 15 s.
  // Returns the sensor object, or null.
  _pipResolveSensor() {
    if (!this._pip || this._pip.entityId || !this._hass) return null;
    const states = timerSensorList(this._hass.states);
    const cutoff = Date.now() - 15000;
    for (const sensor of states) {
      if (!sensor || typeof sensor.entity_id !== "string") continue;
      if (sensor.entity_id.indexOf("sensor.satellite_timer_") !== 0) continue;
      if (timerName(sensor) !== this._pip.name) continue;
      const attrs = sensor.attributes || {};
      const startedAt = attrs.started_at ? Date.parse(attrs.started_at) : NaN;
      if (Number.isFinite(startedAt) && startedAt < cutoff) continue;
      if (attrs.started_via && attrs.started_via !== "service") continue;
      return sensor;
    }
    return null;
  }

  _pipResolveEntityId() {
    const sensor = this._pipResolveSensor();
    return sensor ? sensor.entity_id : null;
  }

  // How many OTHER timers are running besides the PIP's own timer
  // (for the "+N more" count). Finished timers do not count.
  _pipMoreCount(excludeId) {
    let count = 0;
    for (const timer of this._runningTimers()) {
      if (timer.entity_id !== excludeId) count += 1;
    }
    return count;
  }

  // Show the PIP for a timer. source is either a sensor object or an
  // optimistic { entityId, name, remaining, state } from a chip tap.
  // opts.finished marks the finished return (never auto-hides).
  _pipShow(source, opts) {
    const finished = !!(opts && opts.finished);
    const entityId = source && typeof source.entity_id === "string" ? source.entity_id : null;
    const name = source ? timerName(source) || (source.name || "") : "";
    const remaining =
      source && typeof source.remaining === "number"
        ? source.remaining
        : source
          ? timerRemainingSeconds(source)
          : null;
    const state = finished ? "finished" : (source && source.state) || "active";
    this._pip = {
      entityId,
      name,
      state,
      remaining,
      shownAt: Date.now(),
      collapsed: false,
      hidden: false,
      finished,
      more: this._pipMoreCount(entityId),
    };
    this._pipClearHideTimers();
    if (!finished) {
      // 5 s auto-hide, 300 ms fade. Touch suspends the clock (the
      // touch handlers clear the timer and re-arm it with the time
      // left when the touch ends).
      this._pipHideLeftMs = PIP_AUTO_HIDE_MS;
      this._pipHideEndsAt = Date.now() + PIP_AUTO_HIDE_MS;
      this._pipHideTimer = setTimeout(() => this._pipFadeOut(), PIP_AUTO_HIDE_MS);
    }
    this._ensurePipTick();
    this._render();
  }

  // The 300 ms fade, then remove from the DOM.
  _pipFadeOut() {
    if (!this._pip || this._pip.finished) return;
    this._pip.hidden = true;
    this._pipHideTimer = null;
    this._render();
    this._pipFadeTimer = setTimeout(() => this._hidePip(), PIP_FADE_MS);
  }

  _pipClearHideTimers() {
    if (this._pipHideTimer !== null) {
      if (typeof clearTimeout === "function") clearTimeout(this._pipHideTimer);
      this._pipHideTimer = null;
    }
    if (this._pipFadeTimer !== null) {
      if (typeof clearTimeout === "function") clearTimeout(this._pipFadeTimer);
      this._pipFadeTimer = null;
    }
  }

  // Hide the PIP outright (detail closed, × dismissed, fade done).
  // Does NOT cancel the timer — dismissal is a notice action only.
  _hidePip() {
    this._pipClearHideTimers();
    this._clearPipTick();
    this._pip = null;
    this._pipTouch = null;
    if (this._shell) this._renderPip();
  }

  // The 1 s tick that refreshes the PIP's remaining time in place
  // (never a full re-render, so it cannot steal focus or wipe a
  // note draft). The strip has its own tick; the two are independent.
  _ensurePipTick() {
    if (this._pipTick !== null) return;
    if (typeof window === "undefined" || typeof setInterval !== "function") return;
    this._pipTick = setInterval(() => this._pipTickUpdate(), 1000);
  }

  _clearPipTick() {
    if (this._pipTick === null) return;
    if (typeof clearInterval === "function") clearInterval(this._pipTick);
    this._pipTick = null;
  }

  _pipTickUpdate() {
    if (!this._pip) {
      this._clearPipTick();
      return;
    }
    // A finished PIP never ticks away; its time reads "Done".
    if (this._pip.finished) return;
    const sensor = this._pipSensor();
    let remaining = null;
    let state = this._pip.state;
    if (sensor) {
      remaining = timerRemainingSeconds(sensor);
      state = sensor.state;
      if (sensor.state === "finished" && !this._pipDismissed.has(sensor.entity_id)) {
        // The timer finished between hass pushes: return as the full
        // finished PIP (never auto-hides), even from collapsed.
        this._pipShow(sensor, { finished: true });
        return;
      }
    } else if (this._pip.entityId === null) {
      // Optimistic countdown until the sensor binds.
      const elapsed = Math.floor((Date.now() - this._pip.shownAt) / 1000);
      remaining = this._pip.remaining === null ? null : Math.max(0, this._pip.remaining - elapsed);
      // Try to bind the sensor now (it usually appears ~1 s after
      // the chip tap).
      const resolved = this._pipResolveEntityId();
      if (resolved) {
        this._pip.entityId = resolved;
        this._pip.more = this._pipMoreCount(resolved);
      }
    }
    const host = this._shell ? this._shell.querySelector(".pip-host") : null;
    if (!host) return;
    const timeEl = host.querySelector('[data-role="pip-time"]');
    if (timeEl) {
      timeEl.textContent =
        state === "finished" ? "Done" : remaining === null ? "" : formatRemaining(remaining);
    }
    const stateEl = host.querySelector('[data-role="pip-state"]');
    if (stateEl) stateEl.textContent = state === "paused" ? "Paused" : "";
  }

  // Render the PIP (or its collapsed affordance) into the shell host.
  // Called from _render on every pass; the host is stable, so the
  // PIP survives list/detail re-renders.
  _renderPip() {
    const host = this._shell ? this._shell.querySelector(".pip-host") : null;
    if (!host) return;
    if (!this._pip || !this._selected) {
      if (host.innerHTML !== "") host.innerHTML = "";
      return;
    }
    const pip = this._pip;
    const sensor = this._pipSensor();
    const state = sensor ? sensor.state : pip.state;
    const remaining =
      sensor
        ? timerRemainingSeconds(sensor)
        : pip.entityId === null && pip.remaining !== null
          ? Math.max(0, pip.remaining - Math.floor((Date.now() - pip.shownAt) / 1000))
          : pip.remaining;
    const timeText = state === "finished" ? "Done" : remaining === null ? "" : formatRemaining(remaining);
    const moreText = pip.more > 0 ? `+${pip.more} more` : "";
    if (pip.collapsed) {
      // The minimized restore affordance (R-IMPL-22): timer icon +
      // remaining time (or "Done"). Tap restores the full PIP; it
      // never navigates and never cancels the timer. A finished timer
      // that arrives while collapsed comes back as the full PIP (the
      // hass diff shows it with collapsed:false).
      host.innerHTML = `<button type="button" class="pip-affordance" data-action="pip-restore" aria-label="Show timer ${escapeHtml(pip.name)}"><span class="pip-icon" aria-hidden="true">⏱</span><span class="pip-time" data-role="pip-time">${escapeHtml(timeText)}</span></button>`;
      return;
    }
    host.innerHTML = `<div class="pip${pip.finished ? " finished" : ""}${pip.hidden ? " hide" : ""}" data-action="pip-tap" role="button" tabindex="0" aria-label="Timer ${escapeHtml(pip.name)}, ${escapeHtml(timeText)}${moreText ? `, ${escapeHtml(moreText)}` : ""}. Tap to open Timers."><span class="pip-icon" aria-hidden="true">⏱</span><span class="pip-name">${escapeHtml(pip.name)}</span><span class="pip-time" data-role="pip-time">${escapeHtml(timeText)}</span>${state === "paused" ? `<span class="pip-state" data-role="pip-state">Paused</span>` : `<span class="pip-state" data-role="pip-state"></span>`}${moreText ? `<span class="pip-more">${escapeHtml(moreText)}</span>` : ""}<button type="button" class="pip-dismiss" data-action="pip-dismiss" aria-label="Dismiss timer notice">×</button></div>`;
  }

  // Seed the known-sensor set on first hass (pre-existing timers are
  // not "just started by voice" — the diff must not show a PIP for
  // them).
  _pipSeedKnown() {
    if (!this._hass) return;
    const states = timerSensorList(this._hass.states);
    for (const sensor of states) {
      if (!sensor || typeof sensor.entity_id !== "string") continue;
      if (sensor.entity_id.indexOf("sensor.satellite_timer_") !== 0) continue;
      const attrs = sensor.attributes || {};
      this._pipKnown.set(sensor.entity_id, {
        state: sensor.state,
        startedVia: attrs.started_via || null,
        startedAt: attrs.started_at || null,
      });
    }
  }

  // The hass-push diff (ambiguity #4): a newly-appearing sensor with
  // started_via == "voice" while a detail is open shows the PIP; a
  // sensor whose state becomes "finished" shows the finished PIP
  // (unless dismissed). Chip-started timers (started_via ==
  // "service") are shown by the chip-tap path and ignored here.
  _pipOnHassPush() {
    if (!this._hass) return;
    const states = timerSensorList(this._hass.states);
    const seen = new Set();
    for (const sensor of states) {
      if (!sensor || typeof sensor.entity_id !== "string") continue;
      if (sensor.entity_id.indexOf("sensor.satellite_timer_") !== 0) continue;
      seen.add(sensor.entity_id);
      const attrs = sensor.attributes || {};
      const prev = this._pipKnown.get(sensor.entity_id);
      this._pipKnown.set(sensor.entity_id, {
        state: sensor.state,
        startedVia: attrs.started_via || null,
        startedAt: attrs.started_at || null,
      });
      if (!this._selected) continue;
      if (!prev) {
        // A sensor that appears with started_via == "voice" while a
        // detail is open is a voice-started timer: show the PIP.
        // A "service" sensor is the chip-tap path's timer (already
        // shown optimistically, or bound by the tick) — ignore it.
        // A sensor that appears already finished (e.g. a timer that
        // finished while the card was on the list) shows the finished
        // PIP only if it was not dismissed.
        if (sensor.state === "finished") {
          if (!this._pipDismissed.has(sensor.entity_id)) this._pipShow(sensor, { finished: true });
        } else if (attrs.started_via === "voice") {
          this._pipShow(sensor, {});
        }
        continue;
      }
      if (prev.state !== sensor.state && sensor.state === "finished") {
        if (!this._pipDismissed.has(sensor.entity_id)) {
          // Finished (incl. the ringing → finished transition): the
          // return comes back as the full PIP, even from collapsed.
          this._pipShow(sensor, { finished: true });
        }
      }
    }
    // Prune sensors that no longer exist (a finished timer's sensor
    // is removed by the bridge once it is dismissed there).
    for (const id of Array.from(this._pipKnown.keys())) {
      if (!seen.has(id)) this._pipKnown.delete(id);
    }
  }

  // PIP tap → pin the timer + go to Timers (OQ-7: the step field is
  // published — the session already carries openId + step, and
  // Timers reads it back verbatim into &step= — so the return lands
  // on the same step. The gate closes only when the re-match
  // verifies this round-trip at phone portrait AND wall landscape).
  _pipTap() {
    if (!this._pip || !this._selected) return;
    // Bind the sensor now if it has appeared since the chip tap. The
    // pin carries the sensor's timer_id ATTRIBUTE (the ULID), which is
    // what the Timers card matches (timer.timer_id) for the pinned-first
    // render and the "Just started" marker — NOT the entity_id. A tap
    // in the first ~1 s, before the sensor exists, navigates unpinned
    // — the timer still appears in Timers as the most recent.
    let sensor = null;
    if (this._pip.entityId && this._hass) {
      sensor = timerSensorList(this._hass.states).find(
        (s) => s && s.entity_id === this._pip.entityId
      ) || null;
    }
    if (!sensor) {
      sensor = this._pipResolveSensor();
      if (sensor) this._pip.entityId = sensor.entity_id;
    }
    const timerId = sensor && sensor.attributes
      ? sensor.attributes.timer_id
      : null;
    if (typeof timerId === "string" && timerId && typeof sessionStorage !== "undefined") {
      try {
        sessionStorage.setItem(TIMERS_PIN_KEY, JSON.stringify({ timerId }));
      } catch (_err) {
        // A pin failure never blocks the navigation; Timers still
        // opens, just without the "Just started" marker.
      }
    }
    this._hidePip();
    this._navigate("/family-hub/timers");
  }

  // The × dismisses the notice WITHOUT cancelling the timer. A
  // finished timer's dismissal is remembered, so a later hass push
  // does not re-show it; a NEW finish still shows.
  _pipDismiss() {
    if (!this._pip) return;
    if (this._pip.finished && this._pip.entityId) this._pipDismissed.add(this._pip.entityId);
    this._hidePip();
  }

  // Swipe-collapse (R-IMPL-22): the PIP collapses to the restore
  // affordance; the timer keeps running. The auto-hide clock is
  // cleared while collapsed (the affordance stays until tapped or
  // until a finish returns the full PIP).
  _pipCollapse() {
    if (!this._pip) return;
    this._pip.collapsed = true;
    this._pip.hidden = false;
    this._pipClearHideTimers();
    this._render();
  }

  // Tap the affordance: restore the full PIP (with a fresh 5 s
  // auto-hide for a running timer; a finished PIP never auto-hides).
  _pipRestore() {
    if (!this._pip) return;
    this._pip.collapsed = false;
    this._pip.hidden = false;
    this._pipClearHideTimers();
    if (!this._pip.finished) {
      this._pipHideLeftMs = PIP_AUTO_HIDE_MS;
      this._pipHideEndsAt = Date.now() + PIP_AUTO_HIDE_MS;
      this._pipHideTimer = setTimeout(() => this._pipFadeOut(), PIP_AUTO_HIDE_MS);
    }
    this._render();
  }

  // Shadow-root touch delegation for the PIP: only touches that start
  // on the PIP or its affordance suspend the clock / collapse it.
  _onPipTouchStart(event) {
    const target = event && event.target;
    if (!target || typeof target.closest !== "function") return;
    if (!target.closest(".pip, .pip-affordance")) return;
    this._pipTouchStart(event);
  }

  _onPipTouchEnd(event) {
    if (!this._pipTouch) return;
    this._pipTouchEnd(event);
  }

  // Touch on the PIP suspends the 5 s auto-hide clock until the
  // touch ends (R-IMPL-19); a swipe of ≥40 px collapses the PIP.
  _pipTouchStart(event) {
    if (!this._pip || this._pip.finished) return;
    const touch = event && event.touches && event.touches[0];
    if (!touch) return;
    this._pipTouch = { x: touch.clientX, y: touch.clientY };
    if (this._pipHideTimer !== null) {
      if (typeof clearTimeout === "function") clearTimeout(this._pipHideTimer);
      this._pipHideTimer = null;
      this._pipHideLeftMs = Math.max(0, this._pipHideEndsAt - Date.now());
    }
  }

  _pipTouchEnd(event) {
    if (!this._pip) return;
    const touch = this._pipTouch;
    this._pipTouch = null;
    if (!touch) return;
    const end = event && event.changedTouches && event.changedTouches[0];
    if (!end) return;
    const dx = end.clientX - touch.x;
    const dy = end.clientY - touch.y;
    if (Math.abs(dx) >= PIP_SWIPE_PX || Math.abs(dy) >= PIP_SWIPE_PX) {
      this._pipCollapse();
      return;
    }
    // A plain tap (no swipe): resume the auto-hide clock with the
    // time left. The tap itself is handled by the click handler.
    if (!this._pip.finished && this._pipHideTimer === null && this._pipHideLeftMs > 0) {
      this._pipHideEndsAt = Date.now() + this._pipHideLeftMs;
      this._pipHideTimer = setTimeout(() => this._pipFadeOut(), this._pipHideLeftMs);
    }
  }

  // -- navigation (NAV-1) -------------------------------------------------
  //
  // history.pushState + a location-changed dispatch — no reload. The
  // same mechanism the standalone nav strip and the home card use.
  _navigate(path) {
    if (typeof window === "undefined") return;
    const target = String(path || "/family-hub");
    // Active-tab no-op (N-IMPL-6): tapping the Recipes strip button
    // while the list is showing does nothing — no pushState, no
    // location-changed, no re-render. Recipes-from-detail never
    // reaches here (the nav action branch closes the detail first,
    // N-IMPL-7).
    const targetPath = target.split("?")[0];
    if (targetPath === "/family-hub/recipes" || targetPath.endsWith("/recipes")) return;
    const url = withKioskQuery(target);
    try {
      if (window.history && typeof window.history.pushState === "function") {
        window.history.pushState(null, "", url);
      }
    } catch (_err) {
      // A pushState failure (a test stub, a file URL) never breaks
      // the tap; the location-changed dispatch below still runs.
    }
    if (typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("location-changed"));
    }
  }

  // -- photo fallback (RECIPE-10) ----------------------------------------
  //
  // A failed photo load falls back to the initial-letter tile, exactly
  // like a recipe with no photo. The tile carries the recipe's
  // initial from the image's data-initial attribute.
  _onPhotoError(event) {
    const img = event && event.target;
    if (!img || img.tagName !== "IMG") return;
    const parent = img.parentNode;
    if (!parent || typeof document === "undefined") return;
    const tile = document.createElement("div");
    const isHero = Boolean(
      img.classList && typeof img.classList.contains === "function"
        ? img.classList.contains("detail-photo")
        : false,
    );
    tile.className = isHero ? "detail-photo missing" : "thumb missing";
    tile.setAttribute("aria-hidden", "true");
    tile.textContent =
      (img.dataset && img.dataset.initial) || "•";
    if (typeof parent.insertBefore === "function") {
      parent.insertBefore(tile, img);
    } else {
      parent.appendChild(tile);
    }
    if (typeof img.remove === "function") img.remove();
  }

  // -- cooking mode -------------------------------------------------------
  //
  // The detail view is a cooking tool, not a recipe page. Ingredients
  // are checkable (tap to cross off, tap again to un-cross); steps are
  // a guided walkthrough (one current step, the rest dimmed, "Step N
  // of M"); times in a step are tappable timer chips; the note is
  // editable in the Notes tab (Save calls update_recipe with the note
  // only) and the rating is five tappable stars there too. Serving
  // scaling is transient: it changes only the quantities shown while
  // cooking and never saves. Cooking state lives on the card, keyed by
  // recipe id — leaving a recipe and coming back keeps your place.

  // The ingredient rows in display order, each with a stable index
  // (section headings excluded — they are labels, not ingredients).
  // Headed recipes use their ordered entries; older responses fall
  // back to the flat ingredient list.
  _ingredientRows(recipe) {
    const rows = [];
    if (recipe.entries.length) {
      for (const item of recipe.entries) {
        if (item.type === "ingredient") rows.push(item);
      }
    } else {
      rows.push(...recipe.ingredients);
    }
    return rows;
  }

  _checkedSet(recipeId) {
    let set = this._checked.get(recipeId);
    if (!set) {
      set = new Set();
      this._checked.set(recipeId, set);
    }
    return set;
  }

  // The numbered (non-header) steps in order, each with its display
  // number (1-based) and its position in the full steps list.
  // Headers are section labels: they render between steps but never
  // consume a number and can never be the current step.
  _navigableSteps(recipe) {
    const steps = [];
    let number = 0;
    recipe.steps.forEach((step, index) => {
      const rendered = renderStepText(step);
      if (rendered.header) return;
      number += 1;
      steps.push({ number, index, html: rendered.html });
    });
    return steps;
  }

  _currentStepIndex(recipeId, total) {
    if (total <= 0) return 0;
    const stored = this._currentStep.get(recipeId);
    if (typeof stored !== "number" || stored < 0) return 0;
    return Math.min(stored, total - 1);
  }

  // Start a voice timer for a time tapped in a step. The timer lives
  // on the kitchen satellite, so this calls the Satellite Timers
  // bridge's start_timer service (Phase 3 contract: service_data
  // {name, duration} with duration in SECONDS — the bridge names the
  // timer after the recipe, which is how the strip and the timer card
  // know what it is for). A chip-started timer carries
  // started_via: "service" on its sensor, so it never triggers the
  // timer-jump. On failure the message keeps the honest reason and
  // offers the voice alternative — the timer still gets started, just
  // by voice.
  async _startTimer(seconds, label) {
    const total = Number(seconds);
    if (!Number.isFinite(total) || total <= 0) return;
    this._timerStatus = "";
    this._timerError = "";
    this._render();
    try {
      await this._hass.callWS({
        type: "call_service",
        domain: "satellite_timers",
        service: "start_timer",
        service_data: {
          name: this._selected ? this._selected.name : "Recipe timer",
          duration: total,
        },
        return_response: false,
      });
      this._timerStatus = `Timer started: ${label}.`;
      // T7-NJ1: the chip tap starts the timer and does NOT navigate
      // away — the PIP confirms it in place (optimistic: the sensor
      // binds on the next hass push, ~1 s later).
      this._pipShow(
        {
          entityId: null,
          name: this._selected ? this._selected.name : "Recipe timer",
          remaining: total,
          state: "active",
        },
        {}
      );
    } catch (err) {
      const message = String((err && err.message) || err || "");
      const missing = /not found|unknown|no such|service/i.test(message);
      // R-IMPL-25: a bridge-missing error REPLACES the voice hint in
      // place (the same slot — the cook reads one line, not a hint
      // plus an error) and names the chip's own duration. The
      // hardcoded 9-minute sentence is only the last resort, when
      // the chip carries no duration phrase at all. The label is the
      // chip's duration phrase; when it is missing (a bare
      // programmatic call), derive it from the seconds so the error
      // never reads "Couldn't start the timer" with no duration.
      const durationLabel = asTrimmed(label) || formatDuration(total) || `${total} seconds`;
      const hint = voiceHintForStep(durationLabel) || VOICE_HINT;
      this._timerError = missing
        ? `Couldn't start the ${durationLabel} timer. ${hint} instead.`
        : `Couldn't start the ${durationLabel} timer — ${message || "something went wrong"}. ${hint} instead.`;
      this._timerStatus = "";
    }
    this._render();
  }

  // -- note, rating, serving scaling ------------------------------------
  //
  // The Notes tab edits the note and the rating; the Cook tab scales
  // servings. All three read from the loaded recipe and touch nothing
  // else.

  // The serving count the cook is targeting for this recipe: the
  // chosen value, or the stored servings when nothing was chosen.
  // Range-shaped ("4–6"): the cook targets a range, and the stepper
  // moves both ends. Returns null when the recipe has no usable
  // serving count.
  _targetServings(recipe) {
    const stored = parseServings(recipe.servings);
    if (!stored) return null;
    const chosen = this._scaleServings.get(recipe.id);
    if (chosen && Number.isFinite(chosen.low) && chosen.low > 0) return chosen;
    return stored;
  }

  // The factor to multiply displayed quantities by: chosen servings
  // over stored servings, or null when the recipe has no numeric
  // servings, when the stored count is zero, or when the factor is
  // not a finite positive number. An invalid factor returns the input
  // unchanged at the quantity level — the scaler never produces a
  // nonsense amount.
  _scaleFactor(recipe) {
    const stored = parseServings(recipe.servings);
    if (!stored || stored.low <= 0) return null;
    const factor = this._targetServings(recipe).low / stored.low;
    if (!Number.isFinite(factor) || factor <= 0) return null;
    return factor;
  }

  // A copy of an ingredient row with its quantity scaled for display.
  // Section headings pass through untouched; a row with no quantity
  // is returned as-is. The original row is never mutated. The result
  // carries two flags the renderer needs: unparseable (the quantity
  // could not be read, so the row is flagged "check this one") and
  // countNote (the usable instruction for a scaled count, e.g.
  // "½ egg — beat 1 egg and use half").
  _scaledItem(item, factor) {
    if (!factor || factor === 1 || !item || item.type === "section") return item;
    if (!item.quantity) return item;
    const scaled = scaleQuantityDetail(item.quantity, factor);
    // A scaled count that lands fractional gets its usable
    // instruction ("½ egg — beat 1 egg and use half"). countNoteFor
    // decides from the item and the scaled text; it returns "" for
    // measured quantities and whole counts.
    return {
      ...item,
      quantity: scaled.text,
      unparseable: scaled.unparseable,
      countNote: countNoteFor(item, scaled.text) || null,
    };
  }

  // Save the note draft: update_recipe with recipe_id + note only.
  // The action returns the updated recipe, so the card's copy is
  // refreshed from the server rather than assumed. On failure the
  // draft stays, the typed note is not lost, and the status says so.
  async _saveNote() {
    const recipe = this._selected;
    if (!recipe || this._savingNote) return;
    const draft = this._noteDrafts.has(recipe.id)
      ? this._noteDrafts.get(recipe.id)
      : recipe.note;
    const note = asTrimmed(draft);
    if (note === asTrimmed(recipe.note)) return;
    this._savingNote = true;
    this._noteStatus = null;
    this._render();
    try {
      const result = await this._callAction("update_recipe", {
        recipe_id: recipe.id,
        note,
      });
      // R-IMPL-39 (honest save): "Note saved." only when the
      // response carries a usable recipe. A non-throwing response
      // with no usable recipe (the rig stub's update_recipe returns
      // {}) is NOT a confirmed save — the draft is kept and the
      // status says so, with a tappable retry.
      const applied = this._applyUpdatedRecipe(result);
      if (applied) {
        this._noteDrafts.delete(recipe.id);
        this._noteStatus = { text: "Note saved.", error: false };
      } else {
        this._noteStatus = {
          text: "Couldn't save — tap to retry",
          error: true,
          retry: "retry-note",
        };
      }
    } catch (err) {
      this._noteStatus = {
        text: "Couldn't save the note — your text is still here, try again.",
        error: true,
        retry: "retry-note",
      };
    } finally {
      this._savingNote = false;
      this._render();
    }
  }

  // Save a rating at once (a tap, no separate Save button):
  // update_recipe with recipe_id + rating only. Rating 0 clears the
  // rating. On failure the old rating stays displayed and the status
  // says so.
  async _rate(value) {
    const recipe = this._selected;
    if (!recipe || this._ratingBusy) return;
    const rating = Number(value);
    if (!Number.isFinite(rating) || rating < 0 || rating > 5) return;
    const current = recipe.rating || 0;
    if (rating === current) return;
    this._ratingBusy = true;
    this._ratingStatus = null;
    this._render();
    try {
      const result = await this._callAction("update_recipe", {
        recipe_id: recipe.id,
        rating,
      });
      // R-IMPL-39 (honest save): "Rating saved." only when the
      // response carries a usable recipe; a response with no usable
      // recipe keeps the old rating and offers a tappable retry.
      const applied = this._applyUpdatedRecipe(result);
      if (applied) {
        this._pendingRating = null;
        this._ratingStatus = { text: "Rating saved.", error: false };
      } else {
        this._pendingRating = rating;
        this._ratingStatus = {
          text: "Couldn't save — tap to retry",
          error: true,
          retry: "retry-rating",
        };
      }
    } catch (err) {
      this._pendingRating = rating;
      this._ratingStatus = {
        text: "Couldn't save the rating — try again.",
        error: true,
        retry: "retry-rating",
      };
    } finally {
      this._ratingBusy = false;
      this._render();
    }
  }

  // Refresh the card's copy of the open recipe from an update_recipe
  // response. Only the note and rating are taken from the server —
  // the save changed nothing else, and the response's ingredient list
  // may not carry the heading-aware entries, so the local
  // ingredients, entries and steps stay exactly as they were. Returns
  // true when a usable server recipe was applied, false otherwise.
  // R-IMPL-39 (honest save): when the response carries no usable
  // recipe — the rig stub's update_recipe returns {} — the save is
  // NOT certified. The local copy is NOT updated from the just-saved
  // value, the draft is kept, and the status says so with a retry.
  // (The old code fell back to the just-saved value on any
  // non-throwing response, which certified a save on the rig stub.)
  _applyUpdatedRecipe(result) {
    const recipe = this._selected;
    if (!recipe) return false;
    const updated = result && result.recipe ? normalizeRecipe(result.recipe) : null;
    if (!updated || updated.id !== recipe.id) return false;
    const next = { ...recipe, note: updated.note, rating: updated.rating };
    const index = this._recipes.findIndex((item) => item.id === recipe.id);
    if (index >= 0) this._recipes[index] = next;
    this._selected = next;
    return true;
  }

  // Saving a note or a rating calls the fork's update_recipe with
  // only the changed field (recipe_id + note, or recipe_id +
  // rating). The fork (k-mehta/ha-anylist 0.11.1) made
  // name/ingredients/steps optional, so a note-only or rating-only
  // edit never resubmits the whole recipe, and the client replaces
  // only the supplied fields — a note-only save cannot drop
  // ingredient headings or anything else it does not model. An
  // empty note clears the note; rating 0 clears the rating. The
  // action returns the updated recipe when return_response is set,
  // so a successful save refreshes the card's copy from the server
  // instead of assuming the local edit stuck. A failed save keeps
  // the typed note (the draft stays) and says so honestly — the
  // cook never loses what they typed to a silent failure.
  _friendlyError(err) {
    const message = String((err && err.message) || err || "");
    if (/not found/i.test(message) && /service/i.test(message)) {
      return "The AnyList integration is not available on this Home Assistant.";
    }
    // Load failure (N-IMPL-27): the design's verbatim text, for every
    // connection-flavoured failure — the old timeout/generic strings
    // differed from it. The error branch renders this beside the
    // "Try again" button; the search box + sort dropdown stay visible
    // (they live in the toolbar, outside the replaced body).
    return "Couldn't load recipes — check the connection and try again.";
  }

  // -- events ---------------------------------------------------------------

  _onInput(event) {
    // Session restore (DESIGN-7): any typing before the restore runs
    // means the user's state wins.
    this._interacted = true;
    const target = event.target;
    if (!target || !target.dataset) return;
    if (target.dataset.role === "note") {
      // Typing a note updates the draft only — no re-render, or the
      // textarea would be rebuilt (and lose focus) on every
      // keystroke. The Save button's disabled state is updated
      // directly instead.
      if (!this._selected) return;
      const draft = target.value || "";
      this._noteDrafts.set(this._selected.id, draft);
      const save = this.shadowRoot.querySelector('[data-action="save-note"]');
      if (save) {
        save.disabled =
          asTrimmed(draft) === asTrimmed(this._selected.note) ||
          this._savingNote;
      }
      return;
    }
    if (target.dataset.role !== "search") return;
    this._query = target.value || "";
    if (this._searchTimer !== null) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null;
      this._search(this._query);
    }, SEARCH_DEBOUNCE_MS);
  }

  // The sort <select> fires change (not input): apply the chosen
  // sort key and re-render the list (RECIPE-19).
  _onChange(event) {
    const target = event.target;
    if (!target || !target.dataset) return;
    if (target.dataset.role !== "sort") return;
    this._sort = target.value || "name";
    this._render();
    this._saveSession();
  }

  _onClick(event) {
    // Session restore (DESIGN-7): any tap before the restore runs
    // means the user's state wins.
    this._interacted = true;
    const target = event.target && event.target.closest
      ? event.target.closest("[data-action]")
      : null;
    if (!target) return;
    const action = target.dataset.action;
    if (action === "retry") {
      // The only failure left is the one view-open download; a detail
      // cannot fail (it reads from memory), so retry always reloads.
      this._error = "";
      this._loadAll();
      return;
    }
    if (action === "clear-search") {
      this._query = "";
      this._searchResults = null;
      this._collectionId = "";
      const input = this.shadowRoot.querySelector('[data-role="search"]');
      if (input) input.value = "";
      this._render();
      // The result set changed wholesale (filtered → all 382/2500),
      // so the list re-opens at the top.
      if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
        try {
          window.scrollTo(0, 0);
        } catch (_err) {
          // A scroll failure never breaks the clear.
        }
      }
      this._saveSession();
      return;
    }
    if (action === "back") {
      // N-IMPL-9: ← All recipes restores the SAVED listScrollY — never
      // list top. The old code saved the session after closing, which
      // overwrote the saved list scroll with the detail scroll.
      // R-IMPL-11: push ONE list entry ({fhNav:"list", openId:null}) —
      // pushState, NOT replaceState. The spec's Change text says
      // replaceState, but its own Validate line requires "one
      // system-back press returns to the detail once", which only a
      // push delivers: replaceState would erase the detail entry, so
      // system-back would land on the pre-detail view instead of the
      // detail. The merged Navigation decision F (rig-verified dn2-5
      // 32/32) stands; see the implementation report, resolution #3.
      const saved = this._readSavedSession();
      const listScrollY = saved ? saved.listScrollY : 0;
      this._selected = null;
      this._hidePip();
      this._render();
      if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
        try {
          window.scrollTo(0, listScrollY);
        } catch (_err) {
          // A scroll failure never breaks the return.
        }
      }
      this._saveSession();
      if (typeof window !== "undefined" && window.history && typeof window.history.pushState === "function") {
        try {
          window.history.pushState(
            { fhNav: "list", openId: null },
            "",
            withKioskQuery("/family-hub/recipes")
          );
        } catch (_err) {
          // A pushState failure never breaks the return.
        }
      }
      return;
    }
    if (action === "tab") {
      this._detailTab = target.dataset.tab || "cook";
      this._render();
      // R-IMPL-37: opening the Notes tab puts the caret in the
      // editor, at the end of the existing note — the cook starts
      // typing, not tapping. (No character counter: there is no limit
      // on the note, so no counter is required.)
      if (this._detailTab === "notes") {
        const note = this._detailEl ? this._detailEl.querySelector('[data-role="note"]') : null;
        if (note && typeof note.focus === "function") {
          note.focus();
          if (typeof note.setSelectionRange === "function") {
            try {
              const len = typeof note.value === "string" ? note.value.length : 0;
              note.setSelectionRange(len, len);
            } catch (_err) {
              // Caret placement is best-effort.
            }
          }
        }
      }
      return;
    }
    if (action === "collection") {
      // Tapping the active collection clears the filter (RECIPE-12):
      // the chip is a toggle, not a one-way switch.
      const id = target.dataset.collectionId || "";
      this._collectionId = this._collectionId === id ? "" : id;
      this._render();
      // R-IMPL-45: tapping All (or toggling the active filter off)
      // returns the list to the top — the count changes, and the user
      // should not land mid-list at a stale scroll position. Tapping
      // a NEW filter keeps the scroll (the list re-sorts in place).
      if (!this._collectionId && typeof window !== "undefined" && typeof window.scrollTo === "function") {
        try {
          window.scrollTo(0, 0);
        } catch (_err) {
          // A scroll failure never breaks the filter.
        }
      }
      this._saveSession();
      return;
    }
    if (action === "nav") {
      const path = target.dataset.path || "/family-hub";
      // N-IMPL-7: strip Recipes tap while a detail is open is list
      // intent — close the detail, show the LIST at scrollY 0, clear
      // the saved open detail, one history entry. Every other strip
      // tap navigates normally and must NOT clear the saved detail
      // (N-IMPL-9b), so a later strip-Recipes tap from Home/Timers
      // still session-restores (N-IMPL-8).
      if (this._selected && (path === "/family-hub/recipes" || path.endsWith("/recipes"))) {
        this._closeDetailToListTop();
        return;
      }
      this._navigate(path);
      return;
    }
    if (action === "goto-timers") {
      this._navigate("/family-hub/timers");
      return;
    }
    if (action === "pip-tap") {
      // Tap the PIP: pin the timer + go to Timers (OQ-7 gate leg).
      this._pipTap();
      return;
    }
    if (action === "pip-dismiss") {
      // The × dismisses the notice WITHOUT cancelling the timer.
      this._pipDismiss();
      return;
    }
    if (action === "pip-restore") {
      // Tap the collapsed affordance: restore the full PIP.
      this._pipRestore();
      return;
    }
    if (action === "open") {
      this._openRecipe(target.dataset.recipeId, { pushHistory: true });
      return;
    }
    // -- cooking mode ---------------------------------------------------
    if (action === "toggle-ingredient") {
      if (!this._selected) return;
      const index = Number(target.dataset.index);
      if (!Number.isFinite(index)) return;
      const set = this._checkedSet(this._selected.id);
      if (set.has(index)) set.delete(index);
      else set.add(index);
      this._saveCookState(this._selected.id);
      this._render();
      return;
    }
    if (action === "clear-checks") {
      if (!this._selected) return;
      // "Start over" (R-IMPL-34; OQ-5 stays open — the user has not
      // ruled on what "Start over" means yet, so this build takes the
      // plain reading): clears the checks AND resets the step to 1 —
      // a fresh cook-through, not un-checked ingredients with the
      // tracker still sitting at step 12.
      this._checked.delete(this._selected.id);
      this._currentStep.set(this._selected.id, 0);
      this._finishShown = false;
      this._saveCookState(this._selected.id);
      this._saveSession();
      this._render();
      this._scrollCurrentStepIntoView();
      return;
    }
    if (action === "step") {
      if (!this._selected) return;
      const index = Number(target.dataset.stepIndex);
      if (!Number.isFinite(index)) return;
      this._currentStep.set(this._selected.id, index);
      this._finishShown = false;
      this._saveCookState(this._selected.id);
      this._saveSession();
      this._render();
      // R-IMPL-6: tapping a step moves the current step AND scrolls
      // it into view (its top just below the sticky tracker, full
      // text visible). Scroll margin lives on .step.
      this._scrollCurrentStepIntoView();
      return;
    }
    if (action === "step-prev" || action === "step-next") {
      if (!this._selected) return;
      const steps = this._navigableSteps(this._selected);
      if (steps.length === 0) return;
      const current = this._currentStepIndex(this._selected.id, steps.length);
      const next =
        action === "step-prev"
          ? Math.max(0, current - 1)
          : Math.min(steps.length - 1, current + 1);
      this._currentStep.set(this._selected.id, next);
      this._finishShown = false;
      this._saveCookState(this._selected.id);
      this._saveSession();
      this._render();
      // R-IMPL-6: every step change scrolls the new current step
      // into view below the tracker.
      this._scrollCurrentStepIntoView();
      return;
    }
    if (action === "finish") {
      // R-IMPL-8: "Finish" at the last step shows the completion
      // card below the steps. The tracker stays at "Step N of N".
      if (!this._selected) return;
      this._finishShown = true;
      this._render();
      const el = this._detailEl ? this._detailEl.querySelector('[data-role="completion"]') : null;
      if (el && typeof el.scrollIntoView === "function") {
        try {
          el.scrollIntoView({ block: "start", behavior: "auto" });
        } catch (_err) {
          // A scroll failure never breaks the finish.
        }
      }
      return;
    }
    if (action === "cook-again") {
      // The completion card's "Cook again" IS the Start over action
      // (R-IMPL-8): fresh cook-through — checks cleared, step back
      // to 1, completion card hidden.
      if (!this._selected) return;
      this._checked.delete(this._selected.id);
      this._currentStep.set(this._selected.id, 0);
      this._finishShown = false;
      this._saveCookState(this._selected.id);
      this._saveSession();
      this._render();
      this._scrollCurrentStepIntoView();
      return;
    }
    if (action === "finish-dismiss") {
      // "← Back to recipe" hides the completion card and stays at
      // the last step.
      this._finishShown = false;
      this._render();
      return;
    }
    if (action === "start-timer") {
      const seconds = Number(target.dataset.seconds);
      if (Number.isFinite(seconds) && seconds > 0) {
        this._startTimer(seconds, target.textContent || "");
      }
      return;
    }
    // -- note, rating, serving scaling --------------------------------
    if (action === "save-note") {
      this._saveNote();
      return;
    }
    if (action === "retry-note") {
      // The tappable retry (R-IMPL-39): re-attempt the save with the
      // kept draft.
      this._saveNote();
      return;
    }
    if (action === "retry-rating") {
      // The tappable retry (R-IMPL-39): re-attempt exactly the
      // rating the failed save was trying to set.
      if (this._pendingRating !== null) this._rate(this._pendingRating);
      return;
    }
    if (action === "rate") {
      const rating = Number(target.dataset.rating);
      if (Number.isFinite(rating)) this._rate(rating);
      return;
    }
    if (action === "clear-rating") {
      this._rate(0);
      return;
    }
    if (action === "scale-down" || action === "scale-up") {
      // Transient only: the scaler changes the quantities shown, and
      // makes no server call at all. A range target ("4–6") moves
      // both ends together; the low end never drops below 1.
      if (!this._selected) return;
      const base = parseServings(this._selected.servings);
      if (!base) return;
      const current = this._targetServings(this._selected);
      const delta = action === "scale-down" ? -1 : 1;
      const next = {
        low: Math.max(1, current.low + delta),
        high: Math.max(1, current.high + delta),
      };
      this._scaleServings.set(this._selected.id, next);
      this._render();
      return;
    }
    if (action === "scale-reset") {
      if (!this._selected) return;
      this._scaleServings.delete(this._selected.id);
      this._render();
      return;
    }
    if (action === "scale-original") {
      // Show the stored amounts instead of the scaled ones (or back
      // again). The scaler bar still shows the chosen servings and
      // factor, so the cook always knows which view they are in.
      if (!this._selected) return;
      if (this._showOriginal.has(this._selected.id)) {
        this._showOriginal.delete(this._selected.id);
      } else {
        this._showOriginal.add(this._selected.id);
      }
      this._render();
      return;
    }
  }

  _visibleRecipes() {
    // A search in progress shows its ranked results; the collection
    // chips filter whichever list is showing. Both are full recipes
    // from the one loaded list — no join needed. The sort applies
    // after filtering (RECIPE-19).
    const list = this._searchResults !== null ? this._searchResults : this._recipes;
    return sortRecipes(filterByCollection(list, this._collectionId), this._sort);
  }

  // -- rendering ------------------------------------------------------------
  //
  // The shell is built once and kept: title, search field, chips, status
  // line and the list/detail containers. Only their contents change.
  // Rebuilding the whole screen on every keystroke would destroy the
  // search field mid-typing and drop keyboard focus; stable nodes keep
  // typing, focus and scroll position intact.

  _ensureShell() {
    if (this._shell) return;
    const style = document.createElement("style");
    style.textContent = CARD_CSS;
    this.shadowRoot.appendChild(style);
    this._shell = document.createElement("div");
    this._shell.className = "screen";
    // The nav strip is the FIRST child of the screen (DOM-first for
    // tab order) and visually last (flex order 2 + sticky bottom).
    // It is rendered on every path — list and detail alike (NAV-1).
    this._shell.innerHTML = `
      <nav class="nav-strip" aria-label="Views">
        <div class="nav-strip-buttons">
          ${NAV_STRIP_VIEWS.map((view) => {
            const active = view.key === "recipes";
            const badge =
              view.key === "timers"
                ? '<span class="timer-badge" hidden></span>'
                : "";
            return `<button type="button" class="nav-strip-button${active ? " active" : ""}" data-action="nav" data-path="${view.path}"${active ? ' aria-current="page"' : ""}>${view.label}${badge}</button>`;
          }).join("")}
        </div>
      </nav>
      <div class="list-view">
        <h1 class="title"></h1>
        <div class="toolbar">
          <input class="search" data-role="search" type="search" placeholder="Search recipes…" aria-label="Search recipes" />
          <select class="sort" data-role="sort" aria-label="Sort recipes">
            <option value="name">Name</option>
            <option value="rating">Rating</option>
            <option value="cook">Cook time</option>
            <option value="prep">Prep time</option>
          </select>
        </div>
        <div class="chips"></div>
        <div class="status"></div>
        <div class="body"></div>
      </div>
      <div class="detail-view" hidden></div>
      <div class="pip-host"></div>`;
    this.shadowRoot.appendChild(this._shell);
    this._detailEl = this._shell.querySelector(".detail-view");
  }

  _render() {
    if (!this.shadowRoot) return;
    this._ensureShell();
    this._applyDevice();
    this._updateStripBadge();
    this._syncSortLabels();
    // The PIP (D3): rendered into its host on every pass, so it
    // survives list/detail re-renders. Hidden when no detail is open.
    this._renderPip();
    // If the cook is typing a note, a re-render (a Home Assistant
    // state update rebuilds the detail view) would destroy the
    // textarea mid-typing — and with it the focus and the caret. The
    // draft keeps the text; restore the focus and the caret so typing
    // continues uninterrupted. Guarded for environments without a
    // focused element or a focus method (the DOM tests).
    const active = this.shadowRoot.activeElement;
    const wasNote = !!(
      active &&
      active.dataset &&
      active.dataset.role === "note"
    );
    const caret =
      wasNote && typeof active.selectionStart === "number"
        ? active.selectionStart
        : null;
    const listView = this._shell.querySelector(".list-view");
    const title = this._shell.querySelector(".title");
    if (title) title.textContent = this._title;
    if (this._selected) {
      listView.hidden = true;
      this._detailEl.hidden = false;
      this._detailEl.innerHTML = this._detailHtml();
      if (wasNote) {
        const note = this._detailEl.querySelector('[data-role="note"]');
        if (note && typeof note.focus === "function") {
          note.focus();
          if (
            caret !== null &&
            typeof note.setSelectionRange === "function"
          ) {
            try {
              note.setSelectionRange(caret, caret);
            } catch (_err) {
              // Caret restore is best-effort; the text is safe either way.
            }
          }
        }
      }
      // Wake Lock follows the Cook tab (RECIPE-8); the strip tick runs
      // only while the cooking view is open with running timers
      // (RECIPE-22).
      this._syncWakeLock();
      if (this._detailTab === "cook" && this._runningTimers().length > 0) {
        this._ensureStripTick();
      } else {
        this._clearStripTick();
      }
      // A re-render drops the summary's .visible class; restore it.
      this._syncStripSummary();
      return;
    }
    this._detailEl.hidden = true;
    listView.hidden = false;
    this._renderChips();
    this._renderStatus();
    this._renderBody();
    // The sort select is part of the stable shell: keep its value in
    // sync with the state (the shell is built once, so the selected
    // option would otherwise stick at the initial "Name").
    const sortEl = this._shell.querySelector('[data-role="sort"]');
    if (sortEl && sortEl.value !== this._sort) sortEl.value = this._sort;
    // Wake Lock follows the Cook tab (RECIPE-8); the strip tick runs
    // only while the cooking view is open with running timers
    // (RECIPE-22).
    this._syncWakeLock();
    if (this._selected && this._detailTab === "cook" && this._runningTimers().length > 0) {
      this._ensureStripTick();
    } else {
      this._clearStripTick();
    }
  }

  _renderChips() {
    const chipsEl = this._shell.querySelector(".chips");
    if (!chipsEl) return;
    if (this._collections.length === 0) {
      chipsEl.innerHTML = "";
      return;
    }
    const chips = this._collections
      .map(
        (item) =>
          `<button class="chip" data-action="collection" data-collection-id="${escapeHtml(item.id)}" aria-pressed="${this._collectionId === item.id ? "true" : "false"}">${escapeHtml(item.name)}</button>`
      )
      .join("");
    chipsEl.innerHTML =
      `<button class="chip" data-action="collection" data-collection-id="" aria-pressed="${this._collectionId === "" ? "true" : "false"}">All recipes</button>` +
      chips;
    this._updateChipsFade();
  }

  // The chips row wraps at every viewport (D-RECIPE-2), so it never
  // overflows and the scroll fade never applies. This method is kept
  // as the single place the fade decision lives: if wrapping is ever
  // revisited, the fade logic is still here and still guarded for
  // environments without layout (the DOM tests), where the widths are
  // not numbers and the row is never marked scrollable.
  _updateChipsFade() {
    const chipsEl = this._shell.querySelector(".chips");
    if (!chipsEl) return;
    const scrollable =
      typeof chipsEl.scrollWidth === "number" &&
      typeof chipsEl.clientWidth === "number" &&
      // 4px tolerance for sub-pixel rounding, so a row that fits is
      // never marked scrollable over a fraction of a pixel.
      chipsEl.scrollWidth > chipsEl.clientWidth + 4;
    chipsEl.classList.toggle("scrollable", scrollable);
  }

  _renderStatus() {
    const statusEl = this._shell.querySelector(".status");
    if (!statusEl) return;
    const visible = this._visibleRecipes();
    if (this._loaded && !this._loading && !this._error && visible.length > 0) {
      statusEl.textContent =
        `${visible.length} recipe${visible.length === 1 ? "" : "s"}` +
        (this._query ? ` matching “${this._query}”` : "");
    } else {
      // No count while loading, errored, or empty — and no
      // "Searching…" state at all: local search answers instantly.
      statusEl.textContent = "";
    }
  }

  _renderBody() {
    const bodyEl = this._shell.querySelector(".body");
    if (!bodyEl) return;
    const visible = this._visibleRecipes();
    if (this._error) {
      bodyEl.innerHTML = `<div class="error">${escapeHtml(this._error)}</div><button class="button primary" data-action="retry">Try again</button>`;
    } else if (!this._loaded) {
      // Skeleton rows in the same grid as the list, so the page takes
      // its final shape before the data arrives. Six rows fill the
      // first screen (see the skeleton CSS).
      const skeleton = `<div class="skeleton-row"><div class="skeleton-thumb"></div><div class="skeleton-lines"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></div>`;
      bodyEl.innerHTML = `<div class="list">${skeleton.repeat(6)}</div>`;
    } else if (visible.length === 0) {
      bodyEl.innerHTML = this._emptyHtml();
    } else {
      bodyEl.innerHTML = `<div class="list">${visible
        .map((recipe) => this._rowHtml(recipe))
        .join("")}</div>`;
    }
  }

  // The empty state, by cause: a search with no match, a collection
  // with no recipes, or a library with no recipes at all. Title, one
  // line of guidance, and the way back to the full list.
  _emptyHtml() {
    let title;
    let sub;
    if (this._query) {
      // R-IMPL-42: the zero-result line is one exact sentence —
      // "No recipes match 'X' — try an ingredient or a dish name".
      title = `No recipes match '${escapeHtml(this._query)}' — try an ingredient or a dish name`;
      sub = "";
    } else if (this._collectionId) {
      const collection = this._collections.find(
        (item) => item.id === this._collectionId
      );
      const name = collection ? collection.name : "this collection";
      title = `No recipes in “${escapeHtml(name)}”.`;
      sub = "Pick another collection, or browse all recipes.";
    } else {
      title = "No recipes yet.";
      sub = "Recipes added in AnyList will show up here.";
    }
    const showAll =
      this._query || this._collectionId
        ? `<button class="button primary" data-action="clear-search">Show all recipes</button>`
        : "";
    return `<div class="empty"><div class="empty-title">${title}</div>${sub ? `<div class="empty-sub">${sub}</div>` : ""}${showAll}</div>`;
  }

  _rowHtml(recipe) {
    const meta = formatMetaHtml(recipe);
    const collections = recipe.collections
      .map((item) => `<span class="mini-pill">${escapeHtml(item.name)}</span>`)
      .join("");
    const photo = recipe.photoUrls[0];
    const initial = escapeHtml(recipe.name.charAt(0).toUpperCase() || "•");
    const thumb = photo
      // No inline onerror: a failed load falls back to the
      // initial-letter tile via the capture-phase error listener on
      // the shadow root (RECIPE-10). data-initial carries the letter
      // for the fallback tile.
      ? `<img class="thumb" src="${escapeHtml(photo)}" alt="" loading="lazy" data-initial="${initial}" />`
      // No photo: the recipe's initial in a coloured tile. A letter
      // renders in any font; an emoji placeholder does not (headless
      // Chrome here has no colour-emoji font, and the kiosk's fonts
      // are not guaranteed either).
      : `<div class="thumb missing" aria-hidden="true">${initial}</div>`;
    return `<button class="row" data-action="open" data-recipe-id="${escapeHtml(recipe.id)}" aria-label="Open ${escapeHtml(recipe.name)}">
      ${thumb}
      <span class="row-text">
        <span class="row-name">${escapeHtml(recipe.name)}</span>
        ${meta ? `<span class="row-meta">${meta}</span>` : ""}
        ${collections ? `<span class="row-collections">${collections}</span>` : ""}
      </span>
    </button>`;
  }

  _detailHtml() {
    const recipe = this._selected;
    // Cooking mode: the detail view is a cooking tool, not a recipe
    // page. The photo hero and the metadata live on the Details tab
    // (RECIPE-7), where the cook can check times, servings and source
    // without them competing with the cooking view. The name is a
    // compact label, not a display title. Three tabs: Cook
    // (ingredients + steps together), Notes (editable) and Details
    // (photo, times, servings as stored, rating, collections, source).
    const tabs = [
      ["cook", "Cook"],
      ["notes", "Notes"],
      ["details", "Details"],
    ];
    const tabBar = `<div class="tabbar" role="tablist">${tabs
      .map(
        ([id, label]) =>
          `<button class="tab" role="tab" data-action="tab" data-tab="${id}" aria-selected="${this._detailTab === id ? "true" : "false"}">${label}</button>`
      )
      .join("")}</div>`;
    return `
      <div class="detail">
        <div class="detail-header">
          <div class="toolbar">
            <button class="button ghost" data-action="back">← All recipes</button>
          </div>
          ${tabBar}
        </div>
        ${this._error ? `<div class="error">${escapeHtml(this._error)}</div><button class="button primary" data-action="retry">Try again</button>` : ""}
        <h1 class="detail-name">${escapeHtml(recipe.name)}</h1>
        <div class="tab-panel">${this._detailTabHtml(recipe)}</div>
      </div>`;
  }

  // The active tab's panel. Cook is the default tab: ingredients and
  // steps together (two columns on the hub, ingredients above steps on
  // a phone), because a cook needs both at once. Notes is the editable
  // note. Details is the photo hero, the metadata line and every
  // stored field (RECIPE-7).
  _detailTabHtml(recipe) {
    if (this._detailTab === "notes") {
      return this._notesHtml(recipe);
    }
    if (this._detailTab === "details") {
      return this._detailsHtml(recipe);
    }
    return this._cookHtml(recipe);
  }

  // The total time line for the cooking view header (RECIPE-7): prep
  // + cook, with the breakdown beside it. Only rendered when at least
  // one time exists.
  _cookTotalHtml(recipe) {
    const prep = typeof recipe.prepTime === "number" ? recipe.prepTime : null;
    const cook = typeof recipe.cookTime === "number" ? recipe.cookTime : null;
    if (prep === null && cook === null) return "";
    if (prep !== null && cook !== null) {
      return `<div class="cook-total">Total ${formatDuration(prep + cook)} <span class="cook-total-sub">· Prep ${formatDuration(prep)} · Cook ${formatDuration(cook)}</span></div>`;
    }
    const label = prep !== null ? "Prep" : "Cook";
    return `<div class="cook-total">${label} ${formatDuration(prep !== null ? prep : cook)}</div>`;
  }

  // The running-timer strip (RECIPE-22): at most 3 pills (R-IMPL-26),
  // most-recently-started first, then one "+N more running" pill when
  // more timers run. Tapping any pill goes to the Timers view. The
  // remaining span carries data-remaining-for so the 1s tick can
  // rewrite it in place without a full re-render. The cap is a
  // layout rule, not a data rule: the "+N more" pill says exactly
  // how many timers the strip is hiding.
  _timerStripHtml() {
    const timers = this._runningTimers();
    if (timers.length === 0) return "";
    const shown = this._shownStripTimers();
    const extra = timers.length - shown.length;
    return `<div class="timer-strip" aria-label="Running timers">${shown
      .map((timer) => {
        const remaining = timerRemainingSeconds(timer);
        return `<button class="timer-strip-item${timer.state === "paused" ? " paused" : ""}" data-action="goto-timers" aria-label="Go to ${escapeHtml(timerName(timer))} timer">
          <span class="timer-strip-name">${escapeHtml(timerName(timer))}</span>
          <span class="timer-strip-remaining" data-remaining-for="${escapeHtml(timer.entity_id)}">${remaining === null ? "" : escapeHtml(formatRemaining(remaining))}</span>
        </button>`;
      })
      .join("")}${extra > 0 ? `<button class="timer-strip-item timer-strip-more" data-action="goto-timers" aria-label="Go to Timers, ${extra} more running timer${extra === 1 ? "" : "s"}">+${extra} more running</button>` : ""}</div>`;
  }

  // The sticky strip summary (D4 rule 6, R-IMPL-28): a one-line
  // summary shown only once the strip has scrolled past ("⏱ 2
  // running · nearest 12:34"). Hidden by default; the scroll handler
  // toggles .visible, and _syncStripSummary refreshes the "nearest"
  // time in place. Tapping it goes to Timers (ambiguity #5: "expands
  // in place OR goes to Timers" — this build picks Timers, matching
  // RECIPE-22 strip-tap behaviour).
  _timerStripSummaryHtml() {
    const timers = this._runningTimers();
    if (timers.length === 0) return "";
    const nearest = timerRemainingSeconds(timers[0]);
    return `<button type="button" class="timer-strip-summary" data-action="goto-timers" data-role="strip-summary" aria-label="Go to Timers, ${timers.length} running timer${timers.length === 1 ? "" : "s"}">⏱ ${timers.length} running · nearest <span data-role="strip-summary-time">${nearest === null ? "" : escapeHtml(formatRemaining(nearest))}</span></button>`;
  }

  // Show the sticky strip summary only once the strip has scrolled
  // past the tracker (R-IMPL-28); hide it again when the strip is
  // back in view. Also refreshes the "nearest" time in place. Called
  // from the window scroll handler, from _render (a re-render drops
  // the .visible class), and from the strip tick.
  _syncStripSummary() {
    if (!this._detailEl || !this._selected || this._detailTab !== "cook") return;
    const summary = this._detailEl.querySelector('[data-role="strip-summary"]');
    const strip = this._detailEl.querySelector(".timer-strip");
    const tracker = this._detailEl.querySelector(".step-tracker");
    if (!summary || !strip || !tracker) return;
    let show = false;
    if (
      typeof strip.getBoundingClientRect === "function" &&
      typeof tracker.getBoundingClientRect === "function"
    ) {
      const stripRect = strip.getBoundingClientRect();
      const trackerRect = tracker.getBoundingClientRect();
      show = stripRect.bottom < trackerRect.bottom;
    }
    if (summary.classList && typeof summary.classList.toggle === "function") {
      summary.classList.toggle("visible", show);
    }
    const timeEl = summary.querySelector('[data-role="strip-summary-time"]');
    if (timeEl) {
      const timers = this._runningTimers();
      const nearest = timers.length > 0 ? timerRemainingSeconds(timers[0]) : null;
      timeEl.textContent = nearest === null ? "" : formatRemaining(nearest);
    }
  }

  // The cooking view: ingredients (checkable) and steps (guided
  // walkthrough) together. On the hub they sit side by side; on a
  // phone they stack, ingredients first, with the step tracker sticky
  // so your place in the steps stays visible while you scroll.
  _cookHtml(recipe) {
    const rows = this._ingredientRows(recipe);
    const checked = this._checkedSet(recipe.id);
    const checkedCount = rows.reduce(
      (count, _item, index) => count + (checked.has(index) ? 1 : 0),
      0
    );
    // Serving scaling is transient: the factor comes from the cook's
    // chosen serving count over the recipe's stored servings. The
    // scaler bar shows only when the recipe lists servings as a
    // number — "first number ANYWHERE" (RECIPE-3): "Serves 4",
    // "Makes 12 muffins", "Yield: 8" all parse; a servings string
    // with no number has no base to scale from.
    const baseServings = parseServings(recipe.servings);
    const factor = baseServings ? this._scaleFactor(recipe) : null;
    const targetServings = baseServings ? this._targetServings(recipe) : null;
    const isScaled =
      baseServings !== null &&
      (targetServings.low !== baseServings.low ||
        targetServings.high !== baseServings.high);
    const showingOriginal = this._showOriginal.has(recipe.id);
    const scalerHtml = baseServings
      ? `<div class="scaler" role="group" aria-label="Servings">
          <span class="scaler-label">Serves</span>
          <button class="button scaler-btn" data-action="scale-down" ${targetServings.low <= 1 ? "disabled" : ""} aria-label="Fewer servings">−</button>
          <span class="scaler-count" aria-live="polite">${escapeHtml(formatServingsRange(targetServings))}</span>
          <button class="button scaler-btn" data-action="scale-up" aria-label="More servings">+</button>
          ${isScaled ? `<span class="scaler-factor" aria-label="Scaled by factor ${factor}">×${escapeHtml(formatAmount(factor).text)}</span>` : ""}
          ${isScaled ? `<button class="button small ghost" data-action="scale-original">${showingOriginal ? "Show scaled" : "Show original"}</button>` : ""}
          ${isScaled ? `<button class="button small ghost" data-action="scale-reset">Reset servings</button>` : ""}
        </div>`
      : "";
    // Headed recipes interleave section sub-headings with ingredient
    // rows. The checkable index counts ingredient rows only, in
    // display order, so it matches the set stored per recipe. The
    // quantities shown are the scaled ones when the scaler is in
    // use; the stored recipe is untouched.
    let ingIndex = -1;
    const ingredientsHtml = recipe.entries.length
      ? recipe.entries
          .map((item) => {
            if (item.type === "section") {
              return `<div class="ingredient-section">${escapeHtml(item.name)}</div>`;
            }
            ingIndex += 1;
            const display = this._scaledItem(item, showingOriginal ? null : factor);
            return this._ingredientRowHtml(display, ingIndex, checked.has(ingIndex));
          })
          .join("")
      : recipe.ingredients
          .map((item, index) => this._ingredientRowHtml(this._scaledItem(item, showingOriginal ? null : factor), index, checked.has(index)))
          .join("");
    const steps = this._navigableSteps(recipe);
    const current = this._currentStepIndex(recipe.id, steps.length);
    // The voice hint is computed from the CURRENT step (N-IMPL-19c):
    // a step with a time chip names that chip's duration; a step
    // without one shows NO hint. It sits directly under the sticky
    // step navigator and above the step card, so it is visible on
    // detail open at every size (M1 detail-opens-at-top). A
    // bridge-missing timer error REPLACES the hint in the same slot
    // (R-IMPL-25) — the cook reads one line, not a hint plus an error.
    const currentStepText =
      steps.length > 0 ? recipe.steps[steps[current].index] : null;
    const hintStepText =
      currentStepText != null && factor && factor !== 1 && !showingOriginal
        ? scaleStepText(currentStepText, factor)
        : currentStepText;
    const voiceHint = hintStepText != null ? voiceHintForStep(hintStepText) : null;
    const hintHtml = this._timerError
      ? `<div class="voice-hint timer-error" role="alert">${escapeHtml(this._timerError)}</div>`
      : voiceHint
        ? `<div class="voice-hint">${escapeHtml(voiceHint)}</div>`
        : "";
    const stepNav =
      steps.length > 0
        ? `<div class="step-tracker">
            <button class="button step-nav" data-action="step-prev" ${current === 0 ? "disabled" : ""} aria-label="Previous step">← Prev</button>
            <span class="step-position" aria-live="polite">Step ${current + 1} of ${steps.length}</span>
            ${current === steps.length - 1
              ? `<button class="button step-nav" data-action="finish" aria-label="Finish cooking">Finish</button>`
              : `<button class="button step-nav" data-action="step-next" aria-label="Next step">Next →</button>`}
          </div>`
        : "";
    // Steps render in full order (headers interleaved as section
    // labels). Only the numbered steps are navigable; the current one
    // is highlighted and the rest are dimmed. Tapping a step makes it
    // current. Quantities in step text scale with the same rules as
    // the ingredient list (RECIPE-23) — on the raw text, before the
    // time-chip rendering, so time phrases are untouched.
    let stepNumber = 0;
    const stepsHtml = recipe.steps
      .map((step) => {
        const scaledText =
          factor && factor !== 1 && !showingOriginal
            ? scaleStepText(step, factor)
            : step;
        const rendered = renderStepText(scaledText);
        if (rendered.header) {
          return `<li class="step-header">${rendered.html}</li>`;
        }
        const navIndex = stepNumber;
        stepNumber += 1;
        const isCurrent = navIndex === current;
        return `<li class="step${isCurrent ? " current" : ""}" data-action="step" data-step-index="${navIndex}" role="button" tabindex="0" aria-current="${isCurrent ? "step" : "false"}"><span class="step-num">${navIndex + 1}</span><span class="step-text">${rendered.html}</span></li>`;
      })
      .join("");
    const timerStatus = this._timerStatus
      ? `<div class="timer-status" role="status">${escapeHtml(this._timerStatus)}</div>`
      : "";
    // The completion card (R-IMPL-8): shown after "Finish" at the
    // last step. "Cook again" is the Start over action (checks
    // cleared, step back to 1); "← Back to recipe" hides the card
    // and stays at the last step. The card copy is the build's own
    // wording — the design specifies the card, not its text.
    const completionHtml = this._finishShown
      ? `<div class="completion-card" data-role="completion" role="status">
          <div class="completion-title">All done!</div>
          <div class="completion-sub">You've finished all ${steps.length} steps.</div>
          <button class="button primary" data-action="cook-again">Cook again</button>
          <button class="button ghost" data-action="finish-dismiss">← Back to recipe</button>
        </div>`
      : "";
    return `
      <div class="cook-grid">
        <section class="cook-ingredients" aria-label="Ingredients">
          <div class="cook-head">
            <h2 class="section-title">Ingredients</h2>
            <span class="cook-count">${checkedCount} of ${rows.length} gathered</span>
            ${checkedCount > 0 ? `<button class="button small ghost" data-action="clear-checks">Start over</button>` : ""}
          </div>
          ${this._cookTotalHtml(recipe)}
          ${scalerHtml}
          ${ingredientsHtml ? `<div class="ingredients">${ingredientsHtml}</div>` : `<div class="status">No ingredients listed.</div>`}
        </section>
        <section class="cook-steps" aria-label="Steps">
          <div class="cook-head">
            <h2 class="section-title">Steps</h2>
          </div>
          ${stepNav}
          ${timerStatus}
          ${hintHtml}
          ${this._timerStripHtml()}
          ${this._timerStripSummaryHtml()}
          ${stepsHtml ? `<ol class="steps">${stepsHtml}</ol>` : `<div class="status">No steps for this recipe.</div>`}
          ${completionHtml}
        </section>
      </div>`;
  }

  // One checkable ingredient row: a full-row button with a checkbox
  // square. Tap to cross it off (tap again to un-cross). A checked
  // row is struck through and dimmed; the checkbox fills with a tick.
  // A quantity the scaler could not parse is flagged "check this
  // one" (RECIPE-2) — never silently left or silently dropped — and
  // a scaled count carries its usable instruction ("½ egg — beat 1
  // egg and use half").
  _ingredientRowHtml(item, index, isChecked) {
    const display = item.name || item.raw;
    const qty = item.quantity
      ? `<span class="qty">${escapeHtml(item.quantity)}</span>`
      : `<span class="qty"></span>`;
    const note = item.note ? ` <span class="ing-note">${escapeHtml(item.note)}</span>` : "";
    const flag = item.unparseable
      ? ` <span class="ing-flag">check this one</span>`
      : "";
    const countNote = item.countNote
      ? ` <span class="ing-note">${escapeHtml(item.countNote)}</span>`
      : "";
    return `<button class="ingredient${isChecked ? " checked" : ""}" data-action="toggle-ingredient" data-index="${index}" aria-pressed="${isChecked ? "true" : "false"}">
      <span class="check" aria-hidden="true">${isChecked ? "✓" : ""}</span>
      ${qty}<span class="ing-name">${escapeHtml(display)}${note}${flag}${countNote}</span>
    </button>`;
  }

  // The Details tab (RECIPE-7): the photo hero, the metadata line,
  // and every stored field — prep, cook, total, servings as stored,
  // rating (stars + "4/5"), collections, source (a link when it is a
  // URL). This is where the cook checks the recipe before cooking;
  // the cooking view itself stays uncluttered.
  _detailsHtml(recipe) {
    const photo = recipe.photoUrls[0];
    const initial = escapeHtml(recipe.name.charAt(0).toUpperCase() || "•");
    const hero = photo
      ? `<img class="detail-photo" src="${escapeHtml(photo)}" alt="Photo of ${escapeHtml(recipe.name)}" data-initial="${initial}" />`
      : `<div class="detail-photo missing" aria-hidden="true">${initial}</div>`;
    const meta = formatMetaHtml(recipe);
    const prep = typeof recipe.prepTime === "number" ? formatDuration(recipe.prepTime) : null;
    const cook = typeof recipe.cookTime === "number" ? formatDuration(recipe.cookTime) : null;
    const total =
      prep !== null && cook !== null
        ? formatDuration(recipe.prepTime + recipe.cookTime)
        : null;
    const rating = recipe.rating ? formatStarsText(recipe.rating) : "Not rated";
    const collections = recipe.collections.length
      ? recipe.collections.map((item) => item.name).join(", ")
      : "None";
    const source = recipe.sourceUrl
      ? `<a href="${escapeHtml(recipe.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(recipe.sourceName || recipe.sourceUrl)}</a>`
      : recipe.sourceName || "—";
    const servings = recipe.servings ? recipe.servings : "—";
    const rows = [
      prep !== null ? ["Prep", prep] : null,
      cook !== null ? ["Cook", cook] : null,
      total !== null ? ["Total", total] : null,
      ["Servings", servings],
      ["Rating", rating],
      ["Collections", collections],
      ["Source", source],
    ].filter(Boolean);
    return `
      <div class="details-view">
        ${hero}
        ${meta ? `<div class="detail-meta">${meta}</div>` : ""}
        <dl class="detail-rows">
          ${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${label === "Source" && recipe.sourceUrl ? value : escapeHtml(String(value))}</dd>`).join("")}
        </dl>
      </div>`;
  }

  // The Notes tab: the note as an editable textarea, and the rating
  // as five tappable stars. The editor is pre-filled with the saved
  // note (or the unsaved draft, if the cook typed one and left the
  // tab); Save is enabled only when the text actually changed. The
  // rating saves on tap — no separate Save button — and Clear
  // un-rates the recipe. Both show a status line ("Saved." or an
  // honest error); a failed note save keeps the typed text.
  _notesHtml(recipe) {
    const draft = this._noteDrafts.has(recipe.id)
      ? this._noteDrafts.get(recipe.id)
      : recipe.note;
    const hasChanges = asTrimmed(draft) !== asTrimmed(recipe.note);
    const noteStatus = this._noteStatus
      ? this._noteStatus.retry
        ? `<button type="button" class="note-status error" data-action="${this._noteStatus.retry}" role="status">${escapeHtml(this._noteStatus.text)}</button>`
        : `<span class="note-status${this._noteStatus.error ? " error" : ""}" role="status">${escapeHtml(this._noteStatus.text)}</span>`
      : "";
    const rating = recipe.rating || 0;
    const stars = [1, 2, 3, 4, 5]
      .map(
        (value) =>
          `<button class="star${value <= rating ? " filled" : ""}" data-action="rate" data-rating="${value}" ${this._ratingBusy ? 'disabled="disabled"' : ""} aria-label="Rate ${value} out of 5">${value <= rating ? "★" : "☆"}</button>`
      )
      .join("");
    const ratingStatus = this._ratingStatus
      ? this._ratingStatus.retry
        ? `<button type="button" class="rating-status error" data-action="${this._ratingStatus.retry}" role="status">${escapeHtml(this._ratingStatus.text)}</button>`
        : `<span class="rating-status${this._ratingStatus.error ? " error" : ""}" role="status">${escapeHtml(this._ratingStatus.text)}</span>`
      : "";
    return `
      <div class="note-view">
        <label class="note-label" for="note-editor">Your note</label>
        <textarea class="note-editor" id="note-editor" data-role="note" rows="4" placeholder="Add a note — e.g. more salt next time…">${escapeHtml(draft)}</textarea>
        <div class="note-actions">
          <button class="button primary" data-action="save-note" ${!hasChanges || this._savingNote ? 'disabled="disabled"' : ""}>Save note</button>
          ${noteStatus}
        </div>
        <div class="rating-block">
          <div class="rating-label">Your rating</div>
          <div class="rating-stars" role="group" aria-label="Rate this recipe">
            ${stars}
            ${rating > 0 ? `<button class="button small ghost" data-action="clear-rating" ${this._ratingBusy ? 'disabled="disabled"' : ""}>Clear</button>` : ""}
          </div>
          ${ratingStatus}
        </div>
      </div>`;
  }
}

customElements.define("anylist-recipe-view", AnyListRecipeViewCard);

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeRecipe,
    normalizeSearchText,
    isMinorTypo,
    searchRecipes,
    recipeSearchText,
    fieldMatch,
    deriveCollections,
    formatMeta,
    formatMetaHtml,
    formatDuration,
    formatServings,
    formatServingsRange,
    formatStars,
    formatStarsText,
    parseServings,
    parseAmountAt,
    formatAmount,
    scaleQuantity,
    scaleQuantityDetail,
    scaleStepText,
    countNoteFor,
    parseFlatIngredient,
    mergeIngredientEntries,
    renderStepText,
    renderIngredientRow,
    sortRecipes,
    filterByCollection,
    detectDevice,
    readDeviceEnv,
    isKioskMode,
    pluralTimeUnit,
    timerName,
    timerSensorList,
    timerRemainingSeconds,
    formatRemaining,
    runningTimers,
    NAV_STRIP_VIEWS,
    VOICE_HINT,
    AnyListRecipeViewCard,
    CARD_CSS,
    RECIPE_SESSION_KEY,
    parseRecipeSession,
    serializeRecipeSession,
    sanitizeRecipeStep,
    voiceHintForStep,
    KIOSK_SESSION_KEY,
    readKioskFlag,
    storeKioskFlag,
    isKioskSession,
    withKioskQuery,
    reapplyKioskIfNeeded,
    timerBadgeState,
    timerBadgeFromHassStates,
    NIGHT_SETTING_KEY,
    parseNightSetting,
    readNightSetting,
    isNightNow,
  };
}

