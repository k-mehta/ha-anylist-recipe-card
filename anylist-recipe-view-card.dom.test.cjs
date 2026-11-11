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

  // Focus tracking (the card restores note focus across re-renders
  // and autofocuses the note editor when the Notes tab opens): a
  // focused element marks itself on the shadow root as activeElement,
  // mirroring the browser.
  focus() {
    this._focused = true;
    let root = this;
    while (root.parentNode) root = root.parentNode;
    if (root && root !== this && "activeElement" in root) root.activeElement = this;
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  set textContent(value) {
    this._ownText = String(value);
    this.children = [];
  }

  // Inputs and textareas carry .value in the browser: an explicitly
  // assigned value wins, otherwise the rendered text (a textarea's
  // content, an option-less select's text).
  get value() {
    if (this._value !== undefined) return this._value;
    return this.textContent;
  }

  set value(v) {
    this._value = String(v);
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

  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    const index = before ? this.children.indexOf(before) : -1;
    if (index >= 0) this.children.splice(index, 0, child);
    else this.children.push(child);
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
    this.activeElement = null;
  }

  dispatchClick(target) {
    const fn = this._listeners.click;
    if (fn) fn({ target });
  }

  dispatchInput(target) {
    const fn = this._listeners.input;
    if (fn) fn({ target });
  }

  dispatchChange(target) {
    const fn = this._listeners.change;
    if (fn) fn({ target });
  }

  dispatchError(target) {
    const fn = this._listeners.error;
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
  const states = options.states ?? [];
  return {
    calls,
    states,
    callWS: async (message) => {
      calls.push([message.domain, message.service, message.service_data]);
      // The Phase 3 bridge offers start_timer {name, duration} —
      // the card calls it from the timer chips. It succeeds unless
      // the test fails it (fail.start_timer), so the success and
      // failure paths are both testable.
      if (message.domain === "satellite_timers" && message.service === "start_timer") {
        if (fail.start_timer) throw new Error(fail.start_timer);
        return {};
      }
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
    ["Prep 10 min", "Cook 20 min", "Serves 4", "★★★★★ 5/5"]
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
  // Cooking mode: the Cook tab has no photo hero and no metadata line
  // — those live on the Details tab (RECIPE-7), one tap away. The
  // photo lives in the list (where it helps you pick a recipe) and
  // the metadata does not compete with the cooking view. The name is
  // a compact label, not a display title. (Scoped to the detail view:
  // the hidden list still shows the photo and meta.)
  const detailHtml = () => card.shadowRoot.querySelector(".detail-view").innerHTML;
  assert.match(detailHtml(), /Creamy Tomato Pasta/);
  assert.equal(card.shadowRoot.querySelectorAll(".detail-name").length, 1);
  assert.doesNotMatch(detailHtml(), /photos\.anylist\.com\/abc123\.jpg/);
  assert.equal(card.shadowRoot.querySelector(".detail-photo"), null);
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
  // The total time line sits at the top of the Cook tab (RECIPE-7):
  // prep 10 min + cook 20 min.
  assert.match(detailHtml(), /Total 30 min/);
  assert.match(detailHtml(), /Prep 10 min/);
  assert.match(detailHtml(), /Cook 20 min/);
  // No voice hint here (N-IMPL-19c): none of this recipe's steps
  // has a time chip, so no hint is shown — the old hardcoded
  // 9-minute sentence is gone.
  assert.doesNotMatch(detailHtml(), /voice-hint/);
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
  // The Details tab exists (RECIPE-7): photo hero, metadata line and
  // every stored field — the Cook tab is uncluttered, not bare.
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "details" }));
  await flush();
  const detailsHtml = card.shadowRoot.querySelector(".detail-view").innerHTML;
  assert.match(detailsHtml, /photos\.anylist\.com\/abc123\.jpg/);
  assert.ok(card.shadowRoot.querySelector(".detail-photo"));
  assert.match(detailsHtml, /Family cookbook/);
  assert.match(detailsHtml, /Serves 4/);
  assert.match(detailsHtml, /★★★★★ 5\/5/);
  assert.match(detailsHtml, /Total/);
  assert.equal(card.shadowRoot.querySelector(".detail-view").hidden, false);
  assert.equal(card.shadowRoot.querySelector(".list-view").hidden, true);
  // Back returns to the list.
  card.shadowRoot.dispatchClick(fakeTarget("back"));
  await flush();
  assert.equal(card.shadowRoot.querySelector(".list-view").hidden, false);
  assert.equal(card.shadowRoot.querySelectorAll(".row").length, 3);
});

