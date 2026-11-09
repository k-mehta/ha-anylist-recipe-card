const test = require("node:test");
const assert = require("node:assert/strict");

// The card needs a DOM to load (HTMLElement/customElements), so the
// pure helpers are exercised here through a minimal harness-free load:
// stub the browser globals just enough for the module to define itself.
globalThis.HTMLElement = class {
  attachShadow() {
    return { addEventListener: () => {} };
  }
};
globalThis.customElements = { define: () => {} };

const {
  normalizeRecipe,
  normalizeSearchText,
  isMinorTypo,
  searchRecipes,
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
  timerName,
  timerRemainingSeconds,
  formatRemaining,
  runningTimers,
  CARD_CSS,
  RECIPE_SESSION_KEY,
  parseRecipeSession,
  serializeRecipeSession,
} = require("./anylist-recipe-view-card.js");

// A recipe exactly as the AnyList integration serializes it
// (_serialize_recipe in custom_components/anylist/__init__.py).
function fullRecipe(overrides = {}) {
  return {
    id: "rec-pasta",
    name: "Creamy Tomato Pasta",
    ingredients: [
      { name: "Penne", quantity: "500 g", note: "", raw_ingredient: "500 g penne" },
      { name: "Cherry tomatoes", quantity: "400 g", note: "halved", raw_ingredient: "400 g cherry tomatoes, halved" },
      { name: "Cream", quantity: "200 ml", note: "", raw_ingredient: "200 ml cream" },
      { name: "Salt", quantity: "", note: "to taste", raw_ingredient: "Salt to taste" },
    ],
    preparation_steps: [
      "Boil the pasta in salted water until al dente.",
      "Meanwhile, soften the tomatoes in a pan.",
      "Stir in the cream, add the pasta, and serve.",
    ],
    note: "Vihaan likes this with extra cheese.",
    source_name: "Family cookbook",
    source_url: "",
    servings: "4",
    prep_time: 600,
    cook_time: 1200,
    rating: 5,
    photo_urls: ["https://photos.anylist.com/abc123.jpg"],
    collections: [
      { id: "col-weeknight", name: "Weeknight" },
      { id: "col-pasta", name: "Pasta" },
    ],
    ...overrides,
  };
}

test("normalizeRecipe keeps every serialized field", () => {
  const recipe = normalizeRecipe(fullRecipe());
  assert.equal(recipe.id, "rec-pasta");
  assert.equal(recipe.name, "Creamy Tomato Pasta");
  assert.equal(recipe.ingredients.length, 4);
  assert.deepEqual(recipe.ingredients[1], {
    name: "Cherry tomatoes",
    quantity: "400 g",
    note: "halved",
    raw: "400 g cherry tomatoes, halved",
  });
  assert.equal(recipe.steps.length, 3);
  assert.equal(recipe.steps[0], "Boil the pasta in salted water until al dente.");
  assert.equal(recipe.note, "Vihaan likes this with extra cheese.");
  assert.equal(recipe.sourceName, "Family cookbook");
  assert.equal(recipe.servings, "4");
  assert.equal(recipe.prepTime, 600);
  assert.equal(recipe.cookTime, 1200);
  assert.equal(recipe.rating, 5);
  assert.deepEqual(recipe.photoUrls, ["https://photos.anylist.com/abc123.jpg"]);
  assert.deepEqual(recipe.collections, [
    { id: "col-weeknight", name: "Weeknight" },
    { id: "col-pasta", name: "Pasta" },
  ]);
});

test("normalizeRecipe tolerates a bare-minimum recipe (missing fields)", () => {
  const recipe = normalizeRecipe({ id: "rec-x", name: "Soup" });
  assert.equal(recipe.id, "rec-x");
  assert.equal(recipe.name, "Soup");
  assert.deepEqual(recipe.ingredients, []);
  assert.deepEqual(recipe.entries, []);
  assert.deepEqual(recipe.steps, []);
  assert.equal(recipe.note, "");
  assert.equal(recipe.servings, "");
  assert.equal(recipe.prepTime, null);
  assert.equal(recipe.cookTime, null);
  assert.equal(recipe.rating, null);
  assert.deepEqual(recipe.photoUrls, []);
  assert.deepEqual(recipe.collections, []);
});

test("normalizeRecipe tolerates null, non-objects and malformed rows", () => {
  assert.equal(normalizeRecipe(null).name, "Untitled recipe");
  assert.equal(normalizeRecipe("nope").name, "Untitled recipe");
  assert.equal(normalizeRecipe({}).name, "Untitled recipe");
  const recipe = normalizeRecipe({
    id: "rec-y",
    name: "Odd",
    ingredients: [null, "text", { name: "  " }, { name: "Eggs", quantity: 2 }],
    preparation_steps: ["  ", null, 42, "Mix."],
    photo_urls: ["", null, "https://photos.anylist.com/z.jpg"],
  });
  // A flat string is now parsed into an ingredient (RECIPE-24): the
  // malformed rows are dropped, but "text" is a real ingredient row
  // (a name with no quantity), not junk to discard.
  assert.deepEqual(recipe.ingredients, [
    { name: "text", quantity: "", note: "", raw: "text" },
    { name: "Eggs", quantity: "2", note: "", raw: "" },
  ]);
  assert.deepEqual(recipe.steps, ["42", "Mix."]);
  assert.deepEqual(recipe.photoUrls, ["https://photos.anylist.com/z.jpg"]);
});

test("a quantity-less flat row is an ingredient, never an invented heading", () => {
  // Headings now arrive through `ingredient_entries` (see below). A flat
  // row is still name + quantity + note only: the card must not invent a
  // heading from a missing quantity — "Salt to taste" is a real
  // ingredient, not a heading.
  const recipe = normalizeRecipe(
    fullRecipe({
      ingredients: [
        { name: "Salt", quantity: "", note: "to taste", raw_ingredient: "Salt to taste" },
      ],
    })
  );
  assert.equal(recipe.ingredients.length, 1);
  assert.equal(recipe.ingredients[0].name, "Salt");
  assert.equal(recipe.ingredients[0].note, "to taste");
  // The merged entries carry the flat list now (RECIPE-11 fix): the
  // Salt row is an ingredient entry — and no section was invented
  // from the missing quantity.
  assert.equal(recipe.entries.length, 1);
  assert.equal(recipe.entries[0].type, "ingredient");
  assert.equal(recipe.entries[0].name, "Salt");
  assert.equal(recipe.entries.filter((item) => item.type === "section").length, 0);
});

