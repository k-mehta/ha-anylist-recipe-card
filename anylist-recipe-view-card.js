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
  // A real step (not a section header) gets its times as tappable
  // timer chips: "simmer for 10 minutes" becomes a chip that starts
  // a 10-minute timer. Headers are labels, never actionable.
  if (!headerMatch) html = linkDurations(html);
  return { header: Boolean(headerMatch), html };
}

// Time phrases in step text, as tappable timer chips. Matches a number
// (integer or decimal) or "a"/"an" with a unit — hours, minutes or
// seconds, singular/plural/abbreviated ("10 minutes", "1 hour",
// "30 sec", "a minute"). Combined durations ("1 hour 30 minutes")
// become one chip per part. Only text is touched: the HTML is split
// into tags and text first, so a time-looking string inside a tag or
// attribute is never rewritten. Each chip carries the total seconds;
// the card starts a timer for that long when it is tapped.
const DURATION_RE =
  /\b(?:(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)|(a|an)\s+(hour|minute|second))\b/gi;

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
        const seconds = match[1] !== undefined
          ? durationSeconds(match[1], match[2])
          : durationSeconds(null, match[4]);
        if (seconds === null) continue;
        out += part.slice(last, match.index);
        out += `<button class="time-chip" data-action="start-timer" data-seconds="${seconds}" aria-label="Start a ${escapeHtml(match[0])} timer">${escapeHtml(match[0])}</button>`;
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

