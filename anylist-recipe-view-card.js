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

// How long to wait after the last keystroke before searching, so one
// search runs per pause in typing instead of one per letter.
const SEARCH_DEBOUNCE_MS = 300;
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
  return { header: Boolean(headerMatch), html };
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

// A recipe as the card understands it, normalised once from whatever
// the action returned so the rendering code never has to guess at
// shapes. Every field is optional except id and name: the card shows
// what is there and skips what is not.
function normalizeRecipe(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  // The flat ingredient list. Headings are never ingredients: the
  // upstream format (PR #15) carries them inside `ingredients` with
  // `is_heading: true`, so they are filtered out here.
  const parsedIngredients = Array.isArray(source.ingredients)
    ? source.ingredients
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
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
        }))
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
  const entries =
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
    // The anylist_rs docs say "Set prep time in minutes" — that is the
    // setter, not the stored unit. The live list proved it: a "10 Minute"
    // recipe arrives as prep_time 300, cook_time 300. The model keeps
    // seconds; formatDuration converts at display time.
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

// Local search over the loaded recipes, reproducing the integration's
// server search (recipe_search.py) plus the prefix/substring fallback
// the server lacks. Every query word is matched against the title
// words, each title word used at most once; exact words first, then
// the closest remaining match. At least half the query words must
// match. Ranking mirrors the server: an exact title scores 100, all
// query words exact scores 90, anything else scores at most 80 by
// word coverage — then name order, then id.
function searchRecipes(recipes, query) {
  const queryWords = [...new Set(searchWords(query))];
  const total = queryWords.length;
  if (total === 0) return [];
  const normalizedQuery = normalizeSearchText(query);
  const scored = [];
  for (const recipe of recipes) {
    const title = normalizeSearchText(recipe.name);
    const titleWords = new Set(title.split(" ").filter(Boolean));
    const remaining = new Set(queryWords);
    let exact = 0;
    for (const word of [...remaining]) {
      if (titleWords.has(word)) {
        titleWords.delete(word);
        remaining.delete(word);
        exact++;
      }
    }
    let weighted = 0;
    for (const word of [...remaining]) {
      let bestWord = null;
      let bestWeight = 0;
      for (const candidate of titleWords) {
        const weight = wordWeight(word, candidate);
        if (weight > bestWeight) {
          bestWeight = weight;
          bestWord = candidate;
        }
      }
      if (bestWord !== null) {
        titleWords.delete(bestWord);
        remaining.delete(word);
        weighted += bestWeight;
      }
    }
    const matched = total - remaining.size;
    if (matched * 2 < total) continue;
    let score;
    if (title === normalizedQuery) score = 100;
    else if (exact === total) score = 90;
    else score = Math.round(((80 * (exact + weighted)) / total) * 100) / 100;
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

function formatStars(rating) {
  if (rating === null || rating === undefined || rating <= 0) return "";
  const stars = Math.min(5, rating);
  return "★".repeat(stars) + "☆".repeat(5 - stars);
}

// One line of metadata under a recipe name, as segments: only the
// parts that exist. Times are seconds in the model (see
// normalizeRecipe); rating is stars out of 5. Each segment is one
// unbreakable unit ("Prep 5 min", "Serves 4") — the renderer keeps
// segments whole and wraps only between them, so a value never splits
// across lines.
function formatMeta(recipe) {
  const parts = [];
  const prep = formatDuration(recipe.prepTime);
  if (prep) parts.push(`Prep ${prep}`);
  const cook = formatDuration(recipe.cookTime);
  if (cook) parts.push(`Cook ${cook}`);
  const servings = formatServings(recipe.servings);
  if (servings) parts.push(servings);
  const stars = formatStars(recipe.rating);
  if (stars) parts.push(stars);
  return parts;
}

// The metadata line as HTML: each segment wrapped so it cannot break
// inside, joined by a middot that sits between segments only. The
// rating segment is stars only; it gets the stars class so it renders
// amber instead of grey metadata text.
function formatMetaHtml(recipe) {
  const parts = formatMeta(recipe);
  if (parts.length === 0) return "";
  return parts
    .map((part) => {
      const isStars = /^[★☆]+$/.test(part);
      return `<span class="meta-seg${isStars ? " stars" : ""}">${escapeHtml(part)}</span>`;
    })
    .join(`<span class="meta-sep" aria-hidden="true">·</span>`);
}

function sortRecipes(recipes) {
  return [...recipes].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );
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

const CARD_CSS = `
  :host { display: block; }
  /* Design tokens: one warm, food-app palette for the whole card. The
     card renders in shadow DOM and deliberately does NOT borrow Home
     Assistant's theme colours — that is what makes it read as a modern
     recipe app rather than a stock HA card. One accent (warm
     terracotta); everything else is warm neutrals. */
  .screen {
    box-sizing: border-box;
    padding: 28px 36px;
    background: #FAF7F4;
    color: #1C1917;
    --accent: #C2410C;
    --ink: #1C1917;
    --muted: #78716C;
    --card: #FFFFFF;
    --line: #EDE8E3;
    --chip-bg: #F1ECE6;
    --star: #D97706;
    --error: #B91C1C;
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
    font-size: 20px;
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
     grid takes the full width instead (see .list). */
  .detail {
    width: 100%;
    max-width: 1150px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .title {
    font-size: 32px;
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: -0.02em;
    margin: 0;
    color: var(--ink);
  }
  .toolbar { display: flex; gap: 12px; align-items: stretch; }
  .search {
    flex: 1;
    min-height: 64px;
    padding: 12px 24px 12px 58px;
    font-size: 22px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background-color: var(--card);
    background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='24'%20height='24'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%2378716C'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Ccircle%20cx='11'%20cy='11'%20r='7'/%3E%3Cpath%20d='m21%2021-4.3-4.3'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: 20px center;
    background-size: 26px 26px;
    box-shadow: var(--shadow-card);
    color: var(--ink);
    font-family: inherit;
  }
  .search::placeholder { color: var(--muted); }
  .search:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .button {
    min-height: 64px;
    min-width: 64px;
    padding: 12px 24px;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: var(--card);
    box-shadow: var(--shadow-card);
    color: var(--ink);
    font-size: 20px;
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
  .button:disabled { opacity: 0.5; cursor: default; }
  /* Chips scroll horizontally with the scrollbar hidden; the fade at
     the right edge (added only when the row actually overflows, see
     _updateChipsFade) is the affordance that it scrolls. */
  .chips {
    display: flex;
    gap: 10px;
    overflow-x: auto;
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
    min-height: 56px;
    padding: 8px 22px;
    border-radius: 999px;
    border: 1px solid transparent;
    background: var(--chip-bg);
    color: var(--ink);
    font-size: 20px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    white-space: nowrap;
  }
  .chip[aria-pressed="true"] {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    box-shadow: var(--shadow-accent);
  }
  .status { font-size: 18px; color: var(--muted); padding: 0; }
  .error { font-size: 20px; color: var(--error); padding: 0; }
  /* The list is a grid that uses the width it is given: one column on
     narrow screens, two from 1000px, three from 1500px. The Recipes
     view is a panel view, so on the 1920px hub display the grid has
     the full dashboard width to work with. */
  .list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
  }
  @media (min-width: 1000px) { .list { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 1500px) { .list { grid-template-columns: repeat(3, 1fr); } }
  .row {
    display: flex;
    gap: 20px;
    align-items: center;
    width: 100%;
    min-height: 104px;
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
    width: 84px;
    height: 84px;
    border-radius: 16px;
    object-fit: cover;
    background: var(--chip-bg);
  }
  .thumb.missing {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 38px;
    font-weight: 700;
    color: var(--accent);
  }
  .row-text { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 6px; }
  /* Names wrap to two lines, never a single-line ellipsis: a long name
     gets a second line before anything is cut. */
  .row-name {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 22px;
    font-weight: 700;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }
  /* Meta segments are unbreakable units (see formatMetaHtml); the line
     wraps only between them. */
  .row-meta,
  .detail-meta {
    display: flex;
    flex-wrap: wrap;
    column-gap: 10px;
    align-items: baseline;
    color: var(--muted);
    line-height: 1.4;
  }
  .row-meta { font-size: 16px; }
  .meta-seg { white-space: nowrap; }
  .meta-sep { color: var(--muted); }
  /* The rating reads as a rating, not more grey metadata: amber stars
     with breathing room between them. */
  .stars { color: var(--star); letter-spacing: 2px; }
  .row-collections { display: flex; flex-wrap: wrap; gap: 6px; }
  .mini-pill {
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--chip-bg);
    color: var(--muted);
    font-size: 14px;
    font-weight: 600;
    line-height: 1.5;
    white-space: nowrap;
  }
  .detail-photo {
    width: 100%;
    max-height: 420px;
    object-fit: cover;
    border-radius: 20px;
    background: var(--chip-bg);
    box-shadow: var(--shadow-card);
  }
  .detail-name {
    font-size: 36px;
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: -0.02em;
    margin: 0;
    color: var(--ink);
  }
  .detail-meta { font-size: 18px; }
  .detail-note { font-size: 21px; line-height: 1.6; color: var(--ink); }
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
    min-height: 64px;
    padding: 8px 12px;
    border-radius: 14px;
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: 20px;
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
  .ingredients { display: flex; flex-direction: column; }
  .ingredient {
    display: flex;
    gap: 16px;
    align-items: baseline;
    min-height: 64px;
    padding: 14px 4px;
    border-bottom: 1px solid var(--line);
    font-size: 20px;
    line-height: 1.45;
  }
  .ingredient:last-child { border-bottom: none; }
  /* Quantities take the accent colour: they separate from the name at
     a glance, and the colour is the card's single restrained accent. */
  .ingredient .qty { flex: 0 0 auto; font-weight: 700; white-space: nowrap; color: var(--accent); }
  .ingredient .ing-name { flex: 1; min-width: 0; overflow-wrap: break-word; }
  .ingredient .ing-note { color: var(--muted); font-size: 18px; }
  /* Section headings are set apart from the rows: smaller, uppercase,
     letterspaced, secondary colour — a label, not another ingredient. */
  .ingredient-section {
    font-size: 17px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 22px 0 4px;
  }
  .ingredient-section:first-child { padding-top: 0; }
  .steps { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; counter-reset: step; }
  .step {
    display: flex;
    gap: 18px;
    align-items: flex-start;
    min-height: 64px;
    padding: 14px 4px;
    font-size: 21px;
    line-height: 1.55;
  }
  .step::before {
    counter-increment: step;
    content: counter(step);
    flex: 0 0 auto;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    font-size: 22px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 2px;
  }
  .step-text { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: break-word; }
  .step-header {
    padding: 18px 4px 4px;
    font-size: 21px;
    font-weight: 700;
    color: var(--ink);
  }
  .detail-rows { display: flex; flex-direction: column; }
  .detail-row {
    display: flex;
    gap: 16px;
    align-items: baseline;
    min-height: 64px;
    padding: 14px 4px;
    border-bottom: 1px solid var(--line);
    font-size: 20px;
    line-height: 1.45;
  }
  .detail-row:last-child { border-bottom: none; }
  .detail-label { flex: 0 0 160px; font-weight: 700; color: var(--muted); }
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
    min-height: 104px;
    padding: 16px 20px;
    box-sizing: border-box;
    border-radius: 20px;
    border: 1px solid var(--line);
    background: var(--card);
    box-shadow: var(--shadow-card);
  }
  .skeleton-thumb { flex: 0 0 auto; width: 84px; height: 84px; border-radius: 16px; background: var(--chip-bg); }
  .skeleton-lines { flex: 1; display: flex; flex-direction: column; gap: 10px; }
  .skeleton-line { height: 18px; border-radius: 9px; background: var(--chip-bg); }
  .skeleton-line.short { width: 55%; }
  .skeleton-thumb, .skeleton-line { animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
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
    this._detailTab = "ingredients"; // Active tab of the open recipe.
    this._loading = false;
    this._error = "";
    this._loaded = false;
    this._searchTimer = null;
    this._shell = null; // Built once: title, toolbar, chips, status, body.
    this._detailEl = null;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
    this.shadowRoot.addEventListener("input", (event) => this._onInput(event));
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
    } else {
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
      return;
    }
    this._searchResults = searchRecipes(this._recipes, trimmed);
    this._render();
  }

  // Detail reads from the loaded list: the view-open download already
  // brought ingredients and steps, so opening a recipe makes no
  // server call and needs no cache.
  _openRecipe(recipeId) {
    const id = asTrimmed(recipeId);
    if (!id) return;
    const recipe = this._recipes.find((item) => item.id === id);
    if (!recipe) return;
    this._selected = recipe;
    this._detailTab = "ingredients";
    this._render();
  }

  _friendlyError(err) {
    const message = String((err && err.message) || err || "");
    if (/not found/i.test(message) && /service/i.test(message)) {
      return "The AnyList integration is not available on this Home Assistant.";
    }
    if (/timeout/i.test(message)) {
      return "AnyList took too long to answer — check the connection and try again.";
    }
    return "Could not load recipes from AnyList — try again.";
  }

  // -- events ---------------------------------------------------------------

  _onInput(event) {
    const target = event.target;
    if (!target || !target.dataset || target.dataset.role !== "search") return;
    this._query = target.value || "";
    if (this._searchTimer !== null) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null;
      this._search(this._query);
    }, SEARCH_DEBOUNCE_MS);
  }

  _onClick(event) {
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
      return;
    }
    if (action === "back") {
      this._selected = null;
      this._render();
      return;
    }
    if (action === "tab") {
      this._detailTab = target.dataset.tab || "ingredients";
      this._render();
      return;
    }
    if (action === "collection") {
      this._collectionId = target.dataset.collectionId || "";
      this._render();
      return;
    }
    if (action === "open") {
      this._openRecipe(target.dataset.recipeId);
    }
  }

  _visibleRecipes() {
    // A search in progress shows its ranked results; the collection
    // chips filter whichever list is showing. Both are full recipes
    // from the one loaded list — no join needed.
    const list = this._searchResults !== null ? this._searchResults : this._recipes;
    return filterByCollection(list, this._collectionId);
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
    this._shell.innerHTML = `
      <div class="list-view">
        <h1 class="title"></h1>
        <div class="toolbar">
          <input class="search" data-role="search" type="search" placeholder="Search recipes…" aria-label="Search recipes" />
        </div>
        <div class="chips"></div>
        <div class="status"></div>
        <div class="body"></div>
      </div>
      <div class="detail-view" hidden></div>`;
    this.shadowRoot.appendChild(this._shell);
    this._detailEl = this._shell.querySelector(".detail-view");
  }

  _render() {
    if (!this.shadowRoot) return;
    this._ensureShell();
    const listView = this._shell.querySelector(".list-view");
    const title = this._shell.querySelector(".title");
    if (title) title.textContent = this._title;
    if (this._selected) {
      listView.hidden = true;
      this._detailEl.hidden = false;
      this._detailEl.innerHTML = this._detailHtml();
      return;
    }
    this._detailEl.hidden = true;
    listView.hidden = false;
    this._renderChips();
    this._renderStatus();
    this._renderBody();
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

  // The chips row scrolls horizontally with its scrollbar hidden; the
  // fade at the right edge is the only affordance that it scrolls, so
  // it appears only when the chips actually overflow. Guarded for
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
      title = `No recipes match “${escapeHtml(this._query)}”.`;
      sub = "Try a different spelling, or browse the full list.";
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
    return `<div class="empty"><div class="empty-title">${title}</div><div class="empty-sub">${sub}</div>${showAll}</div>`;
  }

  _rowHtml(recipe) {
    const meta = formatMetaHtml(recipe);
    const collections = recipe.collections
      .map((item) => `<span class="mini-pill">${escapeHtml(item.name)}</span>`)
      .join("");
    const photo = recipe.photoUrls[0];
    const thumb = photo
      ? `<img class="thumb" src="${escapeHtml(photo)}" alt="" loading="lazy" onerror="this.remove()" />`
      // No photo: the recipe's initial in a coloured tile. A letter
      // renders in any font; an emoji placeholder does not (headless
      // Chrome here has no colour-emoji font, and the kiosk's fonts
      // are not guaranteed either).
      : `<div class="thumb missing" aria-hidden="true">${escapeHtml(recipe.name.charAt(0).toUpperCase() || "•")}</div>`;
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
    const meta = formatMetaHtml(recipe);
    const photo = recipe.photoUrls[0];
    // A recipe with a photo gets a photo hero; a recipe without one
    // gets no placeholder block at all — just the title, once.
    const tabs = [
      ["ingredients", "Ingredients"],
      ["recipe", "Recipe"],
      ["details", "Details"],
      ["notes", "Notes"],
    ];
    const tabBar = `<div class="tabbar" role="tablist">${tabs
      .map(
        ([id, label]) =>
          `<button class="tab" role="tab" data-action="tab" data-tab="${id}" aria-selected="${this._detailTab === id ? "true" : "false"}">${label}</button>`
      )
      .join("")}</div>`;
    return `
      <div class="detail">
        <div class="toolbar">
          <button class="button ghost" data-action="back">← All recipes</button>
        </div>
        ${this._error ? `<div class="error">${escapeHtml(this._error)}</div><button class="button primary" data-action="retry">Try again</button>` : ""}
        ${photo ? `<img class="detail-photo" src="${escapeHtml(photo)}" alt="" onerror="this.remove()" />` : ""}
        <h1 class="detail-name">${escapeHtml(recipe.name)}</h1>
        ${meta ? `<div class="detail-meta">${meta}</div>` : ""}
        ${tabBar}
        <div class="tab-panel">${this._detailTabHtml(recipe)}</div>
      </div>`;
  }

  // The active tab's panel. Ingredients is the default tab: the quantities
  // a cook needs first. Headed recipes render their ordered entries
  // (section sub-headings interleaved with ingredient rows); without
  // entries — older integration responses — the flat list renders as before.
  _detailTabHtml(recipe) {
    if (this._detailTab === "recipe") {
      const steps = recipe.steps
        .map((step) => {
          const rendered = renderStepText(step);
          if (rendered.header) {
            return `<li class="step-header">${rendered.html}</li>`;
          }
          return `<li class="step"><span class="step-text">${rendered.html}</span></li>`;
        })
        .join("");
      return steps
        ? `<ol class="steps">${steps}</ol>`
        : `<div class="status">No steps listed.</div>`;
    }
    if (this._detailTab === "details") {
      const rows = [];
      const prep = formatDuration(recipe.prepTime);
      if (prep) rows.push(["Prep", prep]);
      const cook = formatDuration(recipe.cookTime);
      if (cook) rows.push(["Cook", cook]);
      const servings = formatServings(recipe.servings);
      if (servings) rows.push(["Servings", servings]);
      const stars = formatStars(recipe.rating);
      if (stars) rows.push(["Rating", stars]);
      const collections = recipe.collections.map((item) => item.name).join(", ");
      if (collections) rows.push(["Collections", collections]);
      if (recipe.sourceName || recipe.sourceUrl) {
        rows.push(["Source", recipe.sourceName || recipe.sourceUrl]);
      }
      if (rows.length === 0) {
        return `<div class="status">No details for this recipe.</div>`;
      }
      return `<div class="detail-rows">${rows
        .map(([label, value]) => {
          // The rating renders as amber stars, like the meta line.
          const valueHtml =
            label === "Rating"
              ? `<span class="stars">${escapeHtml(value)}</span>`
              : escapeHtml(value);
          return `<div class="detail-row"><span class="detail-label">${escapeHtml(label)}</span><span>${valueHtml}</span></div>`;
        })
        .join("")}</div>`;
    }
    if (this._detailTab === "notes") {
      return recipe.note
        ? `<div class="detail-note">${escapeHtml(recipe.note)}</div>`
        : `<div class="status">No notes for this recipe.</div>`;
    }
    const ingredients = recipe.entries.length
      ? recipe.entries
          .map((item) =>
            item.type === "section"
              ? `<div class="ingredient-section">${escapeHtml(item.name)}</div>`
              : renderIngredientRow(item),
          )
          .join("")
      : recipe.ingredients.map(renderIngredientRow).join("");
    return ingredients
      ? `<div class="ingredients">${ingredients}</div>`
      : `<div class="status">No ingredients listed.</div>`;
  }
}

customElements.define("anylist-recipe-view", AnyListRecipeViewCard);

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeRecipe,
    normalizeSearchText,
    isMinorTypo,
    searchRecipes,
    deriveCollections,
    formatMeta,
    formatMetaHtml,
    formatDuration,
    formatServings,
    formatStars,
    renderStepText,
    renderIngredientRow,
    sortRecipes,
    filterByCollection,
    AnyListRecipeViewCard,
  };
}