test("normalizeRecipe keeps ordered ingredient entries", () => {
  const recipe = normalizeRecipe(
    fullRecipe({
      ingredient_entries: [
        { type: "section", name: "For the sauce" },
        { type: "ingredient", name: "Tomatoes", quantity: "500 g", note: "", raw_ingredient: "500 g tomatoes" },
        { type: "section", name: "  " },
        { type: "ingredient", name: "Basil", quantity: "", note: "", raw_ingredient: "" },
        { type: "mystery", name: "Not an entry" },
        null,
        "text",
        { type: "ingredient", name: "", raw_ingredient: "" },
      ],
    })
  );
  assert.deepEqual(recipe.entries, [
    { type: "section", name: "For the sauce" },
    { type: "ingredient", name: "Tomatoes", quantity: "500 g", note: "", raw: "500 g tomatoes" },
    { type: "ingredient", name: "Basil", quantity: "", note: "", raw: "" },
    // RECIPE-11 merge: the flat list's items that are not already in
    // the entries (by normalized name + quantity + note) are appended
    // after the entries, entries first. "Tomatoes" and "Cherry
    // tomatoes" are different names, so both stay.
    { type: "ingredient", name: "Penne", quantity: "500 g", note: "", raw: "500 g penne" },
    { type: "ingredient", name: "Cherry tomatoes", quantity: "400 g", note: "halved", raw: "400 g cherry tomatoes, halved" },
    { type: "ingredient", name: "Cream", quantity: "200 ml", note: "", raw: "200 ml cream" },
    { type: "ingredient", name: "Salt", quantity: "", note: "to taste", raw: "Salt to taste" },
  ]);
  // The flat list is untouched by the entries.
  assert.equal(recipe.ingredients.length, 4);
});

test("normalizeRecipe builds ordered entries from is_heading flags (upstream shape)", () => {
  // Upstream format (PR #15): headings stay inside `ingredients` as
  // entries with is_heading set, each entry carrying an id.
  const recipe = normalizeRecipe(
    fullRecipe({
      ingredients: [
        { id: "ing-1", name: "For the sauce", is_heading: true },
        { id: "ing-2", name: "Tomatoes", quantity: "500 g", note: "", raw_ingredient: "500 g tomatoes" },
        { id: "ing-3", name: "Basil", quantity: "", note: "", raw_ingredient: "" },
        { id: "ing-4", name: "To finish", is_heading: true },
        { id: "ing-5", name: "Salt", quantity: "", note: "to taste", raw_ingredient: "Salt to taste" },
      ],
    })
  );
  assert.deepEqual(recipe.entries, [
    { type: "section", name: "For the sauce" },
    { type: "ingredient", name: "Tomatoes", quantity: "500 g", note: "", raw: "500 g tomatoes" },
    { type: "ingredient", name: "Basil", quantity: "", note: "", raw: "" },
    { type: "section", name: "To finish" },
    { type: "ingredient", name: "Salt", quantity: "", note: "to taste", raw: "Salt to taste" },
  ]);
  // Headings are never ingredients, and the entry ids are never kept.
  assert.equal(recipe.ingredients.length, 3);
  assert.deepEqual(
    recipe.ingredients.map((item) => item.name),
    ["Tomatoes", "Basil", "Salt"]
  );
  assert.equal("id" in recipe.ingredients[0], false);
  assert.equal("id" in recipe.entries[0], false);
});

test("normalizeRecipe prefers ingredient_entries when both heading shapes are present", () => {
  const recipe = normalizeRecipe(
    fullRecipe({
      ingredient_entries: [
        { type: "section", name: "Fork section" },
        { type: "ingredient", name: "Tomatoes", quantity: "500 g", note: "", raw_ingredient: "500 g tomatoes" },
      ],
      ingredients: [
        { id: "ing-1", name: "Upstream heading", is_heading: true },
        { id: "ing-2", name: "Tomatoes", quantity: "500 g", note: "", raw_ingredient: "500 g tomatoes" },
      ],
    })
  );
  assert.deepEqual(recipe.entries, [
    { type: "section", name: "Fork section" },
    { type: "ingredient", name: "Tomatoes", quantity: "500 g", note: "", raw: "500 g tomatoes" },
  ]);
  // The upstream heading is still not an ingredient.
  assert.equal(recipe.ingredients.length, 1);
});

test("renderIngredientRow shows quantity, name and note, escaped", () => {
  assert.equal(
    renderIngredientRow({ name: "Tomatoes", quantity: "500 g", note: "halved", raw: "" }),
    '<div class="ingredient"><span class="qty">500 g</span><span class="ing-name">Tomatoes <span class="ing-note">halved</span></span></div>'
  );
  assert.equal(
    renderIngredientRow({ name: "<b>Eggs</b>", quantity: "", note: "", raw: "" }),
    '<div class="ingredient"><span class="qty"></span><span class="ing-name">&lt;b&gt;Eggs&lt;/b&gt;</span></div>'
  );
});

test("formatMeta returns the parts that exist, as unbreakable segments", () => {
  assert.deepEqual(
    formatMeta(normalizeRecipe(fullRecipe())),
    ["Prep 10 min", "Cook 20 min", "Serves 4", "★★★★★ 5/5"]
  );
  assert.deepEqual(formatMeta(normalizeRecipe({ id: "a", name: "B" })), []);
  assert.deepEqual(
    formatMeta(normalizeRecipe({ id: "a", name: "B", prep_time: 900, rating: 3 })),
    ["Prep 15 min", "★★★☆☆ 3/5"]
  );
  // Servings is a freeform string: a bare number gets "Serves", a
  // string that already says it ("4 servings") is shown as it came.
  assert.deepEqual(
    formatMeta(normalizeRecipe({ id: "a", name: "B", servings: "4 servings" })),
    ["4 servings"]
  );
  // Zero/negative times and ratings are not shown.
  assert.deepEqual(
    formatMeta(normalizeRecipe({ id: "a", name: "B", prep_time: 0, cook_time: -5, rating: 0 })),
    []
  );
});

test("formatMetaHtml wraps each segment so it cannot break inside, and stars get the stars class", () => {
  assert.equal(
    formatMetaHtml(normalizeRecipe(fullRecipe())),
    '<span class="meta-seg">Prep 10 min</span><span class="meta-sep" aria-hidden="true">·</span>' +
      '<span class="meta-seg">Cook 20 min</span><span class="meta-sep" aria-hidden="true">·</span>' +
      '<span class="meta-seg">Serves 4</span><span class="meta-sep" aria-hidden="true">·</span>' +
      '<span class="meta-seg stars">★★★★★ 5/5</span>'
  );
  assert.equal(formatMetaHtml(normalizeRecipe({ id: "a", name: "B" })), "");
  assert.equal(
    formatMetaHtml(normalizeRecipe({ id: "a", name: "B", prep_time: 900, rating: 3 })),
    '<span class="meta-seg">Prep 15 min</span><span class="meta-sep" aria-hidden="true">·</span>' +
      '<span class="meta-seg stars">★★★☆☆ 3/5</span>'
  );
});

test("formatDuration converts seconds to kitchen minutes and hours", () => {
  // The live bug: a "10 Minute" recipe arrives as prep_time 300, and
  // the old code printed "Prep 300 min". These are the real values.
  assert.equal(formatDuration(300), "5 min");
  assert.equal(formatDuration(600), "10 min");
  assert.equal(formatDuration(900), "15 min");
  assert.equal(formatDuration(5400), "1 hr 30 min");
  assert.equal(formatDuration(3600), "1 hr");
  assert.equal(formatDuration(7200), "2 hr");
  // Rounding: nearest minute; under 30 seconds rounds to nothing.
  assert.equal(formatDuration(90), "2 min");
  assert.equal(formatDuration(30), "1 min");
  assert.equal(formatDuration(29), "");
  // Null, zero and negative render as nothing — the caller omits them.
  assert.equal(formatDuration(null), "");
  assert.equal(formatDuration(0), "");
  assert.equal(formatDuration(-5), "");
  assert.equal(formatDuration(undefined), "");
});

