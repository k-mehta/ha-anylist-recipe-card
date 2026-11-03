const test = require("node:test");
const assert = require("node:assert/strict");

// A minimal DOM, just enough for the card: elements with children,
// attributes, dataset, classList, style, textContent, innerHTML (parsed
// from the strings the card writes), querySelector, event dispatch and
// getBoundingClientRect. The card never touches anything else.
// (Adapted from the timer-screen card's DOM test harness.)

function decodeEntities(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseHtml(html) {
  const roots = [];
  const stack = [];
  const token = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let match;
  while ((match = token.exec(html)) !== null) {
    if (match[5] !== undefined) {
      const text = decodeEntities(match[5]);
      if (text.trim() === "") continue;
      const node = new FakeElement("#text");
      node._ownText = text;
      if (stack.length > 0) stack[stack.length - 1].appendChild(node);
      else roots.push(node);
      continue;
    }
    const [, closing, tag, attrs, selfClosing] = match;
    if (closing) {
      stack.pop();
      continue;
    }
    const el = new FakeElement(tag);
    for (const [, name, value] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) {
      const decoded = decodeEntities(value);
      if (name === "class") {
        for (const cls of decoded.split(/\s+/)) if (cls) el.classList.add(cls);
      } else if (name.startsWith("data-")) {
        const key = name
          .slice(5)
          .replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        el.dataset[key] = decoded;
      } else {
        el.setAttribute(name, decoded);
      }
    }
    if (stack.length > 0) stack[stack.length - 1].appendChild(el);
    else roots.push(el);
    if (!selfClosing) stack.push(el);
  }
  return roots;
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this._classSet = new Set();
    this._ownText = "";
    this._listeners = {};
    this.hidden = false;
    this.disabled = false;
  }

  get classList() {
    const set = this._classSet;
    return {
      add: (...names) => names.forEach((n) => set.add(n)),
      remove: (...names) => names.forEach((n) => set.delete(n)),
      toggle: (name, force) => {
        if (force === undefined) {
          if (set.has(name)) set.delete(name);
          else set.add(name);
        } else if (force) set.add(name);
        else set.delete(name);
        return set.has(name);
      },
      contains: (name) => set.has(name),
    };
  }

  get className() {
    return [...this._classSet].join(" ");
  }

  set className(value) {
    this._classSet = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get textContent() {
    if (this._ownText) return this._ownText;
    return this.children.map((c) => c.textContent).join("");
  }

  set textContent(value) {
    this._ownText = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this.children.map((c) => c._serialize()).join("");
  }

  set innerHTML(value) {
    this._ownText = "";
    this.children = [];
    for (const node of parseHtml(String(value))) this.appendChild(node);
  }

  _serialize() {
    if (this.tagName === "#TEXT") return this._ownText;
    const attrs = [];
    if (this._classSet.size > 0) attrs.push(`class="${[...this._classSet].join(" ")}"`);
    for (const [key, value] of Object.entries(this.dataset)) {
      const name = "data-" + key.replace(/[A-Z]/g, (ch) => "-" + ch.toLowerCase());
      attrs.push(`${name}="${value}"`);
    }
    for (const [name, value] of Object.entries(this.attributes)) {
      attrs.push(`${name}="${value}"`);
    }
    const style = Object.entries(this.style)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    if (style) attrs.push(`style="${style}"`);
    if (this.hidden) attrs.push("hidden");
    if (this.disabled) attrs.push("disabled");
    const open = `<${this.tagName.toLowerCase()}${attrs.length ? " " + attrs.join(" ") : ""}>`;
    return open + this.children.map((c) => c._serialize()).join("") + this._ownText + `</${this.tagName.toLowerCase()}>`;
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  addEventListener(type, fn) {
    this._listeners[type] = fn;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const found = [];
    const walk = (el) => {
      if (el !== this && matches(el, selector)) found.push(el);
      for (const child of el.children) walk(child);
    };
    for (const child of this.children) walk(child);
    return found;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
}

function matches(el, selector) {
  if (el.tagName === "#TEXT") return false;
  const dataAttr = /^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (dataAttr) {
    const key = dataAttr[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    if (!(key in el.dataset)) return false;
    return dataAttr[2] === undefined || el.dataset[key] === dataAttr[2];
  }
  const classOnly = /^\.([\w-]+(?:\.[\w-]+)*)$/.exec(selector);
  if (classOnly) return classOnly[1].split(".").every((cls) => el.classList.contains(cls));
  const tagClass = /^([a-zA-Z][\w-]*)\.([\w-]+(?:\.[\w-]+)*)$/.exec(selector);
  if (tagClass) {
    return (
      el.tagName === tagClass[1].toUpperCase() &&
      tagClass[2].split(".").every((cls) => el.classList.contains(cls))
    );
  }
  if (/^[a-zA-Z][\w-]*$/.test(selector)) {
    return el.tagName === selector.toUpperCase();
  }
  return false;
}

class FakeShadowRoot extends FakeElement {
  constructor() {
    super("#shadow-root");
  }

  dispatchClick(target) {
    const fn = this._listeners.click;
    if (fn) fn({ target });
  }

  dispatchInput(target) {
    const fn = this._listeners.input;
    if (fn) fn({ target });
  }
}

class FakeHTMLElement {
  attachShadow() {
    this.shadowRoot = new FakeShadowRoot();
    return this.shadowRoot;
  }
}

globalThis.HTMLElement = FakeHTMLElement;
globalThis.customElements = { define: () => {} };
globalThis.document = { createElement: (tag) => new FakeElement(tag) };

const { AnyListRecipeViewCard } = require("./anylist-recipe-view-card.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function flush() {
  await sleep(20);
}

function fakeTarget(action, extra = {}) {
  return {
    closest: () => ({ dataset: { action, ...extra } }),
  };
}

// Fixtures in the exact shapes the integration's actions return.
function lightRecipe(id, name, overrides = {}) {
  return {
    id,
    name,
    ingredients: [],
    preparation_steps: [],
    note: "",
    source_name: "",
    source_url: "",
    servings: "",
    prep_time: null,
    cook_time: null,
    rating: null,
    photo_urls: [],
    collections: [],
    ...overrides,
  };
}

const PASTA_LIGHT = lightRecipe("rec-pasta", "Creamy Tomato Pasta", {
  servings: "4",
  prep_time: 600,
  cook_time: 1200,
  rating: 5,
  photo_urls: ["https://photos.anylist.com/abc123.jpg"],
  collections: [{ id: "col-pasta", name: "Pasta" }],
});
const SOUP_LIGHT = lightRecipe("rec-soup", "Tomato Soup", {
  servings: "2",
  prep_time: 300,
  cook_time: 1500,
  collections: [{ id: "col-soup", name: "Soup" }],
});
const RICE_LIGHT = lightRecipe("rec-rice", "Rice Pudding", {
  servings: "6",
  prep_time: 300,
  cook_time: 2700,
  rating: 4,
});

const PASTA_FULL = {
  ...PASTA_LIGHT,
  ingredients: [
    { name: "Penne", quantity: "500 g", note: "", raw_ingredient: "500 g penne" },
    { name: "Cherry tomatoes", quantity: "400 g", note: "halved", raw_ingredient: "400 g cherry tomatoes, halved" },
    { name: "Cream", quantity: "200 ml", note: "", raw_ingredient: "200 ml cream" },
  ],
  preparation_steps: [
    "Boil the pasta in salted water until al dente.",
    "Meanwhile, soften the tomatoes in a pan.",
    "Stir in the cream, add the pasta, and serve.",
  ],
  note: "Vihaan likes this with extra cheese.",
  source_name: "Family cookbook",
};

// Chips derive from the loaded recipes now — there is no
// get_collections call and no separate collections fixture.

// A fake hass whose callWS answers like the real AnyList actions and
// records every call, so tests can assert exactly which services the
// card uses — and that it never touches the shopping list.
//
// One download per view-open: get_recipes returns the FULL recipes
// (ingredients and steps included), so the detail view reads from
// memory. search_recipes, get_recipe and get_collections are gone —
// the fake fails loudly if the card ever calls one.
function fakeHass(options = {}) {
  const calls = [];
  const pasta = options.detail ?? PASTA_FULL;
  const all = options.recipes ?? [pasta, SOUP_LIGHT, RICE_LIGHT];
  const fail = options.fail ?? {};
  return {
    calls,
    callWS: async (message) => {
      calls.push([message.domain, message.service, message.service_data]);
      if (message.domain !== "anylist") {
        throw new Error(`Service ${message.domain}.${message.service} not found`);
      }
      if (fail[message.service]) throw new Error(fail[message.service]);
      switch (message.service) {
        case "get_recipes":
          return { response: { recipes: all } };
        case "update_recipe": {
          // The fork returns the updated recipe when return_response
          // is set. The fake applies the changed fields to the detail
          // recipe, so the card can refresh its copy from the
          // response — exactly what the real action returns.
          const data = message.service_data || {};
          const updated = {
            ...pasta,
            note: data.note !== undefined ? data.note : pasta.note,
            rating: data.rating !== undefined ? data.rating : pasta.rating,
          };
          return { response: { recipe: updated } };
        }
        default:
          throw new Error(`Service anylist.${message.service} must not be called`);
      }
    },
  };
}
async function loadedCard(options) {
  const card = new AnyListRecipeViewCard();
  card.setConfig({});
  const hass = fakeHass(options);
  card.hass = hass;
  await flush();
  return { card, hass };
}

test("loading state shows skeleton rows in the list grid, not a bare Loading line", () => {
  const card = new AnyListRecipeViewCard();
  card.setConfig({});
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Loading recipes/);
  assert.equal(card.shadowRoot.querySelectorAll(".skeleton-row").length, 6);
  assert.match(card.shadowRoot.innerHTML, /Search recipes/);
});

test("the hidden view actually hides — the list-view flex rule does not override [hidden]", async () => {
  const { card } = await loadedCard();
  // The guard lives in the card's own CSS: without it, the .list-view
  // display:flex rule beats the browser's built-in [hidden] hiding and
  // the list stays visible under the open recipe.
  assert.match(card.shadowRoot.innerHTML, /\.list-view\[hidden\][^{]*\{[^}]*display: none/);
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  assert.equal(card.shadowRoot.querySelector(".list-view").hidden, true);
  assert.equal(card.shadowRoot.querySelector(".detail-view").hidden, false);
});

test("meta segments are unbreakable units and the rating is an amber stars segment", async () => {
  const { card } = await loadedCard();
  const row = card.shadowRoot.querySelector(".row");
  const segments = row.querySelectorAll(".meta-seg");
  assert.deepEqual(
    segments.map((s) => s.textContent),
    ["Prep 10 min", "Cook 20 min", "Serves 4", "★★★★★"]
  );
  assert.equal(segments[3].classList.contains("stars"), true);
  assert.equal(segments[0].classList.contains("stars"), false);
  // Collections are mini-pills, not a comma-joined line.
  const pills = row.querySelectorAll(".mini-pill");
  assert.deepEqual(
    pills.map((p) => p.textContent),
    ["Pasta"]
  );
});

test("the chips row is marked scrollable only when the chips actually overflow", async () => {
  const { card } = await loadedCard();
  const chipsEl = card.shadowRoot.querySelector(".chips");
  // No layout in the fake DOM: widths are not numbers, so the row is
  // never marked scrollable.
  assert.equal(chipsEl.classList.contains("scrollable"), false);
  // Simulate overflow, then a row that fits.
  chipsEl.scrollWidth = 2000;
  chipsEl.clientWidth = 1000;
  card._updateChipsFade();
  assert.equal(chipsEl.classList.contains("scrollable"), true);
  chipsEl.scrollWidth = 1000;
  chipsEl.clientWidth = 1000;
  card._updateChipsFade();
  assert.equal(chipsEl.classList.contains("scrollable"), false);
  // A fraction of a pixel of sub-pixel rounding is not overflow.
  chipsEl.scrollWidth = 1003;
  chipsEl.clientWidth = 1000;
  card._updateChipsFade();
  assert.equal(chipsEl.classList.contains("scrollable"), false);
});

test("reopening the view reloads fresh data — and there is no Refresh button", async () => {
  const { card, hass } = await loadedCard();
  assert.equal(hass.calls.length, 1);
  // No manual refresh control anywhere in the card.
  assert.equal(card.shadowRoot.querySelector('[data-action="refresh"]'), null);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Refresh/);
  // Lovelace re-attaches the card each time its view opens: that
  // attach reloads, exactly one more get_recipes.
  card.connectedCallback();
  await flush();
  assert.deepEqual(hass.calls, [
    ["anylist", "get_recipes", { include_ingredients: true, include_steps: true }],
    ["anylist", "get_recipes", { include_ingredients: true, include_steps: true }],
  ]);
  assert.equal(card.shadowRoot.querySelectorAll(".row").length, 3);
});

test("list renders rows with photo, name and metadata, sorted alphabetically", async () => {
  const { card, hass } = await loadedCard();
  const rows = card.shadowRoot.querySelectorAll(".row");
  assert.equal(rows.length, 3);
  const html = card.shadowRoot.innerHTML;
  assert.ok(html.indexOf("Creamy Tomato Pasta") < html.indexOf("Rice Pudding"));
  assert.ok(html.indexOf("Rice Pudding") < html.indexOf("Tomato Soup"));
  assert.match(html, /Prep 10 min/);
  assert.match(html, /Cook 20 min/);
  assert.match(html, /Serves 4/);
  assert.match(html, /★★★★★/);
  assert.match(html, /photos\.anylist\.com\/abc123\.jpg/);
  assert.match(html, /3 recipes/);
  // The list load is the one full download: ingredients and steps
  // included, so the detail view never needs a second call.
  const getRecipes = hass.calls.find((c) => c[1] === "get_recipes");
  assert.deepEqual(getRecipes[2], { include_ingredients: true, include_steps: true });
});

test("collection chips filter the list", async () => {
  const { card } = await loadedCard();
  const chips = card.shadowRoot.querySelectorAll(".chip");
  assert.equal(chips.length, 3); // All recipes + Pasta + Soup
  card.shadowRoot.dispatchClick(fakeTarget("collection", { collectionId: "col-pasta" }));
  await flush();
  const rows = card.shadowRoot.querySelectorAll(".row");
  assert.equal(rows.length, 1);
  assert.match(card.shadowRoot.innerHTML, /Creamy Tomato Pasta/);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Tomato Soup/);
  card.shadowRoot.dispatchClick(fakeTarget("collection", { collectionId: "" }));
  await flush();
  assert.equal(card.shadowRoot.querySelectorAll(".row").length, 3);
});

test("typing a search filters locally (debounced) and makes no server call", async () => {
  const { card, hass } = await loadedCard();
  const input = card.shadowRoot.querySelector('[data-role="search"]');
  input.value = "tomato";
  card.shadowRoot.dispatchInput(input);
  // Not yet: the search waits for a pause in typing.
  await sleep(100);
  assert.equal(card.shadowRoot.querySelectorAll(".row").length, 3);
  await sleep(300);
  await flush();
  const rows = card.shadowRoot.querySelectorAll(".row");
  assert.equal(rows.length, 2); // Creamy Tomato Pasta + Tomato Soup
  assert.match(card.shadowRoot.innerHTML, /matching “tomato”/);
  // Typing cost no download: still exactly the one view-open call.
  assert.equal(hass.calls.length, 1);
  assert.equal(hass.calls[0][1], "get_recipes");
});

test("search 'carr' finds carrot recipes — the prefix the server search missed", async () => {
  const carrot = lightRecipe("rec-carrot", "Carrot Ginger Soup", {
    collections: [{ id: "col-soup", name: "Soup" }],
  });
  const { card, hass } = await loadedCard({ recipes: [PASTA_FULL, carrot, RICE_LIGHT] });
  const input = card.shadowRoot.querySelector('[data-role="search"]');
  input.value = "carr";
  card.shadowRoot.dispatchInput(input);
  await sleep(400);
  await flush();
  assert.equal(card.shadowRoot.querySelectorAll(".row").length, 1);
  assert.match(card.shadowRoot.innerHTML, /Carrot Ginger Soup/);
  assert.equal(hass.calls.length, 1);
});

test("a one-edit typo still finds the recipe", async () => {
  const carrot = lightRecipe("rec-carrot", "Carrot Ginger Soup", {
    collections: [{ id: "col-soup", name: "Soup" }],
  });
  const { card } = await loadedCard({ recipes: [PASTA_FULL, carrot, RICE_LIGHT] });
  await card._search("carot");
  await flush();
  assert.equal(card.shadowRoot.querySelectorAll(".row").length, 1);
  assert.match(card.shadowRoot.innerHTML, /Carrot Ginger Soup/);
});
test("clearing the search goes back to the full list", async () => {
  const { card } = await loadedCard();
  await card._search("tomato");
  await flush();
  assert.equal(card.shadowRoot.querySelectorAll(".row").length, 2);
  await card._search("");
  await flush();
  assert.equal(card.shadowRoot.querySelectorAll(".row").length, 3);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /matching/);
});

test("opening a recipe reads the detail from the loaded list — Cook tab first (ingredients + steps together), then the Notes tab", async () => {
  const twoCollections = {
    ...PASTA_FULL,
    collections: [
      { id: "col-pasta", name: "Pasta" },
      { id: "col-weeknight", name: "Weeknight" },
    ],
  };
  const { card, hass } = await loadedCard({ detail: twoCollections });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  // No second download: the view-open load already brought the detail.
  assert.equal(hass.calls.length, 1);
  assert.equal(hass.calls[0][1], "get_recipes");
  // Cooking mode: no photo hero and no metadata line in the detail
  // view — the photo lives only in the list (where it helps you pick
  // a recipe) and the metadata does not belong while cooking. The
  // name is a compact label, not a display title. (Scoped to the
  // detail view: the hidden list still shows the photo and meta.)
  const detailHtml = () => card.shadowRoot.querySelector(".detail-view").innerHTML;
  assert.match(detailHtml(), /Creamy Tomato Pasta/);
  assert.equal(card.shadowRoot.querySelectorAll(".detail-name").length, 1);
  assert.doesNotMatch(detailHtml(), /photos\.anylist\.com\/abc123\.jpg/);
  assert.equal(card.shadowRoot.querySelector(".detail-photo"), null);
  assert.doesNotMatch(detailHtml(), /Serves 4/);
  assert.doesNotMatch(detailHtml(), /Family cookbook/);
  // The Cook tab is the default panel: ingredients AND steps together.
  assert.match(detailHtml(), /500 g/);
  assert.match(detailHtml(), /Cherry tomatoes/);
  assert.match(detailHtml(), /halved/);
  assert.equal(card.shadowRoot.querySelectorAll(".ingredient").length, 3);
  assert.match(detailHtml(), /Boil the pasta/);
  assert.equal(card.shadowRoot.querySelectorAll(".step").length, 3);
  // Step 1 of 3 is current; the note lives on the Notes tab, not here.
  assert.match(detailHtml(), /Step 1 of 3/);
  assert.equal(card.shadowRoot.querySelectorAll(".step.current").length, 1);
  assert.doesNotMatch(detailHtml(), /Vihaan likes this with extra cheese/);
  // Notes tab: the note in an editable textarea, with a Save button
  // (disabled — nothing changed yet) and five stars showing the
  // saved rating. The old "can't be edited" gap line is gone.
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Vihaan likes this with extra cheese/);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /can't be edited from the hub yet/);
  const save = card.shadowRoot.querySelector('[data-action="save-note"]');
  assert.equal(save.getAttribute("disabled"), "disabled");
  assert.equal(card.shadowRoot.querySelectorAll(".star").length, 5);
  assert.equal(card.shadowRoot.querySelectorAll(".star.filled").length, 5);
  // There is no Details tab: metadata does not belong in the cooking view.
  assert.equal(card.shadowRoot.querySelector('[data-tab="details"]'), null);
  assert.equal(card.shadowRoot.querySelector(".detail-view").hidden, false);
  assert.equal(card.shadowRoot.querySelector(".list-view").hidden, true);
  // Back returns to the list.
  card.shadowRoot.dispatchClick(fakeTarget("back"));
  await flush();
  assert.equal(card.shadowRoot.querySelector(".list-view").hidden, false);
  assert.equal(card.shadowRoot.querySelectorAll(".row").length, 3);
});

