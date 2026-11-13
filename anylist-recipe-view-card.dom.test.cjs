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

const { AnyListRecipeViewCard, _setCoreForTests } = require("./anylist-recipe-view-card.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function flush() {
  await sleep(20);
}

// Burst-5 (F4): poll until a condition holds instead of sleeping a
// fixed margin — a fixed sleep can leave a save in flight on a
// loaded tick even when the settle usually takes a fraction of it.
async function waitFor(condition, timeoutMs = 2000) {
  const started = Date.now();
  for (;;) {
    if (condition()) return;
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timed out");
    await sleep(10);
  }
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
      // The core lookup (R1) asks for the Lovelace resource list —
      // the real HA answers it; in tests core is never registered,
      // so the list is empty. It is infrastructure, not a service
      // call, so it is not recorded in `calls` (exact-calls
      // assertions elsewhere in this file would otherwise break).
      if (message && message.type === "lovelace/resources/list") return [];
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

// core.js is an ES module in the pi-family-hub repo — node loads it
// through a byte-identical .mjs copy (same pattern as the core suite).
// The recipe card imports core for identity, so its DOM tests load
// the real core rather than a stub.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
// FAMILY_HUB_CORE_PATH overrides the core location (default: the
// shared pi-family-hub worktree's dashboard core).
const corePath =
  process.env.FAMILY_HUB_CORE_PATH ||
  path.join(
    __dirname,
    "../goals/diy-family-hub-raspberry-pi/files/local-git/pi-family-hub/installer/dashboard/family-hub-core.js"
  );
assert.ok(
  fs.existsSync(corePath),
  `family-hub-core.js missing at ${corePath} — the recipe card imports it for identity`
);
const coreTmp = fs.mkdtempSync(path.join(os.tmpdir(), "family-hub-recipe-dom-test-"));
const coreMjs = path.join(coreTmp, "family-hub-core.mjs");
fs.copyFileSync(corePath, coreMjs);
const core = require(coreMjs);
// The core the tests load must be the R1-3-or-later core: a stale
// pre-R1-3 core (no deviceFromIdentity) used to fail ~30 tests with
// "deviceFromIdentity is not a function". Fail once, naming the cause
// and the override, instead of failing every identity test cryptically.
assert.equal(
  typeof core.deviceFromIdentity,
  "function",
  `family-hub-core.js at ${corePath} predates deviceFromIdentity — ` +
    `the pi-family-hub worktree is on a pre-R1-3 branch; switch it to ` +
    `rebuild/r1, or point FAMILY_HUB_CORE_PATH at a core that exports it`
);
assert.equal(
  typeof core.checkBridgeContract,
  "function",
  `family-hub-core.js at ${corePath} predates checkBridgeContract — ` +
    `the pi-family-hub worktree is on a pre-R1-5 core; switch it to ` +
    `rebuild/r1, or point FAMILY_HUB_CORE_PATH at a core that exports it`
);
const { HUB_BROWSER_ID } = core;

// Inject the real core into the card under test. The wall DOM tests
// register the wall's id via the sensor leg: the shipped core still
// carries the unsubstituted __HUB_BROWSER_ID__ placeholder, so the
// tests register THAT id (the wizard substitutes a real id at deploy;
// the mechanism — exact match → wall — is what's under test).
function injectCore() {
  _setCoreForTests(core);
}
function resetCore() {
  _setCoreForTests(null);
}
function wallBrowserPathState(pathname) {
  return {
    entity_id: `sensor.${HUB_BROWSER_ID}_browser_path`,
    state: pathname,
    attributes: {},
  };
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

test("a failed load retries itself, shows the error only once the budget is spent, and retry works", async () => {
  const card = new AnyListRecipeViewCard();
  card.setConfig({});
  // Short backoff so the test does not wait out the real 1/2/4 s.
  card._loadRetryDelays = [150, 200, 250];
  const hass = fakeHass({ fail: { get_recipes: "boom" } });
  card.hass = hass;
  await flush();
  // Mid-budget: no dead-end error yet — the transient "trying
  // again" state shows instead (C1).
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Couldn't load recipes/);
  assert.match(card.shadowRoot.innerHTML, /trying again/);
  // Once the retries are spent (1 + 3 attempts), the error lands
  // with the Try again button — and exactly 4 loads were made.
  await sleep(900);
  assert.match(card.shadowRoot.innerHTML, /Couldn't load recipes — check the connection and try again\./);
  assert.match(card.shadowRoot.innerHTML, /Try again/);
  assert.equal(
    hass.calls.filter((call) => call[1] === "get_recipes").length,
    4
  );
  // The retry path is a fresh load: swap in a working hass and retry.
  card._hass = fakeHass();
  card.shadowRoot.dispatchClick(fakeTarget("retry"));
  await flush();
  assert.equal(card.shadowRoot.querySelectorAll(".row").length, 3);
  card.disconnectedCallback();
});

test("a load that fails because AnyList is not installed names the remedy at once, without burning retries (C4)", async () => {
  const card = new AnyListRecipeViewCard();
  card.setConfig({});
  card._loadRetryDelays = [150, 200, 250];
  const hass = fakeHass({ fail: { get_recipes: "Service anylist.get_recipes not found" } });
  card.hass = hass;
  await flush();
  // No retry wait: the failure is not transient, so the remedy
  // shows immediately — and only one load was attempted.
  assert.match(
    card.shadowRoot.innerHTML,
    /The AnyList integration is not available on this Home Assistant\. Install the AnyList integration in HACS \(or re-run the setup wizard\), then open the Recipes view again — the list loads when the view opens\./
  );
  assert.equal(
    hass.calls.filter((call) => call[1] === "get_recipes").length,
    1
  );
  card.disconnectedCallback();
});

test("a transient load failure recovers on its own — no error is ever shown (C1)", async () => {
  const card = new AnyListRecipeViewCard();
  card.setConfig({});
  card._loadRetryDelays = [10, 20, 30];
  const hass = fakeHass();
  let attempts = 0;
  const realCallWS = hass.callWS;
  hass.callWS = async (message) => {
    if (message.service === "get_recipes" && ++attempts <= 2) {
      throw new Error("boom");
    }
    return realCallWS(message);
  };
  card.hass = hass;
  await sleep(200);
  assert.equal(card.shadowRoot.querySelectorAll(".row").length, 3);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Couldn't load recipes/);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /trying again/);
  // Two failed attempts plus the succeeding one; only the success
  // reached the recording fake (the failures threw first).
  assert.equal(attempts, 3);
  assert.equal(
    hass.calls.filter((call) => call[1] === "get_recipes").length,
    1
  );
  card.disconnectedCallback();
});

test("re-opening the view cancels a pending load retry — no double load (O2)", async () => {
  const card = new AnyListRecipeViewCard();
  card.setConfig({});
  card._loadRetryDelays = [200, 200, 200];
  const hass = fakeHass({ fail: { get_recipes: "boom" } });
  card.hass = hass;
  await flush();
  assert.equal(hass.calls.filter((call) => call[1] === "get_recipes").length, 1);
  assert.notEqual(card._loadRetryTimer, null, "auto-retry pending");
  // Re-open the view while the retry is pending: the fresh load
  // supersedes the scheduled attempt, which must never fire.
  card._loadRetryDelays = [9000, 9000, 9000];
  card.connectedCallback();
  await flush();
  assert.equal(hass.calls.filter((call) => call[1] === "get_recipes").length, 2);
  await sleep(400);
  assert.equal(
    hass.calls.filter((call) => call[1] === "get_recipes").length,
    2,
    "no phantom load from the cancelled retry"
  );
  card.disconnectedCallback();
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
  globalThis.window.location.pathname = "/family-hub/recipes";
  injectCore();
  try {
    const { card } = await loadedCard({
      states: [wallBrowserPathState("/family-hub/recipes")],
    });
    const screen = card.shadowRoot.querySelector(".screen");
    assert.ok(screen.classList.contains("dev-hub"));
    assert.ok(screen.classList.contains("orient-landscape"));
    assert.ok(!screen.classList.contains("dev-mobile"));
  } finally {
    resetCore();
    clearWindow();
  }
});

test("the card carries dev-desktop on a mouse-driven screen", async () => {
  stubWindow(DESKTOP_WINDOW);
  injectCore();
  try {
    const { card } = await loadedCard();
    const screen = card.shadowRoot.querySelector(".screen");
    assert.ok(screen.classList.contains("dev-desktop"));
    assert.ok(screen.classList.contains("orient-landscape"));
  } finally {
    resetCore();
    clearWindow();
  }
});

test("the card carries dev-mobile + orient-portrait on a phone", async () => {
  stubWindow(PHONE_WINDOW);
  injectCore();
  try {
    const { card } = await loadedCard();
    const screen = card.shadowRoot.querySelector(".screen");
    assert.ok(screen.classList.contains("dev-mobile"));
    assert.ok(screen.classList.contains("orient-portrait"));
  } finally {
    resetCore();
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
  injectCore();
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
    resetCore();
    clearWindow();
  }
});

// -- D9 layout bands (RB-R1-4) ------------------------------------------------
// The detail (.cook-grid) is two-column iff core layoutBand() says so:
// wall-identity OR 900 <= viewport width <= ~1100 px, plus the
// column-minimum condition. The class lives on .screen; the CSS keys
// the grid off it — no media query, no device class decides columns.

test("D9: the wall is two-column at 1920x1200; the same width unknown is single-column", async () => {
  // Wall leg — identity decides, not width (fixes-18 item 24).
  stubWindow(HUB_WINDOW);
  globalThis.window.location.pathname = "/family-hub/recipes";
  injectCore();
  try {
    const { card } = await loadedCard({
      states: [wallBrowserPathState("/family-hub/recipes")],
    });
    const screen = card.shadowRoot.querySelector(".screen");
    assert.ok(screen.classList.contains("dev-hub"));
    assert.ok(screen.classList.contains("layout-two-column"));
    assert.ok(!screen.classList.contains("layout-single-column"));
  } finally {
    resetCore();
    clearWindow();
  }
  // Unknown leg — the same 1920 px viewport with no registered id is
  // "not the wall, width above the range" -> single-column.
  stubWindow({ ...DESKTOP_WINDOW, width: 1920, height: 1200 });
  injectCore();
  try {
    const { card } = await loadedCard();
    const screen = card.shadowRoot.querySelector(".screen");
    assert.ok(!screen.classList.contains("dev-hub"));
    assert.ok(screen.classList.contains("layout-single-column"));
    assert.ok(!screen.classList.contains("layout-two-column"));
  } finally {
    resetCore();
    clearWindow();
  }
});

test("D9: the width band gives two-column at 900..1100 and single outside it", async () => {
  const cases = [
    // [width, height, expected two-column]
    [900, 768, true],
    [1024, 768, true],
    [1100, 800, true],
    [899, 768, false],
    [1101, 800, false],
    [1366, 768, false],
    [1440, 900, false],
    [1920, 1080, false],
    [390, 844, false],
    [768, 1024, false],
  ];
  for (const [width, height, two] of cases) {
    stubWindow({ ...DESKTOP_WINDOW, width, height });
    injectCore();
    try {
      const { card } = await loadedCard();
      const screen = card.shadowRoot.querySelector(".screen");
      assert.equal(
        screen.classList.contains("layout-two-column"),
        two,
        `${width}x${height} two-column=${two}`
      );
      assert.equal(
        screen.classList.contains("layout-single-column"),
        !two,
        `${width}x${height} single-column=${!two}`
      );
    } finally {
      resetCore();
      clearWindow();
    }
  }
});

test("D9: a resize flips the band class (1024 -> two-column, 1366 -> single)", async () => {
  stubWindow({ ...DESKTOP_WINDOW, width: 1024, height: 768 });
  injectCore();
  try {
    const { card } = await loadedCard();
    const screen = card.shadowRoot.querySelector(".screen");
    assert.ok(screen.classList.contains("layout-two-column"));
    stubWindow({ ...DESKTOP_WINDOW, width: 1366, height: 768 });
    card._onResize();
    assert.ok(screen.classList.contains("layout-single-column"));
    assert.ok(!screen.classList.contains("layout-two-column"));
  } finally {
    resetCore();
    clearWindow();
  }
});

test("D9: a 400 px viewport is single-column — the column minimum binds (RB-R1-4)", async () => {
  stubWindow({ ...PHONE_WINDOW, width: 400, height: 800 });
  injectCore();
  try {
    const { card } = await loadedCard();
    const screen = card.shadowRoot.querySelector(".screen");
    assert.ok(screen.classList.contains("layout-single-column"));
    assert.ok(!screen.classList.contains("layout-two-column"));
  } finally {
    resetCore();
    clearWindow();
  }
});

test("D9: before core loads the card is single-column (desktop-safe unknown)", async () => {
  resetCore();
  stubWindow({ ...DESKTOP_WINDOW, width: 1024, height: 768 });
  try {
    const { card } = await loadedCard();
    const screen = card.shadowRoot.querySelector(".screen");
    assert.ok(screen.classList.contains("layout-single-column"));
    assert.ok(!screen.classList.contains("layout-two-column"));
  } finally {
    clearWindow();
  }
});

test("D9: the cook-grid keys off .layout-two-column — no width media query, no dev-hub rule", async () => {
  stubWindow(DESKTOP_WINDOW);
  try {
    const { card } = await loadedCard();
    const css = card.shadowRoot.querySelector("style").textContent;
    assert.match(
      css,
      /\.screen\.layout-two-column \.cook-grid \{ grid-template-columns: minmax\(220px, 5fr\) minmax\(0, 7fr\); \}/
    );
    assert.doesNotMatch(css, /@media \(min-width: 900px\) and \(max-width: 1100px\)/);
    assert.doesNotMatch(css, /\.screen\.dev-hub \.cook-grid/);
    // The comment records the unknown-identity consequence, not the
    // deleted hub-panel signature.
    assert.match(css, /identify\(\) -> unknown degrades the wall to/);
    assert.doesNotMatch(css, /hub-panel/);
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

async function openSoupNotesTab(card) {
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-soup" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
  await flush();
}

async function openRiceNotesTab(card) {
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-rice" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
  await flush();
}

function readStore(store) {
  const raw = store.get("family-hub:recipe:state");
  return raw ? JSON.parse(raw) : null;
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

test("a failed note save retries itself, then keeps the typed note and says so honestly", async () => {
  const { card, hass } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
  // Short backoff so the test does not wait out the real 0.5/1 s.
  card._saveRetryDelays = [50, 100];
  await openNotesTab(card);
  typeNote(card, "More salt next time.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  // Mid-budget: the save is still retrying — no error yet.
  await flush();
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Couldn't save the note/);
  // Once the retries are spent (1 + 2 attempts), the error lands —
  // and all three attempts sent exactly the same note.
  await sleep(250);
  assert.equal(hass.calls.length, 4);
  assert.deepEqual(hass.calls[1], [
    "anylist",
    "update_recipe",
    { recipe_id: "rec-pasta", note: "More salt next time." },
  ]);
  assert.deepEqual(hass.calls[2], hass.calls[1]);
  assert.deepEqual(hass.calls[3], hass.calls[1]);
  assert.match(card.shadowRoot.innerHTML, /Couldn't save the note/);
  assert.match(card.shadowRoot.innerHTML, /your text is still here/);
  // The typed note survives (the draft is kept) and the saved note
  // is untouched — nothing is silently lost.
  assert.equal(card._noteDrafts.get("rec-pasta"), "More salt next time.");
  assert.equal(card._selected.note, "Vihaan likes this with extra cheese.");
  assert.match(card.shadowRoot.innerHTML, /More salt next time\./);
  card.disconnectedCallback();
});

test("a transient note save failure recovers on its own — the draft clears and nothing is lost (C2)", async () => {
  const { card, hass } = await loadedCard();
  card._saveRetryDelays = [10, 20];
  let attempts = 0;
  const realCallWS = hass.callWS;
  hass.callWS = async (message) => {
    if (message.service === "update_recipe" && ++attempts <= 2) {
      throw new Error("AnyList is down");
    }
    return realCallWS(message);
  };
  await openNotesTab(card);
  typeNote(card, "More salt next time.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await sleep(200);
  assert.match(card.shadowRoot.innerHTML, /Note saved\./);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Couldn't save/);
  assert.equal(card._noteDrafts.has("rec-pasta"), false);
  assert.equal(card._selected.note, "More salt next time.");
  // Two failed attempts plus the succeeding one, all identical.
  assert.equal(attempts, 3);
  card.disconnectedCallback();
});

test("disconnect during a note-save backoff settles the save — no stuck flag, later saves work (F1)", async () => {
  const { card, hass } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
  card._saveRetryDelays = [10000, 10000];
  await openNotesTab(card);
  typeNote(card, "More salt next time.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.equal(card._savingNote, true, "save in flight after attempt 1 threw");
  assert.equal(card._saveBackoffs.size, 1, "backoff sleep pending");
  assert.equal(hass.calls.filter((c) => c[1] === "update_recipe").length, 1);
  card.disconnectedCallback();
  assert.equal(card._saveBackoffs.size, 0, "disconnect settled the backoff");
  await sleep(150);
  // The save returned instead of hanging: the flag cleared, no
  // failure status was invented for an abandoned save, and no retry
  // fired after disconnect.
  assert.equal(card._savingNote, false);
  assert.equal(card._noteStatus, null);
  assert.equal(hass.calls.filter((c) => c[1] === "update_recipe").length, 1);
  // The draft survived, and a later save on the same instance works
  // — after a re-attach, which is what Lovelace does when the view
  // re-opens: connectedCallback clears the disconnect flag (B1), so
  // a fresh save on the new mount may attempt and retry. A save
  // attempted on the still-detached card stays cancelled.
  assert.equal(card._noteDrafts.get("rec-pasta"), "More salt next time.");
  card._hass = fakeHass();
  card.connectedCallback();
  await flush();
  await card._saveNote();
  await flush();
  assert.equal(card._savingNote, false);
  assert.match(card.shadowRoot.innerHTML, /Note saved\./);
  assert.equal(card._noteDrafts.has("rec-pasta"), false);
  card.disconnectedCallback();
});

test("overlapping note and rating saves each cancel on disconnect — a detached card saves nothing (F2)", async () => {
  const { card, hass } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
  card._saveRetryDelays = [300, 300];
  await openNotesTab(card);
  typeNote(card, "More salt next time.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.equal(card._savingNote, true);
  await sleep(50);
  card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
  await flush();
  assert.equal(card._ratingBusy, true);
  assert.equal(hass.calls.filter((c) => c[1] === "update_recipe").length, 2, "both first attempts made");
  assert.equal(card._saveBackoffs.size, 2, "each save has its own backoff");
  await sleep(50);
  const callsAtDisconnect = hass.calls.filter((c) => c[1] === "update_recipe").length;
  card.disconnectedCallback();
  assert.equal(card._saveBackoffs.size, 0, "disconnect settled both backoffs");
  await sleep(600);
  assert.equal(
    hass.calls.filter((c) => c[1] === "update_recipe").length,
    callsAtDisconnect,
    "no save ran after disconnect"
  );
  assert.equal(card._savingNote, false);
  assert.equal(card._ratingBusy, false);
  assert.equal(card._noteStatus, null);
  // B2: the cancelled rating save keeps its intended rating and
  // offers the retry — the note shows no status (its draft is the
  // retry), but the rating has no Save button, so the status IS
  // its retry path. The old assertion (null here) encoded the
  // burst's dropped-rating behaviour.
  assert.equal(card._pendingRating, 3);
  assert.equal(card._pendingRatings.get("rec-pasta"), 3);
  assert.deepEqual(card._ratingStatus, {
    text: "Rating not saved yet — tap to retry",
    error: true,
    retry: "retry-rating",
  });
  card.disconnectedCallback();
});

test("disconnect mid-attempt then the attempt fails — no retry fires on the detached card (B1)", async () => {
  const { card, hass } = await loadedCard();
  card._saveRetryDelays = [50, 100];
  let releaseAttempt1;
  const attempt1Gate = new Promise((resolve) => {
    releaseAttempt1 = resolve;
  });
  let attempts = 0;
  const realCallWS = hass.callWS;
  hass.callWS = async (message) => {
    if (message.service === "update_recipe" && ++attempts === 1) {
      await attempt1Gate;
      throw new Error("AnyList is down");
    }
    return realCallWS(message);
  };
  await openNotesTab(card);
  typeNote(card, "More salt next time.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.equal(card._savingNote, true, "attempt 1 in flight");
  const callsAtDisconnect = hass.calls.filter((c) => c[1] === "update_recipe").length;
  card.disconnectedCallback();
  assert.equal(card._saveDisconnected, true, "disconnect flag set");
  // Attempt 1 lands after disconnect — and throws.
  releaseAttempt1();
  await sleep(300);
  // No retry fired on the detached card: the call count is exactly
  // what it was at disconnect, the flag cleared, no failure status
  // was invented, and the draft survived.
  assert.equal(
    hass.calls.filter((c) => c[1] === "update_recipe").length,
    callsAtDisconnect,
    "zero update_recipe calls after disconnect"
  );
  assert.equal(card._saveBackoffs.size, 0);
  assert.equal(card._savingNote, false);
  assert.equal(card._noteStatus, null);
  assert.equal(card._noteDrafts.get("rec-pasta"), "More salt next time.");
  assert.equal(card._selected.note, "Vihaan likes this with extra cheese.");
  card.disconnectedCallback();
});

test("disconnect mid-attempt then the attempt succeeds — the result is not applied on the detached card (B1)", async () => {
  const { card, hass } = await loadedCard();
  card._saveRetryDelays = [50, 100];
  let releaseAttempt1;
  const attempt1Gate = new Promise((resolve) => {
    releaseAttempt1 = resolve;
  });
  let attempts = 0;
  const realCallWS = hass.callWS;
  hass.callWS = async (message) => {
    if (message.service === "update_recipe" && ++attempts === 1) {
      await attempt1Gate;
    }
    return realCallWS(message);
  };
  await openNotesTab(card);
  typeNote(card, "More salt next time.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.equal(card._savingNote, true, "attempt 1 in flight");
  card.disconnectedCallback();
  // Attempt 1 lands after disconnect — and succeeds.
  releaseAttempt1();
  await sleep(300);
  // The in-flight attempt itself ran (one service call), but its
  // result was discarded, not applied: no retry, no backoff, the
  // stored note is untouched, the draft is kept, and no status
  // was set on the detached card.
  assert.equal(hass.calls.filter((c) => c[1] === "update_recipe").length, 1);
  assert.equal(attempts, 1, "no second attempt was fired");
  assert.equal(card._saveBackoffs.size, 0);
  assert.equal(card._savingNote, false);
  assert.equal(card._noteStatus, null);
  assert.equal(card._noteDrafts.get("rec-pasta"), "More salt next time.");
  assert.equal(card._selected.note, "Vihaan likes this with extra cheese.");
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Note saved\./);
  card.disconnectedCallback();
});

test("a cancelled rating save keeps the rating and offers the retry on re-open (B2)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card, hass } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    card._saveRetryDelays = [10000, 10000];
    await openNotesTab(card);
    card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await flush();
    assert.equal(card._ratingBusy, true, "rating save in flight after attempt 1 threw");
    assert.equal(card._saveBackoffs.size, 1, "backoff sleep pending");
    card.disconnectedCallback();
    await sleep(150);
    // Cancelled, not failed: the intended rating is kept with a
    // retry, the old rating still shows, and nothing fired after
    // disconnect.
    assert.equal(card._ratingBusy, false);
    assert.equal(card._pendingRating, 3);
    assert.equal(card._pendingRatings.get("rec-pasta"), 3);
    assert.equal(card.shadowRoot.querySelectorAll(".star.filled").length, 5);
    assert.equal(hass.calls.filter((c) => c[1] === "update_recipe").length, 1);
    assert.ok(card.shadowRoot.querySelector('[data-action="retry-rating"]'), "retry offered");
    // Re-open the view: the retry is still offered, and tapping it
    // saves the kept rating.
    card._hass = fakeHass();
    card.connectedCallback();
    await sleep(150);
    card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
    await flush();
    assert.ok(card.shadowRoot.querySelector('[data-action="retry-rating"]'), "retry offered after re-open");
    card.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await flush();
    assert.match(card.shadowRoot.innerHTML, /Rating saved\./);
    assert.equal(card.shadowRoot.querySelectorAll(".star.filled").length, 3);
    assert.equal(card._selected.rating, 3);
    assert.equal(card._pendingRating, null);
    assert.equal(card._pendingRatings.has("rec-pasta"), false);
    card.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("a cancelled note + rating save survives a real view re-open on a fresh card (B3)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card, hass } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    card._saveRetryDelays = [10000, 10000];
    await openNotesTab(card);
    typeNote(card, "More salt next time.");
    card.shadowRoot.dispatchClick(fakeTarget("save-note"));
    await flush();
    card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await flush();
    assert.equal(hass.calls.filter((c) => c[1] === "update_recipe").length, 2, "both first attempts made");
    card.disconnectedCallback();
    await sleep(150);
    assert.equal(card._savingNote, false);
    assert.equal(card._ratingBusy, false);
    // The kept draft and pending rating are in the session store,
    // not just instance memory.
    const saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.noteDrafts, { "rec-pasta": "More salt next time." });
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 3 });
    // A fresh card instance — what Lovelace creates when the view
    // re-opens — re-opens the saved detail, shows the kept draft
    // in the editor, and offers the rating retry.
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh.shadowRoot.querySelector(".list-view").hidden, true, "fresh card re-opened the saved detail");
    fresh.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
    await flush();
    assert.match(fresh.shadowRoot.innerHTML, /More salt next time\./);
    assert.equal(fresh._noteDrafts.get("rec-pasta"), "More salt next time.");
    assert.equal(fresh.shadowRoot.querySelectorAll(".star.filled").length, 5);
    assert.ok(fresh.shadowRoot.querySelector('[data-action="retry-rating"]'), "rating retry offered on the fresh card");
    assert.equal(fresh._pendingRating, 3);
    // The retry on the fresh card saves the kept rating, and the
    // kept draft saves with Save — nothing has to be retyped.
    fresh.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await flush();
    assert.match(fresh.shadowRoot.innerHTML, /Rating saved\./);
    assert.equal(fresh.shadowRoot.querySelectorAll(".star.filled").length, 3);
    fresh.shadowRoot.dispatchClick(fakeTarget("save-note"));
    await flush();
    assert.match(fresh.shadowRoot.innerHTML, /Note saved\./);
    assert.equal(fresh._selected.note, "More salt next time.");
    card.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("switching recipes mid-save confirms the first recipe's save without a failure status (B4)", async () => {
  const { card, hass } = await loadedCard();
  card._saveRetryDelays = [50, 100];
  let releaseAttempt1;
  const attempt1Gate = new Promise((resolve) => {
    releaseAttempt1 = resolve;
  });
  let attempts = 0;
  const realCallWS = hass.callWS;
  hass.callWS = async (message) => {
    if (message.service === "update_recipe" && ++attempts === 1) {
      await attempt1Gate;
    }
    return realCallWS(message);
  };
  await openNotesTab(card);
  typeNote(card, "More salt next time.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.equal(card._savingNote, true, "pasta save in flight");
  // Open another recipe mid-save: the detail switches to soup and
  // soup has no save in flight — but coming back to pasta still
  // shows its save as busy.
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-soup" }));
  await flush();
  assert.equal(card._selected.id, "rec-soup");
  assert.equal(card._savingNote, false, "soup has no save in flight");
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  assert.equal(card._savingNote, true, "pasta's in-flight save still shows busy on return");
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-soup" }));
  await flush();
  // The server accepts the pasta note on attempt 1.
  releaseAttempt1();
  await sleep(250);
  // Exactly one service call — the confirmed save did not burn
  // the retry budget — no failure status on the soup detail, and
  // the pasta list copy carries the new note.
  assert.equal(hass.calls.filter((c) => c[1] === "update_recipe").length, 1, "no retry budget burned on a confirmed save");
  assert.equal(attempts, 1);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Couldn't save/);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Note saved\./);
  const pasta = card._recipes.find((recipe) => recipe.id === "rec-pasta");
  assert.equal(pasta.note, "More salt next time.");
  assert.equal(card._noteDrafts.has("rec-pasta"), false);
  assert.equal(card._selected.id, "rec-soup");
  assert.equal(card._savingNote, false);
  card.disconnectedCallback();
});

test("text typed during a note-save retry is sent by the retry, not discarded (F3)", async () => {
  const { card, hass } = await loadedCard();
  card._saveRetryDelays = [50, 100];
  let attempts = 0;
  const realCallWS = hass.callWS;
  hass.callWS = async (message) => {
    if (message.service === "update_recipe" && ++attempts === 1) {
      throw new Error("AnyList is down");
    }
    return realCallWS(message);
  };
  await openNotesTab(card);
  typeNote(card, "More salt next time.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await sleep(25);
  assert.equal(card._savingNote, true, "save is in its retry backoff");
  // The textarea stays editable while saving — keep typing.
  typeNote(card, "More salt next time. And pepper.");
  assert.equal(card._noteDrafts.get("rec-pasta"), "More salt next time. And pepper.");
  await sleep(400);
  // The retry re-read the draft, so the newer text is what saved.
  assert.match(card.shadowRoot.innerHTML, /Note saved\./);
  assert.equal(card._selected.note, "More salt next time. And pepper.");
  assert.equal(card._noteDrafts.has("rec-pasta"), false);
  assert.match(card.shadowRoot.innerHTML, /And pepper/);
  // Two attempts were made, but only the succeeding one reached the
  // recording fake (the first threw before it) — and it carried the
  // newer text.
  assert.equal(attempts, 2);
  assert.equal(hass.calls.filter((c) => c[1] === "update_recipe").length, 1);
  assert.deepEqual(hass.calls[1], [
    "anylist",
    "update_recipe",
    { recipe_id: "rec-pasta", note: "More salt next time. And pepper." },
  ]);
  card.disconnectedCallback();
});

test("text typed while the final save attempt is in flight is kept as a draft, not deleted (F3)", async () => {
  const { card, hass } = await loadedCard();
  card._saveRetryDelays = [50, 100];
  let attempts = 0;
  let releaseAttempt2;
  const attempt2Gate = new Promise((resolve) => {
    releaseAttempt2 = resolve;
  });
  const realCallWS = hass.callWS;
  hass.callWS = async (message) => {
    if (message.service === "update_recipe") {
      if (++attempts === 1) throw new Error("AnyList is down");
      if (attempts === 2) await attempt2Gate;
    }
    return realCallWS(message);
  };
  await openNotesTab(card);
  typeNote(card, "More salt next time.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await sleep(120);
  // Attempt 2 is in flight (blocked on the gate) — type more.
  assert.equal(card._savingNote, true);
  typeNote(card, "More salt next time. And pepper.");
  releaseAttempt2();
  await sleep(200);
  // The in-flight attempt saved the text it sent; the newer typing
  // was never in that payload, so it stays a draft with Save enabled.
  assert.equal(card._selected.note, "More salt next time.");
  assert.equal(card._noteDrafts.get("rec-pasta"), "More salt next time. And pepper.");
  assert.match(card.shadowRoot.innerHTML, /And pepper/);
  assert.match(card.shadowRoot.innerHTML, /newer text is still unsaved/);
  assert.equal(card.shadowRoot.querySelector('[data-action="save-note"]').getAttribute("disabled"), null);
  card.disconnectedCallback();
});

// -- burst-3 (cop-out delta review) ---------------------------------------
//
// The stock fakeHass always returns the pasta recipe from
// update_recipe, so no shipped test can confirm a save for any other
// recipe. This stub wraps a hass so each recipe's update_recipe call
// is applied to THAT recipe's server-side copy the moment it is
// made — the call is recorded in hass.calls at call time, exactly
// like the stock fake — and only the RESPONSE is held, until the
// test releases that recipe's gate. gateNext(id) must be called
// BEFORE the save under test starts; calls with no gate queued
// answer at once.
function perRecipeUpdateStub(hass) {
  const server = {
    "rec-pasta": { ...PASTA_FULL },
    "rec-soup": { ...SOUP_LIGHT },
    "rec-rice": { ...RICE_LIGHT },
  };
  const gates = new Map();
  const realCallWS = hass.callWS;
  hass.callWS = async (message) => {
    if (message.service === "update_recipe") {
      const data = message.service_data || {};
      const id = data.recipe_id;
      hass.calls.push([message.domain, message.service, data]);
      const copy = server[id];
      if (copy) {
        if (data.note !== undefined) copy.note = data.note;
        if (data.rating !== undefined) copy.rating = data.rating;
      }
      // Burst-4 (F1): the RESPONSE is snapshotted at call time, like
      // a real server returns — the call's own value, not whatever
      // the server copy holds when the gate releases. The P7d tests
      // alone do NOT prove this: reverting the snapshot alone
      // leaves both P7d tests green (measured by the burst-4
      // critic). The snapshot's role is proven by the direct test
      // below (gate v1, mutate the server copy to v2, release,
      // assert the released response carried v1) and by the pair:
      // neuter _saveSuperseded with the snapshot intact and both
      // P7d tests fail on value assertions.
      const snapshot = copy ? { ...copy } : undefined;
      const queue = gates.get(id);
      if (queue && queue.length > 0) {
        await queue.shift().promise;
      }
      return { response: { recipe: snapshot } };
    }
    return realCallWS(message);
  };
  return {
    server,
    gateNext(id) {
      let release;
      const promise = new Promise((resolve) => {
        release = resolve;
      });
      if (!gates.has(id)) gates.set(id, []);
      gates.get(id).push({ promise });
      return release;
    },
  };
}

// Burst-4 (D1): fail the FIRST update_recipe attempt for one recipe,
// then apply later calls to the shared server copy at call time
// (like perRecipeUpdateStub). `attempts` records every call,
// including the failed first one, so a test can assert exactly how
// many attempts a save dispatched. Non-update_recipe calls pass
// through to the real hass.
function failFirstUpdateStub(hass, failId) {
  const server = {
    "rec-pasta": { ...PASTA_FULL },
    "rec-soup": { ...SOUP_LIGHT },
    "rec-rice": { ...RICE_LIGHT },
  };
  const attempts = [];
  let failed = false;
  const realCallWS = hass.callWS;
  hass.callWS = async (message) => {
    if (message.service === "update_recipe") {
      const data = message.service_data || {};
      attempts.push({ ...data });
      if (data.recipe_id === failId && !failed) {
        failed = true;
        throw new Error("AnyList is down");
      }
      const copy = server[data.recipe_id];
      if (copy) {
        if (data.note !== undefined) copy.note = data.note;
        if (data.rating !== undefined) copy.rating = data.rating;
      }
      return { response: { recipe: copy ? { ...copy } : undefined } };
    }
    return realCallWS(message);
  };
  return { server, attempts };
}

async function openSoupNotesTab(card) {
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-soup" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
  await flush();
}

function updateRecipeCalls(hass) {
  return hass.calls.filter((c) => c[1] === "update_recipe");
}

test("the per-recipe stub snapshots the response at call time — a gated v1 response carries v1, not the mutated v2 (burst-5, F3)", async () => {
  const { card, hass } = await loadedCard();
  const stub = perRecipeUpdateStub(hass);
  await openNotesTab(card);
  const releaseV1 = stub.gateNext("rec-pasta");
  typeNote(card, "v1 text.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.equal(updateRecipeCalls(hass).length, 1, "v1 save made its call");
  assert.equal(stub.server["rec-pasta"].note, "v1 text.", "server copy holds v1 at call time");
  // While the v1 response is gated, the server copy moves to v2 —
  // as if a newer save had landed in between. The released
  // response must still carry v1 (the value the call sent), not
  // whatever the server copy holds when the gate releases.
  // Without the snapshot the card applies v2 here and this fails.
  stub.server["rec-pasta"].note = "v2 text.";
  releaseV1();
  await sleep(200);
  assert.equal(card._selected.note, "v1 text.", "released response carried v1, not the mutated v2");
  assert.equal(stub.server["rec-pasta"].note, "v2 text.", "server copy still ends at v2");
  assert.match(card.shadowRoot.innerHTML, /Note saved\./);
  card.disconnectedCallback();
});

test("a newer note save survives the older gated save landing after it (P7d, burst-3)", async () => {
  const { card, hass } = await loadedCard();
  const stub = perRecipeUpdateStub(hass);
  await openNotesTab(card);
  // Pasta save 1 ("v1 text.") is gated mid-attempt.
  const releaseV1 = stub.gateNext("rec-pasta");
  typeNote(card, "v1 text.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.equal(card._savingNote, true, "pasta save 1 in flight");
  assert.equal(updateRecipeCalls(hass).length, 1);
  // A soup save in between must not steal pasta's flag (the
  // burst-2 scalar bug): coming back to pasta still shows busy.
  await openSoupNotesTab(card);
  assert.equal(card._selected.id, "rec-soup");
  assert.equal(card._savingNote, false, "soup has no save in flight");
  typeNote(card, "Soup note.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.equal(updateRecipeCalls(hass).length, 2, "soup save made its call");
  const soup = card._recipes.find((recipe) => recipe.id === "rec-soup");
  assert.equal(soup.note, "Soup note.");
  // Back to pasta: still busy, but the newer text may be saved —
  // it supersedes the gated v1 attempt.
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
  await flush();
  assert.equal(card._savingNote, true, "pasta's in-flight save still shows busy on return");
  typeNote(card, "v2 text.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.equal(updateRecipeCalls(hass).length, 3, "newer pasta save made its call while v1 was gated");
  assert.equal(card._selected.note, "v2 text.", "newer text confirmed first");
  assert.equal(card._noteDrafts.has("rec-pasta"), false, "newer save cleared its draft");
  // The older gated attempt lands AFTER the newer save confirmed.
  releaseV1();
  await sleep(200);
  // The newer text survives, locally and in the call order to the
  // server (v1 sent first, v2 sent last — the server ends at v2):
  // no fourth call, no clobber, no failure status, no resurrected
  // draft, and the flag is clear.
  assert.equal(updateRecipeCalls(hass).length, 3, "stale save fired no retry after landing");
  assert.deepEqual(updateRecipeCalls(hass)[2], [
    "anylist",
    "update_recipe",
    { recipe_id: "rec-pasta", note: "v2 text." },
  ]);
  assert.equal(card._selected.note, "v2 text.");
  assert.equal(card._noteDrafts.has("rec-pasta"), false);
  assert.equal(card._savingNote, false);
  assert.match(card.shadowRoot.innerHTML, /Note saved\./);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Couldn't save/);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /still unsaved/);
  card.disconnectedCallback();
});

test("two note saves for two recipes: switching back shows Save disabled and fires no third call (burst-3)", async () => {
  const { card, hass } = await loadedCard();
  const stub = perRecipeUpdateStub(hass);
  const releasePasta = stub.gateNext("rec-pasta");
  const releaseSoup = stub.gateNext("rec-soup");
  await openNotesTab(card);
  typeNote(card, "Pasta note.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.equal(card._savingNote, true, "pasta save in flight");
  assert.equal(updateRecipeCalls(hass).length, 1);
  await openSoupNotesTab(card);
  typeNote(card, "Soup note.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.equal(card._ratingBusy, false);
  assert.equal(updateRecipeCalls(hass).length, 2, "soup save made its call");
  // Back to pasta while BOTH saves are in flight: pasta's Save
  // stays disabled, and tapping it anyway fires no third call.
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
  await flush();
  assert.equal(card._savingNote, true, "pasta save still in flight on return");
  assert.equal(
    card.shadowRoot.querySelector('[data-action="save-note"]').getAttribute("disabled"),
    "disabled"
  );
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.equal(updateRecipeCalls(hass).length, 2, "no third call while pasta's save is in flight");
  releasePasta();
  releaseSoup();
  await sleep(200);
  assert.equal(updateRecipeCalls(hass).length, 2);
  const pasta = card._recipes.find((recipe) => recipe.id === "rec-pasta");
  const soup = card._recipes.find((recipe) => recipe.id === "rec-soup");
  assert.equal(pasta.note, "Pasta note.");
  assert.equal(soup.note, "Soup note.");
  assert.equal(card._savingNote, false);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Couldn't save/);
  card.disconnectedCallback();
});

test("two rating saves for two recipes: switching back shows stars disabled and fires no third call (burst-3)", async () => {
  const { card, hass } = await loadedCard();
  const stub = perRecipeUpdateStub(hass);
  const releasePasta = stub.gateNext("rec-pasta");
  const releaseSoup = stub.gateNext("rec-soup");
  await openNotesTab(card);
  card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
  await flush();
  assert.equal(card._ratingBusy, true, "pasta rating save in flight");
  assert.equal(updateRecipeCalls(hass).length, 1);
  await openSoupNotesTab(card);
  card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
  await flush();
  assert.equal(updateRecipeCalls(hass).length, 2, "soup rating save made its call");
  // Back to pasta while BOTH rating saves are in flight: the
  // stars stay disabled, and re-tapping the same rating fires no
  // third call.
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
  await flush();
  assert.equal(card._ratingBusy, true, "pasta rating save still in flight on return");
  assert.equal(
    card.shadowRoot.querySelector('[data-action="rate"]').getAttribute("disabled"),
    "disabled"
  );
  card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
  await flush();
  assert.equal(updateRecipeCalls(hass).length, 2, "no third call while pasta's rating save is in flight");
  releasePasta();
  releaseSoup();
  await sleep(200);
  assert.equal(updateRecipeCalls(hass).length, 2);
  const pasta = card._recipes.find((recipe) => recipe.id === "rec-pasta");
  const soup = card._recipes.find((recipe) => recipe.id === "rec-soup");
  assert.equal(pasta.rating, 3);
  assert.equal(soup.rating, 4);
  assert.equal(card._ratingBusy, false);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Couldn't save/);
  card.disconnectedCallback();
});

test("a newer rating tap supersedes an older gated rating save (P7d for ratings, burst-3)", async () => {
  const { card, hass } = await loadedCard();
  const stub = perRecipeUpdateStub(hass);
  await openNotesTab(card);
  const releaseOld = stub.gateNext("rec-pasta");
  card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
  await flush();
  assert.equal(card._ratingBusy, true, "first rating save in flight");
  assert.equal(updateRecipeCalls(hass).length, 1);
  // A different tap while the first is gated supersedes it.
  card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
  await flush();
  assert.equal(updateRecipeCalls(hass).length, 2, "newer rating save made its call");
  assert.equal(card._selected.rating, 4, "newer rating confirmed first");
  assert.equal(card._pendingRating, null);
  releaseOld();
  await sleep(200);
  assert.equal(updateRecipeCalls(hass).length, 2, "stale rating save fired no retry after landing");
  assert.deepEqual(updateRecipeCalls(hass)[1], [
    "anylist",
    "update_recipe",
    { recipe_id: "rec-pasta", rating: 4 },
  ]);
  assert.equal(card._selected.rating, 4, "older gated rating did not clobber the newer one");
  assert.equal(card._ratingBusy, false);
  assert.equal(card._pendingRatings.has("rec-pasta"), false);
  assert.match(card.shadowRoot.innerHTML, /Rating saved\./);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Couldn't save/);
  card.disconnectedCallback();
});

test("a note typed within the debounce window survives disconnect on a fresh card (burst-3, critic finding 1)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card } = await loadedCard();
    await openNotesTab(card);
    // Type and disconnect at once — inside the 150 ms debounce, so
    // the scheduled session save has not fired yet, and with no
    // other save in flight whose finally could persist the draft
    // instead. The old code dropped that timer on disconnect and
    // the typed note was gone on a fresh card; the flush in
    // disconnectedCallback keeps it.
    typeNote(card, "More salt next time.");
    card.disconnectedCallback();
    const saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.noteDrafts, { "rec-pasta": "More salt next time." });
    // A fresh card instance — what Lovelace creates on re-open —
    // shows the kept draft in the editor.
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._noteDrafts.get("rec-pasta"), "More salt next time.");
    fresh.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
    await flush();
    assert.match(fresh.shadowRoot.innerHTML, /More salt next time\./);
    card.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("disconnect flush keeps a typed draft alongside an already-failed rating save (burst-3, critic finding 1; burst-4 F2)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card, hass } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    // Short backoffs so the rating save fails outright and SETTLES
    // before any draft exists: its retries are spent and its
    // finally has already run, so it cannot be the path that
    // persists the draft typed below — only the disconnect flush
    // can. (Burst-4 F2: the burst-3 version tapped the rating
    // while its save was still in flight, so the draft reached
    // the store through that save's finally, not the flush, and
    // the test passed on burst-2 code with no flush at all. This
    // version fails on burst-2 code: without the flush the draft
    // never reaches the store.)
    card._saveRetryDelays = [10, 10];
    await openNotesTab(card);
    card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    // Burst-5 (F4): poll for the settle instead of a fixed 300 ms
    // sleep — the settle usually takes ~23 ms, but a fixed sleep
    // is a margin, not a guarantee, and a loaded tick could still
    // leave the save in flight when the assertions below run.
    await waitFor(() => card._ratingBusy === false);
    assert.equal(card._ratingBusy, false, "failed rating save settled before the draft was typed");
    assert.equal(card._pendingRatings.get("rec-pasta"), 3);
    assert.match(card.shadowRoot.innerHTML, /Couldn't save the rating/);
    // The pending rating is already in the store via the settled
    // save's finally; the draft is not yet — it only exists in
    // the debounce timer.
    const before = JSON.parse(store.get("family-hub:recipe:state") || "{}");
    assert.deepEqual(before.pendingRatings, { "rec-pasta": 3 });
    assert.equal(before.noteDrafts, undefined, "draft not yet persisted before disconnect");
    typeNote(card, "More salt next time.");
    card.disconnectedCallback();
    const saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.noteDrafts, { "rec-pasta": "More salt next time." });
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 3 });
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._noteDrafts.get("rec-pasta"), "More salt next time.");
    fresh.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
    await flush();
    assert.match(fresh.shadowRoot.innerHTML, /More salt next time\./);
    assert.equal(fresh._pendingRating, 3);
    assert.ok(fresh.shadowRoot.querySelector('[data-action="retry-rating"]'), "rating retry offered on the fresh card");
    card.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("stale draft and pending-rating ids are written out of the session store on load (burst-3, critic finding 3)", async () => {
  // Seeded with NO open recipe (list view): nothing re-opens a
  // recipe on load, so no _openRecipe _saveSession() runs to
  // rewrite the store incidentally — the only store write on
  // load is the prune write-back itself. (With an openId seeded,
  // the re-open would rewrite the store and mask the defect.)
  const seed = {
    openId: null,
    step: null,
    listScrollY: 0,
    detailScrollY: 0,
    query: "",
    collectionId: "",
    sort: "name",
    noteDrafts: { "rec-gone": "stale draft", "rec-pasta": "keep me" },
    pendingRatings: { "rec-gone": 4 },
  };
  const store = stubSessionStorage({
    "family-hub:recipe:state": JSON.stringify(seed),
  });
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card } = await loadedCard();
    await sleep(150);
    // In memory the prune already worked; the store must agree —
    // the old code never wrote the pruned state back, so the stale
    // ids sat in the store and would resurrect if the id returned.
    assert.equal(card._noteDrafts.get("rec-pasta"), "keep me");
    assert.equal(card._noteDrafts.has("rec-gone"), false);
    assert.equal(card._pendingRatings.has("rec-gone"), false);
    const saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.noteDrafts, { "rec-pasta": "keep me" });
    assert.equal(saved.pendingRatings, undefined, "no pending ratings left in the store");
    // The write-back is surgical: the rest of the session survives.
    assert.equal(saved.openId, null);
    assert.equal(saved.step, null);
    assert.equal(saved.sort, "name");
    card.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("a note save superseded during its backoff never dispatches on waking (burst-4, D1)", async () => {
  const { card, hass } = await loadedCard();
  const stub = failFirstUpdateStub(hass, "rec-pasta");
  card._saveRetryDelays = [200, 200];
  await openNotesTab(card);
  // Save 1 ("v1 text.") throws its first attempt and sits in its
  // 200 ms backoff.
  typeNote(card, "v1 text.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.equal(stub.attempts.length, 1, "first attempt made");
  assert.deepEqual(stub.attempts[0], { recipe_id: "rec-pasta", note: "v1 text." });
  // During the backoff, a newer save starts and confirms.
  await sleep(50);
  typeNote(card, "v2 text.");
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await flush();
  assert.equal(stub.attempts.length, 2, "newer save made its call while v1 was in backoff");
  assert.deepEqual(stub.attempts[1], { recipe_id: "rec-pasta", note: "v2 text." });
  assert.equal(card._selected.note, "v2 text.", "newer text confirmed first");
  // The superseded save wakes from its backoff after the newer
  // save confirmed: it must dispatch nothing further. Without
  // the post-backoff supersede check it fires a third call whose
  // callFn re-reads the draft — deleted by the newer save, so it
  // falls back to the ORIGINAL note — and the server ends at the
  // original while the card shows v2.
  await sleep(400);
  assert.equal(stub.attempts.length, 2, "stale save fired no call after its backoff");
  assert.equal(stub.server["rec-pasta"].note, "v2 text.", "server ends at the newer text");
  assert.equal(card._selected.note, "v2 text.");
  assert.equal(card._noteDrafts.has("rec-pasta"), false);
  assert.match(card.shadowRoot.innerHTML, /Note saved\./);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Couldn't save/);
  card.disconnectedCallback();
});

test("a rating save superseded during its backoff never dispatches on waking (burst-4, D1)", async () => {
  const { card, hass } = await loadedCard();
  const stub = failFirstUpdateStub(hass, "rec-pasta");
  card._saveRetryDelays = [200, 200];
  await openNotesTab(card);
  // Rating 2 throws its first attempt and sits in its 200 ms backoff.
  card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "2" }));
  await flush();
  assert.equal(stub.attempts.length, 1, "first attempt made");
  assert.deepEqual(stub.attempts[0], { recipe_id: "rec-pasta", rating: 2 });
  // During the backoff, a newer tap starts and confirms.
  await sleep(50);
  card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
  await flush();
  assert.equal(stub.attempts.length, 2, "newer rating save made its call while the first was in backoff");
  assert.deepEqual(stub.attempts[1], { recipe_id: "rec-pasta", rating: 4 });
  assert.equal(card._selected.rating, 4, "newer rating confirmed first");
  // The superseded save wakes from its backoff after the newer
  // save confirmed: it must dispatch nothing further. Without
  // the post-backoff supersede check it fires a third call with
  // the stale rating 2, and the server ends at 2 while the card
  // shows 4 and reports "Rating saved.".
  await sleep(400);
  assert.equal(stub.attempts.length, 2, "stale rating save fired no call after its backoff");
  assert.equal(stub.server["rec-pasta"].rating, 4, "server ends at the newer rating");
  assert.equal(card._selected.rating, 4);
  assert.match(card.shadowRoot.innerHTML, /Rating saved\./);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Couldn't save/);
  card.disconnectedCallback();
});

test("a disconnect flush does not clobber another live card's stored draft (burst-4, F3)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    // Card A loads first and types a pasta draft — its memory
    // knows pasta only.
    const { card: cardA } = await loadedCard();
    await openNotesTab(cardA);
    typeNote(cardA, "Pasta draft.");
    // Card B, a second live instance sharing the store, types a
    // soup draft and its save fails, so B's finally writes the
    // soup draft to the store. A never saw it: A loaded before B
    // wrote, so A's memory still holds pasta only.
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = fakeHass({ fail: { update_recipe: "AnyList is down" } });
    cardB._saveRetryDelays = [10, 10];
    await flush();
    await openSoupNotesTab(cardB);
    typeNote(cardB, "Soup draft.");
    cardB.shadowRoot.dispatchClick(fakeTarget("save-note"));
    await sleep(200);
    assert.equal(cardB._noteDrafts.get("rec-soup"), "Soup draft.");
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.noteDrafts["rec-soup"], "Soup draft.", "B's failed save persisted its draft");
    // A disconnects: the wholesale replace used to overwrite the
    // store with A's pasta-only drafts and B's soup draft was
    // gone. The merge keeps both — in every interleaving of A's
    // 150 ms debounce timer with B's write, since each write
    // unions what the store already holds.
    cardA.disconnectedCallback();
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.noteDrafts, { "rec-pasta": "Pasta draft.", "rec-soup": "Soup draft." });
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._noteDrafts.get("rec-pasta"), "Pasta draft.");
    assert.equal(fresh._noteDrafts.get("rec-soup"), "Soup draft.");
    cardB.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("a _render() throw during a note save leaks no in-flight id — the next save proceeds (burst-4, F4)", async () => {
  const { card, hass } = await loadedCard();
  await openNotesTab(card);
  typeNote(card, "More salt next time.");
  const realRender = card._render.bind(card);
  let threw = false;
  card._render = () => {
    if (!threw) {
      threw = true;
      throw new Error("render boom");
    }
    return realRender();
  };
  await assert.rejects(card._saveNote(), /render boom/);
  card._render = realRender;
  assert.equal(threw, true, "the throw fired");
  assert.equal(card._savingNoteRecipeIds.has("rec-pasta"), false, "throwing render left no id behind");
  assert.equal(updateRecipeCalls(hass).length, 0, "no call was made by the aborted save");
  // Burst-5 (F2): the flag itself must be clear, and the rendered
  // Save button enabled — the burst-4 test only proved a direct
  // programmatic _saveNote() call proceeds, but a real user taps
  // the button, which fires nothing while disabled. The finally
  // re-rendered with the flag re-derived, so the button is live.
  assert.equal(card._savingNote, false, "no stuck saving flag after the throw");
  assert.equal(
    card.shadowRoot.querySelector('[data-action="save-note"]').getAttribute("disabled"),
    null,
    "Save is enabled after the throw, not stuck disabled"
  );
  // Typing another char must not re-disable it either (the old
  // stuck flag forced save.disabled = true via _onInput).
  typeNote(card, "More salt next time. And pepper.");
  assert.equal(
    card.shadowRoot.querySelector('[data-action="save-note"]').disabled,
    false,
    "Save stays enabled while typing after the throw"
  );
  // Back to the original text for the save below.
  typeNote(card, "More salt next time.");
  // The next save proceeds: the guard no longer sees a save in flight.
  await card._saveNote();
  await flush();
  assert.equal(updateRecipeCalls(hass).length, 1);
  assert.deepEqual(updateRecipeCalls(hass)[0], [
    "anylist",
    "update_recipe",
    { recipe_id: "rec-pasta", note: "More salt next time." },
  ]);
  assert.equal(card._selected.note, "More salt next time.");
  assert.match(card.shadowRoot.innerHTML, /Note saved\./);
  card.disconnectedCallback();
});

test("a _render() throw during a rating save leaks no in-flight id — the next tap proceeds (burst-4, F4)", async () => {
  const { card, hass } = await loadedCard();
  await openNotesTab(card);
  const realRender = card._render.bind(card);
  let threw = false;
  card._render = () => {
    if (!threw) {
      threw = true;
      throw new Error("render boom");
    }
    return realRender();
  };
  await assert.rejects(card._rate(3), /render boom/);
  card._render = realRender;
  assert.equal(threw, true, "the throw fired");
  assert.equal(card._ratingBusyRecipeIds.has("rec-pasta"), false, "throwing render left no id behind");
  assert.equal(updateRecipeCalls(hass).length, 0, "no call was made by the aborted save");
  // Burst-5 (F2): the flag itself must be clear, and the rendered
  // stars enabled — the burst-4 test only proved a direct
  // programmatic _rate() call proceeds, but a real user taps a
  // star, which fires nothing while disabled.
  assert.equal(card._ratingBusy, false, "no stuck busy flag after the throw");
  assert.equal(
    card.shadowRoot.querySelector('[data-action="rate"]').getAttribute("disabled"),
    null,
    "stars are enabled after the throw, not stuck disabled"
  );
  // The next tap proceeds: the guard no longer sees a save in flight.
  await card._rate(3);
  await flush();
  assert.equal(updateRecipeCalls(hass).length, 1);
  assert.deepEqual(updateRecipeCalls(hass)[0], [
    "anylist",
    "update_recipe",
    { recipe_id: "rec-pasta", rating: 3 },
  ]);
  assert.equal(card._selected.rating, 3);
  assert.match(card.shadowRoot.innerHTML, /Rating saved\./);
  card.disconnectedCallback();
});

// -- burst-5 (value-scoped tombstones + critic F1–F4) ----------------------
//
// Burst-4's union merge resurrected a just-deleted entry on every
// later write: a successful rating retry left its pending rating in
// the store (and a saved note's draft never left it), so a fresh
// card showed a phantom retry — worse, tapping it re-sent the old
// value and clobbered the newer saved one. A successful save now
// records a value-scoped tombstone for the deleted entry's
// last-written value, and the merge skips a stored entry only when
// it equals that value.

test("a failed rating save retried successfully leaves no pending rating in the store — fresh card shows no phantom retry (burst-5)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    card._saveRetryDelays = [10, 10];
    await openNotesTab(card);
    card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => card._ratingBusy === false);
    assert.equal(card._pendingRatings.get("rec-pasta"), 3);
    // An outright failure on the same card says so honestly —
    // "Rating not saved yet" is the re-open wording _openRecipe
    // sets when a pending rating is restored (B2).
    assert.match(card.shadowRoot.innerHTML, /Couldn't save the rating/);
    assert.ok(card.shadowRoot.querySelector('[data-action="retry-rating"]'), "retry offered after the failure");
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 3 }, "failed save persisted its pending rating");
    // The retry succeeds now: swap in a hass that answers.
    card._hass = fakeHass();
    card.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => card._ratingBusy === false);
    assert.match(card.shadowRoot.innerHTML, /Rating saved\./);
    assert.equal(card._pendingRatings.has("rec-pasta"), false);
    // THE fix: the successful retry's own finally merge used to
    // resurrect the pending rating in the store. It must be gone.
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "no pending rating left in the store after the successful retry");
    // A fresh card restores no pending rating and offers no retry.
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh.shadowRoot.querySelector(".list-view").hidden, true, "fresh card re-opened the saved detail");
    fresh.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
    await flush();
    assert.equal(fresh._pendingRatings.has("rec-pasta"), false);
    assert.equal(fresh._pendingRating, null);
    assert.equal(fresh.shadowRoot.querySelector('[data-action="retry-rating"]'), null, "no phantom retry on the fresh card");
    assert.doesNotMatch(fresh.shadowRoot.innerHTML, /Rating not saved yet/);
    card.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("a retried rating cannot be clobbered back by its own phantom retry — rate 4 after a successful retry of 3 (burst-5, critic F1a)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    card._saveRetryDelays = [10, 10];
    await openNotesTab(card);
    card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => card._ratingBusy === false);
    assert.equal(card._pendingRatings.get("rec-pasta"), 3);
    // The retry succeeds against a hass that tracks the server copy.
    const goodHass = fakeHass();
    const stub = perRecipeUpdateStub(goodHass);
    card._hass = goodHass;
    card.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => card._ratingBusy === false);
    assert.match(card.shadowRoot.innerHTML, /Rating saved\./);
    assert.equal(stub.server["rec-pasta"].rating, 3, "server holds the retried 3");
    // Now rate 4 successfully.
    card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
    await waitFor(() => card._ratingBusy === false);
    assert.match(card.shadowRoot.innerHTML, /Rating saved\./);
    assert.equal(stub.server["rec-pasta"].rating, 4, "server holds 4");
    // The store must not hold pending 3: on burst-4 it did, and a
    // fresh card offered a retry-for-3 whose tap fired a real
    // update_recipe {rating: 3} and clobbered the saved 4.
    const saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "no phantom pending 3 in the store");
    // A fresh card whose server copy is at 4 shows 4 stars and no
    // retry — there is nothing to tap that could clobber it back.
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass({ detail: { ...PASTA_FULL, rating: 4 } });
    await sleep(150);
    assert.equal(fresh.shadowRoot.querySelector(".list-view").hidden, true);
    fresh.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
    await flush();
    assert.equal(fresh.shadowRoot.querySelectorAll(".star.filled").length, 4);
    assert.equal(fresh.shadowRoot.querySelector('[data-action="retry-rating"]'), null, "no phantom retry-for-3 on the fresh card");
    assert.doesNotMatch(fresh.shadowRoot.innerHTML, /Rating not saved yet/);
    assert.equal(stub.server["rec-pasta"].rating, 4, "server still at 4 — nothing clobbered it");
    card.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("a saved note's debounced v1 draft cannot clobber v2 on a fresh card (burst-5, critic F1b)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card, hass } = await loadedCard();
    const stub = perRecipeUpdateStub(hass);
    await openNotesTab(card);
    // Type v1 and wait out the 150 ms debounce, so the draft is
    // persisted to the store before the save. (Without the wait
    // the plain save-a-draft-then-newer-text flow passes on
    // burst-4 too — the store never held the stale value — so
    // the waited version is the discriminating one.)
    typeNote(card, "v1 text.");
    await sleep(200);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.noteDrafts, { "rec-pasta": "v1 text." }, "debounce persisted v1");
    // Quickly edit to v2 and save immediately — the v2 debounce
    // has not fired yet, so the store still holds v1.
    typeNote(card, "v2 text.");
    card.shadowRoot.dispatchClick(fakeTarget("save-note"));
    await waitFor(() => card._savingNote === false);
    assert.match(card.shadowRoot.innerHTML, /Note saved\./);
    assert.equal(stub.server["rec-pasta"].note, "v2 text.", "server ends at v2");
    assert.equal(card._noteDrafts.has("rec-pasta"), false);
    // Let the v2 debounce fire too, then check the store: the
    // saved draft must be gone, not resurrected as v1.
    await sleep(200);
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.noteDrafts, undefined, "no stale v1 draft left in the store");
    // A fresh card whose server copy is at v2 shows v2 in the
    // editor with Save disabled — not stale v1 with Save enabled.
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass({ detail: { ...PASTA_FULL, note: "v2 text." } });
    await sleep(150);
    assert.equal(fresh._noteDrafts.has("rec-pasta"), false);
    fresh.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
    await flush();
    assert.match(fresh.shadowRoot.innerHTML, /v2 text\./);
    assert.doesNotMatch(fresh.shadowRoot.innerHTML, /v1 text\./);
    assert.equal(
      fresh.shadowRoot.querySelector('[data-action="save-note"]').getAttribute("disabled"),
      "disabled",
      "Save disabled on the fresh card — no stale draft to save"
    );
    card.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("one card's successful save does not delete another live card's pending entry for a different recipe (burst-5)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    // Card A fails a pasta rating save; card B fails a soup one.
    const { card: cardA } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    cardA._saveRetryDelays = [10, 10];
    await openNotesTab(cardA);
    cardA.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => cardA._ratingBusy === false);
    assert.equal(cardA._pendingRatings.get("rec-pasta"), 3);
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = fakeHass({ fail: { update_recipe: "AnyList is down" } });
    cardB._saveRetryDelays = [10, 10];
    await flush();
    await openSoupNotesTab(cardB);
    cardB.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
    await waitFor(() => cardB._ratingBusy === false);
    assert.equal(cardB._pendingRatings.get("rec-soup"), 4);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 3, "rec-soup": 4 });
    // A's retry succeeds: pasta's pending must leave the store
    // while soup's stays.
    cardA._hass = fakeHass();
    cardA.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => cardA._ratingBusy === false);
    assert.match(cardA.shadowRoot.innerHTML, /Rating saved\./);
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-soup": 4 }, "A's success removed only its own pending");
    // A fresh card restores B's pending soup rating.
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._pendingRatings.get("rec-soup"), 4);
    assert.equal(fresh._pendingRatings.has("rec-pasta"), false);
    cardA.disconnectedCallback();
    cardB.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("one card's successful save does not delete another live card's different pending value for the same recipe (burst-5)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card: cardA } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    cardA._saveRetryDelays = [10, 10];
    await openNotesTab(cardA);
    cardA.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => cardA._ratingBusy === false);
    assert.equal(cardA._pendingRatings.get("rec-pasta"), 3);
    // Card B loads (restoring A's pending 3) and then fails a
    // DIFFERENT rating for the same recipe: the store ends at 4.
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = fakeHass({ fail: { update_recipe: "AnyList is down" } });
    cardB._saveRetryDelays = [10, 10];
    await flush();
    await openNotesTab(cardB);
    assert.equal(cardB._pendingRatings.get("rec-pasta"), 3, "B restored A's pending 3");
    cardB.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
    await waitFor(() => cardB._ratingBusy === false);
    assert.equal(cardB._pendingRatings.get("rec-pasta"), 4);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 4 }, "B's newer pending overwrote the stored 3");
    // A's retry of 3 succeeds: the tombstone is value-scoped to 3,
    // so the stored 4 — B's live pending — must survive the merge.
    cardA._hass = fakeHass();
    cardA.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => cardA._ratingBusy === false);
    assert.match(cardA.shadowRoot.innerHTML, /Rating saved\./);
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 4 }, "A's success removed only its own 3, not B's 4");
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._pendingRatings.get("rec-pasta"), 4, "fresh card restores B's pending 4");
    cardA.disconnectedCallback();
    cardB.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("a new pending rating with a different value survives a merge after a tombstoned deletion (burst-5)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    card._saveRetryDelays = [10, 10];
    await openNotesTab(card);
    card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => card._ratingBusy === false);
    card._hass = fakeHass();
    card.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => card._ratingBusy === false);
    assert.match(card.shadowRoot.innerHTML, /Rating saved\./);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "store clean after the successful retry");
    // A new failure for a DIFFERENT value must be able to pend:
    // the tombstone is scoped to 3, and the live entry overlays
    // the merge anyway.
    card._hass = fakeHass({ fail: { update_recipe: "AnyList is down" } });
    card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
    await waitFor(() => card._ratingBusy === false);
    assert.equal(card._pendingRatings.get("rec-pasta"), 4);
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 4 }, "new pending 4 survived the merge");
    // And a later plain session save does not drop it either.
    card._saveSession();
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 4 });
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._pendingRatings.get("rec-pasta"), 4, "fresh card restores the new pending 4");
    card.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("a new failure for the same id+value can re-pend after the tombstone (burst-5)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    card._saveRetryDelays = [10, 10];
    await openNotesTab(card);
    card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => card._ratingBusy === false);
    card._hass = fakeHass();
    card.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => card._ratingBusy === false);
    assert.match(card.shadowRoot.innerHTML, /Rating saved\./);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "store clean after the successful retry");
    // The same value fails again on a FRESH card (the first card's
    // copy now shows 3, so _rate(3) would early-return there): the
    // tombstone must not suppress the genuine new pending.
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass({ fail: { update_recipe: "AnyList is down" } });
    fresh._saveRetryDelays = [10, 10];
    await sleep(150);
    fresh.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
    await flush();
    fresh.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => fresh._ratingBusy === false);
    assert.equal(fresh._pendingRatings.get("rec-pasta"), 3, "same value re-pended");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 3 }, "re-pended 3 survived the merge despite the tombstone");
    assert.notEqual(fresh.shadowRoot.querySelector('[data-action="retry-rating"]'), null, "retry offered for the re-pended rating");
    card.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