test("formatServings adds Serves only to a bare number", () => {
  assert.equal(formatServings("4"), "Serves 4");
  assert.equal(formatServings("4 servings"), "4 servings");
  assert.equal(formatServings("2 (bowls)"), "2 (bowls)");
  assert.equal(formatServings(""), "");
});

test("formatStars clamps to five and hides zero", () => {
  assert.equal(formatStars(5), "★★★★★");
  assert.equal(formatStars(3), "★★★☆☆");
  assert.equal(formatStars(7), "★★★★★");
  assert.equal(formatStars(0), "");
  assert.equal(formatStars(null), "");
});

test("parseServings reads the first number ANYWHERE, as a range when given one (RECIPE-3)", () => {
  assert.deepEqual(parseServings("4"), { low: 4, high: 4 });
  assert.deepEqual(parseServings("4.5"), { low: 4.5, high: 4.5 });
  assert.deepEqual(parseServings(" 6 "), { low: 6, high: 6 });
  assert.equal(parseServings(""), null);
  assert.equal(parseServings(null), null);
  // "First number ANYWHERE": the number need not lead the string.
  assert.deepEqual(parseServings("4 servings"), { low: 4, high: 4 });
  assert.deepEqual(parseServings("2 (bowls)"), { low: 2, high: 2 });
  assert.deepEqual(parseServings("Serves 4"), { low: 4, high: 4 });
  assert.deepEqual(parseServings("Makes 12 muffins"), { low: 12, high: 12 });
  assert.deepEqual(parseServings("Yield: 8"), { low: 8, high: 8 });
  // A range parses as both ends.
  assert.deepEqual(parseServings("4-6"), { low: 4, high: 6 });
  assert.deepEqual(parseServings("4–6"), { low: 4, high: 6 });
  assert.deepEqual(parseServings("Serves 4 to 6"), { low: 4, high: 6 });
  // No number, zero, or a number preceded by a minus sign: no parse.
  assert.equal(parseServings("0"), null);
  assert.equal(parseServings("-2"), null);
  assert.equal(parseServings("four"), null);
  assert.equal(parseServings("a crowd"), null);
});

test("scaleQuantity scales with fractions, never decimals (RECIPE-1/2)", () => {
  assert.equal(scaleQuantity("500 g", 2), "1000 g");
  assert.equal(scaleQuantity("500 g", 0.5), "250 g");
  assert.equal(scaleQuantity("500 g", 1.5), "750 g");
  assert.equal(scaleQuantity("200 ml", 1.25), "250 ml");
  // A fractional result formats as a Unicode fraction, never a decimal.
  assert.equal(scaleQuantity("0.5 tsp", 3), "1 ½ tsp");
  assert.equal(scaleQuantity("2", 3), "6");
  // A whole result stays whole — no trailing ".0".
  assert.equal(scaleQuantity("400 g", 1.5), "600 g");
  // No leading number: unchanged, never a NaN or a crash.
  assert.equal(scaleQuantity("a pinch", 2), "a pinch");
  assert.equal(scaleQuantity("to taste", 2), "to taste");
  // A fraction input scales as a fraction: ½ cup doubled is 1 cup.
  assert.equal(scaleQuantity("1/2 cup", 2), "1 cup");
  assert.equal(scaleQuantity("1½ cups", 2), "3 cups");
  assert.equal(scaleQuantity("", 2), "");
  assert.equal(scaleQuantity(null, 2), "");
});

test("renderStepText renders AnyList's light step markdown, never raw HTML", () => {
  assert.deepEqual(renderStepText("Boil the pasta."), {
    header: false,
    html: "Boil the pasta.",
  });
  assert.deepEqual(renderStepText("# For the sauce"), {
    header: true,
    html: "For the sauce",
  });
  assert.deepEqual(renderStepText("Stir in the **cream** and _serve_ hot."), {
    header: false,
    html: "Stir in the <strong>cream</strong> and <em>serve</em> hot.",
  });
  assert.deepEqual(renderStepText("<script>alert(1)</script>"), {
    header: false,
    html: "&lt;script&gt;alert(1)&lt;/script&gt;",
  });
  // A "#" that is not a header marker stays literal text.
  assert.deepEqual(renderStepText("Add #2 pencil"), {
    header: false,
    html: "Add #2 pencil",
  });
});

test("renderStepText turns times in a step into tappable timer chips", () => {
  assert.deepEqual(renderStepText("Simmer for 10 minutes."), {
    header: false,
    html: 'Simmer for <button class="time-chip" data-action="start-timer" data-seconds="600" aria-label="Start a 10 minutes timer">10 minutes</button>.',
  });
  assert.deepEqual(renderStepText("Bake for 1 hour, then rest for 30 sec."), {
    header: false,
    html: 'Bake for <button class="time-chip" data-action="start-timer" data-seconds="3600" aria-label="Start a 1 hour timer">1 hour</button>, then rest for <button class="time-chip" data-action="start-timer" data-seconds="30" aria-label="Start a 30 sec timer">30 sec</button>.',
  });
  // "a minute" is one minute, not a literal string.
  assert.deepEqual(renderStepText("Let it sit a minute."), {
    header: false,
    html: 'Let it sit <button class="time-chip" data-action="start-timer" data-seconds="60" aria-label="Start a a minute timer">a minute</button>.',
  });
  // A time inside bold still becomes a chip (the markup is split into
  // tags and text first, so only the text is touched).
  assert.deepEqual(renderStepText("Simmer for **10 minutes**."), {
    header: false,
    html: 'Simmer for <strong><button class="time-chip" data-action="start-timer" data-seconds="600" aria-label="Start a 10 minutes timer">10 minutes</button></strong>.',
  });
  // Headers are labels, never actionable: no chip in a section header.
  assert.deepEqual(renderStepText("# Simmer for 10 minutes"), {
    header: true,
    html: "Simmer for 10 minutes",
  });
  // A plain step with no time has no chip.
  assert.deepEqual(renderStepText("Boil the pasta."), {
    header: false,
    html: "Boil the pasta.",
  });
});

test("sortRecipes orders alphabetically, case-insensitive", () => {
  const sorted = sortRecipes([
    normalizeRecipe({ id: "1", name: "zucchini soup" }),
    normalizeRecipe({ id: "2", name: "Apple Pie" }),
    normalizeRecipe({ id: "3", name: "banana bread" }),
  ]);
  assert.deepEqual(sorted.map((r) => r.name), ["Apple Pie", "banana bread", "zucchini soup"]);
});

test("filterByCollection matches membership, empty id passes everything", () => {
  const recipes = [
    normalizeRecipe(fullRecipe()),
    normalizeRecipe({ id: "rec-soup", name: "Soup", collections: [{ id: "col-soup", name: "Soup" }] }),
  ];
  assert.equal(filterByCollection(recipes, "").length, 2);
  assert.equal(filterByCollection(recipes, "col-pasta").length, 1);
  assert.equal(filterByCollection(recipes, "col-soup")[0].name, "Soup");
  assert.equal(filterByCollection(recipes, "col-none").length, 0);
});