test("detail shows two tabs — Cook and Notes — Cook active by default", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  const tabs = [...card.shadowRoot.querySelectorAll(".tab")];
  assert.deepEqual(
    tabs.map((t) => t.textContent),
    ["Cook", "Notes"],
  );
  assert.deepEqual(
    tabs.map((t) => t.getAttribute("aria-selected")),
    ["true", "false"],
  );
  assert.equal(card.shadowRoot.querySelector('[data-tab="cook"]').getAttribute("aria-selected"), "true");
});

test("switching tabs shows the right panel and marks only that tab active", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
  await flush();
  assert.equal(card.shadowRoot.querySelector('[data-tab="notes"]').getAttribute("aria-selected"), "true");
  assert.equal(card.shadowRoot.querySelector('[data-tab="cook"]').getAttribute("aria-selected"), "false");
  assert.match(card.shadowRoot.innerHTML, /Vihaan likes this with extra cheese/);
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "cook" }));
  await flush();
  assert.equal(card.shadowRoot.querySelector('[data-tab="cook"]').getAttribute("aria-selected"), "true");
  assert.match(card.shadowRoot.innerHTML, /Cherry tomatoes/);
});

test("opening a recipe always resets to the Cook tab", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
  await flush();
  assert.equal(card.shadowRoot.querySelector('[data-tab="notes"]').getAttribute("aria-selected"), "true");
  card.shadowRoot.dispatchClick(fakeTarget("back"));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  assert.equal(card.shadowRoot.querySelector('[data-tab="cook"]').getAttribute("aria-selected"), "true");
  assert.equal(card.shadowRoot.querySelector('[data-tab="notes"]').getAttribute("aria-selected"), "false");
  assert.match(card.shadowRoot.innerHTML, /Cherry tomatoes/);
});