test("detail shows three tabs — Cook, Notes and Details — Cook active by default (RECIPE-7)", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  const tabs = [...card.shadowRoot.querySelectorAll(".tab")];
  assert.deepEqual(
    tabs.map((t) => t.textContent),
    ["Cook", "Notes", "Details"],
  );
  assert.deepEqual(
    tabs.map((t) => t.getAttribute("aria-selected")),
    ["true", "false", "false"],
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

test("a time in a step is a tappable chip — tapping it starts a timer via the bridge (RECIPE-5)", async () => {
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
  // Tapping the chip calls satellite_timers.start_timer with the
  // Phase 3 shape: {name, duration} in seconds, named after the
  // recipe. No AnyList call is made by the tap.
  card.shadowRoot.dispatchClick(fakeTarget("start-timer", { seconds: "600" }));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Timer started:/);
  assert.equal(hass.calls.filter((call) => call[0] === "anylist").length, 1);
  assert.equal(hass.calls[1][0], "satellite_timers");
  assert.equal(hass.calls[1][1], "start_timer");
  assert.deepEqual(hass.calls[1][2], { name: "Creamy Tomato Pasta", duration: 600 });
});

test("a failed timer start keeps the honest reason and offers the voice alternative (RECIPE-17)", async () => {
  const timed = {
    ...PASTA_FULL,
    preparation_steps: ["Boil the pasta for 10 minutes."],
  };
  const { card } = await loadedCard({
    detail: timed,
    fail: { start_timer: "Service satellite_timers.start_timer not found" },
  });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("start-timer", { seconds: "600" }));
  await flush();
  // R-IMPL-25: the bridge-missing error REPLACES the voice hint in
  // the same slot and names the chip's duration — the cook reads one
  // line, not a hint plus an error. The old "doesn't offer a start
  // action yet" sentence is gone.
  assert.match(card.shadowRoot.innerHTML, /Couldn't start the 10 min timer/);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /doesn't offer a start action yet/);
  assert.match(card.shadowRoot.innerHTML, /Say 'Okay Nabu, start a 10 minute timer'/);
  // The hint appears exactly once — inside the error, not as a
  // separate hint line beside it.
  assert.equal((card.shadowRoot.innerHTML.match(/Say 'Okay Nabu/g) || []).length, 1);
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
    // Real-shaped data: the flat list and the entries carry the same
    // ingredients (entries add the sections); the merge dedups them,
    // so the list shows each ingredient once, in entry order.
    ingredients: [
      { name: "Cherry tomatoes", quantity: "400 g", note: "halved", raw_ingredient: "400 g cherry tomatoes, halved" },
      { name: "Cream", quantity: "200 ml", note: "", raw_ingredient: "200 ml cream" },
      { name: "Salt", quantity: "", note: "to taste", raw_ingredient: "Salt to taste" },
    ],
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
  assert.match(html, /No steps for this recipe/);
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
  // R-IMPL-42: the zero-result line is one exact sentence.
  assert.equal(noMatch.querySelector(".empty-title").textContent, "No recipes match 'pasta' — try an ingredient or a dish name");
  assert.equal(noMatch.querySelector(".empty-sub"), null);
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
  assert.match(card.shadowRoot.innerHTML, /Couldn't load recipes — check the connection and try again\./);
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

function stubWindow({ width, height, coarse, fine, touch, userAgent, search = "" }) {
  const pushed = [];
  const dispatched = [];
  globalThis.window = {
    innerWidth: width,
    innerHeight: height,
    location: { search },
    history: { pushState: (_state, _title, url) => pushed.push(url) },
    dispatchEvent: (event) => dispatched.push(event && event.type),
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
  return { pushed, dispatched };
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

test("on mobile the chips are one scrollable row, never a wrap (R-IMPL-1)", async () => {
  // R-IMPL-1: the chips wall is gone — the collection chips are a
  // single horizontally scrollable row at every viewport. The style
  // element is read from the card itself, so this fails if the rule
  // is lost. A cut-off chip at the screen edge is the scroll
  // affordance, and the row is exactly one chip tall.
  stubWindow(PHONE_WINDOW);
  try {
    const { card } = await loadedCard();
    const css = card.shadowRoot.querySelector("style").textContent;
    assert.match(css, /\.chips \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/);
    assert.doesNotMatch(css, /\.screen\.dev-mobile \.chips \{ flex-wrap: wrap;/);
    // The mobile row keeps its fade mask (the scroll affordance).
    assert.ok(
      css.includes(
        ".screen.dev-mobile .chips.scrollable { -webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 48px), transparent 100%);"
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
  // R-IMPL-39: the status names what was saved.
  assert.match(card.shadowRoot.innerHTML, /Note saved\./);
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
  assert.match(card.shadowRoot.innerHTML, /Note saved\./);
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
  // R-IMPL-39: the status names what was saved.
  assert.match(card.shadowRoot.innerHTML, /Rating saved\./);
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
  // R-IMPL-33: the reset button is labelled "Reset servings".
  assert.match(card.shadowRoot.innerHTML, /Reset servings/);
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
  // A freeform servings string WITH a number ("4 servings") now
  // parses (RECIPE-3: first number anywhere), so the scaler shows.
  // Only a servings string with NO number has no base to scale from.
  const freeform = lightRecipe("rec-free", "Family Soup", { servings: "4 servings" });
  const second = await loadedCard({ recipes: [freeform], detail: freeform });
  second.card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-free" }));
  await flush();
  assert.ok(second.card.shadowRoot.querySelector(".scaler"));
  assert.equal(second.card.shadowRoot.querySelector(".scaler-count").textContent, "4");
  const noNumber = lightRecipe("rec-none", "Crowd Soup", { servings: "a crowd" });
  const third = await loadedCard({ recipes: [noNumber], detail: noNumber });
  third.card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-none" }));
  await flush();
  assert.equal(third.card.shadowRoot.querySelector(".scaler"), null);
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

// -- v1.4.0 (RECIPE-1..25, NAV-1, deep link) -------------------------------
//
// A fake localStorage for the cook-state tests: a Map-backed store
// the card reads and writes through the same global it uses in the
// browser.
function stubLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  return store;
}

function clearLocalStorage() {
  delete globalThis.localStorage;
}

test("the nav strip renders on list and detail, Recipes active, and navigates without reload (NAV-1)", async () => {
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card } = await loadedCard();
    const strip = card.shadowRoot.querySelector(".nav-strip");
    assert.ok(strip);
    const buttons = [...card.shadowRoot.querySelectorAll(".nav-strip-button")];
    assert.deepEqual(
      buttons.map((b) => b.textContent),
      ["Home", "Timers", "Photos", "Recipes"]
    );
    const active = buttons[3];
    assert.ok(active.classList.contains("active"));
    assert.equal(active.getAttribute("aria-current"), "page");
    // DOM-first: the strip is the first child of the screen (tab
    // order), visually last via flex order.
    const screen = card.shadowRoot.querySelector(".screen");
    assert.equal(screen.children[0].classList.contains("nav-strip"), true);
    // Tap Timers: pushState + location-changed, no reload.
    card.shadowRoot.dispatchClick(fakeTarget("nav", { path: "/family-hub/timers" }));
    await flush();
    assert.deepEqual(nav.pushed, ["/family-hub/timers"]);
    assert.deepEqual(nav.dispatched, ["location-changed"]);
    // The strip is still there on the detail view.
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    assert.ok(card.shadowRoot.querySelector(".nav-strip"));
    // Hidden on desktop only: the CSS hides it under dev-desktop.
    assert.match(card.shadowRoot.innerHTML, /\.screen\.dev-desktop \.nav-strip \{ display: none; \}/);
    // Phone sizing (wave 1, D-N1): 64px bar + safe-area, 16px
    // labels, nowrap; buttons are the full bar height.
    assert.match(card.shadowRoot.innerHTML, /\.screen\.dev-mobile \.nav-strip \{ height: calc\(64px \+ env\(safe-area-inset-bottom, 0px\)\); \}/);
    assert.match(card.shadowRoot.innerHTML, /\.screen\.dev-mobile \.nav-strip-button \{ font-size: 16px; white-space: nowrap; \}/);
  } finally {
    clearWindow();
  }
});

test("a deep link ?recipe=<id>&step=<n> opens the recipe at that step", async () => {
  stubWindow({ ...HUB_WINDOW, search: "?recipe=rec-pasta&step=2" });
  try {
    const { card } = await loadedCard();
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, true);
    assert.match(card.shadowRoot.innerHTML, /Step 2 of 3/);
    assert.equal(card.shadowRoot.querySelectorAll(".step.current").length, 1);
  } finally {
    clearWindow();
  }
});

test("the sort select reorders the list (RECIPE-19)", async () => {
  const { card } = await loadedCard();
  const names = () =>
    [...card.shadowRoot.querySelectorAll(".row-name")].map((el) => el.textContent);
  assert.deepEqual(names(), ["Creamy Tomato Pasta", "Rice Pudding", "Tomato Soup"]);
  card.shadowRoot.dispatchChange({ dataset: { role: "sort" }, value: "cook" });
  await flush();
  assert.deepEqual(names(), ["Creamy Tomato Pasta", "Tomato Soup", "Rice Pudding"]);
  card.shadowRoot.dispatchChange({ dataset: { role: "sort" }, value: "prep" });
  await flush();
  assert.deepEqual(names(), ["Rice Pudding", "Tomato Soup", "Creamy Tomato Pasta"]);
  card.shadowRoot.dispatchChange({ dataset: { role: "sort" }, value: "rating" });
  await flush();
  assert.deepEqual(names(), ["Creamy Tomato Pasta", "Rice Pudding", "Tomato Soup"]);
});

test("Wake Lock is requested while the Cook tab is open and released on leaving it (RECIPE-8)", async () => {
  let requested = 0;
  let released = 0;
  const sentinel = {
    addEventListener: () => {},
    release: () => {
      released += 1;
    },
  };
  globalThis.navigator = {
    maxTouchPoints: 0,
    userAgent: "",
    wakeLock: {
      request: async (type) => {
        requested += 1;
        assert.equal(type, "screen");
        return sentinel;
      },
    },
  };
  try {
    const { card } = await loadedCard();
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    assert.equal(requested, 1);
    assert.equal(card._wakeLock, sentinel);
    card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
    await flush();
    assert.equal(released, 1);
    assert.equal(card._wakeLock, null);
    card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "cook" }));
    await flush();
    assert.equal(requested, 2);
    card.disconnectedCallback();
    assert.equal(released, 2);
  } finally {
    delete globalThis.navigator;
  }
});

test("check-off and step persist across card instances, the scaler does not (RECIPE-9)", async () => {
  stubLocalStorage();
  try {
    const first = await loadedCard();
    first.card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    first.card.shadowRoot.dispatchClick(fakeTarget("toggle-ingredient", { index: "0" }));
    first.card.shadowRoot.dispatchClick(fakeTarget("step-next"));
    first.card.shadowRoot.dispatchClick(fakeTarget("scale-up"));
    await flush();
    assert.equal(first.card.shadowRoot.querySelector(".scaler-count").textContent, "5");
    // A fresh card instance (same device storage) restores the cooking
    // state but not the transient scaler.
    const second = await loadedCard();
    second.card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    assert.equal(second.card.shadowRoot.querySelectorAll(".ingredient.checked").length, 1);
    assert.match(second.card.shadowRoot.innerHTML, /Step 2 of 3/);
    assert.equal(second.card.shadowRoot.querySelector(".scaler-count").textContent, "4");
  } finally {
    clearLocalStorage();
  }
});

test("cooking state older than 24h is discarded (RECIPE-9)", async () => {
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const store = stubLocalStorage({
    "family-hub:recipe:rec-pasta:cook-state": JSON.stringify({
      checked: [0, 1],
      step: 2,
      savedAt: old,
    }),
  });
  try {
    const { card } = await loadedCard();
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    assert.equal(card.shadowRoot.querySelectorAll(".ingredient.checked").length, 0);
    assert.match(card.shadowRoot.innerHTML, /Step 1 of 3/);
    assert.equal(store.has("family-hub:recipe:rec-pasta:cook-state"), false);
  } finally {
    clearLocalStorage();
  }
});

test("a failed photo load falls back to the initial-letter tile, list and detail hero (RECIPE-10)", async () => {
  const { card } = await loadedCard();
  const img = card.shadowRoot.querySelector(".thumb");
  assert.ok(img);
  assert.equal(img.tagName, "IMG");
  const row = card.shadowRoot.querySelector(".row");
  card.shadowRoot.dispatchError(img);
  const tile = card.shadowRoot.querySelector(".thumb.missing");
  assert.ok(tile);
  assert.equal(tile.textContent.trim(), "C");
  assert.equal(row.children[0], tile);
  assert.equal(card.shadowRoot.querySelector("img"), null);
  // The detail hero takes the same path.
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "details" }));
  await flush();
  const hero = card.shadowRoot.querySelector(".detail-photo");
  assert.ok(hero);
  assert.equal(hero.tagName, "IMG");
  card.shadowRoot.dispatchError(hero);
  const heroTile = card.shadowRoot.querySelector(".detail-photo.missing");
  assert.ok(heroTile);
  assert.equal(heroTile.textContent.trim(), "C");
});

test("tapping the active collection chip clears the filter (RECIPE-12)", async () => {
  const { card } = await loadedCard();
  assert.equal(card.shadowRoot.querySelectorAll(".row").length, 3);
  card.shadowRoot.dispatchClick(fakeTarget("collection", { collectionId: "col-pasta" }));
  await flush();
  assert.equal(card.shadowRoot.querySelectorAll(".row").length, 1);
  card.shadowRoot.dispatchClick(fakeTarget("collection", { collectionId: "col-pasta" }));
  await flush();
  assert.equal(card.shadowRoot.querySelectorAll(".row").length, 3);
});

test("the running-timer strip shows name + remaining and taps through to Timers (RECIPE-22)", async () => {
  const nav = stubWindow(HUB_WINDOW);
  let card;
  try {
    const states = [
      {
        entity_id: "sensor.satellite_timer_pasta",
        state: "active",
        attributes: {
          timer_name: "Pasta",
          finishes_at: new Date(Date.now() + 452000).toISOString(),
        },
      },
      {
        entity_id: "sensor.satellite_timer_soup",
        state: "paused",
        attributes: {
          timer_name: "Soup",
          finishes_at: new Date(Date.now() + 3600000).toISOString(),
        },
      },
    ];
    ({ card } = await loadedCard({ states }));
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    const strip = card.shadowRoot.querySelector(".timer-strip");
    assert.ok(strip);
    const items = card.shadowRoot.querySelectorAll(".timer-strip-item");
    assert.equal(items.length, 2);
    assert.match(items[0].textContent, /Pasta/);
    assert.match(items[0].textContent, /7:3\d/);
    assert.ok(items[1].classList.contains("paused"));
    // Tapping a strip item goes to the Timers view. nav.pushed holds
    // the tap-open's same-URL detail entry FIRST (decision F — a
    // state push, not a navigation), then the Timers navigation.
    card.shadowRoot.dispatchClick(fakeTarget("goto-timers"));
    await flush();
    assert.deepEqual(nav.pushed, ["/family-hub/recipes", "/family-hub/timers"]);
    assert.deepEqual(nav.dispatched, ["location-changed"]);
  } finally {
    // Always disconnect: the open detail with running timers starts
    // the 1s strip tick, and a live interval hangs the suite.
    if (card) card.disconnectedCallback();
    clearWindow();
  }
});

test("the running-timer strip also works when hass.states is an object keyed by entity_id (RECIPE-22)", async () => {
  // Live regression: on the rig (HA 2026.2.3) hass.states is a plain
  // object, not an array — the array-only strip rendered zero items
  // live while the unit tests (array states) passed.
  const nav = stubWindow(HUB_WINDOW);
  try {
    const states = {
      "sensor.satellite_timer_pasta": {
        entity_id: "sensor.satellite_timer_pasta",
        state: "active",
        attributes: {
          timer_name: "Pasta",
          finishes_at: new Date(Date.now() + 452000).toISOString(),
        },
      },
      "sensor.satellite_timer_soup": {
        entity_id: "sensor.satellite_timer_soup",
        state: "paused",
        attributes: {
          timer_name: "Soup",
          finishes_at: new Date(Date.now() + 3600000).toISOString(),
        },
      },
      "sensor.other": {
        entity_id: "sensor.other",
        state: "active",
        attributes: {},
      },
    };
    const { card } = await loadedCard({ states });
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    const strip = card.shadowRoot.querySelector(".timer-strip");
    assert.ok(strip);
    const items = card.shadowRoot.querySelectorAll(".timer-strip-item");
    assert.equal(items.length, 2);
    assert.match(items[0].textContent, /Pasta/);
    assert.match(items[0].textContent, /7:3\d/);
    assert.ok(items[1].classList.contains("paused"));
    card.disconnectedCallback();
  } finally {
    clearWindow();
  }
});

test("the strip tick rewrites remaining times in place, never a full re-render (RECIPE-22)", async () => {
  const states = [
    {
      entity_id: "sensor.satellite_timer_pasta",
      state: "active",
      attributes: {
        timer_name: "Pasta",
        finishes_at: new Date(Date.now() + 452000).toISOString(),
      },
    },
  ];
  const { card, hass } = await loadedCard({ states });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  const span = card.shadowRoot.querySelector(
    '[data-remaining-for="sensor.satellite_timer_pasta"]'
  );
  assert.ok(span);
  assert.match(span.textContent, /7:3\d/);
  // Move the finish five minutes later and tick: the text changes,
  // and the span is the SAME node (no re-render replaced it).
  hass.states[0].attributes.finishes_at = new Date(Date.now() + 752000).toISOString();
  card._tickStrip();
  assert.match(span.textContent, /12:3\d/);
  assert.equal(
    card.shadowRoot.querySelector('[data-remaining-for="sensor.satellite_timer_pasta"]'),
    span
  );
  card.disconnectedCallback();
});

test("a duration range is ONE chip starting the upper bound (RECIPE-6)", async () => {
  const ranged = {
    ...PASTA_FULL,
    preparation_steps: ["Simmer for 6 to 8 minutes.", "Rest for 1 hour 30 minutes."],
  };
  const { card, hass } = await loadedCard({ detail: ranged });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  const chips = card.shadowRoot.querySelectorAll(".time-chip");
  assert.equal(chips.length, 3);
  assert.equal(chips[0].textContent, "6–8 minutes");
  assert.equal(chips[0].dataset.seconds, "480");
  card.shadowRoot.dispatchClick(fakeTarget("start-timer", { seconds: "480" }));
  await flush();
  assert.deepEqual(hass.calls[1][2], { name: "Creamy Tomato Pasta", duration: 480 });
});

test("the scaler shows the factor and toggles back to the original amounts (RECIPE-1/2)", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  const qty = () =>
    card.shadowRoot.querySelectorAll(".ingredient")[0].querySelector(".qty").textContent;
  card.shadowRoot.dispatchClick(fakeTarget("scale-up"));
  card.shadowRoot.dispatchClick(fakeTarget("scale-up"));
  await flush();
  // 4 → 6 servings: factor ×1 ½, 500 g penne shows 750 g.
  assert.match(card.shadowRoot.innerHTML, /×1 ½/);
  assert.equal(qty(), "750 g");
  assert.match(card.shadowRoot.innerHTML, /Reset servings/);
  // Show original: the stored quantities return, the factor stays shown.
  card.shadowRoot.dispatchClick(fakeTarget("scale-original"));
  await flush();
  assert.equal(qty(), "500 g");
  assert.match(card.shadowRoot.innerHTML, /×1 ½/);
  assert.match(card.shadowRoot.innerHTML, /Show scaled/);
  card.shadowRoot.dispatchClick(fakeTarget("scale-original"));
  await flush();
  assert.equal(qty(), "750 g");
  assert.match(card.shadowRoot.innerHTML, /Show original/);
});

test("a quantity the scaler cannot parse is flagged, never silently dropped (RECIPE-2)", async () => {
  const broken = lightRecipe("rec-broken", "Broken Soup", {
    servings: "4",
    ingredients: [
      { name: "Flour", quantity: "1/0 cup", note: "", raw_ingredient: "1/0 cup flour" },
      { name: "Sugar", quantity: "100 g", note: "", raw_ingredient: "100 g sugar" },
    ],
    preparation_steps: ["Mix."],
  });
  const { card } = await loadedCard({ recipes: [broken], detail: broken });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-broken" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("scale-up"));
  await flush();
  const rows = card.shadowRoot.querySelectorAll(".ingredient");
  assert.equal(rows[0].querySelector(".qty").textContent, "1/0 cup");
  assert.match(rows[0].textContent, /check this one/);
  assert.equal(rows[1].querySelector(".qty").textContent, "125 g");
});

test("a scaled count gets a usable instruction (RECIPE-2)", async () => {
  const eggy = lightRecipe("rec-eggy", "Eggy Pasta", {
    servings: "4",
    ingredients: [
      { name: "Eggs", quantity: "2 eggs", note: "", raw_ingredient: "2 eggs" },
      { name: "Flour", quantity: "500 g", note: "", raw_ingredient: "500 g flour" },
    ],
    preparation_steps: ["Mix."],
  });
  const { card } = await loadedCard({ recipes: [eggy], detail: eggy });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-eggy" }));
  await flush();
  const qty = () =>
    card.shadowRoot.querySelectorAll(".ingredient")[0].querySelector(".qty").textContent;
  const rowText = () =>
    card.shadowRoot.querySelectorAll(".ingredient")[0].textContent;
  // 4 → 2 servings: 2 eggs become 1 egg (whole, no note).
  card.shadowRoot.dispatchClick(fakeTarget("scale-down"));
  card.shadowRoot.dispatchClick(fakeTarget("scale-down"));
  await flush();
  assert.equal(qty(), "1 egg");
  assert.doesNotMatch(rowText(), /beat 1 egg/);
  // 4 → 3 servings: 2 eggs become 1 ½ eggs — beat 2 and use half of them.
  card.shadowRoot.dispatchClick(fakeTarget("scale-up"));
  await flush();
  assert.equal(qty(), "1 ½ eggs");
  assert.match(rowText(), /beat 2 eggs and use ½ of them/);
});

test("a servings range moves both ends and resets to the range (RECIPE-3)", async () => {
  const ranged = lightRecipe("rec-ranged", "Ranged Soup", {
    servings: "Serves 4–6",
    ingredients: [{ name: "Stock", quantity: "1 l", note: "", raw_ingredient: "1 l stock" }],
    preparation_steps: ["Simmer."],
  });
  const { card } = await loadedCard({ recipes: [ranged], detail: ranged });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-ranged" }));
  await flush();
  assert.equal(card.shadowRoot.querySelector(".scaler-count").textContent, "4–6");
  card.shadowRoot.dispatchClick(fakeTarget("scale-up"));
  await flush();
  assert.equal(card.shadowRoot.querySelector(".scaler-count").textContent, "5–7");
  assert.match(card.shadowRoot.innerHTML, /Reset servings/);
});

test("a flat-string-only recipe shows its ingredients (RECIPE-24)", async () => {
  const flat = lightRecipe("rec-flat", "Flat Soup", {
    servings: "4",
    ingredients: ["1 kg tomatoes", "1 onion, diced", "Salt to taste"],
    preparation_steps: ["Simmer everything."],
  });
  const { card } = await loadedCard({ recipes: [flat], detail: flat });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-flat" }));
  await flush();
  assert.equal(card.shadowRoot.querySelectorAll(".ingredient").length, 3);
  assert.match(card.shadowRoot.innerHTML, /tomatoes/);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /No ingredients listed/);
});

test("chips are one scrollable row at every viewport and rows cannot force the grid wide (R-IMPL-1, RECIPE-25, D-RECIPE-2, ORIENT-9)", async () => {
  const { card } = await loadedCard();
  const css = card.shadowRoot.querySelector("style").textContent;
  // R-IMPL-1: the chips wall is deleted — one scrollable row, wrap
  // gone at every viewport (no mobile wrap override anywhere). Other
  // rows (meta, collections, scaler) still wrap — only the chips row
  // is a single scrollable line.
  assert.match(css, /\.chips \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/);
  assert.doesNotMatch(css, /\.chips \{[^}]*flex-wrap: wrap;/);
  assert.doesNotMatch(css, /\.screen\.dev-mobile \.chips \{[^}]*flex-wrap: wrap;/);
  assert.match(css, /\.chip \{[^}]*white-space: normal;[^}]*overflow-wrap: break-word;/);
  assert.match(css, /\.list \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.row \{[^}]*min-width: 0;/);
  assert.match(css, /\.mini-pill \{[^}]*white-space: normal;/);
  assert.doesNotMatch(css, /@media \(min-width: 1200px\)/);
  // The search field cannot be squeezed out of the toolbar (RECIPE-18).
  assert.match(css, /\.search \{[^}]*min-width: 0;/);
  // Time chips are at least 56px on the hub, 48px on the phone (RECIPE-15).
  assert.match(css, /\.time-chip \{[^}]*min-height: 56px;/);
  assert.match(css, /\.screen\.dev-mobile \.time-chip \{ min-height: 48px; \}/);
  // R-IMPL-7: the step tracker pins BELOW the sticky detail header
  // (back row + tabs row), not at top 0 — the old RECIPE-16 "top: 0
  // in kiosk" was the pre-header value. The header height is a
  // per-class variable, so the rule references it.
  assert.match(css, /\.step-tracker \{[^}]*top: calc\(var\(--header-height, 56px\) \+ var\(--detail-header-h, 184px\)\);/);
  assert.match(css, /\.screen\.kiosk \.step-tracker \{ top: var\(--detail-header-h, 184px\); \}/);
  // Non-current steps dim to 0.8, not 0.5 (RECIPE-13).
  assert.match(css, /\.step \{[^}]*opacity: 0\.8;/);
});

test("the kiosk URL carries the kiosk class (RECIPE-16)", async () => {
  stubWindow({ ...HUB_WINDOW, search: "?kiosk" });
  try {
    const { card } = await loadedCard();
    const screen = card.shadowRoot.querySelector(".screen");
    assert.ok(screen.classList.contains("kiosk"));
    assert.ok(screen.classList.contains("dev-hub"));
  } finally {
    clearWindow();
  }
});

test("step text scales with the recipe, time phrases untouched (RECIPE-23)", async () => {
  const stepped = {
    ...PASTA_FULL,
    preparation_steps: ["Add 2 cups of stock and simmer for 9 minutes."],
  };
  const { card } = await loadedCard({ detail: stepped });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("scale-up"));
  card.shadowRoot.dispatchClick(fakeTarget("scale-up"));
  await flush();
  // 4 → 6 servings: 2 cups become 3 cups; the 9 minutes stay 9 minutes.
  assert.match(card.shadowRoot.innerHTML, /Add 3 cups of stock/);
  assert.match(card.shadowRoot.innerHTML, /9 minutes/);
  assert.equal(card.shadowRoot.querySelectorAll(".time-chip").length, 1);
});

