// Tests for the new Recipes card (custom:anylist-recipe-view, Phase 2
// Wave W7, from scratch). The card needs a DOM to load, so the pure
// helpers and state classes are exercised here through a minimal
// harness: stub the browser globals just enough for the module to
// define itself. Rendering, viewports, the real bridge, and the
// screensaver guard legs are proven by the rig legs in
// hidden_files/redesign/w7-legs/ (the browser is the only place those
// can be measured).
//
// Fixture-count tests read the rig fixtures (recipe382/2500-build)
// when present (the workspace default, overridable with
// RECIPE_FIXTURE_DIR). When the checkout is absent the fixture tests
// skip with a clear note — the repo's own tests never fail for a
// missing sibling checkout.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

globalThis.HTMLElement = class {
  attachShadow() {
    return { addEventListener: () => {} };
  }
};
globalThis.customElements = { define: () => {} };

const {
  SCHEMA_VERSION,
  DEFAULT_RECIPES_URL,
  RECIPE_REVALIDATE_MS,
  SEARCH_DEBOUNCE_MS,
  SEARCH_WEIGHTS,
  ERS1_ATTEMPTS,
  ERS1_DELAYS_MS,
  REPROBE_MS,
  VOICE_STEP_ENTITY_ID,
  RECIPE_SESSION_KEY,
  PIP_STARTING_TIMEOUT_MS,
  MAX_TIMER_DURATION_SECONDS,
  TIMER_CONFIRM_SETTLE_MS,
  CARD_CSS,
  normalizeSearchText,
  searchWords,
  levenshteinWithinOne,
  tokenMatchesWords,
  ingredientGroups,
  ingredientEntryName,
  recipeSearchFields,
  RecipeSearchIndex,
  RecipeSearch,
  VersionGateError,
  parseCanonicalRecipes,
  normalizeRecipe,
  deriveCollections,
  escapeHtml,
  extractDurations,
  splitStepText,
  parseStep,
  navigableSteps,
  parseLeadingAmount,
  formatAmount,
  scaleQuantityText,
  parseServings,
  formatServings,
  emptyRecipeSession,
  parseRecipeSession,
  serializeRecipeSession,
  runWithRetry,
  RecipeFreshness,
  formatTimeOfDay,
  formatExportStamp,
  RecipeErrorSlot,
  RecipeReProbe,
  isUsableSaveResponse,
  RecipeNoteSaver,
  noteSaveState,
  RecipeTimerLink,
  newCommandId,
  timerStartFailureText,
  formatTimerDuration,
  AnylistRecipeView,
} = require("./anylist-recipe-view-card.js");

const FIXTURE_DIR =
  process.env.RECIPE_FIXTURE_DIR ?? "/home/hatch/workspace/ha-repro";

function loadFixture(name) {
  const file = path.join(FIXTURE_DIR, `recipe${name}-build`, "recipes.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")).recipes.map(normalizeRecipe);
}

// ---------------------------------------------------------------------------
// A — constants (design-record legs)
// ---------------------------------------------------------------------------

test("constants name their settled values", () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(DEFAULT_RECIPES_URL, "/local/recipes.json");
  assert.equal(RECIPE_REVALIDATE_MS, 5 * 60 * 1000);
  assert.equal(SEARCH_DEBOUNCE_MS, 250);
  assert.deepEqual(SEARCH_WEIGHTS, {
    title: 100,
    ingredient: 60,
    step: 40,
    description: 20,
    notes: 10,
    source: 5,
  });
  assert.equal(ERS1_ATTEMPTS, 4);
  assert.deepEqual(ERS1_DELAYS_MS, [2000, 8000, 30000]);
  assert.equal(REPROBE_MS, 60 * 1000);
  assert.equal(VOICE_STEP_ENTITY_ID, "sensor.family_hub_voice_step_command");
  assert.equal(RECIPE_SESSION_KEY, "family-hub:recipe:state");
  assert.equal(PIP_STARTING_TIMEOUT_MS, 10 * 1000);
  // B1: the bridge caps timers at 24 h (bridge const.py: 86400 s).
  assert.equal(MAX_TIMER_DURATION_SECONDS, 86400);
  // NB1: the chip-start confirm settle delay is a named constant.
  assert.equal(TIMER_CONFIRM_SETTLE_MS, 250);
});

// ---------------------------------------------------------------------------
// B — normalisation + matcher
// ---------------------------------------------------------------------------

test("normalizeSearchText: NFKD + strip diacritics + lowercase + collapse", () => {
  assert.equal(normalizeSearchText("Crème Brûlée"), "creme brulee");
  assert.equal(normalizeSearchText("  SIMPLE   Tomato\tSoup "), "simple tomato soup");
  assert.equal(normalizeSearchText(null), "");
  assert.equal(normalizeSearchText(42), "42");
});

test("levenshteinWithinOne: plain Levenshtein ≤ 1", () => {
  assert.equal(levenshteinWithinOne("biryani", "biryani"), true);
  assert.equal(levenshteinWithinOne("biryanni", "biryani"), true); // insertion
  assert.equal(levenshteinWithinOne("biryani", "biryani".slice(0, -1)), true); // deletion
  assert.equal(levenshteinWithinOne("biryani", "biryanti"), true); // substitution
  assert.equal(levenshteinWithinOne("biryani", "biryain"), false); // transposition is 2
  assert.equal(levenshteinWithinOne("soup", "soups"), true);
  assert.equal(levenshteinWithinOne("a", "abc"), false);
});

test("tokenMatchesWords: substring or one edit", () => {
  assert.equal(tokenMatchesWords("tomato", ["tomatoes", "sauce"]), true);
  assert.equal(tokenMatchesWords("biryanni", ["biryani"]), true);
  assert.equal(tokenMatchesWords("zzzzz", ["tomato", "sauce"]), false);
});