test("opening the same recipe twice makes no server call at all", async () => {
  const { card, hass } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("back"));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  assert.equal(hass.calls.length, 1);
  assert.equal(hass.calls[0][1], "get_recipes");
});

test("ingredients are checkable — tap to cross off, tap again to un-cross, Start over clears", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  // Nothing gathered yet; no Start over button.
  assert.match(card.shadowRoot.innerHTML, /0 of 3 gathered/);
  assert.equal(card.shadowRoot.querySelector('[data-action="clear-checks"]'), null);
  // Tap the first ingredient: crossed off, count updates.
  card.shadowRoot.dispatchClick(fakeTarget("toggle-ingredient", { index: "0" }));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /1 of 3 gathered/);
  assert.equal(card.shadowRoot.querySelectorAll(".ingredient")[0].classList.contains("checked"), true);
  assert.equal(card.shadowRoot.querySelectorAll(".ingredient")[0].getAttribute("aria-pressed"), "true");
  // Tap again: un-crossed.
  card.shadowRoot.dispatchClick(fakeTarget("toggle-ingredient", { index: "0" }));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /0 of 3 gathered/);
  assert.equal(card.shadowRoot.querySelectorAll(".ingredient")[0].classList.contains("checked"), false);
  // Check two, then Start over clears both.
  card.shadowRoot.dispatchClick(fakeTarget("toggle-ingredient", { index: "0" }));
  card.shadowRoot.dispatchClick(fakeTarget("toggle-ingredient", { index: "2" }));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /2 of 3 gathered/);
  card.shadowRoot.dispatchClick(fakeTarget("clear-checks"));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /0 of 3 gathered/);
  assert.equal(card.shadowRoot.querySelectorAll(".ingredient.checked").length, 0);
});