// -- Wave 1 (Navigation N-IMPL-6/7/8/9/19/21, decision F) ------------------

function stubSessionStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  globalThis.sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  return store;
}

function clearSessionStorage() {
  delete globalThis.sessionStorage;
}

// A window stub that also records history STATES (stubWindow only
// records URLs) and scrollTo calls.
function stubHistoryWindow(base) {
  const nav = stubWindow(base);
  const pushedStates = [];
  const scrolled = [];
  globalThis.window.history.pushState = (state, _title, url) => {
    pushedStates.push({ state, url });
    nav.pushed.push(url);
  };
  globalThis.window.history.back = () => {};
  globalThis.window.history.length = 3;
  globalThis.window.scrollTo = (x, y) => scrolled.push([x, y]);
  return { ...nav, pushedStates, scrolled };
}

test("Wave 1: opening a recipe pushes ONE detail history entry; system-back re-opens it (decision F)", async () => {
  const nav = stubHistoryWindow(HUB_WINDOW);
  let card;
  try {
    ({ card } = await loadedCard());
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    assert.deepEqual(nav.pushedStates, [
      { state: { fhNav: "detail", openId: "rec-pasta" }, url: "/family-hub/recipes" },
    ]);
    assert.deepEqual(nav.pushed, ["/family-hub/recipes"]);
    // System-back to the list entry, then forward to the detail entry.
    card._onPopState({ state: null });
    await flush();
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, false);
    card._onPopState({ state: { fhNav: "detail", openId: "rec-pasta" } });
    await flush();
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, true);
    assert.match(card.shadowRoot.innerHTML, /Step 1 of 3/);
  } finally {
    if (card) card.disconnectedCallback();
    clearWindow();
  }
});