// -- burst-6 (stale-holder healing, tombstone persistence, F2/F3) ---------
//
// Burst-5's value-scoped tombstones fixed the single-writer
// resurrection, but the delta critic showed the tombstone does not
// fix the stale holder in the multi-card case: a second live card
// holding the entry in memory re-publishes it on its next ordinary
// write, and the ping-pong is unbounded because the burst-5
// "at most one write cycle" lifetime drops the tombstone before a
// slow holder writes. Burst-6 heals the holder in the merge (a live
// entry equalling a stored tombstone, on a card that never learned
// it, is deleted from memory with its retry affordance cleared)
// and makes tombstones persist in the store (every write re-carries
// them) until a genuine re-pend of the same id+value drops them.

test("a second live card cannot resurrect a retried rating on its next ordinary write — stale holder healed (burst-6, critic F1 P1a)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    // Card A fails rating 3: the store holds pending 3.
    const { card: cardA } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    cardA._saveRetryDelays = [10, 10];
    await openNotesTab(cardA);
    cardA.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => cardA._ratingBusy === false);
    assert.equal(cardA._pendingRatings.get("rec-pasta"), 3);
    // Card B loads and restores the pending 3 into memory.
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = fakeHass();
    await sleep(150);
    await openNotesTab(cardB);
    assert.equal(cardB._pendingRatings.get("rec-pasta"), 3, "B restored A's pending 3");
    assert.equal(cardB._pendingRating, 3);
    assert.ok(cardB.shadowRoot.querySelector('[data-action="retry-rating"]'), "B offers the retry for the pending 3");
    // A's retry succeeds: the store is clean except the tombstone.
    cardA._hass = fakeHass();
    cardA.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => cardA._ratingBusy === false);
    assert.match(cardA.shadowRoot.innerHTML, /Rating saved\./);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "store clean after A's successful retry");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] }, "tombstone 3 in the store");
    // B never adopted the tombstone, so nothing ever healed it —
    // the critic measured tombstonesInMemory: 0 here.
    assert.equal(cardB._pendingRatingTombstones.size, 0, "B holds no recorded tombstone");
    assert.equal(cardB._knownPendingRatingTombstones.size, 0, "B never learned the tombstone");
    assert.equal(cardB._pendingRatings.get("rec-pasta"), 3, "B still holds the stale 3 in memory");
    // THE fix: B's next ordinary session write must NOT re-publish
    // the stale 3 — it heals B's memory instead.
    cardB._saveSession();
    assert.equal(cardB._pendingRatings.has("rec-pasta"), false, "B's stale entry is gone from memory");
    assert.equal(cardB._pendingRating, null, "B's retry affordance cleared");
    assert.equal(cardB._ratingStatus, null, "B's retry status cleared");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "B's write left the store clean");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] }, "tombstone persists across B's write");
    // The next render reflects the cleared affordance.
    cardB._render();
    assert.equal(cardB.shadowRoot.querySelector('[data-action="retry-rating"]'), null, "no retry button on B after the healing write");
    assert.doesNotMatch(cardB.shadowRoot.innerHTML, /Rating not saved yet/);
    // A fresh card restores no pending rating and offers no retry.
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._pendingRatings.has("rec-pasta"), false);
    assert.equal(fresh._pendingRating, null);
    fresh.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
    await flush();
    assert.equal(fresh.shadowRoot.querySelector('[data-action="retry-rating"]'), null, "no phantom retry on the fresh card");
    assert.doesNotMatch(fresh.shadowRoot.innerHTML, /Rating not saved yet/);
    cardA.disconnectedCallback();
    cardB.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("the resurrection cannot ping-pong: two stale holders both write after the retry and the store stays clean (burst-6, critic F1 P1b)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card: cardA } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    cardA._saveRetryDelays = [10, 10];
    await openNotesTab(cardA);
    cardA.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => cardA._ratingBusy === false);
    assert.equal(cardA._pendingRatings.get("rec-pasta"), 3);
    // Two stale holders restore the pending 3.
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = fakeHass();
    await sleep(150);
    assert.equal(cardB._pendingRatings.get("rec-pasta"), 3, "B restored the pending 3");
    const cardD = new AnyListRecipeViewCard();
    cardD.setConfig({});
    cardD.hass = fakeHass();
    await sleep(150);
    assert.equal(cardD._pendingRatings.get("rec-pasta"), 3, "D restored the pending 3");
    // A's retry succeeds: the store is clean except the tombstone.
    cardA._hass = fakeHass();
    cardA.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => cardA._ratingBusy === false);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined);
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] });
    // Both holders write: on burst-5 the first write re-published
    // the 3 and the second cycle repeated unboundedly. Neither
    // re-publishes now, and a second round of writes stays clean.
    cardB._saveSession();
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "B's write did not re-publish the 3");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] });
    assert.equal(cardB._pendingRatings.has("rec-pasta"), false, "B healed");
    cardD._saveSession();
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "D's write did not re-publish the 3");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] });
    assert.equal(cardD._pendingRatings.has("rec-pasta"), false, "D healed");
    cardB._saveSession();
    cardD._saveSession();
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "no second cycle: the store stays clean");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] });
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._pendingRatings.has("rec-pasta"), false);
    assert.equal(fresh.shadowRoot.querySelector('[data-action="retry-rating"]'), null, "no phantom retry after both holders wrote");
    cardA.disconnectedCallback();
    cardB.disconnectedCallback();
    cardD.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("rating a different recipe does not re-publish the stale pending — the save-finally write heals it (burst-6, critic F1 P1c)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card: cardA } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    cardA._saveRetryDelays = [10, 10];
    await openNotesTab(cardA);
    cardA.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => cardA._ratingBusy === false);
    assert.equal(cardA._pendingRatings.get("rec-pasta"), 3);
    // Card B loads (restoring the pending 3) and opens soup —
    // before A's retry, so no tombstone exists yet.
    const hassB = fakeHass();
    const stubB = perRecipeUpdateStub(hassB);
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = hassB;
    await sleep(150);
    await openSoupNotesTab(cardB);
    assert.equal(cardB._pendingRatings.get("rec-pasta"), 3, "B still holds the stale pasta 3");
    // A's retry succeeds: the store is clean except the tombstone.
    cardA._hass = fakeHass();
    cardA.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => cardA._ratingBusy === false);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined);
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] });
    assert.equal(cardB._pendingRatings.get("rec-pasta"), 3, "B still holds the stale 3 — no B write since the retry");
    // B rates soup 4 successfully: the save-finally session write
    // is an ordinary B write, and on burst-5 it re-published the
    // stale pasta 3. It must heal instead.
    cardB.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
    await waitFor(() => cardB._ratingBusy === false);
    assert.match(cardB.shadowRoot.innerHTML, /Rating saved\./);
    assert.equal(stubB.server["rec-soup"].rating, 4, "server holds B's soup 4");
    assert.equal(cardB._pendingRatings.has("rec-pasta"), false, "B's stale pasta entry is gone from memory");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "no stale pasta 3 re-published by B's soup save");
    assert.deepEqual(saved.pendingRatingTombstones["rec-pasta"], [3], "the pasta tombstone persists");
    // B's successful soup save also tombstones the saved soup 4
    // (burst-5's unconditional recording: a successful save
    // tombstones its value, so another card that failed the same
    // value is healed too) — that is expected store content, not
    // a re-published pending.
    assert.deepEqual(saved.pendingRatingTombstones["rec-soup"], [4], "B's soup save tombstoned its own value");
    // Re-opening pasta on B offers no retry for it.
    await openNotesTab(cardB);
    assert.equal(cardB._pendingRating, null);
    assert.equal(cardB.shadowRoot.querySelector('[data-action="retry-rating"]'), null, "no phantom retry when B re-opens pasta");
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._pendingRatings.has("rec-pasta"), false);
    assert.equal(fresh.shadowRoot.querySelector('[data-action="retry-rating"]'), null, "no phantom retry on the fresh card");
    cardA.disconnectedCallback();
    cardB.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("a second live card cannot resurrect a saved note draft on its next ordinary write (burst-6, critic F1 notes P1a)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card: cardA, hass: hassA } = await loadedCard();
    const stubA = perRecipeUpdateStub(hassA);
    await openNotesTab(cardA);
    typeNote(cardA, "v1 text.");
    await sleep(200);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.noteDrafts, { "rec-pasta": "v1 text." }, "debounce persisted v1");
    // Card B loads and restores the v1 draft.
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = fakeHass();
    await sleep(150);
    await openNotesTab(cardB);
    assert.equal(cardB._noteDrafts.get("rec-pasta"), "v1 text.", "B restored A's draft");
    assert.match(cardB.shadowRoot.innerHTML, /v1 text\./);
    // A edits to v2 and saves: the store loses the draft and gains
    // the tombstone for v1 (A's last-written value).
    typeNote(cardA, "v2 text.");
    cardA.shadowRoot.dispatchClick(fakeTarget("save-note"));
    await waitFor(() => cardA._savingNote === false);
    assert.match(cardA.shadowRoot.innerHTML, /Note saved\./);
    assert.equal(stubA.server["rec-pasta"].note, "v2 text.", "server ends at v2");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.noteDrafts, undefined, "store clean of drafts after A's save");
    assert.deepEqual(saved.noteDraftTombstones, { "rec-pasta": "v1 text." }, "tombstone v1 in the store");
    assert.equal(cardB._knownNoteDraftTombstones.size, 0, "B never learned the tombstone");
    assert.equal(cardB._noteDrafts.get("rec-pasta"), "v1 text.", "B still holds the stale v1 draft in memory");
    // THE fix: B's next ordinary session write heals instead of
    // re-publishing the stale draft.
    cardB._saveSession();
    assert.equal(cardB._noteDrafts.has("rec-pasta"), false, "B's stale draft is gone from memory");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.noteDrafts, undefined, "B's write left the store clean of drafts");
    assert.deepEqual(saved.noteDraftTombstones, { "rec-pasta": "v1 text." }, "tombstone persists across B's write");
    // The next render shows the saved note, not the stale draft.
    cardB._render();
    assert.doesNotMatch(cardB.shadowRoot.innerHTML, /v1 text\./);
    // A fresh card shows v2 in the editor with Save disabled.
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass({ detail: { ...PASTA_FULL, note: "v2 text." } });
    await sleep(150);
    assert.equal(fresh._noteDrafts.has("rec-pasta"), false);
    fresh.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
    await flush();
    assert.match(fresh.shadowRoot.innerHTML, /v2 text\./);
    assert.doesNotMatch(fresh.shadowRoot.innerHTML, /v1 text\./);
    assert.equal(
      fresh.shadowRoot.querySelector('[data-action="save-note"]').getAttribute("disabled"),
      "disabled",
      "Save disabled on the fresh card — no stale draft to save"
    );
    cardA.disconnectedCallback();
    cardB.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("saving another recipe's rating does not re-publish a stale note draft — the save-finally write heals it (burst-6, critic F1 notes P1c)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card: cardA, hass: hassA } = await loadedCard();
    const stubA = perRecipeUpdateStub(hassA);
    await openNotesTab(cardA);
    typeNote(cardA, "v1 text.");
    await sleep(200);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.noteDrafts, { "rec-pasta": "v1 text." }, "debounce persisted v1");
    // Card B loads (restoring the v1 draft) and opens soup —
    // before A's save, so no tombstone exists yet.
    const hassB = fakeHass();
    const stubB = perRecipeUpdateStub(hassB);
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = hassB;
    await sleep(150);
    await openSoupNotesTab(cardB);
    assert.equal(cardB._noteDrafts.get("rec-pasta"), "v1 text.", "B still holds the stale v1 draft");
    // A edits to v2 and saves.
    typeNote(cardA, "v2 text.");
    cardA.shadowRoot.dispatchClick(fakeTarget("save-note"));
    await waitFor(() => cardA._savingNote === false);
    assert.equal(stubA.server["rec-pasta"].note, "v2 text.", "server ends at v2");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.noteDrafts, undefined);
    assert.deepEqual(saved.noteDraftTombstones, { "rec-pasta": "v1 text." });
    assert.equal(cardB._noteDrafts.get("rec-pasta"), "v1 text.", "B still holds the stale draft — no B write since the save");
    // B rates soup 4 successfully: the save-finally session write
    // must heal the stale pasta draft, not re-publish it.
    cardB.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
    await waitFor(() => cardB._ratingBusy === false);
    assert.match(cardB.shadowRoot.innerHTML, /Rating saved\./);
    assert.equal(stubB.server["rec-soup"].rating, 4, "server holds B's soup 4");
    assert.equal(cardB._noteDrafts.has("rec-pasta"), false, "B's stale pasta draft is gone from memory");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.noteDrafts, undefined, "no stale pasta draft re-published by B's soup save");
    assert.deepEqual(saved.noteDraftTombstones, { "rec-pasta": "v1 text." }, "tombstone persists");
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass({ detail: { ...PASTA_FULL, note: "v2 text." } });
    await sleep(150);
    assert.equal(fresh._noteDrafts.has("rec-pasta"), false);
    cardA.disconnectedCallback();
    cardB.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("a fresh card that adopts a tombstone can still re-pend the same value — and the bare load writes nothing (burst-6, critic F1 P3d)", async () => {
  // The store holds only the tombstone: the value already saved,
  // nothing pending. Seed it directly so the load has no open
  // detail to re-open and no scroll to restore.
  const seedState = {
    openId: null,
    step: null,
    listScrollY: 0,
    detailScrollY: 0,
    query: "",
    collectionId: "",
    sort: "name",
    // Legacy scalar shape on purpose: the parser normalises it to [3].
    pendingRatingTombstones: { "rec-pasta": 3 },
  };
  const store = stubSessionStorage({
    "family-hub:recipe:state": JSON.stringify(seedState),
  });
  const nav = stubWindow(HUB_WINDOW);
  // Count setItem calls: the bare load must not write at all.
  let writes = 0;
  const realSetItem = globalThis.sessionStorage.setItem;
  globalThis.sessionStorage.setItem = (key, value) => {
    writes++;
    return realSetItem(key, value);
  };
  try {
    const card = new AnyListRecipeViewCard();
    card.setConfig({});
    card.hass = fakeHass({ fail: { update_recipe: "AnyList is down" } });
    card._saveRetryDelays = [10, 10];
    await sleep(150);
    assert.equal(writes, 0, "the bare load wrote nothing to the store");
    assert.deepEqual([...card._knownPendingRatingTombstones.get("rec-pasta")], [3], "the card adopted the tombstone");
    assert.equal(card._pendingRatings.has("rec-pasta"), false, "nothing pending to restore");
    globalThis.sessionStorage.setItem = realSetItem;
    // The same value fails again: the tombstone must not suppress
    // the genuine new pending — the card learned the tombstone
    // before the entry was created, so the drop rule protects it.
    await openNotesTab(card);
    card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => card._ratingBusy === false);
    assert.equal(card._pendingRatings.get("rec-pasta"), 3, "same value re-pended");
    const saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 3 }, "re-pended 3 survived the merge despite the tombstone");
    assert.equal(saved.pendingRatingTombstones, undefined, "the re-pend dropped the tombstone from the store");
    assert.ok(card.shadowRoot.querySelector('[data-action="retry-rating"]'), "retry offered for the re-pended rating");
    card.disconnectedCallback();
  } finally {
    globalThis.sessionStorage.setItem = realSetItem;
    clearWindow();
    clearSessionStorage();
  }
});