test("settled counts reproduce the measured counts (§05.8)", (t) => {
  const recipes382 = loadFixture("382");
  const recipes2500 = loadFixture("2500");
  if (!recipes382 || !recipes2500) {
    t.skip("rig fixtures absent — RECIPE_FIXTURE_DIR has no recipe382/2500-build");
    return;
  }
  const index382 = new RecipeSearchIndex(recipes382);
  const index2500 = new RecipeSearchIndex(recipes2500);
  assert.equal(index382.search("biryani").length, 6);
  assert.equal(index2500.search("biryani").length, 14);
  assert.equal(index382.search("chickpea").length, 46);
  assert.equal(index2500.search("chickpea").length, 336);
  assert.equal(index382.search("biryanni").length, 6);
  assert.equal(index2500.search("biryanni").length, 14);
  assert.equal(index2500.search("Simple Tomato Soup").length, 2);
  assert.equal(index2500.search("Crème Brûlée").length, 1);
  // Zero-result state: a query with no match settles to zero, not an error.
  assert.equal(index2500.search("qqqxxyy zzz").length, 0);
});

test("search: AND-across-words, OR-across-fields, title rank, no name dedupe", () => {
  const recipes = [
    normalizeRecipe({ id: "a", name: "Tomato Soup", ingredients: [], preparation_steps: ["Simmer the tomatoes."], note: "", source_name: "" }),
    normalizeRecipe({ id: "b", name: "Tomato Soup", ingredients: [{ name: "Basil", quantity: "", note: "", raw_ingredient: "" }], preparation_steps: [], note: "", source_name: "" }),
    normalizeRecipe({ id: "c", name: "Basil Pasta", ingredients: [{ name: "Tomato", quantity: "", note: "", raw_ingredient: "" }], preparation_steps: [], note: "", source_name: "" }),
  ];
  const index = new RecipeSearchIndex(recipes);
  // "tomato soup": both tokens must match (AND); each may match in a
  // different field (OR). Recipe c matches "tomato" but not "soup".
  const both = index.search("tomato soup");
  assert.deepEqual(both.map((r) => r.recipe.id), ["a", "b"]);
  // Title outranks ingredient: a (title match) scores above c.
  const ranked = index.search("tomato");
  assert.equal(ranked[0].recipe.id, "a");
  assert.ok(ranked[0].score > ranked[ranked.length - 1].score);
  // Same name twice: never deduped by name.
  assert.equal(index.search("Tomato Soup").length, 2);
});

test("index build and per-keystroke filter meet the §05.8 bounds", (t) => {
  const recipes = loadFixture("2500");
  if (!recipes) {
    t.skip("rig fixture absent — RECIPE_FIXTURE_DIR has no recipe2500-build");
    return;
  }
  const index = new RecipeSearchIndex(recipes);
  assert.ok(index.buildMs < 1000, `index build ${index.buildMs} ms exceeds the 1 s bound`);
  // Warm the hot paths once (JIT), then take the best of three timed
  // runs per query: the bound is on the matcher's cost, and this
  // shared VM's load jitter is not the matcher's cost.
  index.search("pasta");
  for (const query of ["biryani", "chickpea", "pasta", "tomato", "zzzzz"]) {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const startedAt = Date.now();
      index.search(query);
      best = Math.min(best, Date.now() - startedAt);
    }
    assert.ok(best <= 50, `filter "${query}" took ${best} ms at best — over the 50 ms bound (this machine is the proxy; the Pi 5 leg re-measures)`);
  }
});

test("RecipeSearch: debounced, settled count only", async () => {
  let scheduled = null;
  const index = new RecipeSearchIndex([
    normalizeRecipe({ id: "a", name: "Tomato Soup", ingredients: [], preparation_steps: [] }),
    normalizeRecipe({ id: "b", name: "Pasta", ingredients: [], preparation_steps: [] }),
  ]);
  let settled = null;
  const search = new RecipeSearch(index, {
    onSettled: (results, info) => { settled = { count: results.length, query: info.query }; },
    schedule: (fn) => { scheduled = fn; return 1; },
    cancel: () => { scheduled = null; },
  });
  assert.equal(search.settledCount, 2);
  search.setQuery("tomato");
  assert.equal(search.settledCount, 2, "the count does not move before the debounce settles");
  assert.equal(typeof scheduled, "function");
  scheduled();
  assert.equal(search.settledCount, 1);
  assert.deepEqual(settled, { count: 1, query: "tomato" });
  // Rebuilding on revalidation preserves the query.
  search.rebuild(index.entries.map((e) => e.recipe));
  assert.equal(search.query, "tomato");
  assert.equal(search.settledCount, 1);
});

// ---------------------------------------------------------------------------
// C — canonical gate + headings
// ---------------------------------------------------------------------------

test("parseCanonicalRecipes gates on schema_version (A2)", () => {
  const good = {
    schema_version: 1,
    format: "anylist-canonical/1",
    exported_at: "2026-11-14T12:00:00+00:00",
    recipe_count: 1,
    recipes: [{ id: "r1", name: "Pasta", ingredients: [], preparation_steps: [] }],
  };
  const parsed = parseCanonicalRecipes(JSON.stringify(good));
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.exportedAt, "2026-11-14T12:00:00+00:00");
  assert.equal(parsed.recipes.length, 1);
  assert.throws(() => parseCanonicalRecipes({ recipes: [] }), VersionGateError);
  assert.throws(() => parseCanonicalRecipes({ schema_version: 2, recipes: [] }), VersionGateError);
  assert.throws(() => parseCanonicalRecipes({ schema_version: 0, recipes: [] }), VersionGateError);
  assert.throws(() => parseCanonicalRecipes({}), /not a canonical export/);
});