// The recipe's stored servings as a number, or null when it is not
// one. Servings is a freeform string in AnyList ("4", "4 servings",
// "2 (bowls)") — only a bare number can be a scaling base. Mirrors
// the fork's scale_recipe, which reads float(recipe.servings) and
// refuses to scale when that is not a number.
function parseServings(servings) {
  const text = asTrimmed(servings);
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Scale the first numeric token of a quantity string ("500 g" at 1.5
// becomes "750 g"), leaving the rest untouched. A quantity with no
// leading number ("a pinch", "to taste") comes back unchanged.
// Mirrors the fork's _scale_quantity exactly: Python's float() on the
// first whitespace-separated token, integer results rendered without
// a decimal, the remainder rejoined with single spaces. A whole
// number stays whole (500 * 1.5 = 750, not 750.0); a fractional
// result keeps its decimals (0.5 * 3 = 1.5).
function scaleQuantity(quantity, scale) {
  const text = asTrimmed(quantity);
  if (!text) return asString(quantity);
  const parts = text.split(/\s+/);
  const number = Number(parts[0]);
  if (!Number.isFinite(number)) return asString(quantity);
  const scaled = number * scale;
  // A whole number stays whole: in JS String(750) is "750" and
  // String(1.5) is "1.5", which is exactly the fork's rendering
  // (int when whole, float otherwise).
  const scaledText = String(scaled);
  const rest = parts.slice(1).join(" ");
  return rest ? `${scaledText} ${rest}` : scaledText;
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

// -- Device detection (SHARED MECHANISM) ----------------------------------
//
// The same detection runs in the AnyList recipe card
// (k-mehta/ha-anylist-recipe-card) and the Satellite Timers card
// (k-mehta/ha-satellite-timers). It is ONE mechanism, copied verbatim
// into each card file: each card is a single standalone file with no
// imports, so the code cannot be shared by import — the two copies must
// stay identical. If you change the signals, the precedence, or the
// category names here, change them in the other card too, and update
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
// Precedence (first match wins):
//   1. A phone/tablet user agent ("Mobi", "Android", "iPhone", "iPad",
//      "iPod") is mobile.
//   2. A viewport narrower than 768px is mobile (a narrow desktop
//      window gets the single-column layout too — the layout follows
//      the viewport).
//   3. A coarse pointer on anything but a huge landscape screen is
//      mobile (phones and tablets).
//   4. A coarse pointer on a landscape screen at least 1600px wide is
//      the hub: the kitchen kiosk is a 1920x1200 touch display.
//   5. A fine pointer is desktop.
//   6. With no pointer information: a touch screen that is landscape
//      and at least 1600px wide is the hub; a viewport at least 1024px
//      wide is desktop; anything else is mobile.
//
// Known limits (every fallback still renders a usable layout, never a
// broken one):
//   - A desktop touchscreen at 1920x1200 reads as the hub. That is
//     fine: the hub layout is just big targets on a wide screen.
//   - A phone in desktop mode (no mobile user agent) still reads as
//     mobile by width (rule 2).
//   - The hub is recognised by size + touch + landscape, not by name:
//     if the kiosk display changes size, the thresholds above are the
//     place to adjust.
//
// Orientation is separate from category: landscape is width >= height,
// portrait is width < height. The category picks the control sizes and
// the base layout; orientation picks the grid (e.g. one column in
// portrait, two in landscape on mobile).

const HUB_MIN_WIDTH_PX = 1600;
const MOBILE_MAX_WIDTH_PX = 768;
const DESKTOP_MIN_WIDTH_PX = 1024;
const MOBILE_USER_AGENT = /Mobi|Android|iPhone|iPad|iPod/i;

// The device the card is running on, from a plain environment object
// (width/height in CSS pixels, pointer flags, touch flag, user agent).
// Pure — no browser access — so it is unit-testable in node. Returns
// { category: "hub" | "desktop" | "mobile", orientation:
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
  if (MOBILE_USER_AGENT.test(userAgent)) category = "mobile";
  else if (width < MOBILE_MAX_WIDTH_PX) category = "mobile";
  else if (coarse && !(width >= HUB_MIN_WIDTH_PX && orientation === "landscape"))
    category = "mobile";
  // A touch screen that is hub-sized and landscape IS the hub, even
  // when a mouse is also attached: the kiosk has a mouse, so a fine
  // pointer is present too, and checking fine first would mis-detect
  // the hub as a desktop. Touch + hub size wins over fine pointer.
  else if (touch && width >= HUB_MIN_WIDTH_PX && orientation === "landscape")
    category = "hub";
  else if (coarse) category = "hub";
  else if (fine) category = "desktop";
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
    min-height: 72px;
    padding: 12px 24px 12px 58px;
    font-size: 24px;
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
    white-space: nowrap;
  }
  .chip[aria-pressed="true"] {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    box-shadow: var(--shadow-accent);
  }
  .status { font-size: 20px; color: var(--muted); padding: 0; }
  .error { font-size: 22px; color: var(--error); padding: 0; }
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
  /* The cooking view has no photo and no metadata line: the photo
     lives only in the list (where it helps you pick a recipe) and
     the metadata does not belong while cooking. So there is no
     .detail-photo and no .detail-meta rule at all. */
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
     lives in the Cook tab, not here. */
  .note-view { display: flex; flex-direction: column; gap: 24px; }
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
    color: var(--accent);
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
  .ingredient .ing-name { flex: 1; min-width: 0; overflow-wrap: break-word; }
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
     others are plain text at half opacity. Tap any step to make it
     current. Step numbers are rendered in the markup (span.step-num),
     not a CSS counter, so a headed step list numbers only the
     navigable steps. */
  .steps { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .step {
    display: flex;
    gap: 18px;
    align-items: flex-start;
    min-height: 76px;
    padding: 18px 16px;
    font-size: 26px;
    line-height: 1.55;
    border-radius: 16px;
    border: 1px solid transparent;
    cursor: pointer;
    opacity: 0.5;
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
  .step-text { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: break-word; }
  .step-header {
    padding: 18px 4px 4px;
    font-size: 24px;
    font-weight: 700;
    color: var(--ink);
  }
  /* A time inside a step is a tappable chip: warm tint, accent text,
     pill shape — it reads as an action, not body text. Sized in em so
     it scales with the step text on every device. */
  .time-chip {
    display: inline-block;
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
  /* The cooking view puts ingredients and steps together: two columns
     on the hub (ingredients left, steps right — the cook needs both
     at once), one stacked column on a phone (ingredients above steps).
     The columns align at the top so a short ingredient list does not
     stretch the steps column. */
  .cook-grid {
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    gap: 40px;
    align-items: start;
  }
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
     it pins to the top once you reach the steps. It pins BELOW Home
     Assistant's own header, not at the very top: the header is 56 px
     tall and stays fixed while the page scrolls, so a top of 0 would
     slide the tracker underneath it and hide it. HA exposes the
     header height as --header-height (56 px here); the 56 px fallback
     covers a Home Assistant that does not define it. It is a card on
     the screen background, so content scrolling under it stays hidden. */
  .step-tracker {
    position: sticky;
    top: var(--header-height, 56px);
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
  .step-position {
    flex: 1;
    text-align: center;
    font-size: 22px;
    font-weight: 700;
    color: var(--ink);
    white-space: nowrap;
  }
  .step-nav { flex: 0 0 auto; }
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
     category + orientation as classes on .screen: dev-hub, dev-desktop
     or dev-mobile, and orient-landscape or orient-portrait. The rules
     above ARE the hub layout (1920x1200 kitchen kiosk: big touch
     targets, multi-column grid); the rules below only adjust for
     desktop and mobile. A card with no device classes (no browser
     environment) renders the hub layout. */
  /* Desktop: a mouse is precise, so targets shrink and the grid gets
     denser — three columns from 1200px, four from 1700px. Hover states
     from the base rules still apply. The cooking view keeps two
     columns (the desktop is wide), at desktop type sizes. */
  .screen.dev-desktop { font-size: 18px; padding: 20px 28px; }
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
  @media (min-width: 1200px) { .screen.dev-desktop .list { grid-template-columns: repeat(3, 1fr); } }
  @media (min-width: 1700px) { .screen.dev-desktop .list { grid-template-columns: repeat(4, 1fr); } }
  /* Mobile: touch targets stay large (a finger is not a mouse), the
     type stays readable, and the grid is one column in portrait so
     nothing overflows or clips. The detail view takes the full width;
     the cooking view stacks (ingredients above steps) with the step
     tracker sticky, so your place stays visible while you scroll. */
  .screen.dev-mobile { font-size: 18px; padding: 16px; }
  .screen.dev-mobile .title { font-size: 26px; }
  .screen.dev-mobile .search { min-height: 56px; font-size: 18px; padding: 10px 16px 10px 48px; background-size: 22px 22px; background-position: 14px center; }
  .screen.dev-mobile .button { min-height: 56px; font-size: 18px; padding: 10px 18px; }
  .screen.dev-mobile .chip { min-height: 48px; font-size: 17px; padding: 6px 16px; }
  /* On a phone the collection chips wrap onto a second row instead of
     scrolling sideways: a cut-off chip at the screen edge is too easy
     to miss, and vertical space is cheap on a scrolling list. The
     wrap only kicks in when the chips do not fit on one row, so wider
     mobile screens (tablets) keep a single row. */
  .screen.dev-mobile .chips { flex-wrap: wrap; overflow-x: visible; }
  .screen.dev-mobile .chips.scrollable { -webkit-mask-image: none; mask-image: none; }
  .screen.dev-mobile .row { min-height: 88px; padding: 12px 14px; gap: 12px; }
  .screen.dev-mobile .thumb { width: 64px; height: 64px; }
  .screen.dev-mobile .skeleton-row { min-height: 88px; }
  .screen.dev-mobile .skeleton-thumb { width: 64px; height: 64px; }
  .screen.dev-mobile .row-name { font-size: 19px; }
  .screen.dev-mobile .row-meta { font-size: 15px; }
  .screen.dev-mobile .detail { max-width: none; }
  .screen.dev-mobile .detail-name { font-size: 28px; }
  .screen.dev-mobile .tab { min-height: 56px; font-size: 18px; padding: 8px 6px; }
  .screen.dev-mobile .cook-grid { grid-template-columns: 1fr; gap: 32px; }
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
  .screen.dev-mobile .list { grid-template-columns: 1fr; }
  /* Landscape phone/tablet: two columns, but only when the viewport is
     wide enough for two readable columns — a narrow landscape phone
     keeps the single column. */
  @media (min-width: 640px) { .screen.dev-mobile.orient-landscape .list { grid-template-columns: repeat(2, 1fr); } }
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
    // line under the editor ("Saved." or an honest error); a failed
    // save keeps the draft, so nothing typed is ever lost.
    this._noteDrafts = new Map();
    this._noteStatus = null; // { text, error } or null
    this._savingNote = false;
    // Rating: a tap saves at once (no separate Save button). The
    // status is the feedback line under the stars. _ratingBusy
    // blocks double-taps while a save is in flight.
    this._ratingStatus = null; // { text, error } or null
    this._ratingBusy = false;
    // Serving scaling is transient by design: the chosen serving
    // count per recipe id, for this cooking session only. It resets
    // when the recipe is opened (see _openRecipe) and never calls
    // update_recipe — it only changes the quantities shown.
    this._scaleServings = new Map();
    this._searchTimer = null;
    this._shell = null; // Built once: title, toolbar, chips, status, body.
    this._detailEl = null;
    this._device = null; // { category, orientation } from detectDevice, or null outside a browser.
    this._resizeBound = null;
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
  }

  _onResize() {
    this._applyDevice();
    this._updateChipsFade();
  }

  // Detect the device and carry it as classes on the screen element:
  // dev-hub, dev-desktop or dev-mobile, plus orient-landscape or
  // orient-portrait. The CSS below keys the adaptive layout off these
  // classes; the base rules are the hub layout. Outside a browser
  // (node tests) there is no environment to read, so the classes are
  // left off and the base layout stands.
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
      "dev-mobile",
      "orient-landscape",
      "orient-portrait"
    );
    this._shell.classList.add(
      `dev-${device.category}`,
      `orient-${device.orientation}`
    );
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
    this._detailTab = "cook";
    // Fresh open, fresh session: the serving scaler resets to the
    // recipe's stored servings (it is transient by design), and the
    // save feedback lines clear. The note draft is NOT cleared — an
    // unsaved note survives leaving the recipe and coming back, the
    // same way checked ingredients and the current step do.
    this._scaleServings.delete(id);
    this._noteStatus = null;
    this._ratingStatus = null;
    this._savingNote = false;
    this._ratingBusy = false;
    this._render();
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
  // bridge's start action. That action does not exist yet (the bridge
  // only operates on timers that already exist) — until it does, the
  // tap reports that honestly instead of pretending a timer started.
  async _startTimer(seconds, label) {
    const total = Number(seconds);
    if (!Number.isFinite(total) || total <= 0) return;
    this._timerStatus = "";
    this._render();
    try {
      const minutes = Math.floor(total / 60);
      const secs = total % 60;
      await this._hass.callWS({
        type: "call_service",
        domain: "satellite_timers",
        service: "start_timer",
        service_data: {
          minutes,
          seconds: secs,
          name: this._selected ? this._selected.name : undefined,
        },
        return_response: false,
      });
      this._timerStatus = `Timer started: ${label}.`;
    } catch (err) {
      this._timerStatus =
        "Couldn't start the timer — the timer bridge doesn't offer a start action yet.";
    }
    this._render();
  }

  // -- note, rating, serving scaling ------------------------------------
  //
  // The Notes tab edits the note and the rating; the Cook tab scales
  // servings. All three read from the loaded recipe and touch nothing
  // else.

  // The serving count currently shown for a recipe: the cook's chosen
  // count, or the recipe's stored servings when nothing is chosen.
  _targetServings(recipe) {
    const stored = parseServings(recipe.servings);
    if (!stored) return null;
    const chosen = this._scaleServings.get(recipe.id);
    return typeof chosen === "number" && chosen > 0 ? chosen : stored;
  }

  // The factor to multiply displayed quantities by: chosen servings
  // over stored servings, or null when the recipe has no numeric
  // servings (then there is no scaler at all).
  _scaleFactor(recipe) {
    const stored = parseServings(recipe.servings);
    if (!stored) return null;
    return this._targetServings(recipe) / stored;
  }

  // A copy of an ingredient row with its quantity scaled for display.
  // Section headings pass through untouched; a row with no quantity
  // is returned as-is. The original row is never mutated.
  _scaledItem(item, factor) {
    if (!factor || factor === 1 || !item || item.type === "section") return item;
    if (!item.quantity) return item;
    return { ...item, quantity: scaleQuantity(item.quantity, factor) };
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
      this._applyUpdatedRecipe(result, { note });
      this._noteDrafts.delete(recipe.id);
      this._noteStatus = { text: "Saved.", error: false };
    } catch (err) {
      this._noteStatus = {
        text: "Couldn't save the note — your text is still here, try again.",
        error: true,
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
      this._applyUpdatedRecipe(result, { rating });
      this._ratingStatus = { text: "Saved.", error: false };
    } catch (err) {
      this._ratingStatus = {
        text: "Couldn't save the rating — try again.",
        error: true,
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
  // ingredients, entries and steps stay exactly as they were. When
  // there is no usable response (an older integration, a bare
  // response), fall back to the value that was just saved: the call
  // succeeding means the server accepted it. Either way the list row
  // stays in sync too.
  _applyUpdatedRecipe(result, fallback) {
    const recipe = this._selected;
    if (!recipe) return;
    const updated = result && result.recipe ? normalizeRecipe(result.recipe) : null;
    const next =
      updated && updated.id === recipe.id
        ? { ...recipe, note: updated.note, rating: updated.rating }
        : { ...recipe, ...fallback };
    const index = this._recipes.findIndex((item) => item.id === recipe.id);
    if (index >= 0) this._recipes[index] = next;
    this._selected = next;
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
    if (/timeout/i.test(message)) {
      return "AnyList took too long to answer — check the connection and try again.";
    }
    return "Could not load recipes from AnyList — try again.";
  }

  // -- events ---------------------------------------------------------------

  _onInput(event) {
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
      this._detailTab = target.dataset.tab || "cook";
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
      this._render();
      return;
    }
    if (action === "clear-checks") {
      if (!this._selected) return;
      this._checked.delete(this._selected.id);
      this._render();
      return;
    }
    if (action === "step") {
      if (!this._selected) return;
      const index = Number(target.dataset.stepIndex);
      if (!Number.isFinite(index)) return;
      this._currentStep.set(this._selected.id, index);
      this._render();
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
      // makes no server call at all.
      if (!this._selected) return;
      const base = parseServings(this._selected.servings);
      if (!base) return;
      const current = this._targetServings(this._selected);
      const next =
        action === "scale-down"
          ? Math.max(1, current - 1)
          : current + 1;
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
    this._applyDevice();
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
    // Cooking mode: the detail view is a cooking tool, not a recipe
    // page. No photo hero and no metadata line — the photo lives only
    // in the list (where it helps you pick a recipe) and the metadata
    // (times, servings, source) does not belong in the cooking view at
    // all. The name is a compact label, not a display title. Two tabs:
    // Cook (ingredients + steps together) and Notes (editable).
    const tabs = [
      ["cook", "Cook"],
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
        <h1 class="detail-name">${escapeHtml(recipe.name)}</h1>
        ${tabBar}
        <div class="tab-panel">${this._detailTabHtml(recipe)}</div>
      </div>`;
  }

  // The active tab's panel. Cook is the default tab: ingredients and
  // steps together (two columns on the hub, ingredients above steps on
  // a phone), because a cook needs both at once. Notes is the editable
  // note. There is no Details tab: metadata (times, servings, source)
  // does not belong in the cooking view.
  _detailTabHtml(recipe) {
    if (this._detailTab === "notes") {
      return this._notesHtml(recipe);
    }
    return this._cookHtml(recipe);
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
    // number; a freeform servings string ("4 servings", "2 (bowls)")
    // has no clean base to scale from.
    const baseServings = parseServings(recipe.servings);
    const factor = baseServings ? this._scaleFactor(recipe) : null;
    const targetServings = baseServings ? this._targetServings(recipe) : null;
    const isScaled = baseServings !== null && targetServings !== baseServings;
    const scalerHtml = baseServings
      ? `<div class="scaler" role="group" aria-label="Servings">
          <span class="scaler-label">Serves</span>
          <button class="button scaler-btn" data-action="scale-down" ${targetServings <= 1 ? "disabled" : ""} aria-label="Fewer servings">−</button>
          <span class="scaler-count" aria-live="polite">${targetServings}</span>
          <button class="button scaler-btn" data-action="scale-up" aria-label="More servings">+</button>
          ${isScaled ? `<button class="button small ghost" data-action="scale-reset">Reset to ${baseServings}</button>` : ""}
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
            const display = this._scaledItem(item, factor);
            return this._ingredientRowHtml(display, ingIndex, checked.has(ingIndex));
          })
          .join("")
      : recipe.ingredients
          .map((item, index) => this._ingredientRowHtml(this._scaledItem(item, factor), index, checked.has(index)))
          .join("");
    const steps = this._navigableSteps(recipe);
    const current = this._currentStepIndex(recipe.id, steps.length);
    const stepNav =
      steps.length > 0
        ? `<div class="step-tracker">
            <button class="button step-nav" data-action="step-prev" ${current === 0 ? "disabled" : ""} aria-label="Previous step">← Prev</button>
            <span class="step-position" aria-live="polite">Step ${current + 1} of ${steps.length}</span>
            <button class="button step-nav" data-action="step-next" ${current === steps.length - 1 ? "disabled" : ""} aria-label="Next step">Next →</button>
          </div>`
        : "";
    // Steps render in full order (headers interleaved as section
    // labels). Only the numbered steps are navigable; the current one
    // is highlighted and the rest are dimmed. Tapping a step makes it
    // current.
    let stepNumber = 0;
    const stepsHtml = recipe.steps
      .map((step) => {
        const rendered = renderStepText(step);
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
    return `
      <div class="cook-grid">
        <section class="cook-ingredients" aria-label="Ingredients">
          <div class="cook-head">
            <h2 class="section-title">Ingredients</h2>
            <span class="cook-count">${checkedCount} of ${rows.length} gathered</span>
            ${checkedCount > 0 ? `<button class="button small ghost" data-action="clear-checks">Start over</button>` : ""}
          </div>
          ${scalerHtml}
          ${ingredientsHtml ? `<div class="ingredients">${ingredientsHtml}</div>` : `<div class="status">No ingredients listed.</div>`}
        </section>
        <section class="cook-steps" aria-label="Steps">
          <div class="cook-head">
            <h2 class="section-title">Steps</h2>
          </div>
          ${stepNav}
          ${timerStatus}
          ${stepsHtml ? `<ol class="steps">${stepsHtml}</ol>` : `<div class="status">No steps listed.</div>`}
        </section>
      </div>`;
  }

  // One checkable ingredient row: a full-row button with a checkbox
  // square. Tap to cross it off (tap again to un-cross). A checked
  // row is struck through and dimmed; the checkbox fills with a tick.
  _ingredientRowHtml(item, index, isChecked) {
    const display = item.name || item.raw;
    const qty = item.quantity
      ? `<span class="qty">${escapeHtml(item.quantity)}</span>`
      : `<span class="qty"></span>`;
    const note = item.note ? ` <span class="ing-note">${escapeHtml(item.note)}</span>` : "";
    return `<button class="ingredient${isChecked ? " checked" : ""}" data-action="toggle-ingredient" data-index="${index}" aria-pressed="${isChecked ? "true" : "false"}">
      <span class="check" aria-hidden="true">${isChecked ? "✓" : ""}</span>
      ${qty}<span class="ing-name">${escapeHtml(display)}${note}</span>
    </button>`;
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
      ? `<span class="note-status${this._noteStatus.error ? " error" : ""}" role="status">${escapeHtml(this._noteStatus.text)}</span>`
      : "";
    const rating = recipe.rating || 0;
    const stars = [1, 2, 3, 4, 5]
      .map(
        (value) =>
          `<button class="star${value <= rating ? " filled" : ""}" data-action="rate" data-rating="${value}" ${this._ratingBusy ? 'disabled="disabled"' : ""} aria-label="Rate ${value} out of 5">${value <= rating ? "★" : "☆"}</button>`
      )
      .join("");
    const ratingStatus = this._ratingStatus
      ? `<span class="rating-status${this._ratingStatus.error ? " error" : ""}" role="status">${escapeHtml(this._ratingStatus.text)}</span>`
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
    deriveCollections,
    formatMeta,
    formatMetaHtml,
    formatDuration,
    formatServings,
    formatStars,
    parseServings,
    scaleQuantity,
    renderStepText,
    renderIngredientRow,
    sortRecipes,
    filterByCollection,
    detectDevice,
    readDeviceEnv,
    AnyListRecipeViewCard,
  };
}