test("normalizeSearchText folds accents, case and punctuation", () => {
  assert.equal(normalizeSearchText("Crème Brûlée!"), "creme brulee");
  assert.equal(normalizeSearchText("  CARROT  soup "), "carrot soup");
  assert.equal(normalizeSearchText(""), "");
  assert.equal(normalizeSearchText(null), "");
});

test("isMinorTypo allows one edit, refuses short words and two edits", () => {
  // One insertion, deletion, substitution, transposition.
  assert.equal(isMinorTypo("carot", "carrot"), true);
  assert.equal(isMinorTypo("carrot", "carot"), true);
  assert.equal(isMinorTypo("carrot", "carrit"), true);
  assert.equal(isMinorTypo("carrot", "carort"), true);
  // Under 4 characters a one-edit difference is a different word.
  assert.equal(isMinorTypo("cat", "cut"), false);
  assert.equal(isMinorTypo("pea", "peaz"), false);
  // More than one edit apart is not a typo — and "carr" vs "carrot"
  // (length difference 2) is exactly the case the prefix fallback
  // has to cover instead.
  assert.equal(isMinorTypo("carr", "carrot"), false);
  assert.equal(isMinorTypo("carrot", "carpet"), false);
});

test("searchRecipes finds a prefix the server search misses", () => {
  const recipes = [
    normalizeRecipe({ id: "1", name: "Carrot Ginger Soup" }),
    normalizeRecipe({ id: "2", name: "Roasted Carrots" }),
    normalizeRecipe({ id: "3", name: "Tomato Soup" }),
  ];
  assert.deepEqual(searchRecipes(recipes, "carr").map((r) => r.name), [
    "Carrot Ginger Soup",
    "Roasted Carrots",
  ]);
  // Substring inside a word works too.
  assert.deepEqual(searchRecipes(recipes, "rrot").map((r) => r.name), [
    "Carrot Ginger Soup",
    "Roasted Carrots",
  ]);
});

test("searchRecipes tolerates a one-edit typo", () => {
  const recipes = [
    normalizeRecipe({ id: "1", name: "Carrot Ginger Soup" }),
    normalizeRecipe({ id: "2", name: "Tomato Soup" }),
  ];
  assert.deepEqual(searchRecipes(recipes, "carot").map((r) => r.name), ["Carrot Ginger Soup"]);
  assert.deepEqual(searchRecipes(recipes, "carot ginger").map((r) => r.name), [
    "Carrot Ginger Soup",
  ]);
});

test("searchRecipes ranks an exact title first, then word coverage (RECIPE-4)", () => {
  const recipes = [
    normalizeRecipe({ id: "1", name: "Carrot Soup" }),
    normalizeRecipe({ id: "2", name: "Carrot Ginger Soup" }),
    normalizeRecipe({ id: "3", name: "Tomato Soup" }),
  ];
  // "Tomato Soup" has no "carrot" anywhere, so the all-words rule
  // excludes it; the exact title outranks the partial title.
  assert.deepEqual(searchRecipes(recipes, "Carrot Soup").map((r) => r.name), [
    "Carrot Soup",
    "Carrot Ginger Soup",
  ]);
});

test("searchRecipes needs EVERY query word to match, somewhere (RECIPE-4)", () => {
  const recipes = [
    normalizeRecipe({ id: "1", name: "Carrot Ginger Soup" }),
    normalizeRecipe({ id: "2", name: "Tomato Soup" }),
  ];
  assert.equal(searchRecipes(recipes, "carrot banana mango").length, 0);
  assert.equal(searchRecipes(recipes, "zzz").length, 0);
  assert.equal(searchRecipes(recipes, "").length, 0);
  // Words may match in different fields: "carrot" in the title,
  // "ginger" in the ingredients.
  const crossField = normalizeRecipe({
    id: "3",
    name: "Carrot Soup",
    ingredients: [{ name: "Ginger", quantity: "10 g", note: "", raw_ingredient: "10 g ginger" }],
  });
  assert.deepEqual(
    searchRecipes([crossField], "carrot ginger").map((r) => r.name),
    ["Carrot Soup"]
  );
});

test("searchRecipes folds accents", () => {
  const recipes = [normalizeRecipe({ id: "1", name: "Crème Brûlée" })];
  assert.equal(searchRecipes(recipes, "creme").length, 1);
  assert.equal(searchRecipes(recipes, "brulee").length, 1);
});

test("deriveCollections dedupes by id and sorts by name", () => {
  const recipes = [
    normalizeRecipe({
      id: "1",
      name: "A",
      collections: [
        { id: "col-b", name: "Baking" },
        { id: "col-a", name: "Appetizers" },
      ],
    }),
    normalizeRecipe({
      id: "2",
      name: "B",
      collections: [{ id: "col-b", name: "Baking" }],
    }),
  ];
  assert.deepEqual(deriveCollections(recipes), [
    { id: "col-a", name: "Appetizers" },
    { id: "col-b", name: "Baking" },
  ]);
  assert.deepEqual(deriveCollections([]), []);
});



// -- Device detection (shared mechanism; the timer-screen card carries
// the identical block — see ADAPTIVE-LAYOUT.md) ---------------------------

const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HUB_UA =
  "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

test("detectDevice: the hub is a huge landscape touch screen", () => {
  assert.deepEqual(
    detectDevice({
      width: 1920,
      height: 1200,
      coarsePointer: true,
      finePointer: false,
      touch: true,
      userAgent: HUB_UA,
    }),
    { category: "hub", orientation: "landscape" }
  );
  // No user agent at all: size + touch + landscape is enough.
  assert.deepEqual(
    detectDevice({
      width: 1920,
      height: 1200,
      coarsePointer: true,
      finePointer: false,
      touch: true,
      userAgent: "",
    }),
    { category: "hub", orientation: "landscape" }
  );
});

test("detectDevice: a hub-sized touch-only screen is mobile, not the hub (P8-16)", () => {
  // Rule 8 (touch + >=1600px landscape = hub) is deleted: a
  // touch-only screen at 1920x1080 is not the hub — only the exact
  // 1920x1200 signature is. Coarse with no fine pointer is mobile.
  assert.deepEqual(
    detectDevice({
      width: 1920,
      height: 1080,
      coarsePointer: true,
      finePointer: false,
      touch: true,
      userAgent: DESKTOP_UA,
    }),
    { category: "mobile", orientation: "landscape" }
  );
  // The same screen WITH a mouse (a touchscreen laptop, V1080-01)
  // is desktop: fine + width >=1024 wins over coarse.
  assert.deepEqual(
    detectDevice({
      width: 1920,
      height: 1080,
      coarsePointer: true,
      finePointer: true,
      touch: true,
      userAgent: DESKTOP_UA,
    }),
    { category: "desktop", orientation: "landscape" }
  );
});

test("detectDevice: the hub with a mouse attached still reads as the hub", () => {
  // The kiosk has a mouse attached, so it reports a fine pointer too.
  // A hub-sized landscape touch screen is the hub regardless of the
  // mouse — the mouse is for setup, not for cooking. Checking fine
  // first would mis-detect the hub as a desktop (the audit's finding).
  assert.deepEqual(
    detectDevice({
      width: 1920,
      height: 1200,
      coarsePointer: true,
      finePointer: true,
      touch: true,
      userAgent: HUB_UA,
    }),
    { category: "hub", orientation: "landscape" }
  );
  // Even when only the fine pointer is reported (no coarse), touch +
  // hub size + landscape still wins.
  assert.deepEqual(
    detectDevice({
      width: 1920,
      height: 1200,
      coarsePointer: false,
      finePointer: true,
      touch: true,
      userAgent: HUB_UA,
    }),
    { category: "hub", orientation: "landscape" }
  );
});