test("ingredientGroups renders headings from BOTH shapes (§05.17)", () => {
  const fork = normalizeRecipe({
    id: "f", name: "Pasta",
    ingredients: [{ name: "Penne", quantity: "500 g", note: "", raw_ingredient: "" }],
    ingredient_entries: [
      { type: "section", name: "Pasta" },
      { type: "ingredient", name: "Penne", quantity: "500 g", note: "", raw_ingredient: "" },
      { type: "section", name: "Sauce" },
      { type: "ingredient", name: "Tomato", quantity: "2", note: "", raw_ingredient: "" },
    ],
    preparation_steps: [],
  });
  assert.deepEqual(ingredientGroups(fork).map((g) => g.heading), ["Pasta", "Sauce"]);
  assert.deepEqual(ingredientGroups(fork)[0].items.map((i) => i.name), ["Penne"]);

  const upstream = normalizeRecipe({
    id: "u", name: "Pasta",
    ingredients: [
      { id: "h1", is_heading: true, name: "Pasta" },
      { id: "i1", name: "Penne", quantity: "500 g", note: "", raw_ingredient: "" },
      { id: "h2", is_heading: true, name: "Sauce" },
      { id: "i2", name: "Tomato", quantity: "2", note: "", raw_ingredient: "" },
    ],
    preparation_steps: [],
  });
  assert.deepEqual(ingredientGroups(upstream).map((g) => g.heading), ["Pasta", "Sauce"]);
  assert.deepEqual(ingredientGroups(upstream)[1].items.map((i) => i.name), ["Tomato"]);

  const plain = normalizeRecipe({
    id: "p", name: "Soup",
    ingredients: [{ name: "Water", quantity: "1 l", note: "", raw_ingredient: "" }],
    preparation_steps: [],
  });
  assert.deepEqual(ingredientGroups(plain), [{ heading: null, items: plain.ingredients }]);

  // A bare-string ingredient is an ingredient, never dropped.
  const stringy = normalizeRecipe({
    id: "s", name: "Salad",
    ingredients: ["Feta cheese", { name: "Olives", quantity: "", note: "", raw_ingredient: "" }],
    preparation_steps: [],
  });
  assert.equal(ingredientGroups(stringy)[0].items.length, 2);
  assert.equal(ingredientEntryName("Feta cheese"), "Feta cheese");
});

test("deriveCollections deduplicates by id and sorts by name", () => {
  const recipes = [
    normalizeRecipe({ id: "a", name: "A", collections: [{ id: "c2", name: "Pasta" }, { id: "c1", name: "Soups" }] }),
    normalizeRecipe({ id: "b", name: "B", collections: [{ id: "c2", name: "Pasta" }] }),
  ];
  assert.deepEqual(deriveCollections(recipes).map((c) => c.name), ["Pasta", "Soups"]);
});

// ---------------------------------------------------------------------------
// D — step text: duration chips + scaler
// ---------------------------------------------------------------------------

test("extractDurations: ranges yield the UPPER bound", () => {
  assert.deepEqual(extractDurations("cook 6 to 8 minutes"), [{ label: "6 to 8 minutes", seconds: 480 }]);
  assert.deepEqual(extractDurations("simmer 6–8 minutes"), [{ label: "6–8 minutes", seconds: 480 }]);
  assert.deepEqual(extractDurations("rest 60 seconds"), [{ label: "60 seconds", seconds: 60 }]);
  assert.deepEqual(extractDurations("bake 1 hour"), [{ label: "1 hour", seconds: 3600 }]);
  assert.deepEqual(extractDurations("half an hour"), []);
  assert.deepEqual(extractDurations("no times here"), []);
});

test("splitStepText + parseStep: chips in text, headers never numbered", () => {
  const segments = splitStepText("Warm the oil, cook 60 seconds until fragrant.");
  assert.equal(segments.filter((s) => s.chip).length, 1);
  assert.equal(segments.find((s) => s.chip).chip.seconds, 60);
  assert.equal(parseStep("# Sauce").header, true);
  assert.equal(parseStep("Simmer gently.").header, false);
  const steps = navigableSteps(
    normalizeRecipe({ id: "r", name: "R", preparation_steps: ["# Sauce", "Simmer 5 minutes.", "Serve."] }),
  );
  assert.deepEqual(steps.map((s) => s.number), [1, 2]);
  assert.deepEqual(steps.map((s) => s.index), [1, 2]);
});

// B1: a duration above the bridge cap (24 h) renders as plain text,
// never as a tappable chip; exactly 24 h still chips. The parser stays
// pure — extractDurations still reports the phrase, because parsing and
// startability are different questions.
test("B1: over-cap durations are plain text, never chips; 24 h still chips", () => {
  const over = splitStepText("Marinate the ribs for 48 hours.");
  assert.equal(over.filter((s) => s.chip).length, 0);
  assert.equal(over.map((s) => s.text ?? "").join(""), "Marinate the ribs for 48 hours.");
  assert.deepEqual(extractDurations("Marinate the ribs for 48 hours."), [{ label: "48 hours", seconds: 172800 }]);
  const over25 = splitStepText("Bake for 25 hours.");
  assert.equal(over25.filter((s) => s.chip).length, 0);
  const exact = splitStepText("Bake for 24 hours.");
  assert.equal(exact.filter((s) => s.chip).length, 1);
  assert.equal(exact.find((s) => s.chip).chip.seconds, 86400);
  const under = splitStepText("Bake for 4 hours.");
  assert.equal(under.find((s) => s.chip).chip.seconds, 14400);
  // The failed-call text for an over-cap duration surfaces the
  // service's own reason, never the generic "service is back" lie.
  const capText = timerStartFailureText({ kind: "failed-call", seconds: 172800, name: "Ribs" });
  assert.match(capText, /A timer can run from 1 second to 24 hours/);
  assert.match(capText, /48 hours/);
  assert.doesNotMatch(capText, /service is back/);
  assert.doesNotMatch(capText, /Timers view instead/);
  // A non-cap failed call keeps the existing generic text.
  const transient = timerStartFailureText({ kind: "failed-call", seconds: 60, name: "Pasta" });
  assert.match(transient, /Timers view instead/);
});