test("Wave 1: _navigate is a no-op on the active Recipes tab (N-IMPL-6)", async () => {
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card } = await loadedCard();
    card.shadowRoot.dispatchClick(fakeTarget("nav", { path: "/family-hub/recipes" }));
    await flush();
    assert.deepEqual(nav.pushed, []);
    assert.deepEqual(nav.dispatched, []);
    card.disconnectedCallback();
  } finally {
    clearWindow();
  }
});

test("Wave 1: session restore re-opens the saved detail at the saved step (N-IMPL-8/21); strip Recipes from the detail closes to list top and clears it (N-IMPL-7)", async () => {
  const store = stubSessionStorage({
    "family-hub:recipe:state": JSON.stringify({
      openId: "rec-pasta",
      step: 2,
      listScrollY: 400,
      detailScrollY: 120,
    }),
  });
  const nav = stubHistoryWindow(HUB_WINDOW);
  let card;
  try {
    ({ card } = await loadedCard());
    // Mount restore (N-IMPL-8): the saved detail re-opens at step 2.
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, true);
    assert.match(card.shadowRoot.innerHTML, /Step 2 of 3/);
    nav.scrolled.length = 0;
    nav.pushedStates.length = 0;
    nav.pushed.length = 0;
    // Strip Recipes from the detail (N-IMPL-7): list top, session
    // cleared, exactly ONE list history entry.
    card.shadowRoot.dispatchClick(fakeTarget("nav", { path: "/family-hub/recipes" }));
    await flush();
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, false);
    assert.deepEqual(nav.scrolled, [[0, 0]]);
    assert.deepEqual(JSON.parse(store.get("family-hub:recipe:state")), {
      openId: null,
      step: null,
      listScrollY: 0,
      detailScrollY: 0,
      query: "",
      collectionId: "",
      sort: "name",
    });
    assert.deepEqual(nav.pushedStates, [
      { state: { fhNav: "list", openId: null }, url: "/family-hub/recipes" },
    ]);
    // System-back from the list returns to the detail exactly once.
    card._onPopState({ state: { fhNav: "detail", openId: "rec-pasta" } });
    await flush();
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, true);
  } finally {
    if (card) card.disconnectedCallback();
    clearWindow();
    clearSessionStorage();
  }
});