test("an adopted tombstone survives the adopter's own writes — it is not dropped by the second write (burst-6, F3)", async () => {
  // Burst-5's "at most one write cycle" lifetime was off by one:
  // the load performed exactly two writes, the first carrying the
  // adopted tombstone and the second dropping it from the store.
  // Tombstones now persist until a genuine re-pend drops them.
  const seedState = {
    openId: null,
    step: null,
    listScrollY: 0,
    detailScrollY: 0,
    query: "",
    collectionId: "",
    sort: "name",
    // Legacy scalar shape on purpose: the parser normalises it to [3].
    pendingRatingTombstones: { "rec-pasta": 3 },
  };
  const store = stubSessionStorage({
    "family-hub:recipe:state": JSON.stringify(seedState),
  });
  const nav = stubWindow(HUB_WINDOW);
  try {
    const card = new AnyListRecipeViewCard();
    card.setConfig({});
    card.hass = fakeHass();
    await sleep(150);
    assert.deepEqual([...card._knownPendingRatingTombstones.get("rec-pasta")], [3], "the card adopted the tombstone");
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    // The bare load writes nothing, so the raw seeded scalar is
    // still in the store bytes — the card adopted it as [3] in
    // memory. The first write below normalises it to the array.
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": 3 }, "tombstone still in the store after the load");
    // Two plain session writes: on burst-5 the second dropped it.
    card._saveSession();
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] }, "tombstone survives the first write");
    card._saveSession();
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] }, "tombstone survives the second write");
    assert.deepEqual([...card._knownPendingRatingTombstones.get("rec-pasta")], [3], "the known tombstone is never consumed");
    card.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("a different pending value survives a merge and the tombstone persists across the other card's write (burst-6, P2b + persistence)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card: cardA } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    cardA._saveRetryDelays = [10, 10];
    await openNotesTab(cardA);
    cardA.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => cardA._ratingBusy === false);
    assert.equal(cardA._pendingRatings.get("rec-pasta"), 3);
    // Card B loads (restoring A's pending 3) and then fails a
    // DIFFERENT rating for the same recipe: the store ends at 4.
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = fakeHass({ fail: { update_recipe: "AnyList is down" } });
    cardB._saveRetryDelays = [10, 10];
    await sleep(150);
    await openNotesTab(cardB);
    assert.equal(cardB._pendingRatings.get("rec-pasta"), 3, "B restored A's pending 3");
    cardB.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
    await waitFor(() => cardB._ratingBusy === false);
    assert.equal(cardB._pendingRatings.get("rec-pasta"), 4);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 4 }, "B's newer pending overwrote the stored 3");
    // A's retry of 3 succeeds: the tombstone is value-scoped to 3,
    // so the stored 4 — B's live pending — must survive the merge,
    // and the tombstone must persist alongside it.
    cardA._hass = fakeHass();
    cardA.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => cardA._ratingBusy === false);
    assert.match(cardA.shadowRoot.innerHTML, /Rating saved\./);
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 4 }, "A's success removed only its own 3, not B's 4");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] }, "tombstone 3 carried alongside the different pending");
    // B's next write keeps both: its live 4 survives (it differs
    // from the tombstone) and the tombstone is re-carried.
    cardB._saveSession();
    assert.equal(cardB._pendingRatings.get("rec-pasta"), 4, "B's live 4 was not dropped by the tombstone for 3");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 4 }, "B's write kept its pending 4");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] }, "B's write kept the tombstone 3");
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._pendingRatings.get("rec-pasta"), 4, "fresh card restores B's pending 4");
    cardA.disconnectedCallback();
    cardB.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("a failed carrying write strands the tombstone in memory and the disconnect flush carries it (burst-6, F2)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    card._saveRetryDelays = [10, 10];
    await openNotesTab(card);
    card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => card._ratingBusy === false);
    assert.equal(card._pendingRatings.get("rec-pasta"), 3);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 3 }, "failed save persisted its pending rating");
    // The retry succeeds on the server, but its carrying write to
    // the session store throws once.
    const realSetItem = globalThis.sessionStorage.setItem;
    let threw = false;
    globalThis.sessionStorage.setItem = (key, value) => {
      if (!threw) {
        threw = true;
        throw new Error("storage quota exceeded");
      }
      return realSetItem(key, value);
    };
    try {
      card._hass = fakeHass();
      card.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
      await waitFor(() => card._ratingBusy === false);
    } finally {
      globalThis.sessionStorage.setItem = realSetItem;
    }
    assert.match(card.shadowRoot.innerHTML, /Rating saved\./);
    assert.equal(card._pendingRatings.has("rec-pasta"), false, "the live entry is gone from memory");
    assert.deepEqual([...card._pendingRatingTombstones.get("rec-pasta")], [3], "the tombstone is retained in memory");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 3 }, "the store still holds the stale pending 3");
    assert.equal(saved.pendingRatingTombstones, undefined, "the tombstone never reached the store");
    // Disconnect with no scroll timer pending: on burst-5 no flush
    // ran, so the phantom came back on the next load.
    assert.equal(card._scrollSaveTimer, null, "no scroll timer pending at disconnect");
    card.disconnectedCallback();
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "the disconnect flush cleaned the stale pending");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] }, "the disconnect flush carried the tombstone");
    // A fresh card shows no phantom retry.
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._pendingRatings.has("rec-pasta"), false);
    fresh.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
    await flush();
    assert.equal(fresh.shadowRoot.querySelector('[data-action="retry-rating"]'), null, "no phantom retry on the fresh card");
    assert.doesNotMatch(fresh.shadowRoot.innerHTML, /Rating not saved yet/);
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
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