// B2: " servings" is appended only to a bare number or a range; any
// other stored string renders as-is (no doubled unit).
test("B2: formatServings appends the unit only to bare numbers and ranges", () => {
  assert.equal(formatServings("4"), "4 servings");
  assert.equal(formatServings("4–6"), "4–6 servings");
  assert.equal(formatServings("4-6"), "4–6 servings".replace("–", "-"));
  assert.equal(formatServings("4 - 6"), "4 - 6 servings");
  assert.equal(formatServings("Serves 4"), "Serves 4");
  assert.equal(formatServings("Serves 1"), "Serves 1");
  assert.equal(formatServings("Makes 24 cookies"), "Makes 24 cookies");
  assert.equal(formatServings("Makes 8 servings"), "Makes 8 servings");
  assert.equal(formatServings(""), "");
  assert.equal(formatServings(null), "");
});

// B2, fixture sweep: across the 2,500-recipe fixture no rendered
// servings string may double the unit.
test("B2: no recipe in the 2,500 fixture renders a doubled unit", (t) => {
  const recipes = loadFixture("2500");
  if (!recipes) { t.skip("2500 fixture not present on this checkout"); return; }
  let bare = 0, range = 0, other = 0;
  for (const recipe of recipes) {
    if (!recipe.servings) continue;
    const rendered = formatServings(recipe.servings);
    assert.doesNotMatch(rendered, /servings servings/);
    if (/^\d+(?:\.\d+)?$/.test(String(recipe.servings).trim())) bare += 1;
    else if (/^\d+(?:\.\d+)?\s*(?:-|–|—)\s*\d+(?:\.\d+)?$/.test(String(recipe.servings).trim())) range += 1;
    else other += 1;
  }
  assert.equal(bare, 1186);
  assert.equal(range, 200);
  assert.equal(other, 1114);
});