test("detectDevice: a mouse is desktop", () => {
  assert.deepEqual(
    detectDevice({
      width: 1440,
      height: 900,
      coarsePointer: false,
      finePointer: true,
      touch: false,
      userAgent: DESKTOP_UA,
    }),
    { category: "desktop", orientation: "landscape" }
  );
  assert.deepEqual(
    detectDevice({
      width: 1280,
      height: 800,
      coarsePointer: false,
      finePointer: true,
      touch: false,
      userAgent: DESKTOP_UA,
    }),
    { category: "desktop", orientation: "landscape" }
  );
});

test("detectDevice: a narrow desktop window gets the mobile layout (the layout follows the viewport)", () => {
  assert.deepEqual(
    detectDevice({
      width: 700,
      height: 900,
      coarsePointer: false,
      finePointer: true,
      touch: false,
      userAgent: DESKTOP_UA,
    }),
    { category: "mobile", orientation: "portrait" }
  );
});

test("detectDevice: phones are mobile in both orientations", () => {
  assert.deepEqual(
    detectDevice({
      width: 390,
      height: 844,
      coarsePointer: true,
      finePointer: false,
      touch: true,
      userAgent: IPHONE_UA,
    }),
    { category: "mobile", orientation: "portrait" }
  );
  assert.deepEqual(
    detectDevice({
      width: 844,
      height: 390,
      coarsePointer: true,
      finePointer: false,
      touch: true,
      userAgent: IPHONE_UA,
    }),
    { category: "mobile", orientation: "landscape" }
  );
});

test("detectDevice: a mobile user agent wins over a desktop-sized viewport", () => {
  assert.deepEqual(
    detectDevice({
      width: 1440,
      height: 900,
      coarsePointer: false,
      finePointer: true,
      touch: false,
      userAgent: IPHONE_UA,
    }),
    { category: "mobile", orientation: "landscape" }
  );
});

test("detectDevice: tablets are tablets in both orientations (DESIGN-9)", () => {
  assert.deepEqual(
    detectDevice({
      width: 768,
      height: 1024,
      coarsePointer: true,
      finePointer: false,
      touch: true,
      userAgent: IPAD_UA,
    }),
    { category: "tablet", orientation: "portrait" }
  );
  assert.deepEqual(
    detectDevice({
      width: 1024,
      height: 768,
      coarsePointer: true,
      finePointer: false,
      touch: true,
      userAgent: IPAD_UA,
    }),
    { category: "tablet", orientation: "landscape" }
  );
});

test("detectDevice: a huge portrait touch screen is mobile, not the hub (the hub is landscape)", () => {
  assert.deepEqual(
    detectDevice({
      width: 1200,
      height: 1920,
      coarsePointer: true,
      finePointer: false,
      touch: true,
      userAgent: "",
    }),
    { category: "mobile", orientation: "portrait" }
  );
});

test("detectDevice: with no pointer information, touch + huge landscape is the hub and a wide viewport is desktop", () => {
  assert.deepEqual(
    detectDevice({
      width: 1920,
      height: 1200,
      coarsePointer: false,
      finePointer: false,
      touch: true,
      userAgent: "",
    }),
    { category: "hub", orientation: "landscape" }
  );
  assert.deepEqual(
    detectDevice({
      width: 1440,
      height: 900,
      coarsePointer: false,
      finePointer: false,
      touch: false,
      userAgent: "",
    }),
    { category: "desktop", orientation: "landscape" }
  );
  assert.deepEqual(
    detectDevice({
      width: 800,
      height: 600,
      coarsePointer: false,
      finePointer: false,
      touch: false,
      userAgent: "",
    }),
    { category: "mobile", orientation: "landscape" }
  );
});

test("readDeviceEnv returns null outside a browser", () => {
  assert.equal(readDeviceEnv(), null);
});

test("formatAmount rounds to the nearest eighth, third or whole, with ≈ when rounded (RECIPE-1)", () => {
  assert.deepEqual(formatAmount(2), { text: "2", approximate: false });
  assert.deepEqual(formatAmount(0.5), { text: "½", approximate: false });
  assert.deepEqual(formatAmount(1.5), { text: "1 ½", approximate: false });
  assert.deepEqual(formatAmount(0.375), { text: "⅜", approximate: false });
  assert.deepEqual(formatAmount(0.625), { text: "⅝", approximate: false });
  assert.deepEqual(formatAmount(0.875), { text: "⅞", approximate: false });
  assert.deepEqual(formatAmount(1 / 3), { text: "⅓", approximate: false });
  assert.deepEqual(formatAmount(2 / 3), { text: "⅔", approximate: false });
  // 0.4 is not a rounding fraction: nearest is ⅜, marked approximate.
  assert.deepEqual(formatAmount(0.4), { text: "⅜", approximate: true });
  // A tie rounds up: 0.4375 sits exactly between ⅜ and ½.
  assert.deepEqual(formatAmount(0.4375), { text: "½", approximate: true });
  assert.deepEqual(formatAmount(0), { text: "0", approximate: false });
});

test("parseAmountAt reads mixed numbers, fractions, Unicode fractions and decimals (RECIPE-1)", () => {
  assert.deepEqual(parseAmountAt("1 1/2 cups"), { value: 1.5, length: 5 });
  assert.deepEqual(parseAmountAt("1/2 cup"), { value: 0.5, length: 3 });
  assert.deepEqual(parseAmountAt("1½ cups"), { value: 1.5, length: 2 });
  assert.deepEqual(parseAmountAt("½ cup"), { value: 0.5, length: 1 });
  assert.deepEqual(parseAmountAt("0.5 tsp"), { value: 0.5, length: 3 });
  assert.deepEqual(parseAmountAt("500 g"), { value: 500, length: 3 });
  assert.equal(parseAmountAt("a pinch"), null);
  assert.equal(parseAmountAt("1/0 cup"), null);
  assert.equal(parseAmountAt("1..2 cups"), null);
  assert.equal(parseAmountAt(""), null);
});