test("Wave 1: ← All recipes restores the saved list scroll (N-IMPL-9)", async () => {
  stubSessionStorage({
    "family-hub:recipe:state": JSON.stringify({
      openId: "rec-pasta",
      step: 1,
      listScrollY: 400,
      detailScrollY: 120,
    }),
  });
  const nav = stubHistoryWindow(HUB_WINDOW);
  let card;
  try {
    ({ card } = await loadedCard());
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, true);
    nav.scrolled.length = 0;
    card.shadowRoot.dispatchClick(fakeTarget("back"));
    await flush();
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, false);
    assert.deepEqual(nav.scrolled, [[0, 400]]);
  } finally {
    if (card) card.disconnectedCallback();
    clearWindow();
    clearSessionStorage();
  }
});

test("Wave 1: the voice hint is computed from the current step; no time chip, no hint (N-IMPL-19c)", async () => {
  const timed = {
    ...PASTA_FULL,
    preparation_steps: ["Simmer for 6 to 8 minutes.", "Rest for 1 hour 30 minutes."],
  };
  const { card } = await loadedCard({ detail: timed });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Say 'Okay Nabu, start a 8 minute timer'/);
  card.shadowRoot.dispatchClick(fakeTarget("step-next"));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Say 'Okay Nabu, start a 1 hour timer'/);
  card.disconnectedCallback();
});