test("a failed rating save retries itself, then keeps the old rating and says so honestly", async () => {
  const { card, hass } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
  // Short backoff so the test does not wait out the real 0.5/1 s.
  card._saveRetryDelays = [50, 100];
  await openNotesTab(card);
  card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
  // Mid-budget: the save is still retrying — no error yet.
  await flush();
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Couldn't save the rating/);
  // Once the retries are spent (1 + 2 attempts), the error lands —
  // and all three attempts sent exactly the same rating.
  await sleep(250);
  assert.equal(hass.calls.length, 4);
  assert.deepEqual(hass.calls[1], [
    "anylist",
    "update_recipe",
    { recipe_id: "rec-pasta", rating: 3 },
  ]);
  assert.deepEqual(hass.calls[2], hass.calls[1]);
  assert.deepEqual(hass.calls[3], hass.calls[1]);
  assert.match(card.shadowRoot.innerHTML, /Couldn't save the rating/);
  assert.equal(card.shadowRoot.querySelectorAll(".star.filled").length, 5);
  assert.equal(card._selected.rating, 5);
  assert.equal(card._pendingRating, 3);
  card.disconnectedCallback();
});

test("a transient rating save failure recovers on its own (C2)", async () => {
  const { card, hass } = await loadedCard();
  card._saveRetryDelays = [10, 20];
  let attempts = 0;
  const realCallWS = hass.callWS;
  hass.callWS = async (message) => {
    if (message.service === "update_recipe" && ++attempts <= 2) {
      throw new Error("AnyList is down");
    }
    return realCallWS(message);
  };
  await openNotesTab(card);
  card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
  await sleep(200);
  assert.match(card.shadowRoot.innerHTML, /Rating saved\./);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Couldn't save/);
  assert.equal(card.shadowRoot.querySelectorAll(".star.filled").length, 3);
  assert.equal(card._selected.rating, 3);
  assert.equal(card._pendingRating, null);
  assert.equal(attempts, 3);
  card.disconnectedCallback();
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
    // the tap-open's detail route FIRST (RB-R4-2 — the open writes
    // ?recipe=&step= into the URL), then the Timers navigation.
    card.shadowRoot.dispatchClick(fakeTarget("goto-timers"));
    await flush();
    assert.deepEqual(nav.pushed, ["/family-hub/recipes?recipe=rec-pasta&step=1", "/family-hub/timers"]);
    // Both navigations dispatch location-changed (the open's route
    // write and the Timers navigation).
    assert.deepEqual(nav.dispatched, ["location-changed", "location-changed"]);
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
  globalThis.window.location.pathname = "/family-hub/recipes";
  injectCore();
  try {
    const { card } = await loadedCard({
      states: [wallBrowserPathState("/family-hub/recipes")],
    });
    const screen = card.shadowRoot.querySelector(".screen");
    assert.ok(screen.classList.contains("kiosk"));
    assert.ok(screen.classList.contains("dev-hub"));
  } finally {
    resetCore();
    clearWindow();
  }
});

test("R1: _navigate never carries ?kiosk — it is launch-only (§4/§19)", async () => {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const nav = stubWindow(HUB_WINDOW);
  try {
    // A stale flag from the old machinery must not re-attach ?kiosk:
    // the flag machinery is deleted, and in-app navigation is plain.
    store.set("family-hub:kiosk", "1");
    const { card } = await loadedCard();
    card._navigate("/family-hub/timers");
    card._navigate("/family-hub/family-photos");
    assert.deepEqual(nav.pushed, [
      "/family-hub/timers",
      "/family-hub/family-photos",
    ]);
  } finally {
    delete globalThis.sessionStorage;
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
    // RB-R4-2: the tap-open writes the open recipe + step into the
    // URL as a real route (via navigateTo; the legacy pushState runs
    // here because no core is injected), so the §7.2 guard can see
    // it and currentRoute() tracks the detail at once. The old
    // same-URL fhNav-state push is gone.
    assert.deepEqual(nav.pushedStates, [
      { state: null, url: "/family-hub/recipes?recipe=rec-pasta&step=1" },
    ]);
    assert.deepEqual(nav.pushed, ["/family-hub/recipes?recipe=rec-pasta&step=1"]);
    assert.deepEqual(nav.dispatched, ["location-changed"]);
    // System-back to the list entry, then forward to the detail entry.
    // The stub window does not move location on pushState, so the test
    // moves it the way the browser would on Back/Forward.
    globalThis.window.location.search = "";
    card._onPopState({ state: null });
    await flush();
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, false);
    // The legacy fhNav-state entry (written by the pre-R4-2 card in
    // the same session) still re-opens the detail.
    card._onPopState({ state: { fhNav: "detail", openId: "rec-pasta" } });
    await flush();
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, true);
    assert.match(card.shadowRoot.innerHTML, /Step 1 of 3/);
    // The URL-based entry: Back onto the plain list URL closes the
    // detail, and Forward onto ?recipe=&step= re-opens it at the
    // URL's step — no fhNav state needed.
    globalThis.window.location.search = "";
    card._onPopState({ state: null });
    await flush();
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, false);
    globalThis.window.location.search = "?recipe=rec-pasta&step=2";
    card._onPopState({ state: null });
    await flush();
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, true);
    assert.match(card.shadowRoot.innerHTML, /Step 2 of 3/);
    globalThis.window.location.search = "";
    card._onPopState({ state: null });
    await flush();
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, false);
  } finally {
    if (card) card.disconnectedCallback();
    clearWindow();
  }
});