test("checked ingredients and the current step survive leaving the recipe and coming back", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("toggle-ingredient", { index: "1" }));
  card.shadowRoot.dispatchClick(fakeTarget("step-next"));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Step 2 of 3/);
  card.shadowRoot.dispatchClick(fakeTarget("back"));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /1 of 3 gathered/);
  assert.match(card.shadowRoot.innerHTML, /Step 2 of 3/);
  assert.equal(card.shadowRoot.querySelectorAll(".ingredient")[1].classList.contains("checked"), true);
});

test("steps are a guided walkthrough — current step highlighted, Step N of M, Prev/Next and tap to set", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  // Step 1 of 3, the first step current, the rest dimmed (no .current).
  assert.match(card.shadowRoot.innerHTML, /Step 1 of 3/);
  assert.equal(card.shadowRoot.querySelectorAll(".step.current").length, 1);
  assert.equal(card.shadowRoot.querySelectorAll(".step")[0].classList.contains("current"), true);
  // Prev on the first step stays on step 1 (clamped, not an error).
  card.shadowRoot.dispatchClick(fakeTarget("step-prev"));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Step 1 of 3/);
  // Next moves to step 2.
  card.shadowRoot.dispatchClick(fakeTarget("step-next"));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Step 2 of 3/);
  assert.equal(card.shadowRoot.querySelectorAll(".step")[1].classList.contains("current"), true);
  // Tap the third step to make it current.
  card.shadowRoot.dispatchClick(fakeTarget("step", { stepIndex: "2" }));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Step 3 of 3/);
  assert.equal(card.shadowRoot.querySelectorAll(".step")[2].classList.contains("current"), true);
  // Next on the last step stays on step 3 (clamped, not an error).
  card.shadowRoot.dispatchClick(fakeTarget("step-next"));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Step 3 of 3/);
});