test("Wave 1: the strip badge shows the timer count from hass states (N-IMPL-5)", async () => {
  const states = [
    {
      entity_id: "sensor.satellite_timer_pasta",
      state: "active",
      attributes: { remaining: 600 },
    },
    {
      entity_id: "sensor.satellite_timer_soup",
      state: "paused",
      attributes: { remaining: 30 },
    },
  ];
  const { card } = await loadedCard({ states });
  const badges = card.shadowRoot.querySelectorAll(".timer-badge");
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, "2");
  assert.equal(badges[0].hidden, false);
  card.disconnectedCallback();
});

// -- Wave 1 (Recipes): PIP, strip cap, honest save, Finish ---------------

function timerSensor(id, name, state, extra = {}) {
  return {
    entity_id: id,
    state,
    attributes: {
      timer_name: name,
      started_at: new Date(Date.now() - 60000).toISOString(),
      finishes_at: new Date(Date.now() + 600000).toISOString(),
      ...extra,
    },
  };
}

test("Wave 1 (Recipes): the strip shows at most 3 pills, most-recently-started first, then '+N more running' (R-IMPL-26)", async () => {
  const now = Date.now();
  const states = [40, 30, 20, 10].map((ago, i) => ({
    entity_id: `sensor.satellite_timer_t${i + 1}`,
    state: "active",
    attributes: {
      timer_name: `Timer ${i + 1}`,
      started_at: new Date(now - ago * 1000).toISOString(),
      finishes_at: new Date(now + 600000).toISOString(),
    },
  }));
  const { card } = await loadedCard({ states });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  const items = card.shadowRoot.querySelectorAll(".timer-strip-item");
  // 4 running timers -> 3 pills + the "+1 more running" pill.
  assert.equal(items.length, 4);
  assert.match(items[0].textContent, /Timer 4/);
  assert.match(items[1].textContent, /Timer 3/);
  assert.match(items[2].textContent, /Timer 2/);
  assert.match(items[3].textContent, /\+1 more running/);
  assert.ok(items[3].classList.contains("timer-strip-more"));
  card.disconnectedCallback();
});

test("Wave 1 (Recipes): a chip tap shows the PIP in place and does NOT navigate away (T7-NJ1, R-IMPL-17)", async () => {
  const nav = stubWindow(HUB_WINDOW);
  try {
    const timed = {
      ...PASTA_FULL,
      preparation_steps: ["Boil the pasta for 10 minutes."],
    };
    const { card } = await loadedCard({ detail: timed });
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    card.shadowRoot.dispatchClick(fakeTarget("start-timer", { seconds: "600" }));
    await flush();
    // The PIP confirms the timer in place: name + ticking time.
    const pip = card.shadowRoot.querySelector(".pip");
    assert.ok(pip);
    assert.match(pip.textContent, /Creamy Tomato Pasta/);
    assert.match(pip.textContent, /10:00/);
    // No navigation: the cook stays on the recipe. (The one push is
    // the detail entry from opening the recipe, not a navigation.)
    assert.deepEqual(nav.pushed, ["/family-hub/recipes"]);
    // The 5 s auto-hide clock is armed (the fade itself is covered
    // by the fade test below, not by waiting 5 s here).
    assert.notEqual(card._pipHideTimer, null);
    card.disconnectedCallback();
  } finally {
    clearWindow();
  }
});