// B3: the current step's duration chip keeps the orange text on the
// white pill — the CSS must not set a white label on a white pill.
test("B3: current-step time chip is orange-on-white in the card CSS", () => {
  assert.match(CARD_CSS, /\.time-chip \{[^}]*background: #FFFFFF; color: #C2410C;/);
  const currentRule = /\.steps \.step\.current \.time-chip \{([^}]*)\}/.exec(CARD_CSS);
  assert.ok(currentRule, "no current-step time-chip rule in the CSS");
  assert.match(currentRule[1], /border-color: #FFFFFF/);
  // A bare `color:` declaration (not border-color) would be the
  // white-on-white label again.
  assert.doesNotMatch(currentRule[1], /(?:^|;)\s*color:/);
});

// NB5: a sub-0.02 fraction with no whole part renders as a short
// decimal, never "0" — the quantity is kept.
test("NB5: formatAmount never erases a small quantity to 0", () => {
  assert.equal(formatAmount(0.02), "0.02");
  assert.equal(formatAmount(0.01), "0.01");
  assert.equal(formatAmount(0), "0");
  assert.equal(formatAmount(0.5), "½");
  assert.equal(formatAmount(0.25), "¼");
  assert.equal(scaleQuantityText("1 cup", 0.01), "0.01 cup");
});

test("scaleQuantityText: fractions, ranges, compounds, passthrough", () => {
  assert.equal(scaleQuantityText("1 1/2 cups", 2), "3 cups");
  assert.equal(scaleQuantityText("2–3 cups", 2), "4–6 cups");
  assert.equal(scaleQuantityText("1 cup + 2 tbsp", 0.5), "½ cup + 1 tbsp");
  assert.equal(scaleQuantityText("½ tsp", 2), "1 tsp");
  assert.equal(scaleQuantityText("a pinch", 2), "a pinch");
  assert.equal(scaleQuantityText("500 g", 1), "500 g");
  assert.equal(formatAmount(1.5), "1 ½");
  assert.equal(formatAmount(2), "2");
  assert.equal(formatAmount(0.25), "¼");
  assert.deepEqual(parseLeadingAmount("1 1/2 cups"), { value: 1.5, rest: "cups", matched: "1 1/2" });
  assert.equal(parseServings("4 servings"), 4);
  assert.equal(parseServings(""), null);
});

// ---------------------------------------------------------------------------
// E — session
// ---------------------------------------------------------------------------

test("RecipeSession round-trips; garbage parses to empty", () => {
  const session = { openId: "r1", step: 3, lastVoiceSequence: 7, scrollY: 120 };
  assert.deepEqual(parseRecipeSession(serializeRecipeSession(session)), session);
  assert.deepEqual(parseRecipeSession("not json{"), emptyRecipeSession());
  assert.deepEqual(parseRecipeSession(null), emptyRecipeSession());
  assert.equal(parseRecipeSession({ openId: "r1", step: 0 }).step, 1);
});

// ---------------------------------------------------------------------------
// F — freshness + ladder
// ---------------------------------------------------------------------------

test("runWithRetry spends the ERS-1 ladder [2, 8, 30] s", async () => {
  const delays = [];
  let attempts = 0;
  await assert.rejects(
    runWithRetry(
      () => { attempts += 1; throw new Error("boom"); },
      { sleep: (ms) => { delays.push(ms); return Promise.resolve(); } },
    ),
  );
  assert.equal(attempts, ERS1_ATTEMPTS);
  assert.deepEqual(delays, [2000, 8000, 30000]);
  attempts = 0;
  const value = await runWithRetry(
    () => { attempts += 1; if (attempts < 3) throw new Error("boom"); return "ok"; },
    { sleep: () => Promise.resolve() },
  );
  assert.equal(value, "ok");
  assert.equal(attempts, 3);
});

test("RecipeFreshness: load retries, revalidate keeps last good, tick at 5 min", async () => {
  const now = { ms: 1000000 };
  let calls = 0;
  const freshness = new RecipeFreshness({
    fetch: async () => {
      calls += 1;
      if (calls <= 2) throw new Error("down");
      return { recipes: [{ id: "r1", name: "Pasta" }], exportedAt: null };
    },
    now: () => now.ms,
    sleep: () => Promise.resolve(),
  });
  let seen = null;
  freshness.onData = (data) => { seen = data; };
  await freshness.load();
  assert.equal(calls, 3);
  assert.equal(seen.recipes.length, 1);
  assert.equal(freshness.lastFetchMs, 1000000);

  // Background revalidation failure keeps last-good data.
  let errorSeen = null;
  freshness.onError = (error, info) => { errorSeen = info; };
  freshness.fetch = async () => { throw new Error("down again"); };
  await freshness.revalidate();
  assert.equal(freshness.lastGood.recipes.length, 1);
  assert.equal(errorSeen.keptLastGood, true);

  // The tick fires at ≥ 5 min, not before.
  let refetched = 0;
  freshness.fetch = async () => { refetched += 1; return { recipes: [], exportedAt: null }; };
  now.ms += 4 * 60 * 1000;
  assert.equal(freshness.tick(), false);
  now.ms += 60 * 1000 + 1;
  assert.equal(freshness.tick(), true);
  assert.equal(refetched, 1);

  // The version gate is not retryable: one attempt, then it throws.
  let gateCalls = 0;
  const gated = new RecipeFreshness({
    fetch: async () => { gateCalls += 1; throw new VersionGateError(2); },
    sleep: () => Promise.resolve(),
  });
  await assert.rejects(gated.load(), VersionGateError);
  assert.equal(gateCalls, 1);
});

test("RecipeFreshness.revalidate: returns whether fresh data was accepted (D-W7-F12)", async () => {
  // A failed revalidation keeps last-good data — so lastGood existing
  // can never be the re-probe's "recovered" signal. The boolean is.
  const freshness = new RecipeFreshness({
    fetch: async () => ({ recipes: [{ id: "r1", name: "Pasta" }], exportedAt: null }),
    sleep: () => Promise.resolve(),
  });
  await freshness.load();
  freshness.fetch = async () => { throw new Error("down"); };
  assert.equal(await freshness.revalidate(), false);
  assert.equal(freshness.lastGood.recipes.length, 1);
  freshness.fetch = async () => ({ recipes: [{ id: "r1", name: "Pasta" }], exportedAt: null });
  assert.equal(await freshness.revalidate(), true);
});

test("formatTimeOfDay + formatExportStamp: fetch age shown, export age never invented", () => {
  // Timezone-independent: the hour depends on the machine's zone,
  // the minutes and the shape do not.
  assert.match(formatTimeOfDay(Date.parse("2026-11-14T14:14:00-08:00")), /^\d{1,2}:14 [AP]M$/);
  assert.equal(formatExportStamp(null), "");
  assert.equal(formatExportStamp(""), "");
  assert.match(formatExportStamp("2026-11-14T22:14:00Z"), /Exported/);
});

// ---------------------------------------------------------------------------
// I — honest save + error slot + re-probe
// ---------------------------------------------------------------------------

test("isUsableSaveResponse: {} is NOT a confirmed save", () => {
  assert.equal(isUsableSaveResponse({}, { recipeId: "r1", note: "hi" }), false);
  // The W2 stub shape {"recipe": {}} carries neither the id nor the
  // saved field — it confirms nothing either.
  assert.equal(isUsableSaveResponse({ recipe: {} }, { recipeId: "r1", note: "hi" }), false);
  assert.equal(isUsableSaveResponse(null, { recipeId: "r1" }), false);
  assert.equal(isUsableSaveResponse({ recipe: { id: "r1", note: "hi" } }, { recipeId: "r1", note: "hi" }), true);
  assert.equal(isUsableSaveResponse({ recipe: { id: "r1", note: "other" } }, { recipeId: "r1", note: "hi" }), false);
  assert.equal(isUsableSaveResponse({ recipe: { id: "r2", note: "hi" } }, { recipeId: "r1", note: "hi" }), false);
  // An echo that omits the saved field is accepted (partial echo).
  assert.equal(isUsableSaveResponse({ recipe: { id: "r1" } }, { recipeId: "r1", note: "hi" }), true);
});

test("RecipeNoteSaver: confirmation only on backend success", async () => {
  const echo = async (message) => {
    if (message.service_data.note === "fail-echo") return {};
    return { response: { recipe: { id: message.service_data.recipe_id, note: message.service_data.note } } };
  };
  const saver = new RecipeNoteSaver(echo, { sleep: () => Promise.resolve() });
  const ok = await saver.saveNote("r1", "Family favourite");
  assert.equal(ok.ok, true);

  // The rig stub returns {}: the save is NOT confirmed, after the ladder.
  let calls = 0;
  const stub = new RecipeNoteSaver(
    async () => { calls += 1; return {}; },
    { sleep: () => Promise.resolve() },
  );
  const failed = await stub.saveNote("r1", "fail-echo");
  assert.equal(failed.ok, false);
  assert.equal(failed.kind, "failed-call");
  assert.equal(calls, ERS1_ATTEMPTS);

  // A missing service surfaces at once, without burning the ladder.
  calls = 0;
  const missing = new RecipeNoteSaver(
    async () => {
      calls += 1;
      const error = new Error("Service not found.");
      error.code = "not_found";
      throw error;
    },
    { sleep: () => Promise.resolve() },
  );
  const missingResult = await missing.saveNote("r1", "x");
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.kind, "bridge-missing");
  assert.equal(calls, 1);
});