test("scaleQuantityDetail: ranges, compounds, tidy units, unparseable flag, invalid factor (RECIPE-2)", () => {
  // Ranges scale both ends.
  assert.deepEqual(scaleQuantityDetail("2–3 cups", 2), {
    text: "4–6 cups",
    unparseable: false,
    approximate: false,
  });
  assert.deepEqual(scaleQuantityDetail("2 to 3 tbsp", 0.5), {
    text: "1–1 ½ tbsp",
    unparseable: false,
    approximate: false,
  });
  // Compounds scale piece by piece.
  assert.equal(scaleQuantityDetail("2 cups + 1 tbsp", 2).text, "4 cups + 2 tbsp");
  // Tidy units: exact conversions only.
  assert.equal(scaleQuantityDetail("48 tsp", 1.5).text, "1 ½ cups");
  assert.equal(scaleQuantityDetail("24 tsp", 2).text, "1 cup");
  assert.equal(scaleQuantityDetail("3 tsp", 2).text, "2 tbsp");
  assert.equal(scaleQuantityDetail("12 tsp", 2).text, "½ cup");
  // 16 tbsp is 1 cup; 8 tbsp is ½ cup.
  assert.equal(scaleQuantityDetail("8 tbsp", 2).text, "1 cup");
  // Unquantified stays as written; unparseable leading numbers flag.
  assert.deepEqual(scaleQuantityDetail("a pinch", 2), {
    text: "a pinch",
    unparseable: false,
    approximate: false,
  });
  assert.equal(scaleQuantityDetail("1/0 cup", 2).unparseable, true);
  assert.equal(scaleQuantityDetail("1..2 cups", 2).unparseable, true);
  assert.equal(scaleQuantityDetail("1/0 cup", 2).text, "1/0 cup");
  // Invalid factor returns the input unchanged.
  assert.equal(scaleQuantityDetail("1 cup", 0).text, "1 cup");
  assert.equal(scaleQuantityDetail("1 cup", -2).text, "1 cup");
  assert.equal(scaleQuantityDetail("1 cup", NaN).text, "1 cup");
  // Scaling by exactly 1 is the identity (no tidy conversion).
  assert.equal(scaleQuantityDetail("48 tsp", 1).text, "48 tsp");
  // Rounding carries the ≈ marker.
  const rounded = scaleQuantityDetail("1 cup", 0.4);
  assert.equal(rounded.text, "≈⅜ cup");
  assert.equal(rounded.approximate, true);
});

test("countNoteFor turns a fractional count into a usable instruction (RECIPE-2)", () => {
  assert.equal(
    countNoteFor({ name: "Eggs", quantity: "1 egg" }, "1/2 egg"),
    "— beat 1 egg and use half"
  );
  assert.equal(
    countNoteFor({ name: "Eggs", quantity: "3 eggs" }, "1 1/2 eggs"),
    "— beat 2 eggs and use ½ of them"
  );
  // Whole counts and measured quantities need no note.
  assert.equal(countNoteFor({ name: "Eggs", quantity: "2 eggs" }, "1 egg"), "");
  assert.equal(countNoteFor({ name: "Flour", quantity: "500 g" }, "250 g"), "");
  assert.equal(countNoteFor({ name: "Garlic", quantity: "3 cloves" }, "1 1/2 cloves"), "— prepare 2 cloves and use ½ of them");
  // A leading ≈ is stripped before parsing.
  assert.equal(
    countNoteFor({ name: "Eggs", quantity: "1 egg" }, "≈1/2 egg"),
    "— beat 1 egg and use half"
  );
});

test("parseFlatIngredient reads a flat string: first number anywhere + unit word (RECIPE-24)", () => {
  assert.deepEqual(parseFlatIngredient("500 g penne rigate"), {
    name: "penne rigate",
    quantity: "500 g",
    note: "",
    raw: "500 g penne rigate",
  });
  assert.deepEqual(parseFlatIngredient("1 1/2 cups flour"), {
    name: "flour",
    quantity: "1 1/2 cups",
    note: "",
    raw: "1 1/2 cups flour",
  });
  assert.deepEqual(parseFlatIngredient("Salt to taste"), {
    name: "Salt to taste",
    quantity: "",
    note: "",
    raw: "Salt to taste",
  });
  // A flat string keeps its tail as the name: the comma-separated
  // preparation ("beaten") stays part of the ingredient text, the
  // way the raw string reads — it is not silently reclassified.
  assert.deepEqual(parseFlatIngredient("2 eggs, beaten"), {
    name: "eggs, beaten",
    quantity: "2",
    note: "",
    raw: "2 eggs, beaten",
  });
});

test("mergeIngredientEntries dedups across lists only, entries first (RECIPE-11)", () => {
  const entries = [
    { type: "section", name: "Sauce" },
    { type: "ingredient", name: "Tomatoes", quantity: "500 g", note: "", raw: "500 g tomatoes" },
  ];
  const flat = [
    { name: "Tomatoes", quantity: "500 g", note: "", raw: "500 g tomatoes" },
    { name: "Basil", quantity: "", note: "", raw: "Basil" },
  ];
  const merged = mergeIngredientEntries(entries, flat);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].type, "section");
  assert.equal(merged[1].name, "Tomatoes");
  assert.equal(merged[2].name, "Basil");
  // Duplicates inside the ENTRIES list are kept verbatim (the
  // entries are authoritative and ordered — a recipe can genuinely
  // need the same thing twice), while the flat list is supplementary
  // and deduped against everything already merged.
  const entryDupes = mergeIngredientEntries(
    [
      { type: "ingredient", name: "Salt", quantity: "1 tsp", note: "", raw: "1 tsp salt" },
      { type: "ingredient", name: "Salt", quantity: "1 tsp", note: "", raw: "1 tsp salt" },
    ],
    []
  );
  assert.equal(entryDupes.length, 2);
  const flatDupes = mergeIngredientEntries([], [
    { name: "Salt", quantity: "1 tsp", note: "", raw: "1 tsp salt" },
    { name: "Salt", quantity: "1 tsp", note: "", raw: "1 tsp salt" },
  ]);
  assert.equal(flatDupes.length, 1);
});

test("normalizeRecipe renders flat-string-only recipes (RECIPE-24)", () => {
  const recipe = normalizeRecipe({
    id: "rec-flat",
    name: "Flat Soup",
    ingredients: ["1 kg tomatoes", "1 onion, diced", "Salt to taste"],
    preparation_steps: ["Simmer."],
  });
  // The merged entries ARE the flat list now (RECIPE-11 fix): the
  // merge always runs, so a flat-only recipe's entries carry its
  // (deduped) flat ingredients instead of staying empty.
  assert.equal(recipe.entries.length, 3);
  assert.equal(recipe.ingredients.length, 3);
  assert.equal(recipe.ingredients[0].name, "tomatoes");
  assert.equal(recipe.ingredients[0].quantity, "1 kg");
  assert.equal(recipe.ingredients[1].name, "onion, diced");
  assert.equal(recipe.ingredients[2].name, "Salt to taste");
});

test("normalizeRecipe collapses duplicate flat-string ingredients (RECIPE-11)", () => {
  // rec-t9 live shape: the same flat line twice is ONE ingredient
  // listed twice, not two rows. The merge must run even with no
  // entries — before the fix this rendered 5 rows live.
  const recipe = normalizeRecipe({
    id: "rec-t9",
    name: "Test Duplicate Ingredients",
    ingredients: ["Garlic 2 cloves", "Garlic 2 cloves", "Olive oil 2 tbsp", "Olive oil 2 tbsp", "Salt 1 tsp"],
    preparation_steps: ["Cook."],
  });
  assert.equal(recipe.entries.length, 3);
  assert.deepEqual(
    recipe.entries.map((item) => item.name.toLowerCase()),
    ["garlic", "olive oil", "salt"]
  );
  assert.equal(recipe.entries[0].quantity, "2 cloves");
});