// -- RB-R4-2 (§16): route writing goes through navigateTo ------------
//
// A fake core is the real core with navigateTo stubbed + recorded:
// the card's hass setter still gets identify/deviceFromIdentity from
// the real core, so the card mounts exactly as on the hub.

function r42FakeCore(navigateTo) {
  return { ...core, navigateTo };
}

test("R4-2: tap-open with core loaded calls navigateTo with the detail URL — no pushState, no dispatch", async () => {
  const nav = stubHistoryWindow(HUB_WINDOW);
  const navigated = [];
  _setCoreForTests(r42FakeCore((url) => {
    navigated.push(url);
    return Promise.resolve(true);
  }));
  let card;
  try {
    ({ card } = await loadedCard());
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    assert.deepEqual(navigated, ["/family-hub/recipes?recipe=rec-pasta&step=1"]);
    assert.deepEqual(nav.pushed, [], "the legacy pushState never runs when the helper is used");
    assert.deepEqual(nav.dispatched, [], "no location-changed dispatch from the card either");
  } finally {
    if (card) card.disconnectedCallback();
    resetCore();
    clearWindow();
  }
});

test("R4-2: tap-open carries ?kiosk when the session launched with it — and the close keeps it", async () => {
  const nav = stubHistoryWindow({ ...HUB_WINDOW, search: "?kiosk" });
  const navigated = [];
  _setCoreForTests(r42FakeCore((url) => {
    navigated.push(url);
    return Promise.resolve(true);
  }));
  let card;
  try {
    ({ card } = await loadedCard());
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    assert.deepEqual(navigated, [
      "/family-hub/recipes?recipe=rec-pasta&step=1&kiosk",
    ]);
    card.shadowRoot.dispatchClick(fakeTarget("back"));
    await flush();
    assert.deepEqual(navigated, [
      "/family-hub/recipes?recipe=rec-pasta&step=1&kiosk",
      "/family-hub/recipes?kiosk",
    ]);
    assert.deepEqual(nav.pushed, []);
  } finally {
    if (card) card.disconnectedCallback();
    resetCore();
    clearWindow();
  }
});

test("R4-2: close/back without core writes the plain list URL at once (legacy path)", async () => {
  const nav = stubHistoryWindow(HUB_WINDOW);
  let card;
  try {
    ({ card } = await loadedCard());
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    nav.pushed.length = 0;
    nav.pushedStates.length = 0;
    nav.dispatched.length = 0;
    card.shadowRoot.dispatchClick(fakeTarget("back"));
    await flush();
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, false);
    assert.deepEqual(nav.pushed, ["/family-hub/recipes"]);
    assert.deepEqual(nav.dispatched, ["location-changed"]);
  } finally {
    if (card) card.disconnectedCallback();
    clearWindow();
  }
});

test("R4-2: _navigate with core loaded calls the helper; a throwing helper falls back to the legacy path", async () => {
  const nav = stubHistoryWindow(HUB_WINDOW);
  const navigated = [];
  _setCoreForTests(r42FakeCore((url) => {
    navigated.push(url);
    return Promise.resolve(true);
  }));
  let card;
  try {
    ({ card } = await loadedCard());
    card._navigate("/family-hub/timers");
    assert.deepEqual(navigated, ["/family-hub/timers"]);
    assert.deepEqual(nav.pushed, []);
    card.disconnectedCallback();
    card = null;
  } finally {
    resetCore();
    clearWindow();
  }
  // Throwing helper: the legacy pushState + dispatch runs instead —
  // navigation must never dead-end on a helper failure.
  const nav2 = stubHistoryWindow(HUB_WINDOW);
  _setCoreForTests(r42FakeCore(() => {
    throw new Error("SPA call unavailable");
  }));
  try {
    ({ card } = await loadedCard());
    card._navigate("/family-hub/timers");
    assert.deepEqual(nav2.pushed, ["/family-hub/timers"]);
    assert.deepEqual(nav2.dispatched, ["location-changed"]);
    card.disconnectedCallback();
    card = null;
  } finally {
    resetCore();
    clearWindow();
  }
});

test("R4-2: goto-timers and PIP tap write the return state before navigating", async () => {
  const store = stubSessionStorage({});
  const nav = stubHistoryWindow(HUB_WINDOW);
  let card;
  try {
    ({ card } = await loadedCard());
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    // Step to step 2, then leave for Timers: the session must carry
    // openId + step 2 so "← Back to recipe" can return to it.
    card.shadowRoot.dispatchClick(fakeTarget("step-next"));
    await flush();
    card.shadowRoot.dispatchClick(fakeTarget("goto-timers"));
    await flush();
    assert.deepEqual(nav.pushed.slice(-1), ["/family-hub/timers"]);
    const saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.openId, "rec-pasta");
    assert.equal(saved.step, 2);
  } finally {
    if (card) card.disconnectedCallback();
    clearWindow();
    clearSessionStorage();
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
      { state: null, url: "/family-hub/recipes" },
    ]);
    // System-back from the list returns to the detail exactly once —
    // via the URL now: Back lands on ?recipe=&step=, which re-opens
    // the detail at the URL's step (RB-R4-2).
    globalThis.window.location.search = "?recipe=rec-pasta&step=2";
    card._onPopState({ state: null });
    await flush();
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, true);
    assert.match(card.shadowRoot.innerHTML, /Step 2 of 3/);
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
    // RB-R4-2: the close routes through navigateTo — the plain list
    // URL, one entry, no fhNav state, no stale route.
    assert.deepEqual(nav.pushed, ["/family-hub/recipes"]);
    assert.deepEqual(nav.pushedStates, [
      { state: null, url: "/family-hub/recipes" },
    ]);
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
      // R1-5: fixtures are contract-v2 sensors (the bridge gate admits
      // only contract_version 2). Pass contract_version: null in extra
      // for a v1-shaped sensor in a mismatch test.
      contract_version: 2,
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
    // the detail route from opening the recipe, not a navigation.)
    assert.deepEqual(nav.pushed, ["/family-hub/recipes?recipe=rec-pasta&step=1"]);
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
    // The first push is the detail route from opening the recipe.
    assert.deepEqual(nav.pushed, ["/family-hub/recipes?recipe=rec-pasta&step=1", "/family-hub/timers"]);
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
    assert.deepEqual(nav.pushed, ["/family-hub/recipes?recipe=rec-pasta&step=1", "/family-hub/timers"]);
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
  card._saveRetryDelays = [10, 20];
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
  await flush();
  typeNote(card, "More salt next time.");
  // The rig stub's shape: a non-throwing update_recipe returning {}.
  // The unconfirmed response is retried like a failure (C2) before
  // the error shows, so wait the budget out.
  card._callAction = async () => ({});
  card.shadowRoot.dispatchClick(fakeTarget("save-note"));
  await sleep(150);
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
  card._saveRetryDelays = [10, 20];
  card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
  await flush();
  card.shadowRoot.dispatchClick(fakeTarget("tab", { tab: "notes" }));
  await flush();
  card._callAction = async () => ({});
  card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
  // The unconfirmed response is retried like a failure (C2) before
  // the error shows, so wait the budget out.
  await sleep(150);
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
      { state: null, url: "/family-hub/recipes" },
    ]);
    // One system-back press from that list entry returns to the detail —
    // via the URL now: Back lands on ?recipe=&step= (RB-R4-2).
    globalThis.window.location.search = "?recipe=rec-pasta&step=1";
    card._onPopState({ state: null });
    await flush();
    assert.equal(card.shadowRoot.querySelector(".list-view").hidden, true);
    assert.match(card.shadowRoot.innerHTML, /Step 1 of 3/);
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