test("noteSaveState: three distinct states (§05.13)", () => {
  assert.equal(noteSaveState({ hasHass: false }), "core-absent");
  assert.equal(
    noteSaveState({ hasHass: true, saveResult: { ok: false, kind: "bridge-missing" } }),
    "bridge-missing",
  );
  assert.equal(
    noteSaveState({ hasHass: true, saveResult: { ok: false, kind: "failed-call" } }),
    "failed-call",
  );
  assert.equal(noteSaveState({ hasHass: true, saveResult: { ok: true } }), "ready");
});

test("RecipeErrorSlot: newer wins, cleared on success", () => {
  const slot = new RecipeErrorSlot();
  assert.equal(slot.present, false);
  slot.set({ kind: "failed-call", scope: "load", message: "first" });
  slot.set({ kind: "failed-call", scope: "load", message: "second" });
  assert.equal(slot.current.message, "second");
  slot.clear();
  assert.equal(slot.present, false);
});

// NB6: the slot carries what its retry needs — a timer failure's
// seconds, so "Try again" re-attempts the same start. A set without
// seconds yields null, never undefined.
test("RecipeErrorSlot: a timer failure carries its seconds for retry", () => {
  const slot = new RecipeErrorSlot();
  slot.set({ kind: "bridge-missing", scope: "timer", message: "down", retry: "retry-timer", seconds: 300 });
  assert.equal(slot.current.seconds, 300);
  assert.equal(slot.current.retry, "retry-timer");
  slot.set({ kind: "failed-call", scope: "timer", message: "too long", retry: null });
  assert.equal(slot.current.seconds, null);
  assert.equal(slot.current.retry, null);
});

test("RecipeReProbe exists and fires: recovery clears, persistence re-arms", async () => {
  let armed = 0;
  let fired = null;
  const probe = new RecipeReProbe({
    probe: async () => true,
    onRecovered: () => { fired = "recovered"; },
    schedule: (fn) => { armed += 1; fired = fn; return 1; },
    cancel: () => { armed = 0; },
  });
  assert.equal(probe.armed, false);
  probe.arm();
  assert.equal(probe.armed, true);
  assert.equal(armed, 1);
  await probe.fire();
  assert.equal(fired, "recovered");
  assert.equal(probe.armed, false);

  // A failing probe re-arms instead of clearing.
  let attempts = 0;
  const failing = new RecipeReProbe({
    probe: async () => { attempts += 1; return false; },
    schedule: (fn) => { failing._pending = fn; return 1; },
    cancel: () => {},
  });
  failing.arm();
  const recovered = await failing.fire();
  assert.equal(recovered, false);
  assert.equal(failing.armed, true);
  assert.equal(attempts, 1);
  failing.disarm();
  assert.equal(failing.armed, false);
});

// ---------------------------------------------------------------------------
// J — timer contract
// ---------------------------------------------------------------------------

