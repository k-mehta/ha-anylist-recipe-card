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
  formatStars,
  renderStepText,
  renderIngredientRow,
  sortRecipes,
  filterByCollection,
  detectDevice,
  readDeviceEnv,
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
  assert.deepEqual(recipe.ingredients, [{ name: "Eggs", quantity: "2", note: "", raw: "" }]);
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
  assert.deepEqual(recipe.entries, []);
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
    ["Prep 10 min", "Cook 20 min", "Serves 4", "★★★★★"]
  );
  assert.deepEqual(formatMeta(normalizeRecipe({ id: "a", name: "B" })), []);
  assert.deepEqual(
    formatMeta(normalizeRecipe({ id: "a", name: "B", prep_time: 900, rating: 3 })),
    ["Prep 15 min", "★★★☆☆"]
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
      '<span class="meta-seg stars">★★★★★</span>'
  );
  assert.equal(formatMetaHtml(normalizeRecipe({ id: "a", name: "B" })), "");
  assert.equal(
    formatMetaHtml(normalizeRecipe({ id: "a", name: "B", prep_time: 900, rating: 3 })),
    '<span class="meta-seg">Prep 15 min</span><span class="meta-sep" aria-hidden="true">·</span>' +
      '<span class="meta-seg stars">★★★☆☆</span>'
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

test("searchRecipes ranks an exact title first, then word coverage", () => {
  const recipes = [
    normalizeRecipe({ id: "1", name: "Carrot Soup" }),
    normalizeRecipe({ id: "2", name: "Carrot Ginger Soup" }),
    normalizeRecipe({ id: "3", name: "Tomato Soup" }),
  ];
  assert.deepEqual(searchRecipes(recipes, "Carrot Soup").map((r) => r.name), [
    "Carrot Soup",
    "Carrot Ginger Soup",
    "Tomato Soup",
  ]);
});

test("searchRecipes needs at least half the query words to match", () => {
  const recipes = [
    normalizeRecipe({ id: "1", name: "Carrot Ginger Soup" }),
    normalizeRecipe({ id: "2", name: "Tomato Soup" }),
  ];
  assert.equal(searchRecipes(recipes, "carrot banana mango").length, 0);
  assert.equal(searchRecipes(recipes, "zzz").length, 0);
  assert.equal(searchRecipes(recipes, "").length, 0);
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

test("detectDevice: a desktop touchscreen that size reads as the hub (documented limit)", () => {
  assert.deepEqual(
    detectDevice({
      width: 1920,
      height: 1080,
      coarsePointer: true,
      finePointer: false,
      touch: true,
      userAgent: DESKTOP_UA,
    }),
    { category: "hub", orientation: "landscape" }
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

test("detectDevice: tablets are mobile in both orientations", () => {
  assert.deepEqual(
    detectDevice({
      width: 768,
      height: 1024,
      coarsePointer: true,
      finePointer: false,
      touch: true,
      userAgent: IPAD_UA,
    }),
    { category: "mobile", orientation: "portrait" }
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
    { category: "mobile", orientation: "landscape" }
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