// -- §9 version gates (R1-5) -------------------------------------------------

test("R1-5: old bridge (no contract_version) -> Timer bridge mismatch in the strip area, no pills, browsing intact", async () => {
  injectCore();
  try {
    const v1a = timerSensor("sensor.satellite_timer_pasta", "Pasta", "active", { contract_version: null });
    const v1b = timerSensor("sensor.satellite_timer_soup", "Soup", "active", { contract_version: null });
    const { card } = await loadedCard({ states: [v1a, v1b] });
    // Browsing still renders: the recipe list is there.
    assert.match(card.shadowRoot.innerHTML, /Creamy Tomato Pasta/);
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    const mismatch = card.shadowRoot.querySelector(".fh-core-mismatch");
    assert.ok(mismatch);
    assert.match(mismatch.textContent, /Timer bridge mismatch: card expects contract v2/);
    assert.equal(card.shadowRoot.querySelectorAll(".timer-strip-item").length, 0);
    card.disconnectedCallback();
  } finally {
    resetCore();
  }
});

test("R1-5: mixed v2 + v1 sensors -> the error shows, the v2 pill still renders", async () => {
  injectCore();
  try {
    const v2 = timerSensor("sensor.satellite_timer_pasta", "Pasta", "active");
    const v1 = timerSensor("sensor.satellite_timer_soup", "Soup", "active", { contract_version: null });
    const { card } = await loadedCard({ states: [v2, v1] });
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    const mismatch = card.shadowRoot.querySelector(".fh-core-mismatch");
    assert.ok(mismatch);
    assert.match(mismatch.textContent, /Timer bridge mismatch/);
    const items = card.shadowRoot.querySelectorAll(".timer-strip-item");
    assert.equal(items.length, 1);
    assert.match(items[0].textContent, /Pasta/);
    card.disconnectedCallback();
  } finally {
    resetCore();
  }
});

test("R1-5: core version skew -> Hub core mismatch replaces the strip, browsing intact", async () => {
  const wrongCore = {
    identify: core.identify,
    deviceFromIdentity: core.deviceFromIdentity,
    checkCoreVersion: () =>
      "Hub core mismatch: card needs 2.0.0, core is 9.9.9",
    checkBridgeContract: core.checkBridgeContract,
    layoutBand: core.layoutBand,
  };
  _setCoreForTests(wrongCore);
  try {
    const v2 = timerSensor("sensor.satellite_timer_pasta", "Pasta", "active");
    const { card } = await loadedCard({ states: [v2] });
    assert.match(card.shadowRoot.innerHTML, /Creamy Tomato Pasta/);
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    const mismatch = card.shadowRoot.querySelector(".fh-core-mismatch");
    assert.ok(mismatch);
    assert.match(mismatch.textContent, /Hub core mismatch: card needs 2.0.0, core is 9.9.9/);
    assert.equal(card.shadowRoot.querySelectorAll(".timer-strip-item").length, 0);
    card.disconnectedCallback();
  } finally {
    resetCore();
  }
});

test("R1-5: a finished v1 sensor on a hass push shows no PIP", async () => {
  injectCore();
  try {
    const v1 = timerSensor("sensor.satellite_timer_pasta", "Creamy Tomato Pasta", "active", { contract_version: null });
    const { card, hass } = await loadedCard({ states: [v1] });
    card.shadowRoot.dispatchClick(fakeTarget("open", { recipeId: "rec-pasta" }));
    await flush();
    // The sensor finishes on a later push: the gate must not show the
    // finished PIP from a mismatched sensor.
    const finished = timerSensor("sensor.satellite_timer_pasta", "Creamy Tomato Pasta", "finished", { contract_version: null });
    card.hass = { ...hass, states: [finished] };
    await flush();
    assert.equal(card.shadowRoot.querySelector(".pip"), null);
    card.disconnectedCallback();
  } finally {
    resetCore();
  }
});

// -- burst-7 (critic F1–F4 + verifier item b) -------------------------
//
// Burst-6 healed the stale holder on the merge path, but the delta
// critic measured three paths where the fix does not hold: a
// same-instance re-open shields the stale entry (F1), the
// known-check is value-blind (F2), and the stored tombstone never
// updates so only the first saved value per id is guarded (F3 —
// now set-valued for ratings, recorded-wins for notes). Tombstones
// for ids that left the list were never pruned (F4), and a heal
// left the ghost note text editable (verifier item b).

test("burst-7 F1: a same-instance re-open from the list view does not shield a stale entry — adoption clears it (critic D1)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card: cardA } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    cardA._saveRetryDelays = [10, 10];
    await openNotesTab(cardA);
    cardA.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => cardA._ratingBusy === false);
    assert.equal(cardA._pendingRatings.get("rec-pasta"), 3);
    const cardB = new AnyListRecipeViewCard();
    const hassB = fakeHass();
    cardB.setConfig({});
    cardB.hass = hassB;
    await sleep(150);
    await openNotesTab(cardB);
    assert.equal(cardB._pendingRatings.get("rec-pasta"), 3, "B restored A's pending 3");
    // A's retry succeeds: store clean except the tombstone.
    cardA._hass = fakeHass();
    cardA.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => cardA._ratingBusy === false);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "store clean after A's retry");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] }, "tombstone [3] in store");
    assert.equal(cardB._pendingRatings.get("rec-pasta"), 3, "B still holds stale 3");
    // Back to the list: openId null, so the re-attach restore has
    // no open recipe to re-save before the async load adopts.
    cardA.shadowRoot.dispatchClick(fakeTarget("back"));
    await flush();
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.openId, null, "precondition: openId null after back");
    assert.equal(saved.listScrollY, 0, "precondition: listScrollY 0 after back");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] }, "tombstone kept by the clear");
    const loadsBefore = hassB.calls.filter((c) => c[1] === "get_recipes").length;
    cardB.disconnectedCallback();
    cardB.connectedCallback();
    await sleep(250);
    const loadsAfter = hassB.calls.filter((c) => c[1] === "get_recipes").length;
    assert.equal(loadsAfter, loadsBefore + 1, "reload proof: one more get_recipes");
    // Adoption must have cleared the stale memory entry, not
    // shielded it: known holds [3] and memory holds nothing.
    assert.deepEqual([...cardB._knownPendingRatingTombstones.get("rec-pasta")], [3], "B adopted tombstone 3");
    assert.equal(cardB._pendingRatings.get("rec-pasta"), undefined, "stale memory cleared by adoption");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "store pending clean after reload");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] }, "tombstone kept by the reload");
    cardB._saveSession();
    assert.equal(cardB._pendingRatings.get("rec-pasta"), undefined, "B memory clean after write");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "store pending clean after B write");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] }, "tombstone kept by B write");
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._pendingRatings.get("rec-pasta"), undefined, "fresh card restores no phantom");
    assert.equal(fresh.shadowRoot.querySelector('[data-action="retry-rating"]'), null, "no phantom retry on fresh card");
    cardA.disconnectedCallback();
    cardB.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-7 F1 (notes): a same-instance re-open from the list view clears a stale note draft on adoption", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card: cardA, hass: hassA } = await loadedCard();
    const stubA = perRecipeUpdateStub(hassA);
    await openNotesTab(cardA);
    typeNote(cardA, "v1 text.");
    await sleep(200);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.noteDrafts, { "rec-pasta": "v1 text." }, "debounce persisted v1");
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = fakeHass();
    await sleep(150);
    await openNotesTab(cardB);
    assert.equal(cardB._noteDrafts.get("rec-pasta"), "v1 text.", "B restored A's draft");
    typeNote(cardA, "v2 text.");
    cardA.shadowRoot.dispatchClick(fakeTarget("save-note"));
    await waitFor(() => cardA._savingNote === false);
    assert.equal(stubA.server["rec-pasta"].note, "v2 text.", "server ends at v2");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.noteDrafts, undefined, "store clean of drafts after A's save");
    assert.deepEqual(saved.noteDraftTombstones, { "rec-pasta": "v1 text." }, "tombstone v1 in the store");
    assert.equal(cardB._noteDrafts.get("rec-pasta"), "v1 text.", "B still holds the stale v1 draft");
    cardA.shadowRoot.dispatchClick(fakeTarget("back"));
    await flush();
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.openId, null, "precondition: openId null after back");
    cardB.disconnectedCallback();
    cardB.connectedCallback();
    await sleep(250);
    assert.equal(cardB._knownNoteDraftTombstones.get("rec-pasta"), "v1 text.", "B adopted tombstone v1");
    assert.equal(cardB._noteDrafts.get("rec-pasta"), undefined, "stale draft cleared by adoption");
    cardB._saveSession();
    assert.equal(cardB._noteDrafts.has("rec-pasta"), false, "B draft clean after write");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.noteDrafts, undefined, "store clean of drafts after B write");
    assert.deepEqual(saved.noteDraftTombstones, { "rec-pasta": "v1 text." }, "tombstone kept by B write");
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass({ detail: { ...PASTA_FULL, note: "v2 text." } });
    await sleep(150);
    assert.equal(fresh._noteDrafts.has("rec-pasta"), false, "fresh card restores no draft");
    cardA.disconnectedCallback();
    cardB.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-8 F1 guard (revised): adoption must NOT delete a genuine re-pend created by a local tap after learning the value", async () => {
  const nav = stubWindow(HUB_WINDOW);
  try {
    // REVISED in burst-8 — what changed and why: the burst-7
    // version created the "re-pend" by assigning the pending map
    // directly (card._pendingRatings.set(...)). A directly-assigned
    // entry carries no provenance, so it is indistinguishable from
    // a restored stale entry — and adoption now (correctly) deletes
    // it. That locked behaviour WAS the shielding itself (a
    // provenance-free entry surviving adoption), so the test is
    // revised to create the re-pend the honest way: a real tap.
    // Seed a tombstone for 3; the card adopts it, then the cook
    // re-taps the same value and the save fails — the re-pend is
    // created AFTER the learning, so it is genuine. A carrying
    // write that never ran (or threw) leaves the tombstone in the
    // store while the genuine pending sits in memory; the next
    // restore must keep it, not delete it as if it were stale.
    // The carrying write is made to throw here (setItem throws —
    // the card swallows it), which holds that precondition.
    const seedState = {
      openId: null, step: null, listScrollY: 0, detailScrollY: 0,
      query: "", collectionId: "", sort: "name",
      pendingRatingTombstones: { "rec-pasta": [3] },
    };
    const store = stubSessionStorage({ "family-hub:recipe:state": JSON.stringify(seedState) });
    const card = new AnyListRecipeViewCard();
    card.setConfig({});
    card.hass = fakeHass();
    await sleep(150);
    assert.deepEqual([...card._knownPendingRatingTombstones.get("rec-pasta")], [3], "adopted tombstone 3");
    await openNotesTab(card);
    // Genuine re-pend created after learning, by a real tap whose
    // save fails — with the store failing underneath it, so the
    // tombstone survives in the store while the pending sits in
    // memory.
    const realSetItem = globalThis.sessionStorage.setItem;
    globalThis.sessionStorage.setItem = () => {
      throw new Error("store down");
    };
    try {
      card._hass = fakeHass({ fail: { update_recipe: "AnyList is down" } });
      card._saveRetryDelays = [10, 10];
      card.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
      await waitFor(() => card._ratingBusy === false);
    } finally {
      globalThis.sessionStorage.setItem = realSetItem;
    }
    assert.equal(card._pendingRatings.get("rec-pasta"), 3, "genuine re-pend held after the failed tap");
    let saved = readStore(store);
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] }, "tombstone survived the failed carrying write");
    // Adoption re-reads the store: the genuine re-pend survives.
    card._restorePendingSaves();
    assert.equal(card._pendingRatings.get("rec-pasta"), 3, "genuine re-pend survives the restore");
    assert.deepEqual([...card._knownPendingRatingTombstones.get("rec-pasta")], [3], "known tombstone kept");
    card._saveSession();
    saved = readStore(store);
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 3 }, "re-pend reaches the store");
    assert.equal(saved.pendingRatingTombstones, undefined, "the re-pend drops its tombstone");
    card.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-7 F2: the drop rule is value-scoped — a tombstone for the held value drops it even when known holds a different value (critic D2)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    // Step 1: X saves 4 -> store tombstone [4].
    const { card: cardX } = await loadedCard();
    await openNotesTab(cardX);
    cardX.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
    await waitFor(() => cardX._ratingBusy === false);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [4] }, "tombstone [4] landed first");
    // Step 2: A fails 3 -> store pending 3 + tombstone [4].
    const { card: cardA } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    cardA._saveRetryDelays = [10, 10];
    await openNotesTab(cardA);
    cardA.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => cardA._ratingBusy === false);
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 3 }, "A's failed 3 is pending");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [4] }, "tombstone [4] persists");
    // Step 3: B loads -> adopts known {4}, restores live 3.
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = fakeHass();
    await sleep(150);
    assert.deepEqual([...cardB._knownPendingRatingTombstones.get("rec-pasta")], [4], "B adopted tombstone 4");
    assert.equal(cardB._pendingRatings.get("rec-pasta"), 3, "B restored pending 3");
    // Step 4: C re-pends 4 (fails) -> its write evicts tombstone 4;
    // the store ends at pending {4}, tombstone undefined.
    const cardC = new AnyListRecipeViewCard();
    cardC.setConfig({});
    cardC.hass = fakeHass({ fail: { update_recipe: "AnyList is down" } });
    cardC._saveRetryDelays = [10, 10];
    await sleep(150);
    await openNotesTab(cardC);
    assert.equal(cardC._pendingRatings.get("rec-pasta"), 3, "C restored pending 3");
    cardC.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
    await waitFor(() => cardC._ratingBusy === false);
    assert.equal(cardC._pendingRatings.get("rec-pasta"), 4, "C's failed 4 overwrote its restored 3 in memory");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 4 }, "C's write published its live 4");
    assert.equal(saved.pendingRatingTombstones, undefined, "C's live 4 evicted tombstone 4 from the store");
    assert.equal(cardB._pendingRatings.get("rec-pasta"), 3, "B still holds its restored 3 in memory");
    assert.deepEqual([...cardB._knownPendingRatingTombstones.get("rec-pasta")], [4], "B's known still holds the OLD value 4");
    // Step 5: A's retry of 3 succeeds -> tombstone [3] lands,
    // C's genuine pending 4 survives.
    cardA._hass = fakeHass();
    cardA.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => cardA._ratingBusy === false);
    assert.match(cardA.shadowRoot.innerHTML, /Rating saved\./);
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 4 }, "A's success kept C's genuine pending 4");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] }, "tombstone [3] landed");
    // Step 6: B's next ordinary write. The store holds a tombstone
    // for the EXACT value B holds (3), and B's known map holds a
    // DIFFERENT value (4). A value-scoped check drops B's stale 3.
    cardB._saveSession();
    assert.equal(cardB._pendingRatings.get("rec-pasta"), undefined, "B's stale 3 dropped");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatings, { "rec-pasta": 4 }, "only C's genuine 4 survives in the store");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] }, "tombstone [3] kept by B's write");
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    // NOTE: the critic's probe asserts the fresh card restores
    // nothing here, but that contradicts its own store assertion
    // above (pending {4} must restore as 4 — C's genuine pending,
    // the burst-6 P2b behaviour). The correct expectation is 4.
    assert.equal(fresh._pendingRatings.get("rec-pasta"), 4, "fresh card restores C's genuine pending 4, not B's stale 3");
    cardX.disconnectedCallback();
    cardA.disconnectedCallback();
    cardB.disconnectedCallback();
    cardC.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-7 F3 (ratings): set-valued tombstones — saving a second value guards both, and the loser's holder is healed (critic FROZEN)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    // A saves 3 -> tombstone [3].
    const { card: cardA } = await loadedCard();
    await openNotesTab(cardA);
    cardA.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => cardA._ratingBusy === false);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3] }, "tombstone [3] landed");
    // D fails 4 -> pending 4. C loads and restores it.
    const { card: cardD } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    cardD._saveRetryDelays = [10, 10];
    await openNotesTab(cardD);
    cardD.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
    await waitFor(() => cardD._ratingBusy === false);
    const cardC = new AnyListRecipeViewCard();
    cardC.setConfig({});
    cardC.hass = fakeHass();
    await sleep(150);
    assert.equal(cardC._pendingRatings.get("rec-pasta"), 4, "C restored pending 4");
    // D's retry saves 4. NOTE: the critic's probe expects the
    // tombstone to become {4} (latest wins); the coordinator
    // decision for burst-7 is set-valued, so the tombstone is
    // [3, 4] — BOTH values guarded, strictly stronger.
    cardD._hass = fakeHass();
    cardD.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => cardD._ratingBusy === false);
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3, 4] }, "tombstone guards both saved values");
    assert.equal(saved.pendingRatings, undefined, "store clean after D's save");
    // C's ordinary writes must not re-publish the just-saved 4.
    cardC._saveSession();
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "store pending clean after C write #1");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3, 4] }, "tombstones kept after C write #1");
    cardC._saveSession();
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "store pending clean after C write #2");
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._pendingRatings.get("rec-pasta"), undefined, "fresh card restores no phantom");
    cardA.disconnectedCallback();
    cardD.disconnectedCallback();
    cardC.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-7 F3 (ratings): the loser's holder cannot re-publish after a second save of its value (critic RESIDUAL1)", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card: cardA } = await loadedCard();
    await openNotesTab(cardA);
    cardA.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "3" }));
    await waitFor(() => cardA._ratingBusy === false);
    const { card: cardD } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    cardD._saveRetryDelays = [10, 10];
    await openNotesTab(cardD);
    cardD.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
    await waitFor(() => cardD._ratingBusy === false);
    const cardC = new AnyListRecipeViewCard();
    cardC.setConfig({});
    cardC.hass = fakeHass();
    await sleep(150);
    assert.equal(cardC._pendingRatings.get("rec-pasta"), 4, "C restored pending 4");
    cardD._hass = fakeHass();
    cardD.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => cardD._ratingBusy === false);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "store clean right after D's save");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3, 4] }, "both values guarded after D's save");
    cardC._saveSession();
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "C write #1 re-publishes nothing — healed, not 'once'");
    assert.equal(cardC._pendingRatings.has("rec-pasta"), false, "C healed by write #1");
    // A SECOND card saves 4 again (E fails 4, then retries).
    const { card: cardE } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    cardE._saveRetryDelays = [10, 10];
    await openNotesTab(cardE);
    cardE.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
    await waitFor(() => cardE._ratingBusy === false);
    cardE._hass = fakeHass();
    cardE.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => cardE._ratingBusy === false);
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "store clean right after E's save");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-pasta": [3, 4] }, "both values still guarded after E's save");
    cardC._saveSession();
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "C write #2 re-publishes nothing either");
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._pendingRatings.get("rec-pasta"), undefined, "fresh card restores no phantom");
    fresh._saveSession();
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "no ordinary write re-publishes");
    cardA.disconnectedCallback();
    cardD.disconnectedCallback();
    cardC.disconnectedCallback();
    cardE.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-7 F3 (notes): recorded wins — the newest save's tombstone replaces the stored one", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    // A types alpha-1 (debounce persists it) and saves alpha-2:
    // the tombstone names its last-written value, alpha-1.
    const { card: cardA } = await loadedCard();
    await openNotesTab(cardA);
    typeNote(cardA, "alpha draft one.");
    await sleep(200);
    typeNote(cardA, "alpha draft two.");
    cardA.shadowRoot.dispatchClick(fakeTarget("save-note"));
    await waitFor(() => cardA._savingNote === false);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.noteDraftTombstones, { "rec-pasta": "alpha draft one." }, "A's save tombstoned alpha-1");
    // B loads, types beta-1 (debounce persists it) and saves beta-2:
    // its recorded tombstone (beta-1) must REPLACE alpha-1 in the
    // store — under burst-6 stored-wins it would stay alpha-1.
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = fakeHass();
    await sleep(150);
    await openNotesTab(cardB);
    typeNote(cardB, "beta draft one.");
    await sleep(200);
    typeNote(cardB, "beta draft two.");
    cardB.shadowRoot.dispatchClick(fakeTarget("save-note"));
    await waitFor(() => cardB._savingNote === false);
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.noteDraftTombstones, { "rec-pasta": "beta draft one." }, "newest save's tombstone wins");
    assert.equal(saved.noteDrafts, undefined, "store clean of drafts after B's save");
    cardA.disconnectedCallback();
    cardB.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-7 F4: a tombstone for an id that left the recipe list is pruned on load (critic PRUNE)", async () => {
  const seedState = {
    openId: null, step: null, listScrollY: 0, detailScrollY: 0,
    query: "", collectionId: "", sort: "name",
    pendingRatingTombstones: { "rec-gone": [3], "rec-pasta": [3] },
    noteDraftTombstones: { "rec-gone": "dead note text", "rec-pasta": "x" },
  };
  const store = stubSessionStorage({ "family-hub:recipe:state": JSON.stringify(seedState) });
  const nav = stubWindow(HUB_WINDOW);
  try {
    const beforeBytes = store.get("family-hub:recipe:state").length;
    const card = new AnyListRecipeViewCard();
    card.setConfig({});
    card.hass = fakeHass();
    await sleep(150);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatingTombstones["rec-gone"], undefined, "rating tombstone for rec-gone pruned on load");
    assert.equal(saved.noteDraftTombstones["rec-gone"], undefined, "note tombstone for rec-gone pruned on load");
    assert.deepEqual(saved.pendingRatingTombstones["rec-pasta"], [3], "control tombstone for live rec-pasta kept");
    assert.equal(saved.noteDraftTombstones["rec-pasta"], "x", "control note tombstone kept");
    card._saveSession();
    card._saveSession();
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatingTombstones["rec-gone"], undefined, "rating tombstone for rec-gone stays pruned after 2 writes");
    assert.equal(saved.noteDraftTombstones["rec-gone"], undefined, "note tombstone for rec-gone stays pruned after 2 writes");
    assert.deepEqual(saved.pendingRatingTombstones["rec-pasta"], [3], "control tombstone survives the writes");
    assert.ok(store.get("family-hub:recipe:state").length < beforeBytes, "store shrank after pruning");
    card.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-7 F4 (PRUNE2): a tombstoned pending for a gone id cleans the pending AND its tombstone", async () => {
  const seedState = {
    openId: null, step: null, listScrollY: 0, detailScrollY: 0,
    query: "", collectionId: "", sort: "name",
    pendingRatings: { "rec-gone": 3 },
    pendingRatingTombstones: { "rec-gone": [3] },
  };
  const store = stubSessionStorage({ "family-hub:recipe:state": JSON.stringify(seedState) });
  const nav = stubWindow(HUB_WINDOW);
  try {
    const card = new AnyListRecipeViewCard();
    card.setConfig({});
    card.hass = fakeHass();
    await sleep(150);
    const saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.pendingRatings, undefined, "pending for rec-gone cleaned");
    assert.equal(saved.pendingRatingTombstones, undefined, "tombstone for rec-gone pruned with the entry");
    card.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-7 verifier (b): a heal refreshes the note editor — typing afterwards edits the saved note, never the stale draft", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card: cardA, hass: hassA } = await loadedCard();
    const stubA = perRecipeUpdateStub(hassA);
    await openNotesTab(cardA);
    typeNote(cardA, "v1 text.");
    await sleep(200);
    let saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.deepEqual(saved.noteDrafts, { "rec-pasta": "v1 text." }, "debounce persisted v1");
    const hassB = fakeHass();
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = hassB;
    await sleep(150);
    await openNotesTab(cardB);
    assert.equal(cardB._noteDrafts.get("rec-pasta"), "v1 text.", "B restored v1");
    typeNote(cardA, "v2 text.");
    cardA.shadowRoot.dispatchClick(fakeTarget("save-note"));
    await waitFor(() => cardA._savingNote === false);
    assert.equal(stubA.server["rec-pasta"].note, "v2 text.", "server ends at v2");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.noteDrafts, undefined);
    assert.deepEqual(saved.noteDraftTombstones, { "rec-pasta": "v1 text." });
    // The heal: an ordinary write with NO explicit render (the
    // scroll-debounce shape). The fix re-renders from _saveSession,
    // so the editor must already show the saved note, not v1.
    const callsBefore = updateRecipeCalls(hassB).length;
    cardB._saveSession();
    assert.equal(cardB._noteDrafts.has("rec-pasta"), false, "memory healed");
    assert.doesNotMatch(cardB.shadowRoot.innerHTML, /v1 text\./, "editor no longer shows the stale v1 after the heal");
    const editor = cardB.shadowRoot.querySelector('[data-role="note"]');
    assert.equal(editor.value, cardB._selected.note, "editor shows the saved note");
    const saveBtn = cardB.shadowRoot.querySelector('[data-action="save-note"]');
    assert.equal(saveBtn.getAttribute("disabled"), "disabled", "Save disabled — nothing unsaved after the heal");
    // Now the cook types in the refreshed editor: the new draft is
    // based on the saved note, never on v1 — and saving it sends
    // that text, not v1-derived text.
    const edited = `${cardB._selected.note} edited`;
    typeNote(cardB, edited);
    cardB.shadowRoot.dispatchClick(fakeTarget("save-note"));
    await waitFor(() => cardB._savingNote === false);
    const callsAfter = updateRecipeCalls(hassB);
    assert.equal(callsAfter.length, callsBefore + 1, "exactly one save from the edited note");
    assert.equal(callsAfter[callsAfter.length - 1][2].note, edited, "saved text is the edited saved note");
    assert.doesNotMatch(callsAfter[callsAfter.length - 1][2].note, /v1 text\./, "saved text is not v1-derived");
    saved = JSON.parse(store.get("family-hub:recipe:state"));
    assert.equal(saved.noteDrafts, undefined, "store clean of drafts after the save");
    cardA.disconnectedCallback();
    cardB.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