test("RecipeTimerLink binds by the RETURNED entity id (A2 fix)", async () => {
  const shown = [];
  const callWS = async (message) => {
    assert.equal(message.return_response, true);
    assert.equal(message.service, "start_timer");
    assert.equal(typeof message.service_data.command_id, "string");
    return { response: { entity_id: "sensor.satellite_timer_abc", timer_id: "abc" } };
  };
  const link = new RecipeTimerLink(callWS);
  const result = await link.start({
    name: "Pasta",
    seconds: 480,
    returnContext: { route: "/family-hub/recipes", openId: "r1", step: 2, scrollY: 0 },
    pipShow: (entityId, options) => shown.push({ entityId, options }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.entityId, "sensor.satellite_timer_abc");
  assert.equal(shown.length, 1);
  assert.equal(shown[0].entityId, "sensor.satellite_timer_abc");
  assert.equal(shown[0].options.returnContext.step, 2);
  assert.equal(shown[0].options.name, "Pasta");
});

test("RecipeTimerLink: no entity id means NO PIP and NO name lookup (A2)", async () => {
  let shown = 0;
  const link = new RecipeTimerLink(async () => ({ response: {} }));
  const result = await link.start({
    name: "Pasta",
    seconds: 480,
    pipShow: () => { shown += 1; },
  });
  assert.equal(result.ok, false);
  assert.equal(shown, 0, "a missing entity id must never bind by name");
});

test("RecipeTimerLink: two Pasta timers bind their own ids", async () => {
  const ids = ["sensor.satellite_timer_one", "sensor.satellite_timer_two"];
  let call = 0;
  const link = new RecipeTimerLink(async () => ({ response: { entity_id: ids[call++] } }));
  const shown = [];
  for (const id of ids) {
    const result = await link.start({
      name: "Pasta",
      seconds: 60,
      pipShow: (entityId) => shown.push(entityId),
    });
    assert.equal(result.ok, true);
  }
  assert.deepEqual(shown, ids);
});

test("RecipeTimerLink: bridge-missing is classified, and C3 never says try voice", async () => {
  const error = new Error("Service not found.");
  error.code = "not_found";
  const link = new RecipeTimerLink(async () => { throw error; });
  const result = await link.start({ name: "Pasta", seconds: 60 });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "bridge-missing");
  const text = timerStartFailureText({ kind: "bridge-missing", seconds: 480, name: "Pasta" });
  assert.match(text, /Timers view instead/);
  assert.doesNotMatch(text, /voice/i);
  assert.equal(formatTimerDuration(480), "8 minutes");
  assert.equal(formatTimerDuration(45), "45 seconds");
  assert.equal(formatTimerDuration(3600), "1 hour");
  assert.match(newCommandId(), /[0-9a-f-]{8,}/);
});

test("D-W7-10: chip start confirms the PIP once the sensor is active", () => {
  const returnContext = { route: "/family-hub/recipes", openId: "r1", step: 3, scrollY: 0 };
  const makeCard = (storeState) => {
    const card = Object.create(AnylistRecipeView.prototype);
    const confirmed = [];
    const store = {
      state: storeState,
      byEntityId: () => (store.state ? { state: store.state } : null),
    };
    card._shell = {
      pip: { confirmTimerStarted: (id, opts) => confirmed.push({ id, opts }) },
      timerStore: store,
      haClient: {
        subscribeEntity: (entityId, handler) => {
          card._capturedHandler = handler;
          return () => { card._unsubscribed = true; };
        },
      },
    };
    card._timerConfirmUnsubscribe = null;
    card._timerConfirmSettleTimer = null;
    card._confirmed = confirmed;
    card._store = store;
    return card;
  };
  // Sensor already active: confirm at once, no subscription — and the
  // confirm carries the full returnContext, not just the route (NB9).
  const immediate = makeCard("active");
  immediate._confirmTimerStart("sensor.satellite_timer_x", returnContext);
  assert.deepEqual(immediate._confirmed, [{ id: "sensor.satellite_timer_x", opts: { originView: "/family-hub/recipes", returnContext } }]);
  assert.equal(immediate._timerConfirmUnsubscribe, null);

  // Sensor arrives later: no confirm on idle, confirm on active, and
  // the subscription is dropped once it fires.
  const delayed = makeCard(null);
  delayed._confirmTimerStart("sensor.satellite_timer_y", returnContext);
  assert.equal(delayed._confirmed.length, 0);
  assert.equal(typeof delayed._capturedHandler, "function");
  delayed._capturedHandler({ state: "idle" });
  assert.equal(delayed._confirmed.length, 0);
  delayed._store.state = "active";
  delayed._capturedHandler({ state: "active" });
  assert.equal(delayed._unsubscribed, true);
  assert.deepEqual(delayed._confirmed, [{ id: "sensor.satellite_timer_y", opts: { originView: "/family-hub/recipes", returnContext } }]);

  // No PipHost: a start never throws for want of a confirm.
  const noPip = Object.create(AnylistRecipeView.prototype);
  noPip._shell = null;
  noPip._timerConfirmUnsubscribe = null;
  noPip._timerConfirmSettleTimer = null;
  assert.doesNotThrow(() => noPip._confirmTimerStart("sensor.satellite_timer_z", returnContext));

  // A failing confirm is not a start failure.
  const failing = makeCard("active");
  failing._shell.pip.confirmTimerStarted = () => { throw new Error("pip gone"); };
  assert.doesNotThrow(() => failing._confirmTimerStart("sensor.satellite_timer_x", returnContext));
});

// NB1: the settle-delayed confirm is a tracked, named timer — dropping
// the confirm before the delay means the confirm never fires (the
// disconnect leak: a confirm firing up to 250 ms after disconnect).
test("NB1: a dropped chip-start confirm never fires after its settle delay", async () => {
  const returnContext = { route: "/family-hub/recipes", openId: "r1", step: 1, scrollY: 0 };
  const card = Object.create(AnylistRecipeView.prototype);
  const confirmed = [];
  const store = { byEntityId: () => null };
  card._shell = {
    pip: { confirmTimerStarted: (id, opts) => confirmed.push({ id, opts }) },
    timerStore: store,
    haClient: {
      subscribeEntity: (entityId, handler) => {
        card._capturedHandler = handler;
        return () => {};
      },
    },
  };
  card._timerConfirmUnsubscribe = null;
  card._timerConfirmSettleTimer = null;
  card._confirmTimerStart("sensor.satellite_timer_settle", returnContext);
  // The sensor arrives but the store has not processed the event yet:
  // the confirm is scheduled on the tracked settle timer.
  card._capturedHandler({ state: "active" });
  assert.notEqual(card._timerConfirmSettleTimer, null);
  // Dropping the confirm (what disconnectedCallback does) cancels it.
  card._dropTimerConfirm();
  assert.equal(card._timerConfirmSettleTimer, null);
  await new Promise((resolve) => setTimeout(resolve, TIMER_CONFIRM_SETTLE_MS + 100));
  assert.equal(confirmed.length, 0);
});

// NB6: "Try again" on a timer error re-attempts the same start with the
// seconds the slot carries; a slot with no seconds falls back to
// clearing the status line.
test("NB6: retry-timer re-attempts the carried start", () => {
  const card = Object.create(AnylistRecipeView.prototype);
  card._errorSlot = new RecipeErrorSlot();
  card._timerStatus = "Couldn't start the 5 minutes Pasta timer.";
  const attempted = [];
  card._startTimerFromChip = (seconds) => { attempted.push(seconds); return Promise.resolve(); };
  let rendered = 0;
  card._renderDetailStatus = () => { rendered += 1; };
  const fakeEvent = (action) => ({
    target: { closest: () => ({ getAttribute: (name) => (name === "data-action" ? action : null) }) },
  });
  card._errorSlot.set({ kind: "bridge-missing", scope: "timer", message: "down", retry: "retry-timer", seconds: 300 });
  card._onClick(fakeEvent("retry-timer"));
  assert.deepEqual(attempted, [300]);
  // No seconds on the slot: the old clear-the-line behaviour.
  card._errorSlot.set({ kind: "failed-call", scope: "timer", message: "too long", retry: null });
  card._onClick(fakeEvent("retry-timer"));
  assert.deepEqual(attempted, [300]);
  assert.equal(card._timerStatus, "");
  assert.equal(rendered, 1);
});

// ---------------------------------------------------------------------------
// H — voice step commands through the one handler (D9)
// ---------------------------------------------------------------------------

function makeVoiceCard() {
  const card = Object.create(AnylistRecipeView.prototype);
  card._recipes = [
    normalizeRecipe({
      id: "r1", name: "Pasta",
      ingredients: [], preparation_steps: ["Boil water.", "Add pasta.", "Serve."],
    }),
  ];
  card._session = { openId: "r1", step: 1, lastVoiceSequence: 0, scrollY: 0 };
  card._stepsById = new Map([["r1", 1]]);
  card._writeSession = () => {};
  card._renderDetail = () => {};
  card._scrollStepIntoView = () => {};
  return card;
}

test("voice step record: sensor + sequence + one handler (D9)", () => {
  const card = makeVoiceCard();
  assert.equal(card._handleVoiceStepRecord({ state: "next", attributes: { sequence: 7 } }), true);
  assert.equal(card._session.step, 2);
  assert.equal(card._session.lastVoiceSequence, 7);
  // Re-observation of the same sequence never re-applies.
  assert.equal(card._handleVoiceStepRecord({ state: "next", attributes: { sequence: 7 } }), false);
  assert.equal(card._session.step, 2);
  // An older sequence never re-applies either.
  assert.equal(card._handleVoiceStepRecord({ state: "next", attributes: { sequence: 6 } }), false);
  assert.equal(card._session.step, 2);
  // Previous steps back, through the same handler.
  assert.equal(card._handleVoiceStepRecord({ state: "previous", attributes: { sequence: 8 } }), true);
  assert.equal(card._session.step, 1);
  // Unknown directions and no open recipe are no-ops, not errors.
  assert.equal(card._handleVoiceStepRecord({ state: "jump", attributes: { sequence: 9 } }), false);
  card._session.openId = null;
  assert.equal(card._handleVoiceStepRecord({ state: "next", attributes: { sequence: 10 } }), false);
});

// NB3: a voice command observed with no recipe open is recorded —
// its re-delivery after opening a recipe must not apply it.
test("NB3: a no-open voice command is recorded, so its re-delivery is a no-op", () => {
  const card = makeVoiceCard();
  card._session.openId = null;
  assert.equal(card._handleVoiceStepRecord({ state: "next", attributes: { sequence: 9401 } }), false);
  assert.equal(card._session.lastVoiceSequence, 9401);
  assert.equal(card._session.step, 1);
  // Open the recipe and re-emit the same sequence: deduped.
  card._session.openId = "r1";
  assert.equal(card._handleVoiceStepRecord({ state: "next", attributes: { sequence: 9401 } }), false);
  assert.equal(card._session.step, 1);
  // A newer sequence still applies.
  assert.equal(card._handleVoiceStepRecord({ state: "next", attributes: { sequence: 9402 } }), true);
  assert.equal(card._session.step, 2);
});

// NB3: navigating away (a plain route — the PIP tap to Timers) keeps
// the voice watermark, like the per-recipe step memory.
test("NB3: navigating away keeps the voice watermark", () => {
  const card = makeVoiceCard();
  card._render = () => {};
  card._handleVoiceStepRecord({ state: "next", attributes: { sequence: 7 } });
  assert.equal(card._session.lastVoiceSequence, 7);
  assert.equal(card._session.step, 2);
  card._currentUrl = () => new URL("http://family-hub.local/family-hub/recipes");
  card._applyRoute();
  assert.equal(card._session.openId, null);
  assert.equal(card._session.lastVoiceSequence, 7);
  assert.equal(card._stepsById.get("r1"), 2);
});

test("PIP return: navigating away keeps the step, a fresh open resets it (D-W7-F21)", () => {
  const card = makeVoiceCard();
  card._render = () => {};
  // Step to 3 through the one handler.
  card._handleVoiceStepRecord({ state: "next", attributes: { sequence: 7 } });
  card._handleVoiceStepRecord({ state: "next", attributes: { sequence: 8 } });
  assert.equal(card._session.step, 3);
  assert.equal(card._stepsById.get("r1"), 3);
  // Navigating away (a plain route — the PIP tap to Timers)
  // closes the detail but keeps the per-recipe step memory.
  card._applyRoute();
  assert.equal(card._session.openId, null);
  assert.equal(card._stepsById.get("r1"), 3);
  // The Timers back button returns to the detail URL: the step
  // is restored from the memory, not reset.
  card._currentUrl = () => new URL("http://family-hub.local/family-hub/recipes?recipe=r1");
  card._applyRoute();
  assert.equal(card._session.openId, "r1");
  assert.equal(card._session.step, 3);
  // A fresh open from the list (a row tap) is a new cooking
  // session: it starts at step 1 and records it.
  card._readNoteDraft = () => null;
  card._openDetail("r1");
  assert.equal(card._session.step, 1);
  assert.equal(card._stepsById.get("r1"), 1);
});

// ---------------------------------------------------------------------------
// Card smoke
// ---------------------------------------------------------------------------

test("card class instantiates with the settled defaults", () => {
  const card = new AnylistRecipeView();
  card.setConfig({});
  assert.equal(card._config.recipes_url, DEFAULT_RECIPES_URL);
  assert.equal(card._config.title, "Recipes");
  card.setConfig({ recipes_url: "/local/other.json", title: "Food" });
  assert.equal(card._config.recipes_url, "/local/other.json");
  assert.equal(typeof escapeHtml("<b>&"), "string");
  assert.equal(escapeHtml('<a href="x">&'), "&lt;a href=&quot;x&quot;&gt;&amp;");
});