test("Wave 1 (Recipes): tapping the PIP pins the timer and goes to Timers (OQ-7 publish leg)", async () => {
  const nav = stubWindow(HUB_WINDOW);
  const store = stubSessionStorage();
  try {
    const sensor = timerSensor("sensor.satellite_timer_pasta", "Creamy Tomato Pasta", "active", { timer_id: "01MPASTA" });
    const { card } = await loadedCard({ states: [sensor] });
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    card._pipShow(sensor, {});
    card.shadowRoot.dispatchClick(fakeTarget("pip-tap"));
    await flush();
    // The pin carries the sensor's timer_id ATTRIBUTE (the ULID) —
    // that is what the Timers card matches for the pinned-first render
    // and the "Just started" marker, not the entity_id.
    assert.equal(
      store.get("family-hub:timers:pin"),
      JSON.stringify({ timerId: "01MPASTA" })
    );
    // The first push is the detail entry from opening the recipe.
    assert.deepEqual(nav.pushed, ["/family-hub/recipes", "/family-hub/timers"]);
    assert.equal(card.shadowRoot.querySelector(".pip"), null);
    card.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("Wave 1 (Recipes): a PIP tap with no timer_id attribute navigates unpinned (OQ-7)", async () => {
  const nav = stubWindow(HUB_WINDOW);
  const store = stubSessionStorage();
  try {
    const { card } = await loadedCard();
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    // No timer_id attribute on the sensor: nothing to pin against.
    card._pipShow(timerSensor("sensor.satellite_timer_pasta", "Creamy Tomato Pasta", "active"), {});
    card.shadowRoot.dispatchClick(fakeTarget("pip-tap"));
    await flush();
    assert.equal(store.get("family-hub:timers:pin"), undefined);
    assert.deepEqual(nav.pushed, ["/family-hub/recipes", "/family-hub/timers"]);
    card.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("Wave 1 (Recipes): the PIP x dismisses the notice without cancelling the timer; a finished dismissal is remembered (R-IMPL-20)", async () => {
  const { card, hass } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card._pipShow(timerSensor("sensor.satellite_timer_pasta", "Creamy Tomato Pasta", "active"), {});
  card.shadowRoot.dispatchClick(fakeTarget("pip-dismiss"));
  await flush();
  assert.equal(card.shadowRoot.querySelector(".pip"), null);
  // Dismissal is a notice action only: no service call went out.
  assert.equal(hass.calls.filter((c) => c[1] !== "get_recipes").length, 0);
  // A finished timer's dismissal is remembered: a later hass push
  // showing the same timer finished does NOT re-show the PIP.
  card._pipShow(timerSensor("sensor.satellite_timer_pasta", "Creamy Tomato Pasta", "finished"), { finished: true });
  card.shadowRoot.dispatchClick(fakeTarget("pip-dismiss"));
  await flush();
  assert.ok(card._pipDismissed.has("sensor.satellite_timer_pasta"));
  const finished = timerSensor("sensor.satellite_timer_pasta", "Creamy Tomato Pasta", "finished");
  card.hass = { ...hass, states: [finished] };
  await flush();
  assert.equal(card.shadowRoot.querySelector(".pip"), null);
  card.disconnectedCallback();
});

test("Wave 1 (Recipes): a swipe collapses the PIP to the affordance; tapping the affordance restores it (R-IMPL-22)", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card._pipShow(timerSensor("sensor.satellite_timer_pasta", "Creamy Tomato Pasta", "active"), {});
  assert.ok(card.shadowRoot.querySelector(".pip"));
  // A 60 px swipe down collapses it; the auto-hide clock stops while
  // collapsed (the affordance stays until tapped).
  card._pipTouchStart({ touches: [{ clientX: 200, clientY: 500 }] });
  card._pipTouchEnd({ changedTouches: [{ clientX: 200, clientY: 560 }] });
  assert.equal(card.shadowRoot.querySelector(".pip"), null);
  const affordance = card.shadowRoot.querySelector(".pip-affordance");
  assert.ok(affordance);
  assert.match(affordance.textContent, /10:00/);
  assert.equal(card._pipHideTimer, null);
  // Tapping the affordance restores the full PIP with a fresh clock.
  card.shadowRoot.dispatchClick(fakeTarget("pip-restore"));
  await flush();
  assert.ok(card.shadowRoot.querySelector(".pip"));
  assert.notEqual(card._pipHideTimer, null);
  // A short drag (under 40 px) is a tap, not a swipe: the PIP stays.
  card._pipTouchStart({ touches: [{ clientX: 200, clientY: 500 }] });
  card._pipTouchEnd({ changedTouches: [{ clientX: 200, clientY: 510 }] });
  assert.ok(card.shadowRoot.querySelector(".pip"));
  card.disconnectedCallback();
});

test("Wave 1 (Recipes): a touchcancel after a swipe collapses the PIP, and a touchcancel without movement resumes the clock (R-IMPL-22)", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card._pipShow(timerSensor("sensor.satellite_timer_pasta", "Creamy Tomato Pasta", "active"), {});
  assert.ok(card.shadowRoot.querySelector(".pip"));
  // A swipe the compositor cancels (touchcancel, not touchend) still
  // collapses: the end handler reads the cancel position.
  card._pipTouchStart({ touches: [{ clientX: 200, clientY: 500 }] });
  card._onPipTouchEnd({ changedTouches: [{ clientX: 140, clientY: 500 }] });
  assert.equal(card.shadowRoot.querySelector(".pip"), null);
  assert.ok(card.shadowRoot.querySelector(".pip-affordance"));
  // Restored, then a cancelled touch with no movement resumes the
  // auto-hide clock instead of collapsing.
  card.shadowRoot.dispatchClick(fakeTarget("pip-restore"));
  await flush();
  assert.ok(card.shadowRoot.querySelector(".pip"));
  card._pipTouchStart({ touches: [{ clientX: 200, clientY: 500 }] });
  assert.equal(card._pipHideTimer, null);
  card._onPipTouchEnd({ changedTouches: [{ clientX: 200, clientY: 500 }] });
  assert.ok(card.shadowRoot.querySelector(".pip"));
  assert.notEqual(card._pipHideTimer, null);
  card.disconnectedCallback();
});

test("Wave 1 (Recipes): a voice-started timer shows the PIP via the hass diff; a service-started timer does not double-show (R-IMPL-23)", async () => {
  const active = timerSensor("sensor.satellite_timer_pasta", "Creamy Tomato Pasta", "active", { started_via: "service" });
  const { card, hass } = await loadedCard({ states: [active] });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  assert.equal(card.shadowRoot.querySelector(".pip"), null);
  const voice = timerSensor("sensor.satellite_timer_voice", "Voice Timer", "active", { started_via: "voice" });
  card.hass = { ...hass, states: [active, voice] };
  await flush();
  const pip = card.shadowRoot.querySelector(".pip");
  assert.ok(pip);
  assert.match(pip.textContent, /Voice Timer/);
  // A second service-started timer arriving by hass push does NOT
  // replace the voice PIP (the chip path owns service timers).
  const service2 = timerSensor("sensor.satellite_timer_soup", "Soup Timer", "active", { started_via: "service" });
  card.hass = { ...hass, states: [active, voice, service2] };
  await flush();
  assert.match(card.shadowRoot.querySelector(".pip").textContent, /Voice Timer/);
  card.disconnectedCallback();
});

test("Wave 1 (Recipes): a finished timer shows a PIP that never auto-hides (R-IMPL-21)", async () => {
  const active = timerSensor("sensor.satellite_timer_pasta", "Creamy Tomato Pasta", "active", { started_via: "voice" });
  const { card, hass } = await loadedCard({ states: [active] });
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.hass = { ...hass, states: [{ ...active, state: "finished" }] };
  await flush();
  const pip = card.shadowRoot.querySelector(".pip");
  assert.ok(pip);
  assert.match(pip.textContent, /Done/);
  assert.equal(card._pip.finished, true);
  assert.equal(card._pipHideTimer, null);
  card.disconnectedCallback();
});

test("Wave 1 (Recipes): a 5 s fade hides the PIP; the fade class lands first (R-IMPL-18)", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card._pipShow(timerSensor("sensor.satellite_timer_pasta", "Creamy Tomato Pasta", "active"), {});
  card._pipFadeOut();
  // The fade class lands immediately (300 ms transition); the PIP
  // leaves the DOM when the fade finishes.
  assert.ok(card.shadowRoot.querySelector(".pip.hide"));
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(card.shadowRoot.querySelector(".pip"), null);
  card.disconnectedCallback();
});

test("Wave 1 (Recipes): an update_recipe that returns {} does NOT certify a note save — retry is tappable (R-IMPL-39)", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
  await flush();
  typeNote(card, "More salt next time.");
  // The rig stub's shape: a non-throwing update_recipe returning {}.
  card._callAction = async () => ({});
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Couldn't save — tap to retry/);
  assert.equal(card._noteDrafts.get("rec-pasta"), "More salt next time.");
  assert.equal(card._selected.note, "Vihaan likes this with extra cheese.");
  // The retry re-attempts with the kept draft; the real action
  // returns a usable recipe, so the save confirms.
  delete card._callAction;
  card.shadowRoot.dispatchClick(fakeTarget("retry-note"));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Note saved\./);
  assert.equal(card._selected.note, "More salt next time.");
  card.disconnectedCallback();
});

test("Wave 1 (Recipes): an update_recipe that returns {} does NOT certify a rating save — retry is tappable (R-IMPL-39)", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
  await flush();
  card._callAction = async () => ({});
  card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Couldn't save — tap to retry/);
  assert.equal(card._pendingRating, 3);
  assert.equal(card.shadowRoot.querySelectorAll(".star.filled").length, 5);
  delete card._callAction;
  card.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Rating saved\./);
  assert.equal(card.shadowRoot.querySelectorAll(".star.filled").length, 3);
  assert.equal(card._selected.rating, 3);
  card.disconnectedCallback();
});