test("scaleStepText scales quantities in steps, leaves times alone (RECIPE-23)", () => {
  assert.equal(
    scaleStepText("Add 2 cups of stock and simmer for 9 minutes.", 0.5),
    "Add 1 cup of stock and simmer for 9 minutes."
  );
  assert.equal(
    scaleStepText("Stir in 1 1/2 tbsp of butter.", 2),
    "Stir in 3 tbsp of butter."
  );
  assert.equal(
    scaleStepText("Add 2–3 cloves of garlic.", 2),
    "Add 4–6 cloves of garlic."
  );
  // No factor, or factor 1: the text is untouched.
  assert.equal(scaleStepText("Add 2 cups.", 1), "Add 2 cups.");
  assert.equal(scaleStepText("Add 2 cups.", null), "Add 2 cups.");
  // An unparseable amount is left as written.
  assert.equal(scaleStepText("Add 1/0 cups.", 2), "Add 1/0 cups.");
});

test("renderStepText renders a range as ONE chip starting the upper bound (RECIPE-6)", () => {
  const ranged = renderStepText("Simmer for 6 to 8 minutes.");
  assert.equal(ranged.header, false);
  assert.match(ranged.html, /6–8 minutes/);
  assert.match(ranged.html, /data-seconds="480"/);
  assert.equal((ranged.html.match(/time-chip/g) || []).length, 1);
  // A combined duration is still one chip per part.
  const combined = renderStepText("Bake for 1 hour 30 minutes.");
  assert.equal((combined.html.match(/time-chip/g) || []).length, 2);
});

test("formatStarsText pairs stars with the number (RECIPE-14)", () => {
  assert.equal(formatStarsText(4), "★★★★☆ 4/5");
  assert.equal(formatStarsText(5), "★★★★★ 5/5");
  assert.equal(formatStarsText(0), "");
  assert.equal(formatStarsText(null), "");
});

test("formatServingsRange reads as a range (RECIPE-3)", () => {
  assert.equal(formatServingsRange({ low: 4, high: 4 }), "4");
  assert.equal(formatServingsRange({ low: 4, high: 6 }), "4–6");
  assert.equal(formatServingsRange(null), "");
});

test("sortRecipes sorts by rating, cook and prep, nulls last (RECIPE-19)", () => {
  const byRating = sortRecipes(
    [
      { name: "B", rating: 0 },
      { name: "A", rating: 5 },
      { name: "C", rating: null },
      { name: "D", rating: 3 },
    ],
    "rating"
  ).map((r) => r.name);
  assert.deepEqual(byRating, ["A", "D", "B", "C"]);
  const byCook = sortRecipes(
    [
      { name: "B", cookTime: null },
      { name: "A", cookTime: 600 },
      { name: "C", cookTime: 300 },
    ],
    "cook"
  ).map((r) => r.name);
  assert.deepEqual(byCook, ["C", "A", "B"]);
  const byPrep = sortRecipes(
    [
      { name: "B", prepTime: 900 },
      { name: "A", prepTime: 300 },
    ],
    "prep"
  ).map((r) => r.name);
  assert.deepEqual(byPrep, ["A", "B"]);
  // Ties break by name; the default key is name.
  assert.deepEqual(
    sortRecipes([{ name: "b" }, { name: "A" }]).map((r) => r.name),
    ["A", "b"]
  );
});

test("detectDevice: the exact 1920x1200 panel is the hub FIRST, even with a mouse and no touch (spec §3.7)", () => {
  assert.deepEqual(
    detectDevice({ width: 1920, height: 1200, finePointer: true, coarsePointer: false, touch: false, userAgent: "" }),
    { category: "hub", orientation: "landscape" }
  );
  // A bare wide landscape desktop monitor is NOT the hub.
  assert.deepEqual(
    detectDevice({ width: 1920, height: 1080, finePointer: true, coarsePointer: false, touch: false, userAgent: "" }),
    { category: "desktop", orientation: "landscape" }
  );
  // The portrait panel is not the hub signature.
  assert.deepEqual(
    detectDevice({ width: 1200, height: 1920, finePointer: false, coarsePointer: true, touch: true, userAgent: "" }),
    { category: "mobile", orientation: "portrait" }
  );
});

test("isKioskMode reads the ?kiosk URL (RECIPE-16)", () => {
  assert.equal(isKioskMode("?kiosk"), true);
  assert.equal(isKioskMode("?kiosk=1"), true);
  assert.equal(isKioskMode("?recipe=abc&kiosk"), true);
  assert.equal(isKioskMode(""), false);
  assert.equal(isKioskMode("?recipe=abc"), false);
  assert.equal(isKioskMode(null), false);
});

test("timer helpers: name, remaining, formatting (RECIPE-22)", () => {
  // timer_name wins; friendly_name is the fallback with the
  // "kitchen_hub " prefix stripped.
  assert.equal(
    timerName({ entity_id: "sensor.satellite_timer_1", attributes: { timer_name: "Pasta", friendly_name: "kitchen_hub Pasta" } }),
    "Pasta"
  );
  assert.equal(
    timerName({ entity_id: "sensor.satellite_timer_1", attributes: { friendly_name: "kitchen_hub Pasta" } }),
    "Pasta"
  );
  assert.equal(
    timerName({ entity_id: "sensor.satellite_timer_1", attributes: {} }),
    "sensor.satellite_timer_1"
  );
  // finishes_at wins over the remaining attribute; finished is 0.
  const now = Date.parse("2026-11-08T12:00:00Z");
  assert.equal(
    timerRemainingSeconds(
      { state: "active", attributes: { finishes_at: "2026-11-08T12:07:32Z", remaining: 999 } },
      now
    ),
    452
  );
  assert.equal(
    timerRemainingSeconds({ state: "active", attributes: { remaining: 452 } }, now),
    452
  );
  assert.equal(
    timerRemainingSeconds({ state: "finished", attributes: { finishes_at: "2026-11-08T12:07:32Z" } }, now),
    0
  );
  assert.equal(timerRemainingSeconds({ state: "active", attributes: {} }, now), null);
  assert.equal(formatRemaining(452), "7:32");
  assert.equal(formatRemaining(3912), "1:05:12");
  assert.equal(formatRemaining(0), "0:00");
  // runningTimers: active or paused bridge sensors, soonest first.
  const states = [
    { entity_id: "sensor.satellite_timer_b", state: "active", attributes: { finishes_at: "2026-11-08T12:10:00Z", timer_name: "B" } },
    { entity_id: "sensor.satellite_timer_a", state: "paused", attributes: { finishes_at: "2026-11-08T12:05:00Z", timer_name: "A" } },
    { entity_id: "sensor.satellite_timer_c", state: "finished", attributes: { finishes_at: "2026-11-08T12:01:00Z", timer_name: "C" } },
    { entity_id: "sensor.other", state: "active", attributes: {} },
  ];
  assert.deepEqual(
    runningTimers(states).map((t) => t.entity_id),
    ["sensor.satellite_timer_a", "sensor.satellite_timer_b"]
  );
  // The same, with hass.states as the plain object keyed by
  // entity_id that the live frontend actually hands cards (rig,
  // HA 2026.2.3) — the array-only version returned no timers live.
  const statesObj = {
    sensor_satellite_timer_b: states[0],
    sensor_satellite_timer_a: states[1],
    sensor_satellite_timer_c: states[2],
    sensor_other: states[3],
  };
  assert.deepEqual(
    runningTimers(statesObj).map((t) => t.entity_id),
    ["sensor.satellite_timer_a", "sensor.satellite_timer_b"]
  );
  assert.deepEqual(runningTimers(null), []);
  assert.deepEqual(runningTimers(undefined), []);
  assert.deepEqual(runningTimers("nope"), []);
});