// -- burst-8 (provenance, not alreadyKnown; deferred restore) ------------
//
// The burst-7 F1 guard ("already knew this value") shielded stale
// entries: it treated "knew" as proof of a genuine re-pend. Burst-8
// replaces it with provenance — a tombstone generation counter plus
// the entry's creation generation (see the card's constructor
// comment) — and defers the connectedCallback session restore until
// after the load's adoption, so no pre-adoption write can evict a
// tombstone. The tests below are the healed versions of the
// reviewers' defect demonstrations (verifier V7-3/V7-3b/V7-15b/V7-16,
// critic D7-1/D7-1b/D7-2/D7-3/D7-3b/D7-7b2): same scenarios, the
// shielding/clobber/race behaviour asserted GONE.

test("burst-8 V7-3 healed: a known value that became stale after creation is deleted on re-open — no re-publish, no clobber of a newer saved 5", async () => {
  const seedState = {
    openId: null, step: null, listScrollY: 0, detailScrollY: 0,
    query: "", collectionId: "", sort: "name",
    pendingRatingTombstones: { "rec-soup": [2] },
  };
  const store = stubSessionStorage({ "family-hub:recipe:state": JSON.stringify(seedState) });
  const nav = stubWindow(HUB_WINDOW);
  try {
    const cardB = new AnyListRecipeViewCard();
    const hassB = fakeHass();
    cardB.setConfig({});
    cardB.hass = hassB;
    await sleep(150);
    assert.deepEqual([...cardB._knownPendingRatingTombstones.get("rec-soup")], [2], "B adopted tombstone 2");
    const { card: cardC } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    cardC._saveRetryDelays = [10, 10];
    await openSoupNotesTab(cardC);
    cardC.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "2" }));
    await waitFor(() => cardC._ratingBusy === false);
    let saved = readStore(store);
    assert.deepEqual(saved.pendingRatings, { "rec-soup": 2 }, "C's failed 2 is pending");
    assert.equal(saved.pendingRatingTombstones, undefined, "C's live 2 evicted the tombstone");
    // B re-opens #1: restores C's pending 2 (genuine at this point).
    cardB.disconnectedCallback();
    cardB.connectedCallback();
    await sleep(250);
    assert.equal(cardB._pendingRatings.get("rec-soup"), 2, "B restored C's pending 2");
    // D saves 2: server 2, tombstone [2] lands, store clean.
    const cardD = new AnyListRecipeViewCard();
    const hassD = fakeHass();
    const stubD = perRecipeUpdateStub(hassD);
    cardD.setConfig({});
    cardD.hass = hassD;
    await sleep(150);
    await openSoupNotesTab(cardD);
    cardD.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "2" }));
    await waitFor(() => cardD._ratingBusy === false);
    assert.equal(stubD.server["rec-soup"].rating, 2, "server holds 2 after D's save");
    saved = readStore(store);
    assert.equal(saved.pendingRatings, undefined, "store clean after D's save");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2] }, "tombstone [2] landed");
    // B re-opens #2: the tombstone re-landed since B's entry was
    // restored, so adoption deletes it — no shield.
    cardB.disconnectedCallback();
    cardB.connectedCallback();
    await sleep(250);
    assert.equal(cardB._pendingRatings.get("rec-soup"), undefined, "HEALED: B's stale 2 deleted on re-open adoption");
    saved = readStore(store);
    assert.equal(saved.pendingRatings, undefined, "no re-publish after the reload");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2] }, "tombstone kept by the reload");
    cardB._saveSession();
    saved = readStore(store);
    assert.equal(saved.pendingRatings, undefined, "B's write re-publishes nothing");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2] }, "tombstone kept by B's write");
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._pendingRatings.get("rec-soup"), undefined, "fresh card restores no phantom");
    // E saves 5: the server moves on to 5. E never held a pending
    // for soup, so its save records tombstone 5 alongside the
    // carried 2 — [2,5], not [2] as on the shielded run, where
    // E's last-written value was B's re-published 2.
    const cardE = new AnyListRecipeViewCard();
    const hassE = fakeHass();
    cardE.setConfig({});
    cardE.hass = hassE;
    await sleep(150);
    const stubE = perRecipeUpdateStub(hassE);
    stubE.server["rec-soup"].rating = 2;
    await openSoupNotesTab(cardE);
    cardE.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "5" }));
    await waitFor(() => cardE._ratingBusy === false);
    assert.equal(stubE.server["rec-soup"].rating, 5, "server holds 5 after E's save");
    saved = readStore(store);
    assert.equal(saved.pendingRatings, undefined, "store clean after E's save");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2, 5] }, "tombstones [2,5] after E's save");
    assert.equal(cardB._pendingRatings.get("rec-soup"), undefined, "B's memory stays clean after E saved 5");
    // B writes again: still nothing to re-publish — and B offers
    // no retry for 2, so there is nothing that could clobber 5.
    cardB._saveSession();
    saved = readStore(store);
    assert.equal(saved.pendingRatings, undefined, "B's second write re-publishes nothing");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2, 5] }, "tombstones kept by B's second write");
    await openSoupNotesTab(cardB);
    assert.equal(cardB._pendingRating, null, "B offers no retry for the stale 2");
    assert.equal(cardB.shadowRoot.querySelector('[data-action="retry-rating"]'), null, "no retry button on B");
    assert.equal(stubE.server["rec-soup"].rating, 5, "server still holds 5 — no clobber");
    cardB.disconnectedCallback();
    cardC.disconnectedCallback();
    cardD.disconnectedCallback();
    cardE.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-8 V7-3b healed (isolated, no open recipe at re-open): alreadyKnown alone no longer shields B's stale 2", async () => {
  const seedState = {
    openId: null, step: null, listScrollY: 0, detailScrollY: 0,
    query: "", collectionId: "", sort: "name",
    pendingRatingTombstones: { "rec-soup": [2] },
  };
  const store = stubSessionStorage({ "family-hub:recipe:state": JSON.stringify(seedState) });
  const nav = stubWindow(HUB_WINDOW);
  try {
    const cardB = new AnyListRecipeViewCard();
    const hassB = fakeHass();
    cardB.setConfig({});
    cardB.hass = hassB;
    await sleep(150);
    assert.deepEqual([...cardB._knownPendingRatingTombstones.get("rec-soup")], [2], "B adopted tombstone 2");
    const { card: cardC } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    cardC._saveRetryDelays = [10, 10];
    await openSoupNotesTab(cardC);
    cardC.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "2" }));
    await waitFor(() => cardC._ratingBusy === false);
    let saved = readStore(store);
    assert.deepEqual(saved.pendingRatings, { "rec-soup": 2 }, "C's failed 2 is pending");
    assert.equal(saved.pendingRatingTombstones, undefined, "C's live 2 evicted the tombstone");
    cardC.shadowRoot.dispatchClick(fakeTarget("back"));
    await flush();
    saved = readStore(store);
    assert.equal(saved.openId, null, "precondition: list view before B re-open 1 (no race)");
    cardB.disconnectedCallback();
    cardB.connectedCallback();
    await sleep(250);
    assert.equal(cardB._pendingRatings.get("rec-soup"), 2, "B restored C's pending 2");
    const cardD = new AnyListRecipeViewCard();
    const hassD = fakeHass();
    const stubD = perRecipeUpdateStub(hassD);
    cardD.setConfig({});
    cardD.hass = hassD;
    await sleep(150);
    await openSoupNotesTab(cardD);
    cardD.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "2" }));
    await waitFor(() => cardD._ratingBusy === false);
    assert.equal(stubD.server["rec-soup"].rating, 2, "server holds 2 after D's save");
    saved = readStore(store);
    assert.equal(saved.pendingRatings, undefined, "store clean after D's save");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2] }, "tombstone [2] landed");
    cardD.shadowRoot.dispatchClick(fakeTarget("back"));
    await flush();
    saved = readStore(store);
    assert.equal(saved.openId, null, "precondition: list view before B re-open 2 (no race)");
    cardB.disconnectedCallback();
    cardB.connectedCallback();
    await sleep(250);
    saved = readStore(store);
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2] }, "no race: tombstone [2] still in store right after reload");
    assert.equal(saved.pendingRatings, undefined, "no race: no pending re-published yet");
    assert.equal(cardB._pendingRatings.get("rec-soup"), undefined, "HEALED: B's memory 2 deleted by adoption — the re-landed tombstone outranks the restored entry");
    cardB.disconnectedCallback();
    cardC.disconnectedCallback();
    cardD.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-8 V7-15b healed (notes, isolated): alreadyKnown alone no longer shields B's stale draft", async () => {
  const seedState = {
    openId: null, step: null, listScrollY: 0, detailScrollY: 0,
    query: "", collectionId: "", sort: "name",
    noteDraftTombstones: { "rec-soup": "simmer one." },
  };
  const store = stubSessionStorage({ "family-hub:recipe:state": JSON.stringify(seedState) });
  const nav = stubWindow(HUB_WINDOW);
  try {
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = fakeHass();
    await sleep(150);
    assert.equal(cardB._knownNoteDraftTombstones.get("rec-soup"), "simmer one.", "B adopted tombstone simmer one");
    const cardC = new AnyListRecipeViewCard();
    cardC.setConfig({});
    cardC.hass = fakeHass();
    await sleep(150);
    await openSoupNotesTab(cardC);
    typeNote(cardC, "simmer one.");
    await sleep(200);
    let saved = readStore(store);
    assert.deepEqual(saved.noteDrafts, { "rec-soup": "simmer one." }, "C's re-typed draft persisted");
    assert.equal(saved.noteDraftTombstones, undefined, "C's live draft evicted the tombstone");
    cardC.shadowRoot.dispatchClick(fakeTarget("back"));
    await flush();
    saved = readStore(store);
    assert.equal(saved.openId, null, "precondition: list view before B re-open 1 (no race)");
    cardB.disconnectedCallback();
    cardB.connectedCallback();
    await sleep(250);
    assert.equal(cardB._noteDrafts.get("rec-soup"), "simmer one.", "B restored C's draft");
    const cardD = new AnyListRecipeViewCard();
    const hassD = fakeHass();
    const stubD = perRecipeUpdateStub(hassD);
    cardD.setConfig({});
    cardD.hass = hassD;
    await sleep(150);
    await openSoupNotesTab(cardD);
    typeNote(cardD, "simmer one.");
    cardD.shadowRoot.dispatchClick(fakeTarget("save-note"));
    await waitFor(() => cardD._savingNote === false);
    assert.equal(stubD.server["rec-soup"].note, "simmer one.", "server holds simmer one after D's save");
    saved = readStore(store);
    assert.equal(saved.noteDrafts, undefined, "store clean of drafts after D's save");
    assert.deepEqual(saved.noteDraftTombstones, { "rec-soup": "simmer one." }, "tombstone simmer one landed");
    cardD.shadowRoot.dispatchClick(fakeTarget("back"));
    await flush();
    saved = readStore(store);
    assert.equal(saved.openId, null, "precondition: list view before B re-open 2 (no race)");
    cardB.disconnectedCallback();
    cardB.connectedCallback();
    await sleep(250);
    saved = readStore(store);
    assert.deepEqual(saved.noteDraftTombstones, { "rec-soup": "simmer one." }, "no race: tombstone still in store right after reload");
    assert.equal(saved.noteDrafts, undefined, "no race: no draft re-published yet");
    assert.equal(cardB._noteDrafts.get("rec-soup"), undefined, "HEALED: B's draft deleted by adoption — the re-landed tombstone outranks the restored draft");
    cardB.disconnectedCallback();
    cardC.disconnectedCallback();
    cardD.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-8 V7-16 healed (pre-adoption race): with a recipe left open, the re-open write no longer evicts the tombstone before adoption runs", async () => {
  const seedState = {
    openId: null, step: null, listScrollY: 0, detailScrollY: 0,
    query: "", collectionId: "", sort: "name",
    pendingRatingTombstones: { "rec-soup": [2] },
  };
  const store = stubSessionStorage({ "family-hub:recipe:state": JSON.stringify(seedState) });
  const nav = stubWindow(HUB_WINDOW);
  try {
    const cardB = new AnyListRecipeViewCard();
    const hassB = fakeHass();
    cardB.setConfig({});
    cardB.hass = hassB;
    await sleep(150);
    assert.deepEqual([...cardB._knownPendingRatingTombstones.get("rec-soup")], [2], "B adopted tombstone 2");
    const { card: cardC } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    cardC._saveRetryDelays = [10, 10];
    await openSoupNotesTab(cardC);
    cardC.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "2" }));
    await waitFor(() => cardC._ratingBusy === false);
    cardB.disconnectedCallback();
    cardB.connectedCallback();
    await sleep(250);
    assert.equal(cardB._pendingRatings.get("rec-soup"), 2, "B restored C's pending 2");
    const cardD = new AnyListRecipeViewCard();
    const hassD = fakeHass();
    const stubD = perRecipeUpdateStub(hassD);
    cardD.setConfig({});
    cardD.hass = hassD;
    await sleep(150);
    await openSoupNotesTab(cardD);
    cardD.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "2" }));
    await waitFor(() => cardD._ratingBusy === false);
    assert.equal(stubD.server["rec-soup"].rating, 2, "server holds 2 after D's save");
    let saved = readStore(store);
    assert.equal(saved.pendingRatings, undefined, "store clean after D's save");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2] }, "tombstone [2] landed");
    assert.equal(saved.openId, "rec-soup", "precondition: a recipe is LEFT OPEN (D never went back)");
    // B re-attaches with the recipe left open: the restore is
    // deferred until after the load's adoption, so the tombstone
    // survives to adoption and the stale entry is healed there —
    // the store is clean immediately after the reload, before any
    // explicit write.
    cardB.disconnectedCallback();
    cardB.connectedCallback();
    await sleep(250);
    saved = readStore(store);
    assert.equal(saved.pendingRatings, undefined, "HEALED: no pending re-published right after reload");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2] }, "HEALED: the tombstone survived the re-open — no pre-adoption write evicted it");
    assert.equal(cardB._pendingRatings.get("rec-soup"), undefined, "HEALED: B's stale 2 is gone after the reload");
    cardB.disconnectedCallback();
    cardC.disconnectedCallback();
    cardD.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-8 D7-1 healed: a re-pend that became stale after creation is dropped on the next ordinary write — no phantom pending, tombstone intact", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    // X saves soup 4 -> tombstone [4].
    const { card: cardX, hass: hassX } = await loadedCard();
    perRecipeUpdateStub(hassX);
    await openSoupNotesTab(cardX);
    cardX.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
    await waitFor(() => cardX._ratingBusy === false);
    let saved = readStore(store);
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [4] }, "tombstone [4] landed");
    // B loads -> knows 4.
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = fakeHass();
    await sleep(150);
    assert.deepEqual([...cardB._knownPendingRatingTombstones.get("rec-soup")], [4], "B adopted tombstone 4");
    // Y saves soup 2 -> server 2, tombstone [2, 4].
    const { card: cardY, hass: hassY } = await loadedCard();
    perRecipeUpdateStub(hassY);
    await openSoupNotesTab(cardY);
    cardY.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "2" }));
    await waitFor(() => cardY._ratingBusy === false);
    saved = readStore(store);
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2, 4] }, "tombstone [2,4] after Y saves 2 (set is sorted)");
    // B re-rates 4 (genuine: the server is 2) and fails.
    await openSoupNotesTab(cardB);
    cardB._hass = fakeHass({ fail: { update_recipe: "AnyList is down" } });
    cardB._saveRetryDelays = [10, 10];
    cardB.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
    await waitFor(() => cardB._ratingBusy === false);
    assert.equal(cardB._pendingRatings.get("rec-soup"), 4, "B holds its genuine failed 4");
    saved = readStore(store);
    assert.deepEqual(saved.pendingRatings, { "rec-soup": 4 }, "B's failed 4 is pending in the store");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2] }, "tombstone 4 evicted by B's live 4");
    // A loads, restores the pending 4, retries it successfully.
    const cardA = new AnyListRecipeViewCard();
    const hassA = fakeHass();
    cardA.setConfig({});
    cardA.hass = hassA;
    await sleep(150);
    assert.equal(cardA._pendingRatings.get("rec-soup"), 4, "A restored the pending 4");
    await openSoupNotesTab(cardA);
    perRecipeUpdateStub(hassA);
    cardA.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => cardA._ratingBusy === false);
    saved = readStore(store);
    assert.equal(saved.pendingRatings, undefined, "store pending clean after A's retry");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2, 4] }, "tombstone [2,4] after A's retry");
    assert.equal(cardB._pendingRatings.get("rec-soup"), 4, "B still holds 4 in memory — now stale (server is 4)");
    // B's next ordinary write: the re-landed tombstone 4 outranks
    // the entry created before it landed — B is healed, not shielded.
    cardB._saveSession();
    assert.equal(cardB._pendingRatings.get("rec-soup"), undefined, "HEALED: B memory clean after write — stale 4 dropped");
    saved = readStore(store);
    assert.equal(saved.pendingRatings, undefined, "HEALED: B re-published nothing");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2, 4] }, "HEALED: tombstones [2,4] kept — the re-publish did not evict 4");
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._pendingRatings.get("rec-soup"), undefined, "HEALED: fresh card restores no phantom");
    await openSoupNotesTab(fresh);
    assert.equal(fresh.shadowRoot.querySelector('[data-action="retry-rating"]'), null, "HEALED: fresh card offers no retry for the already-saved 4");
    cardX.disconnectedCallback();
    cardY.disconnectedCallback();
    cardB.disconnectedCallback();
    cardA.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-8 D7-1b healed: a re-attach after the value was saved elsewhere deletes the stale entry at adoption", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card: cardX, hass: hassX } = await loadedCard();
    perRecipeUpdateStub(hassX);
    await openSoupNotesTab(cardX);
    cardX.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
    await waitFor(() => cardX._ratingBusy === false);
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = fakeHass();
    await sleep(150);
    assert.deepEqual([...cardB._knownPendingRatingTombstones.get("rec-soup")], [4], "B adopted tombstone 4");
    const { card: cardY, hass: hassY } = await loadedCard();
    perRecipeUpdateStub(hassY);
    await openSoupNotesTab(cardY);
    cardY.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "2" }));
    await waitFor(() => cardY._ratingBusy === false);
    await openSoupNotesTab(cardB);
    cardB._hass = fakeHass({ fail: { update_recipe: "AnyList is down" } });
    cardB._saveRetryDelays = [10, 10];
    cardB.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "4" }));
    await waitFor(() => cardB._ratingBusy === false);
    const cardA = new AnyListRecipeViewCard();
    const hassA = fakeHass();
    cardA.setConfig({});
    cardA.hass = hassA;
    await sleep(150);
    await openSoupNotesTab(cardA);
    perRecipeUpdateStub(hassA);
    cardA.shadowRoot.dispatchClick(fakeTarget("retry-rating"));
    await waitFor(() => cardA._ratingBusy === false);
    let saved = readStore(store);
    assert.equal(saved.pendingRatings, undefined, "store pending clean after A's retry");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2, 4] }, "tombstone [2,4] after A's retry");
    assert.equal(cardB._pendingRatings.get("rec-soup"), 4, "B still holds 4 — now stale");
    // B re-attaches: adoption runs before any restore write, sees
    // the re-landed tombstone 4, and deletes the stale entry.
    cardB.disconnectedCallback();
    cardB.connectedCallback();
    await sleep(250);
    assert.equal(cardB._pendingRatings.get("rec-soup"), undefined, "HEALED: B memory clean after re-attach reload — adoption deleted the stale 4");
    cardB._saveSession();
    saved = readStore(store);
    assert.equal(saved.pendingRatings, undefined, "HEALED: B re-published nothing");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2, 4] }, "HEALED: tombstones [2,4] kept");
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._pendingRatings.get("rec-soup"), undefined, "HEALED: fresh card restores no phantom");
    await openSoupNotesTab(fresh);
    assert.equal(fresh.shadowRoot.querySelector('[data-action="retry-rating"]'), null, "HEALED: fresh card offers no retry for the already-saved 4");
    cardX.disconnectedCallback();
    cardY.disconnectedCallback();
    cardB.disconnectedCallback();
    cardA.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-8 D7-2 healed (notes): a re-typed note that became stale after creation is dropped on the next ordinary write", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card: cardX, hass: hassX } = await loadedCard();
    const stubX = perRecipeUpdateStub(hassX);
    await openRiceNotesTab(cardX);
    typeNote(cardX, "q1.");
    await sleep(200);
    let saved = readStore(store);
    assert.deepEqual(saved.noteDrafts, { "rec-rice": "q1." }, "debounce persisted q1");
    typeNote(cardX, "q2.");
    cardX.shadowRoot.dispatchClick(fakeTarget("save-note"));
    await waitFor(() => cardX._savingNote === false);
    assert.equal(stubX.server["rec-rice"].note, "q2.", "server ends at q2");
    saved = readStore(store);
    assert.equal(saved.noteDrafts, undefined, "store clean of drafts after X save");
    assert.deepEqual(saved.noteDraftTombstones, { "rec-rice": "q1." }, "tombstone q1 in store");
    // B loads -> knows q1.
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = fakeHass();
    await sleep(150);
    assert.equal(cardB._knownNoteDraftTombstones.get("rec-rice"), "q1.", "B adopted tombstone q1");
    // B re-types q1 (genuine: the cook wants the old text back).
    await openRiceNotesTab(cardB);
    typeNote(cardB, "q1.");
    await sleep(200);
    assert.equal(cardB._noteDrafts.get("rec-rice"), "q1.", "B holds its re-typed q1");
    saved = readStore(store);
    assert.deepEqual(saved.noteDrafts, { "rec-rice": "q1." }, "B's re-typed q1 reached the store");
    assert.equal(saved.noteDraftTombstones, undefined, "tombstone q1 evicted by B's live q1");
    // D loads, restores B's draft q1, saves it as-is -> server q1.
    const cardD = new AnyListRecipeViewCard();
    const hassD = fakeHass();
    cardD.setConfig({});
    cardD.hass = hassD;
    await sleep(150);
    assert.equal(cardD._noteDrafts.get("rec-rice"), "q1.", "D restored the draft q1");
    await openRiceNotesTab(cardD);
    perRecipeUpdateStub(hassD);
    cardD.shadowRoot.dispatchClick(fakeTarget("save-note"));
    await waitFor(() => cardD._savingNote === false);
    saved = readStore(store);
    assert.deepEqual(saved.noteDraftTombstones, { "rec-rice": "q1." }, "tombstone q1 landed again after D's save");
    assert.equal(cardB._noteDrafts.get("rec-rice"), "q1.", "B still holds q1 in memory — now stale (server is q1)");
    // B's next ordinary write: the re-landed tombstone outranks it.
    cardB._saveSession();
    assert.equal(cardB._noteDrafts.get("rec-rice"), undefined, "HEALED: B memory clean after write — stale q1 dropped");
    saved = readStore(store);
    assert.equal(saved.noteDrafts, undefined, "HEALED: B re-published nothing");
    assert.deepEqual(saved.noteDraftTombstones, { "rec-rice": "q1." }, "HEALED: tombstone q1 kept");
    const fresh = new AnyListRecipeViewCard();
    fresh.setConfig({});
    fresh.hass = fakeHass();
    await sleep(150);
    assert.equal(fresh._noteDrafts.get("rec-rice"), undefined, "HEALED: fresh card restores no phantom draft");
    cardX.disconnectedCallback();
    cardB.disconnectedCallback();
    cardD.disconnectedCallback();
    fresh.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-8 D7-3 healed: a fresh re-rate of an already-saved value on a card that never learned the tombstone is kept as pending, with its retry", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    // C loads first (empty store, knows nothing).
    const { card: cardC } = await loadedCard();
    // X saves soup 5, Y saves soup 2 -> server 2, tombstone [2,5].
    const { card: cardX, hass: hassX } = await loadedCard();
    perRecipeUpdateStub(hassX);
    await openSoupNotesTab(cardX);
    cardX.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "5" }));
    await waitFor(() => cardX._ratingBusy === false);
    const { card: cardY, hass: hassY } = await loadedCard();
    perRecipeUpdateStub(hassY);
    await openSoupNotesTab(cardY);
    cardY.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "2" }));
    await waitFor(() => cardY._ratingBusy === false);
    let saved = readStore(store);
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2, 5] }, "tombstone [2,5] landed (set is sorted)");
    // C (live since before the tombstones, never learned them)
    // re-rates 5 and fails. The tap is a fresh local action newer
    // than the card's knowledge, so the merge keeps it — the save
    // did try (3 attempts), and the cook's tap must not vanish.
    await openSoupNotesTab(cardC);
    cardC._hass = fakeHass({ fail: { update_recipe: "AnyList is down" } });
    cardC._saveRetryDelays = [10, 10];
    const attemptsBefore = cardC._hass.calls.filter((c) => c[1] === "update_recipe").length;
    cardC.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "5" }));
    await waitFor(() => cardC._ratingBusy === false);
    const attempts = cardC._hass.calls.filter((c) => c[1] === "update_recipe").length - attemptsBefore;
    assert.equal(attempts, 3, "the save did try: initial + 2 backoff retries");
    assert.equal(cardC._pendingRatings.get("rec-soup"), 5, "HEALED: C memory keeps the fresh 5 as pending");
    assert.ok(cardC._ratingStatus && cardC._ratingStatus.retry === "retry-rating", "HEALED: the tappable retry is offered");
    assert.ok(cardC.shadowRoot.querySelector('[data-action="retry-rating"]'), "HEALED: retry button present after the failed tap");
    saved = readStore(store);
    assert.deepEqual(saved.pendingRatings, { "rec-soup": 5 }, "HEALED: store holds the fresh pending 5");
    cardC.disconnectedCallback();
    cardX.disconnectedCallback();
    cardY.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-8 D7-3b healed: typing the exact tombstoned text on a card that never learned it survives the debounce write — editor and memory keep it", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    // C loads first (empty store, knows nothing).
    const { card: cardC } = await loadedCard();
    // X types w1, saves w2 -> tombstone w1.
    const { card: cardX, hass: hassX } = await loadedCard();
    perRecipeUpdateStub(hassX);
    await openRiceNotesTab(cardX);
    typeNote(cardX, "w1.");
    await sleep(200);
    typeNote(cardX, "w2.");
    cardX.shadowRoot.dispatchClick(fakeTarget("save-note"));
    await waitFor(() => cardX._savingNote === false);
    let saved = readStore(store);
    assert.deepEqual(saved.noteDraftTombstones, { "rec-rice": "w1." }, "tombstone w1 landed");
    // C opens rice and types exactly w1 (fresh text, never learned
    // the tombstone). The debounce write must keep it, not heal it
    // away — and the heal re-render must not wipe the editor.
    await openRiceNotesTab(cardC);
    typeNote(cardC, "w1.");
    assert.equal(cardC._noteDrafts.get("rec-rice"), "w1.", "typed w1 is the draft right after typing");
    await sleep(300);
    assert.equal(cardC._noteDrafts.get("rec-rice"), "w1.", "HEALED: C memory keeps the typed w1 after the debounce write");
    const editor = cardC.shadowRoot.querySelector('[data-role="note"]');
    assert.equal(editor ? editor.value : null, "w1.", "HEALED: the editor still shows the typed w1 — no heal wipe");
    saved = readStore(store);
    assert.deepEqual(saved.noteDrafts, { "rec-rice": "w1." }, "HEALED: store holds the typed draft w1");
    cardC.disconnectedCallback();
    cardX.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-8 D7-7b2 healed: re-typing the exact tombstoned text and letting a write fire keeps it in memory and in the editor", async () => {
  const store = stubSessionStorage();
  const nav = stubWindow(HUB_WINDOW);
  try {
    const { card: cardA, hass: hassA } = await loadedCard();
    perRecipeUpdateStub(hassA);
    await openNotesTab(cardA);
    typeNote(cardA, "v1 text.");
    await sleep(200);
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = fakeHass();
    await sleep(150);
    await openNotesTab(cardB);
    assert.equal(cardB._noteDrafts.get("rec-pasta"), "v1 text.", "B restored v1");
    typeNote(cardA, "v2 text.");
    cardA.shadowRoot.dispatchClick(fakeTarget("save-note"));
    await waitFor(() => cardA._savingNote === false);
    // B fiddles with the stale draft, then puts it back to exactly v1.
    typeNote(cardB, "v1 text. plus more");
    typeNote(cardB, "v1 text.");
    assert.equal(cardB._noteDrafts.get("rec-pasta"), "v1 text.", "draft is back to exactly v1 before the write");
    cardB._saveSession();
    assert.equal(cardB._noteDrafts.get("rec-pasta"), "v1 text.", "HEALED: B memory keeps the re-typed v1 after the write");
    const editorAfter = cardB.shadowRoot.querySelector('[data-role="note"]');
    assert.equal(editorAfter ? editorAfter.value : null, "v1 text.", "HEALED: the editor still shows the re-typed v1 — no heal wipe");
    cardA.disconnectedCallback();
    cardB.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

test("burst-8 race isolation: re-attaching with a recipe left open writes NOTHING to the store until the load's adoption runs", async () => {
  const seedState = {
    openId: null, step: null, listScrollY: 0, detailScrollY: 0,
    query: "", collectionId: "", sort: "name",
    pendingRatingTombstones: { "rec-soup": [2] },
  };
  const store = stubSessionStorage({ "family-hub:recipe:state": JSON.stringify(seedState) });
  const nav = stubWindow(HUB_WINDOW);
  try {
    const cardB = new AnyListRecipeViewCard();
    cardB.setConfig({});
    cardB.hass = fakeHass();
    await sleep(150);
    const { card: cardC } = await loadedCard({ fail: { update_recipe: "AnyList is down" } });
    cardC._saveRetryDelays = [10, 10];
    await openSoupNotesTab(cardC);
    cardC.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "2" }));
    await waitFor(() => cardC._ratingBusy === false);
    cardB.disconnectedCallback();
    cardB.connectedCallback();
    await sleep(250);
    assert.equal(cardB._pendingRatings.get("rec-soup"), 2, "B restored C's pending 2");
    const cardD = new AnyListRecipeViewCard();
    const hassD = fakeHass();
    const stubD = perRecipeUpdateStub(hassD);
    cardD.setConfig({});
    cardD.hass = hassD;
    await sleep(150);
    await openSoupNotesTab(cardD);
    cardD.shadowRoot.dispatchClick(fakeTarget("rate", { rating: "2" }));
    await waitFor(() => cardD._ratingBusy === false);
    assert.equal(stubD.server["rec-soup"].rating, 2, "server holds 2 after D's save");
    let saved = readStore(store);
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2] }, "tombstone [2] landed");
    assert.equal(saved.openId, "rec-soup", "precondition: a recipe is LEFT OPEN (D never went back)");
    assert.equal(cardB._pendingRatings.get("rec-soup"), 2, "B still holds 2 — now stale");
    // The re-attach itself must not write: connectedCallback returns
    // with the load still in flight, and the restore is deferred
    // until adoption. Two signals, read synchronously — no await —
    // so any synchronous pre-adoption write would already show:
    // (a) the store is byte-identical, and (b) sessionStorage saw
    // zero writes. (b) is the sharper one: a pre-adoption write
    // that merely rewrites identical bytes still counts as a
    // write, and the merge's drop rule can mask (a) by healing
    // the entry before the bytes are compared.
    cardB.disconnectedCallback();
    const beforeReattach = store.get("family-hub:recipe:state");
    const realSetItem = globalThis.sessionStorage.setItem;
    let syncWrites = 0;
    globalThis.sessionStorage.setItem = (...args) => {
      syncWrites++;
      return realSetItem(...args);
    };
    try {
      cardB.connectedCallback();
    } finally {
      globalThis.sessionStorage.setItem = realSetItem;
    }
    assert.equal(
      syncWrites,
      0,
      "ISOLATION: connectedCallback performed zero session-store writes synchronously — the restore waits for the load's adoption"
    );
    assert.equal(
      store.get("family-hub:recipe:state"),
      beforeReattach,
      "ISOLATION: the store is byte-identical immediately after connectedCallback returns — no synchronous pre-adoption write"
    );
    // And once the load lands, adoption heals the entry.
    await sleep(250);
    assert.equal(cardB._pendingRatings.get("rec-soup"), undefined, "B's stale 2 is gone after the load's adoption");
    saved = readStore(store);
    assert.equal(saved.pendingRatings, undefined, "no re-publish after the reload");
    assert.deepEqual(saved.pendingRatingTombstones, { "rec-soup": [2] }, "tombstone kept");
    cardB.disconnectedCallback();
    cardC.disconnectedCallback();
    cardD.disconnectedCallback();
  } finally {
    clearWindow();
    clearSessionStorage();
  }
});