test("a time in a step is a tappable chip — tapping it reports honestly that the bridge has no start action yet", async () => {
  const timed = {
    ...PASTA_FULL,
    preparation_steps: [
      "Boil the pasta for 10 minutes.",
      "Simmer the sauce for 1 hour.",
    ],
  };
  const { card, hass } = await loadedCard({ detail: timed });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  const chips = card.shadowRoot.querySelectorAll(".time-chip");
  assert.equal(chips.length, 2);
  assert.equal(chips[0].dataset.seconds, "600");
  assert.equal(chips[1].dataset.seconds, "3600");
  // Tapping the chip calls satellite_timers.start_timer, which does
  // not exist — the card reports that honestly instead of pretending
  // a timer started. No AnyList call is made by the tap.
  card.shadowRoot.dispatchClick(fakeTarget("start-timer", { seconds: "600" }));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Couldn't start the timer/);
  assert.match(card.shadowRoot.innerHTML, /doesn't offer a start action yet/);
  assert.equal(hass.calls.filter((call) => call[0] === "anylist").length, 1);
  assert.equal(hass.calls[1][0], "satellite_timers");
  assert.equal(hass.calls[1][1], "start_timer");
});

test("the step tracker pins below Home Assistant's header, not under it", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  // HA's header is 56 px tall and stays fixed while the page scrolls;
  // a sticky top of 0 would slide the tracker underneath it and hide
  // it. The tracker pins below the header via HA's own
  // --header-height variable (56 px fallback).
  const style = card.shadowRoot.querySelector("style").textContent;
  assert.match(style, /\.step-tracker \{[^}]*position: sticky;/s);
  assert.match(style, /top: var\(--header-height, 56px\);/);
  assert.ok(card.shadowRoot.querySelector(".step-tracker"));
});

test("a recipe without a photo gets a deliberate tile in the list, not a grey box", async () => {
  const { card } = await loadedCard();
  // SOUP and RICE have no photo; PASTA does. Each no-photo recipe
  // gets one tile with its initial.
  const tiles = card.shadowRoot.querySelectorAll(".thumb.missing");
  assert.equal(tiles.length, 2);
  const rice = [...card.shadowRoot.querySelectorAll(".row")].find((row) =>
    row.textContent.includes("Rice Pudding"),
  );
  assert.ok(rice);
  const tile = rice.querySelector(".thumb.missing");
  assert.ok(tile);
  assert.equal(tile.textContent.trim(), "R");
});
test("step section headers render as headings, not numbered steps", async () => {
  const withHeader = {
    ...PASTA_FULL,
    preparation_steps: [
      "# For the sauce",
      "Soften the tomatoes in a pan.",
      "Stir in the **cream**.",
    ],
  };
  const { card } = await loadedCard({ detail: withHeader });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  // Step headers live in the Cook view (the default tab), alongside
  // the numbered steps.
  const html = card.shadowRoot.innerHTML;
  const headers = card.shadowRoot.querySelectorAll(".step-header");
  assert.equal(headers.length, 1);
  assert.equal(headers[0].textContent, "For the sauce");
  // The header does not consume a step number: two numbered steps only.
  assert.equal(card.shadowRoot.querySelectorAll(".step").length, 2);
  assert.match(html, /<strong>cream<\/strong>/);
});

test("ingredient headings render as sub-headings in the detail view", async () => {
  const headed = {
    ...PASTA_FULL,
    ingredient_entries: [
      { type: "section", name: "For the sauce" },
      { type: "ingredient", name: "Cherry tomatoes", quantity: "400 g", note: "halved", raw_ingredient: "400 g cherry tomatoes, halved" },
      { type: "ingredient", name: "Cream", quantity: "200 ml", note: "", raw_ingredient: "200 ml cream" },
      { type: "section", name: "To finish" },
      { type: "ingredient", name: "Salt", quantity: "", note: "to taste", raw_ingredient: "Salt to taste" },
    ],
  };
  const { card } = await loadedCard({ detail: headed });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  const sections = card.shadowRoot.querySelectorAll(".ingredient-section");
  assert.equal(sections.length, 2);
  assert.equal(sections[0].textContent, "For the sauce");
  assert.equal(sections[1].textContent, "To finish");
  assert.equal(card.shadowRoot.querySelectorAll(".ingredient").length, 3);
  // Order: each section precedes its own ingredients.
  const html = card.shadowRoot.innerHTML;
  assert.ok(html.indexOf("For the sauce") < html.indexOf("Cherry tomatoes"));
  assert.ok(html.indexOf("To finish") < html.indexOf("Salt"));
});

test("upstream headings (is_heading inside ingredients) render as sub-headings too", async () => {
  // Upstream format (PR #15): headings stay inside `ingredients` with
  // is_heading set and an id on every entry; there is no
  // ingredient_entries list.
  const upstream = {
    ...PASTA_FULL,
    ingredients: [
      { id: "ing-1", name: "For the sauce", is_heading: true },
      { id: "ing-2", name: "Cherry tomatoes", quantity: "400 g", note: "halved", raw_ingredient: "400 g cherry tomatoes, halved" },
      { id: "ing-3", name: "Cream", quantity: "200 ml", note: "", raw_ingredient: "200 ml cream" },
      { id: "ing-4", name: "To finish", is_heading: true },
      { id: "ing-5", name: "Salt", quantity: "", note: "to taste", raw_ingredient: "Salt to taste" },
    ],
  };
  const { card } = await loadedCard({ detail: upstream });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  const sections = card.shadowRoot.querySelectorAll(".ingredient-section");
  assert.equal(sections.length, 2);
  assert.equal(sections[0].textContent, "For the sauce");
  assert.equal(sections[1].textContent, "To finish");
  // Headings are sections, not ingredients: three ingredient rows only.
  assert.equal(card.shadowRoot.querySelectorAll(".ingredient").length, 3);
  // Order: each section precedes its own ingredients.
  const html = card.shadowRoot.innerHTML;
  assert.ok(html.indexOf("For the sauce") < html.indexOf("Cherry tomatoes"));
  assert.ok(html.indexOf("To finish") < html.indexOf("Salt"));
  // Entry ids are never shown.
  assert.doesNotMatch(html, /ing-\d/);
});