test("Wave 1 (Recipes): Start over clears the checks AND resets the step to 1 (R-IMPL-34)", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("step", { stepIndex: "2" }));
  card.shadowRoot.dispatchClick(fakeTarget("toggle-ingredient", { index: "0" }));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Step 3 of 3/);
  assert.match(card.shadowRoot.innerHTML, /1 of 3 gathered/);
  card.shadowRoot.dispatchClick(fakeTarget("clear-checks"));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Step 1 of 3/);
  assert.match(card.shadowRoot.innerHTML, /0 of 3 gathered/);
  card.disconnectedCallback();
});

test("Wave 1 (Recipes): Next becomes Finish at the last step; Finish shows the completion card (R-IMPL-8)", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("step-next"));
  card.shadowRoot.dispatchClick(fakeTarget("step-next"));
  await flush();
  assert.match(card.shadowRoot.innerHTML, /Step 3 of 3/);
  assert.ok(card.shadowRoot.querySelector('[data-action="finish"]'));
  assert.equal(card.shadowRoot.querySelector('[data-action="step-next"]'), null);
  card.shadowRoot.dispatchClick(fakeTarget("finish"));
  await flush();
  assert.ok(card.shadowRoot.querySelector('[data-role="completion"]'));
  assert.match(card.shadowRoot.innerHTML, /All done!/);
  // "Cook again" is Start over: checks cleared, step back to 1.
  card.shadowRoot.dispatchClick(fakeTarget("cook-again"));
  await flush();
  assert.equal(card.shadowRoot.querySelector('[data-role="completion"]'), null);
  assert.match(card.shadowRoot.innerHTML, /Step 1 of 3/);
  // Finish again, then "Back to recipe" hides the card at the last step.
  card.shadowRoot.dispatchClick(fakeTarget("step-next"));
  card.shadowRoot.dispatchClick(fakeTarget("step-next"));
  card.shadowRoot.dispatchClick(fakeTarget("finish"));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("finish-dismiss"));
  await flush();
  assert.equal(card.shadowRoot.querySelector('[data-role="completion"]'), null);
  assert.match(card.shadowRoot.innerHTML, /Step 3 of 3/);
  card.disconnectedCallback();
});

test("Wave 1 (Recipes): <- All recipes pushes ONE list history entry, so one system-back returns to the detail (R-IMPL-11)", async () => {
  stubSessionStorage({
    "family-hub:recipe:state": JSON.stringify({
      openId: "rec-pasta",
      step: 1,
      listScrollY: 400,
      detailScrollY: 120,
    }),
  });
  const nav = stubHistoryWindow(HUB_WINDOW);
  let card;
  try {
    ({ card } = await loadedCard());
    nav.scrolled.length = 0;
    nav.pushedStates.length = 0;
    nav.pushed.length = 0;
    card.shadowRoot.dispatchClick(fakeTarget("back"));
    await flush();
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, false);
    assert.deepEqual(nav.scrolled, [[0, 400]]);
    assert.deepEqual(nav.pushedStates, [
      { state: { fhNav: "list", openId: null }, url: "/family-hub/recipes" },
    ]);
    // One system-back press from that list entry returns to the detail.
    card._onPopState({ state: { fhNav: "detail", openId: "rec-pasta" } });
    await flush();
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, true);
  } finally {
    if (card) card.disconnectedCallback();
    clearWindow();
    clearSessionStorage();
  }
});

test("Wave 1 (Recipes): a reload re-opens the saved detail at scrollY 0 — the saved detail scroll is never restored (R-IMPL-15)", async () => {
  stubSessionStorage({
    "family-hub:recipe:state": JSON.stringify({
      openId: "rec-pasta",
      step: 2,
      listScrollY: 400,
      detailScrollY: 120,
    }),
  });
  const nav = stubHistoryWindow(HUB_WINDOW);
  let card;
  try {
    ({ card } = await loadedCard());
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, true);
    assert.match(card.shadowRoot.innerHTML, /Step 2 of 3/);
    // The detail opens at the top (0,0); the saved 120 never lands.
    assert.deepEqual(nav.scrolled, [[0, 0]]);
  } finally {
    if (card) card.disconnectedCallback();
    clearWindow();
    clearSessionStorage();
  }
});

test("Wave 1 (Recipes): the session restores the list state — query, filter, sort (R-IMPL-14b)", async () => {
  stubSessionStorage({
    "family-hub:recipe:state": JSON.stringify({
      openId: null,
      step: null,
      listScrollY: 0,
      detailScrollY: 0,
      query: "pasta",
      collectionId: "col-pasta",
      sort: "cook",
    }),
  });
  try {
    const { card } = await loadedCard();
    assert.equal(card._query, "pasta");
    assert.equal(card._collectionId, "col-pasta");
    assert.equal(card._sort, "cook");
    // The search field keeps the query for editing; the list shows
    // the filtered recipes.
    assert.equal(card.shadowRoot.querySelector('[data-role="search"]').value, "pasta");
    assert.equal(card.shadowRoot.querySelectorAll(".row").length, 1);
    card.disconnectedCallback();
  } finally {
    clearSessionStorage();
  }
});

test("Wave 1 (Recipes): the sort labels go compact at <=390 px (R-IMPL-4)", async () => {
  stubWindow(PHONE_WINDOW);
  try {
    const { card } = await loadedCard();
    const sortEl = card.shadowRoot.querySelector('[data-role="sort"]');
    // The fake select carries no .options; give it the option objects
    // the card's shell carries, then re-sync.
    sortEl.options = [
      { value: "name", textContent: "Name" },
      { value: "rating", textContent: "Rating" },
      { value: "cook", textContent: "Cook time" },
      { value: "prep", textContent: "Prep time" },
    ];
    card._syncSortLabels();
    assert.deepEqual(
      sortEl.options.map((o) => o.textContent),
      ["⇅ Name", "⇅ Rating", "⇅ Cook time", "⇅ Prep time"]
    );
    card.disconnectedCallback();
  } finally {
    clearWindow();
  }
  stubWindow(DESKTOP_WINDOW);
  try {
    const { card } = await loadedCard();
    const sortEl = card.shadowRoot.querySelector('[data-role="sort"]');
    sortEl.options = [
      { value: "name", textContent: "⇅ Name" },
      { value: "rating", textContent: "⇅ Rating" },
      { value: "cook", textContent: "⇅ Cook time" },
      { value: "prep", textContent: "⇅ Prep time" },
    ];
    card._syncSortLabels();
    assert.deepEqual(
      sortEl.options.map((o) => o.textContent),
      ["Name", "Rating", "Cook time", "Prep time"]
    );
    card.disconnectedCallback();
  } finally {
    clearWindow();
  }
});

test("Wave 1 (Recipes): opening the Notes tab autofocuses the editor with the caret at the end (R-IMPL-37)", async () => {
  const { card } = await loadedCard();
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
  await flush();
  const editor = card.shadowRoot.querySelector('[data-role="note"]');
  assert.equal(card.shadowRoot.activeElement, editor);
  // The caret sits at the end of the existing note.
  const noteLen = "Vihaan likes this with extra cheese.".length;
  assert.equal(editor.selectionStart, noteLen);
  assert.equal(editor.selectionEnd, noteLen);
  card.disconnectedCallback();
});