// -- Screensaver mount (§7.5, RB-R4-1) ---------------------------------------
//
// The shared singleton's refcount is file-global (one core module per
// test file), so these tests read the count before and after instead
// of assuming it starts at zero.

test("Screensaver mount: connect attaches, hass pushes update without touching the refcount, disconnect detaches", async () => {
  injectCore();
  try {
    const before = core.screensaver.getRefcount();
    const { card } = await loadedCard();
    card.connectedCallback();
    assert.equal(core.screensaver.getRefcount(), before + 1);
    // Every hass push feeds the controller + the PIP Host; the
    // refcount is mount-scoped and never moves on a push.
    card.hass = fakeHass();
    card.hass = fakeHass();
    assert.equal(core.screensaver.getRefcount(), before + 1);
    card.disconnectedCallback();
    assert.equal(core.screensaver.getRefcount(), before);
  } finally {
    resetCore();
  }
});

test("Screensaver mount: two cards mounted at once attach twice; each detach decrements", async () => {
  injectCore();
  try {
    const before = core.screensaver.getRefcount();
    const first = await loadedCard();
    const second = await loadedCard();
    first.card.connectedCallback();
    second.card.connectedCallback();
    assert.equal(core.screensaver.getRefcount(), before + 2);
    first.card.disconnectedCallback();
    assert.equal(core.screensaver.getRefcount(), before + 1);
    second.card.disconnectedCallback();
    assert.equal(core.screensaver.getRefcount(), before);
  } finally {
    resetCore();
  }
});

test("Screensaver mount: attach is once per instance even when core loads after connect", async () => {
  resetCore();
  try {
    const before = core.screensaver.getRefcount();
    const { card } = await loadedCard();
    card.connectedCallback();
    assert.equal(core.screensaver.getRefcount(), before);
    // Core loads: the re-apply attaches the live card once.
    injectCore();
    assert.equal(core.screensaver.getRefcount(), before + 1);
    // A second connect-side attach attempt is a no-op (the flag).
    card._screensaverAttach();
    assert.equal(core.screensaver.getRefcount(), before + 1);
    card.disconnectedCallback();
    assert.equal(core.screensaver.getRefcount(), before);
  } finally {
    resetCore();
  }
});