test("a recipe with no photo, ingredients or steps still renders cleanly", async () => {
  const bare = {
    ...lightRecipe("rec-bare", "Plain Rice"),
    ingredients: [],
    preparation_steps: [],
  };
  const { card } = await loadedCard({ recipes: [bare], detail: bare });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-bare" }));
  await flush();
  const html = card.shadowRoot.innerHTML;
  assert.match(html, /Plain Rice/);
  // No photo: no hero image and no placeholder block — just the title.
  assert.equal(card.shadowRoot.querySelector(".detail-photo"), null);
  assert.equal(card.shadowRoot.querySelectorAll(".detail-name").length, 1);
  // The Cook tab shows both empty states together, and no step
  // tracker when there are no steps.
  assert.match(html, /No ingredients listed/);
  assert.match(html, /No steps listed/);
  assert.equal(card.shadowRoot.querySelector(".step-tracker"), null);
  // Notes tab: no saved note, so the editor is empty (with a
  // placeholder) and the rating is unrated — and the old "can't be
  // edited" gap line is gone: editing is available now.
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
  await flush();
  assert.doesNotMatch(card.shadowRoot.innerHTML, /can't be edited from the hub yet/);
  const editor = card.shadowRoot.querySelector('[data-role="note"]');
  assert.equal(editor.getAttribute("placeholder"), "Add a note — e.g. more salt next time…");
  assert.equal(card.shadowRoot.querySelectorAll(".star").length, 5);
  assert.equal(card.shadowRoot.querySelectorAll(".star.filled").length, 0);
});

test("empty states, by cause: empty library, no-match search, empty collection", async () => {
  const { card } = await loadedCard({ recipes: [] });
  const empty = card.shadowRoot.querySelector(".empty");
  assert.equal(empty.querySelector(".empty-title").textContent, "No recipes yet.");
  assert.match(empty.querySelector(".empty-sub").textContent, /Recipes added in AnyList/);
  assert.equal(empty.querySelector(".button"), null);
  await card._search("pasta");
  await flush();
  const noMatch = card.shadowRoot.querySelector(".empty");
  assert.equal(noMatch.querySelector(".empty-title").textContent, "No recipes match “pasta”.");
  assert.match(noMatch.querySelector(".empty-sub").textContent, /different spelling/);
  assert.match(noMatch.querySelector(".button").textContent, /Show all recipes/);
  card.shadowRoot.dispatchClick(fakeTarget("clear-search"));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /No recipes yet/);
  // A collection with no recipes gets its own title naming the collection.
  const { card: card2 } = await loadedCard();
  card2._collectionId = "col-soup";
  card2._recipes = [];
  card2._render();
  const noCollection = card2.shadowRoot.querySelector(".empty");
  assert.equal(noCollection.querySelector(".empty-title").textContent, "No recipes in “Soup”.");
  assert.match(noCollection.querySelector(".button").textContent, /Show all recipes/);
});

test("a failed load shows an error with a retry button, and retry works", async () => {
  const card = new AnyListRecipeViewCard();
  card.setConfig({});
  const hass = fakeHass({ fail: { get_recipes: "boom" } });
  card.hass = hass;
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Could not load recipes/);
  assert.match(card.shadowRoot.innerHTML, /Try again/);
  // The retry path is a fresh load: swap in a working hass and retry.
  card._hass = fakeHass();
  card.shadowRoot.dispatchClick(fakeTarget("retry"));
  await flush();
  assert.equal(card.shadowRoot.querySelectorAll(".row").length, 3);
});

test("recipe names are escaped — markup in a name cannot break the page", async () => {
  const evil = lightRecipe("rec-evil", "<script>alert(1)</script> Pasta");
  const { card } = await loadedCard({ recipes: [evil] });
  // The harness decodes entities when re-serializing innerHTML, so the
  // structural check is what proves escaping: a name written unescaped
  // would parse into a real <script> element; an escaped name stays a
  // text node whose text is the literal name.
  assert.equal(card.shadowRoot.querySelector("script"), null);
  const nameEl = card.shadowRoot.querySelector(".row-name");
  assert.equal(nameEl.textContent, "<script>alert(1)</script> Pasta");
  const row = card.shadowRoot.querySelector(".row");
  assert.equal(row.getAttribute("aria-label"), "Open <script>alert(1)</script> Pasta");
});

test("there is no shopping-list button anywhere — list or any detail tab", async () => {
  const { card } = await loadedCard();
  const listHtml = card.shadowRoot.innerHTML;
  assert.doesNotMatch(listHtml, /shopping/i);
  assert.doesNotMatch(listHtml, /add to list/i);
  assert.doesNotMatch(listHtml, /add_recipe_to_list/);
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  for (const tab of ["ingredients", "recipe", "details", "notes"]) {
    card.shadowRoot.dispatchClick(fakeTarget("tab", { tab }));
    await flush();
    const detailHtml = card.shadowRoot.innerHTML;
    assert.doesNotMatch(detailHtml, /shopping/i);
    assert.doesNotMatch(detailHtml, /add to list/i);
    assert.doesNotMatch(detailHtml, /add_recipe_to_list/);
  }
});