// -- tablet category (DESIGN-9, Phase 7) -----------------------------------
// The fourth device category: hub / desktop / tablet / mobile. The
// tablet band is a touch screen 768-1024px wide, either orientation,
// plus the tablet user agents (iPad; Android without a "Mobi" token).

test("detectDevice: tablet category — band, iPad, Android tablet (DESIGN-9)", () => {
  // The spec viewports: 1024x768 landscape and 768x1024 portrait.
  assert.equal(
    detectDevice({ width: 1024, height: 768, coarsePointer: true, touch: true }).category,
    "tablet"
  );
  assert.equal(
    detectDevice({ width: 768, height: 1024, coarsePointer: true, touch: true }).category,
    "tablet"
  );
  // The other spec tablet viewports: 900x1440, 768x1366.
  assert.equal(
    detectDevice({ width: 900, height: 1440, coarsePointer: true, touch: true }).category,
    "tablet"
  );
  assert.equal(
    detectDevice({ width: 768, height: 1366, coarsePointer: true, touch: true }).category,
    "tablet"
  );
  // iPad user agent is a tablet whatever the viewport (even a wide
  // one — the UA wins over size, as the mobile UA does for phones).
  assert.equal(
    detectDevice({
      width: 1440,
      height: 900,
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    }).category,
    "tablet"
  );
  // Android tablet: "Android" with no "Mobi"/"Mobile" token.
  assert.equal(
    detectDevice({
      width: 1280,
      height: 800,
      coarsePointer: true,
      touch: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    }).category,
    "tablet"
  );
  // Android phone: the same OS string WITH the "Mobile" token.
  assert.equal(
    detectDevice({
      width: 1280,
      height: 800,
      coarsePointer: true,
      touch: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    }).category,
    "mobile"
  );
  // Boundaries of the band: 767px wide is mobile, 1025px wide with a
  // coarse pointer (and no hub-size landscape) is mobile too.
  assert.equal(
    detectDevice({ width: 767, height: 1024, coarsePointer: true, touch: true }).category,
    "mobile"
  );
  assert.equal(
    detectDevice({ width: 1025, height: 768, coarsePointer: true, touch: true }).category,
    "mobile"
  );
  // OQ-7 DECIDED (review 3 §4): a touchscreen laptop at 1366x768
  // reads as DESKTOP, not mobile — it has a fine pointer. Without
  // the fine pointer it is a touch-only device and stays mobile.
  assert.equal(
    detectDevice({ width: 1366, height: 768, coarsePointer: true, touch: true }).category,
    "mobile"
  );
  assert.equal(
    detectDevice({ width: 1366, height: 768, coarsePointer: true, finePointer: true, touch: true }).category,
    "desktop"
  );
  // The portrait touch laptop (1080x1920) with a mouse is desktop
  // too (P8-16 §5 decided mapping).
  assert.equal(
    detectDevice({ width: 1080, height: 1920, coarsePointer: true, finePointer: true, touch: true }).category,
    "desktop"
  );
  // A huge portrait touch screen is mobile, not the hub (the hub is
  // landscape) — and not a tablet either (1200px is outside the band).
  assert.equal(
    detectDevice({ width: 1200, height: 1920, coarsePointer: true, touch: true }).category,
    "mobile"
  );
});

// -- Phase 7 CSS: tablet rules, bottom-edge fix, reduced motion ----------

test("Phase 7 CSS: tablet rules, bottom-edge padding, reduced motion", () => {
  // Tablet (DESIGN-9, OQ-4): every tap target raised to the 56-64px
  // band (chips 44->56, tabs/sort/stars/scaler 52->56).
  assert.match(CARD_CSS, /\.screen\.dev-tablet \.chip \{ min-height: 56px;/);
  assert.match(CARD_CSS, /\.screen\.dev-tablet \.tab \{ min-height: 56px;/);
  assert.match(CARD_CSS, /\.screen\.dev-tablet \.time-chip \{ min-height: 56px; \}/);
  assert.match(CARD_CSS, /\.screen\.dev-tablet \.star \{ min-width: 56px; min-height: 56px;/);
  assert.match(CARD_CSS, /\.screen\.dev-tablet \.nav-strip-button \{ min-height: 56px;/);
  // Bottom-edge fix: list + detail padding equals the sticky strip
  // height (mobile 60px, tablet 76px).
  assert.match(CARD_CSS, /\.screen\.dev-mobile \.list \{ padding-bottom: 60px; \}/);
  assert.match(CARD_CSS, /\.screen\.dev-mobile \.detail \{ padding-bottom: 60px; \}/);
  assert.match(CARD_CSS, /\.screen\.dev-tablet \.list \{ padding-bottom: 76px; \}/);
  assert.match(CARD_CSS, /\.screen\.dev-tablet \.detail \{[^}]*padding-bottom: 76px;/s);
  // Reduced motion (DESIGN-6, WCAG 2.2): the skeleton pulse stops.
  assert.ok(CARD_CSS.includes("@media (prefers-reduced-motion: reduce)"));
  assert.match(
    CARD_CSS,
    /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.skeleton-thumb, \.skeleton-line \{ animation: none; \}/s
  );
  // The skeleton pulse itself still exists in the base rules (the
  // loading state is a guardrail — reduced motion only disables it
  // under the media query).
  assert.ok(CARD_CSS.includes("animation: pulse 1.4s ease-in-out infinite"));
});

// -- Phase 7 session persistence (DESIGN-7) -------------------------------

test("parseRecipeSession/serializeRecipeSession: round-trip, garbage -> null, bad id -> null", () => {
  assert.equal(RECIPE_SESSION_KEY, "family-hub:recipe:state");
  const state = { openId: "abc123", listScrollY: 400, detailScrollY: 120 };
  assert.deepEqual(parseRecipeSession(serializeRecipeSession(state)), state);
  assert.equal(parseRecipeSession(null), null);
  assert.equal(parseRecipeSession(""), null);
  assert.equal(parseRecipeSession("not json"), null);
  assert.equal(parseRecipeSession("[1,2]"), null);
  assert.deepEqual(parseRecipeSession("{}"), {
    openId: null,
    listScrollY: 0,
    detailScrollY: 0,
  });
  // A blank or non-string id means list view; scrolls sanitise.
  assert.deepEqual(parseRecipeSession('{"openId": "  ", "listScrollY": -5, "detailScrollY": 12.9}'), {
    openId: null,
    listScrollY: 0,
    detailScrollY: 12,
  });
  assert.deepEqual(parseRecipeSession('{"openId": 42}').openId, null);
});

// -- Phase 7: success green (OQ-1) -----------------------------------------

test("Phase 7 CSS: the Saved status lines use the success green, errors stay red", () => {
  assert.ok(CARD_CSS.includes("--success: #166534;"));
  assert.match(
    CARD_CSS,
    /\.note-status,\s*\.rating-status \{[^}]*color: var\(--success\);/s
  );
  assert.match(
    CARD_CSS,
    /\.note-status\.error,\s*\.rating-status\.error \{ color: var\(--error\); \}/s
  );
});