test("the card makes exactly ONE data call per view-open — the single get_recipes", async () => {
  const { card, hass } = await loadedCard();
  // Type a search, filter by a collection, open a recipe, switch tabs:
  // none of it may call the server again.
  const input = card.shadowRoot.querySelector('[data-role="search"]');
  input.value = "tomato";
  card.shadowRoot.dispatchInput(input);
  await sleep(400);
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("collection", { collectionId: "col-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("collection", { collectionId: "" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  for (const tab of ["recipe", "details", "notes"]) {
    card.shadowRoot.dispatchClick(fakeTarget("tab", { tab }));
    await flush();
  }
  assert.deepEqual(hass.calls, [
    ["anylist", "get_recipes", { include_ingredients: true, include_steps: true }],
  ]);
  assert.ok(hass.calls.every((c) => c[0] === "anylist"));
});
// -- Device classes ---------------------------------------------------------
// The card carries its device as classes on .screen (dev-hub,
// dev-desktop or dev-mobile + orient-landscape/orient-portrait); the
// CSS keys the adaptive layout off them. The browser environment is
// stubbed here (window/navigator do not exist in node).

function stubWindow({ width, height, coarse, fine, touch, userAgent }) {
  globalThis.window = {
    innerWidth: width,
    innerHeight: height,
    matchMedia: (query) =>
      query === "(pointer: coarse)"
        ? { matches: coarse }
        : query === "(pointer: fine)"
          ? { matches: fine }
          : { matches: false },
    addEventListener: () => {},
    removeEventListener: () => {},
    ...(touch ? { ontouchstart: () => {} } : {}),
  };
  globalThis.navigator = {
    maxTouchPoints: touch ? 5 : 0,
    userAgent,
  };
}

function clearWindow() {
  delete globalThis.window;
  delete globalThis.navigator;
}

const HUB_WINDOW = {
  width: 1920,
  height: 1200,
  coarse: true,
  fine: false,
  touch: true,
  userAgent:
    "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};
const DESKTOP_WINDOW = {
  width: 1440,
  height: 900,
  coarse: false,
  fine: true,
  touch: false,
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};
const PHONE_WINDOW = {
  width: 390,
  height: 844,
  coarse: true,
  fine: false,
  touch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

test("the card carries dev-hub + orient-landscape on the kiosk", async () => {
  stubWindow(HUB_WINDOW);
  try {
    const { card } = await loadedCard();
    const screen = card.shadowRoot.querySelector(".screen");
    assert.ok(screen.classList.contains("dev-hub"));
    assert.ok(screen.classList.contains("orient-landscape"));
    assert.ok(!screen.classList.contains("dev-mobile"));
  } finally {
    clearWindow();
  }
});

test("the card carries dev-desktop on a mouse-driven screen", async () => {
  stubWindow(DESKTOP_WINDOW);
  try {
    const { card } = await loadedCard();
    const screen = card.shadowRoot.querySelector(".screen");
    assert.ok(screen.classList.contains("dev-desktop"));
    assert.ok(screen.classList.contains("orient-landscape"));
  } finally {
    clearWindow();
  }
});

test("the card carries dev-mobile + orient-portrait on a phone", async () => {
  stubWindow(PHONE_WINDOW);
  try {
    const { card } = await loadedCard();
    const screen = card.shadowRoot.querySelector(".screen");
    assert.ok(screen.classList.contains("dev-mobile"));
    assert.ok(screen.classList.contains("orient-portrait"));
  } finally {
    clearWindow();
  }
});

test("on mobile the chips wrap instead of scrolling sideways", async () => {
  // The shipped CSS must carry the mobile override: a cut-off chip at
  // the screen edge is too easy to miss on a phone. The style element
  // is read from the card itself, so this fails if the rule is lost.
  stubWindow(PHONE_WINDOW);
  try {
    const { card } = await loadedCard();
    const css = card.shadowRoot.querySelector("style").textContent;
    assert.ok(
      css.includes(".screen.dev-mobile .chips { flex-wrap: wrap; overflow-x: visible; }")
    );
    assert.ok(
      css.includes(
        ".screen.dev-mobile .chips.scrollable { -webkit-mask-image: none; mask-image: none; }"
      )
    );
  } finally {
    clearWindow();
  }
});

test("a resize re-detects the device and swaps the classes", async () => {
  stubWindow(PHONE_WINDOW);
  try {
    const { card } = await loadedCard();
    const screen = card.shadowRoot.querySelector(".screen");
    assert.ok(screen.classList.contains("dev-mobile"));
    // Rotate the phone to landscape: same category, new orientation.
    stubWindow({ ...PHONE_WINDOW, width: 844, height: 390 });
    card._onResize();
    assert.ok(screen.classList.contains("dev-mobile"));
    assert.ok(screen.classList.contains("orient-landscape"));
    assert.ok(!screen.classList.contains("orient-portrait"));
    // Move to a desktop window: the category swaps too.
    stubWindow(DESKTOP_WINDOW);
    card._onResize();
    assert.ok(screen.classList.contains("dev-desktop"));
    assert.ok(!screen.classList.contains("dev-mobile"));
  } finally {
    clearWindow();
  }
});

test("with no browser environment the card carries no device classes (base layout stands)", async () => {
  clearWindow();
  const { card } = await loadedCard();
  const screen = card.shadowRoot.querySelector(".screen");
  assert.ok(!screen.classList.contains("dev-hub"));
  assert.ok(!screen.classList.contains("dev-desktop"));
  assert.ok(!screen.classList.contains("dev-mobile"));
});

// -- Note editing, rating, serving scaling ---------------------------------
// The fork (k-mehta/ha-anylist 0.11.1) offers note and rating on
// update_recipe, so the Notes tab is an editor and the Cook tab has a
// transient serving scaler. The scaler never calls the server.

function typeNote(card, text) {
  const editor = card.shadowRoot.querySelector('[data-role="note"]');
  editor.value = text;
  card.shadowRoot.dispatchInput(editor);
  return editor;
}

async function openNotesTab(card) {
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
  await flush();
}

test("typing a note enables Save; saving calls update_recipe with the note only", async () => {
  const { card, hass } = await loadedCard();
  await openNotesTab(card);
  const save = card.shadowRoot.querySelector('[data-action="save-note"]');
  assert.equal(save.getAttribute("disabled"), "disabled");
  typeNote(card, "More salt next time.");
  // The button enables as soon as the text differs from the saved note.
  assert.equal(save.disabled, false);
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  // Exactly one save, with the note only — no name, ingredients or
  // steps resubmitted.
  assert.equal(hass.calls.length, 2);
  assert.deepEqual(hass.calls[1], [
    "anylist",
    "update_recipe",
    { recipe_id: "rec-pasta", note: "More salt next time." },
  ]);
  assert.match(card.shadowRoot.innerHTML, /Saved\./);
  // The local copy refreshes from the server response, so the editor
  // now shows the saved note and Save disables again.
  assert.match(card.shadowRoot.innerHTML, /More salt next time\./);
  assert.equal(
    card.shadowRoot.querySelector('[data-action="save-note"]').getAttribute("disabled"),
    "disabled"
  );
});

test("saving an empty note clears it", async () => {
  const { card, hass } = await loadedCard();
  await openNotesTab(card);
  typeNote(card, "");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.equal(hass.calls.length, 2);
  assert.deepEqual(hass.calls[1], [
    "anylist",
    "update_recipe",
    { recipe_id: "rec-pasta", note: "" },
  ]);
  assert.match(card.shadowRoot.innerHTML, /Saved\./);
  assert.equal(card._selected.note, "");
});

test("a failed note save keeps the typed note and says so honestly", async () => {
  const { card, hass } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
  await openNotesTab(card);
  typeNote(card, "More salt next time.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.equal(hass.calls.length, 2);
  assert.equal(hass.calls[1][1], "update_recipe");
  assert.match(card.shadowRoot.innerHTML, /Couldn't save the note/);
  assert.match(card.shadowRoot.innerHTML, /your text is still here/);
  // The typed note survives (the draft is kept) and the saved note
  // is untouched — nothing is silently lost.
  assert.equal(card._noteDrafts.get("rec-pasta"), "More salt next time.");
  assert.equal(card._selected.note, "Vihaan likes this with extra cheese.");
  assert.match(card.shadowRoot.innerHTML, /More salt next time\./);
});

test("an unsaved note draft survives leaving the recipe and coming back", async () => {
  const { card } = await loadedCard();
  await openNotesTab(card);
  typeNote(card, "More salt next time.");
  card.shadowRoot.dispatchClick(fakeTarget("back"));
  await flush();
  await openNotesTab(card);
  assert.match(card.shadowRoot.innerHTML, /More salt next time\./);
});

test("tapping a star saves the rating with update_recipe and only the rating", async () => {
  const { card, hass } = await loadedCard();
  await openNotesTab(card);
  // Pasta is rated 5; tapping 3 re-rates it.
  assert.equal(card.shadowRoot.querySelectorAll(".star.filled").length, 5);
  card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
  await flush();
  assert.equal(hass.calls.length, 2);
  assert.deepEqual(hass.calls[1], [
    "anylist",
    "update_recipe",
    { recipe_id: "rec-pasta", rating: 3 },
  ]);
  assert.match(card.shadowRoot.innerHTML, /Saved\./);
  assert.equal(card.shadowRoot.querySelectorAll(".star.filled").length, 3);
  assert.equal(card._selected.rating, 3);
});

test("Clear un-rates the recipe (rating 0)", async () => {
  const { card, hass } = await loadedCard();
  await openNotesTab(card);
  assert.equal(card.shadowRoot.querySelector('[data-action="clear-rating"]').getAttribute("disabled"), null);
  card.shadowRoot.dispatchClick(fakeTarget("clear-rating"));
  await flush();
  assert.equal(hass.calls.length, 2);
  assert.deepEqual(hass.calls[1], [
    "anylist",
    "update_recipe",
    { recipe_id: "rec-pasta", rating: 0 },
  ]);
  assert.equal(card.shadowRoot.querySelectorAll(".star.filled").length, 0);
  assert.equal(card.shadowRoot.querySelector('[data-action="clear-rating"]'), null);
});

test("a failed rating save keeps the old rating and says so honestly", async () => {
  const { card } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
  await openNotesTab(card);
  card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Couldn't save the rating/);
  assert.equal(card.shadowRoot.querySelectorAll(".star.filled").length, 5);
  assert.equal(card._selected.rating, 5);
});

test("the serving scaler scales the displayed quantities and makes no server call", async () => {
  const { card, hass } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  const qty = (index) =>
    card.shadowRoot.querySelectorAll(".ingredient")[index].querySelector(".qty").textContent;
  const count = () => card.shadowRoot.querySelector(".scaler-count").textContent;
  assert.equal(count(), "4");
  assert.equal(qty(0), "500 g");
  // Scale up to 5: 500 g becomes 625 g, 200 ml becomes 250 ml.
  card.shadowRoot.dispatchClick(fakeTarget("scale-up"));
  await flush();
  assert.equal(count(), "5");
  assert.equal(qty(0), "625 g");
  assert.equal(qty(2), "250 ml");
  assert.match(card.shadowRoot.innerHTML, /Reset to 4/);
  // Scale up to 6: whole numbers stay whole.
  card.shadowRoot.dispatchClick(fakeTarget("scale-up"));
  await flush();
  assert.equal(count(), "6");
  assert.equal(qty(0), "750 g");
  assert.equal(qty(2), "300 ml");
  // Scaling is transient and client-side: still exactly the one
  // view-open call, no update_recipe, nothing persisted.
  assert.equal(hass.calls.length, 1);
  assert.equal(hass.calls[0][1], "get_recipes");
  // Scale down, then reset back to the stored servings.
  card.shadowRoot.dispatchClick(fakeTarget("scale-down"));
  await flush();
  assert.equal(count(), "5");
  assert.equal(qty(0), "625 g");
  card.shadowRoot.dispatchClick(fakeTarget("scale-reset"));
  await flush();
  assert.equal(count(), "4");
  assert.equal(qty(0), "500 g");
  assert.equal(card.shadowRoot.querySelector('[data-action="scale-reset"]'), null);
});

test("the scaler leaves non-numeric quantities alone and hides when servings is not a number", async () => {
  const pinch = lightRecipe("rec-pinch", "Salted Butter", {
    servings: "4",
    ingredients: [
      { name: "Butter", quantity: "100 g", note: "", raw_ingredient: "100 g butter" },
      { name: "Salt", quantity: "a pinch", note: "", raw_ingredient: "a pinch of salt" },
    ],
    preparation_steps: ["Melt the butter.", "Stir in the salt."],
  });
  const { card } = await loadedCard({ recipes: [pinch], detail: pinch });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pinch" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("scale-up"));
  await flush();
  const qty = (index) =>
    card.shadowRoot.querySelectorAll(".ingredient")[index].querySelector(".qty").textContent;
  assert.equal(qty(0), "125 g");
  assert.equal(qty(1), "a pinch");
  // A freeform servings string has no clean base to scale from, so
  // there is no scaler at all.
  const freeform = lightRecipe("rec-free", "Family Soup", { servings: "4 servings" });
  const second = await loadedCard({ recipes: [freeform], detail: freeform });
  second.card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-free" }));
  await flush();
  assert.equal(second.card.shadowRoot.querySelector(".scaler"), null);
});

test("re-opening a recipe resets the scaler to the stored servings", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("scale-up"));
  card.shadowRoot.dispatchClick(fakeTarget("scale-up"));
  await flush();
  assert.equal(card.shadowRoot.querySelector(".scaler-count").textContent, "6");
  card.shadowRoot.dispatchClick(fakeTarget("back"));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  assert.equal(card.shadowRoot.querySelector(".scaler-count").textContent, "4");
  assert.equal(
    card.shadowRoot.querySelectorAll(".ingredient")[0].querySelector(".qty").textContent,
    "500 g"
  );
});
