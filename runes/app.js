import { RUNES, RUNE_LAYOUT, RUNEWORDS, RUNEWORD_TIERS, BUILDS, CLASSES, SLOTS } from "./data.js";
import { GLYPHS } from "./glyphs.js";

const TIERS = Object.keys(RUNEWORD_TIERS);
const DEFAULT_TIERS = ["S", "A", "B", "C"];
const STORAGE_KEY = "d2tools.runes.v1";
const CLASS_NAME = Object.fromEntries(CLASSES);
const SLOT_NAME = Object.fromEntries(SLOTS);
const RUNE_BY_NAME = new Map(RUNES.map((r) => [r.name.toLowerCase(), r]));

const tierOf = new Map();
for (const [tier, names] of Object.entries(RUNEWORD_TIERS)) {
  for (const name of names) tierOf.set(name, tier);
}

// runeword name -> [{ build, merc }]
const usage = new Map(RUNEWORDS.map((rw) => [rw.name, []]));
for (const build of BUILDS) {
  for (const name of build.uses) usage.get(name).push({ build, merc: false });
  for (const name of build.merc) usage.get(name).push({ build, merc: true });
}

// ---- State ------------------------------------------------------------------

const state = {
  selected: new Set(),
  slots: new Set(),          // empty = all slots
  tiers: new Set(DEFAULT_TIERS),
  cls: "any",
  match: "0",
  sort: "tier",
  q: "",
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved) {
      state.selected = new Set(saved.selected || []);
      state.slots = new Set(saved.slots || []);
      if (Array.isArray(saved.tiers)) state.tiers = new Set(saved.tiers);
      state.cls = saved.cls || state.cls;
      state.match = saved.match || state.match;
      state.sort = saved.sort || state.sort;
    }
  } catch { /* storage unavailable */ }

  const fromHash = new URLSearchParams(location.hash.slice(1)).get("runes");
  if (fromHash !== null) {
    state.selected = new Set(
      fromHash.split(",").map((n) => RUNE_BY_NAME.get(n.trim().toLowerCase())?.name).filter(Boolean),
    );
  }
  // Drop anything no longer valid.
  state.selected = new Set([...state.selected].filter((n) => RUNE_BY_NAME.has(n.toLowerCase())));
  if (!CLASS_NAME[state.cls]) state.cls = "any";
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      selected: [...state.selected],
      slots: [...state.slots],
      tiers: [...state.tiers],
      cls: state.cls,
      match: state.match,
      sort: state.sort,
    }));
  } catch { /* storage unavailable */ }

  const ordered = RUNES.filter((r) => state.selected.has(r.name)).map((r) => r.name);
  const hash = ordered.length ? `#runes=${ordered.join(",")}` : "";
  history.replaceState(null, "", location.pathname + location.search + hash);
}

// ---- Rune stash -------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

function addGlyphDefs() {
  const defs = document.getElementById("rune-defs");
  for (const [name, d] of Object.entries(GLYPHS)) {
    const path = document.createElementNS(SVG_NS, "path");
    path.id = `glyph-${name}`;
    path.setAttribute("d", d);
    defs.append(path);
  }
}

function stoneSvg(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 46 46");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `
    <use href="#stone" class="st st-dim" fill="url(#stone-dim)"/>
    <use href="#stone" class="st st-lit" fill="url(#stone-lit)"/>
    <use href="#stone" class="st-tex" filter="url(#stone-noise)"/>
    <use href="#glyph-${name}" class="gl-hi" transform="translate(.45 .6)"/>
    <use href="#glyph-${name}" class="gl"/>`;
  return svg;
}

function renderStash() {
  addGlyphDefs();
  const grid = document.getElementById("rune-grid");
  RUNE_LAYOUT.forEach((row, r) => row.forEach((name, c) => {
    if (!name) return;
    const rune = RUNE_BY_NAME.get(name.toLowerCase());
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rune";
    btn.style.gridArea = `${r + 1} / ${c + 1}`;
    btn.dataset.rune = rune.name;
    btn.setAttribute("aria-label", `${rune.name} Rune`);
    btn.append(stoneSvg(rune.name));
    grid.append(btn);
  }));
  syncStash();

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".rune");
    if (!btn) return;
    const name = btn.dataset.rune;
    if (state.selected.has(name)) state.selected.delete(name);
    else state.selected.add(name);
    syncStash();
    update();
  });

  // In-game style tooltip
  const tip = document.getElementById("rune-tip");
  const show = (btn) => {
    const rune = RUNE_BY_NAME.get(btn.dataset.rune.toLowerCase());
    tip.innerHTML = `<div class="n">${rune.name} Rune</div><div class="l">Required Level: ${rune.level}</div>`;
    const r = btn.getBoundingClientRect();
    tip.style.left = `${r.left + r.width / 2}px`;
    tip.style.top = `${r.top - 6}px`;
    tip.hidden = false;
  };
  const hide = () => { tip.hidden = true; };
  grid.addEventListener("pointerover", (e) => { const b = e.target.closest(".rune"); if (b) show(b); });
  grid.addEventListener("pointerout", (e) => { if (e.target.closest(".rune")) hide(); });
  grid.addEventListener("focusin", (e) => { const b = e.target.closest(".rune"); if (b) show(b); });
  grid.addEventListener("focusout", hide);
  window.addEventListener("scroll", hide, { passive: true });

  renderCube(null);
}

function syncStash() {
  for (const btn of document.querySelectorAll(".rune")) {
    const lit = state.selected.has(btn.dataset.rune);
    btn.classList.toggle("lit", lit);
    btn.setAttribute("aria-pressed", String(lit));
  }
}

// ---- Horadric Cube preview ----------------------------------------------------

let pinned = null;

function renderCube(rw) {
  const cube = document.getElementById("cube");
  const cells = [];
  for (let i = 0; i < 12; i++) {
    const cell = document.createElement("div");
    cell.className = "cube-cell";
    const name = rw?.runes[i];
    if (name) {
      const svg = stoneSvg(name);
      if (state.selected.has(name)) svg.classList.add("lit");
      cell.append(svg);
      cell.title = `${name} Rune`;
    }
    cells.push(cell);
  }
  cube.replaceChildren(...cells);
}

function setupCubePreview() {
  const results = document.getElementById("results");
  const byName = new Map(RUNEWORDS.map((rw) => [rw.name, rw]));
  const tileFor = (e) => e.target.closest(".tile");
  const markPinned = () => {
    for (const t of results.querySelectorAll(".tile")) {
      t.classList.toggle("previewed", t.dataset.name === pinned);
    }
  };
  results.addEventListener("pointerover", (e) => {
    const t = tileFor(e);
    if (t) renderCube(byName.get(t.dataset.name));
  });
  results.addEventListener("pointerleave", () => renderCube(byName.get(pinned) || null));
  results.addEventListener("click", (e) => {
    const t = tileFor(e);
    if (!t) return;
    pinned = pinned === t.dataset.name ? null : t.dataset.name;
    renderCube(byName.get(pinned) || byName.get(t.dataset.name));
    markPinned();
  });
  return markPinned;
}

// ---- Filters ----------------------------------------------------------------

function chip(label, pressed, onToggle, className = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `chip ${className}`.trim();
  b.innerHTML = label;
  b.setAttribute("aria-pressed", String(pressed));
  b.addEventListener("click", () => {
    onToggle();
    update();
  });
  return b;
}

function renderFilters() {
  const slotChips = document.getElementById("slot-chips");
  slotChips.replaceChildren(
    chip("All", state.slots.size === 0, () => state.slots.clear()),
    ...SLOTS.map(([key, label]) => chip(label, state.slots.has(key), () => {
      if (state.slots.has(key)) state.slots.delete(key);
      else state.slots.add(key);
      if (state.slots.size === SLOTS.length) state.slots.clear();
    })),
  );

  const tierChips = document.getElementById("tier-chips");
  tierChips.replaceChildren(...TIERS.map((t) =>
    chip(`<span class="tier-letter tier-${t}">${t}</span>`, state.tiers.has(t), () => {
      if (state.tiers.has(t)) state.tiers.delete(t);
      else state.tiers.add(t);
    }),
  ));

  const note = [];
  const hidden = TIERS.filter((t) => !state.tiers.has(t));
  if (hidden.length) note.push(`Hiding tier ${hidden.join(", ")} runewords.`);
  if (state.cls !== "any") {
    note.push(state.cls === "merc"
      ? "Showing runewords maxroll build guides put on the mercenary."
      : `Showing runewords used by maxroll ${CLASS_NAME[state.cls]} builds.`);
  }
  document.getElementById("filter-note").textContent = note.join(" ");
}

function setupControls() {
  const classSelect = document.getElementById("class-select");
  classSelect.replaceChildren(
    new Option("Any class", "any"),
    ...CLASSES.map(([key, label]) => new Option(label, key)),
  );

  const bind = (id, key) => {
    const el = document.getElementById(id);
    el.value = state[key];
    el.addEventListener("input", () => {
      state[key] = el.value;
      update();
    });
  };
  bind("class-select", "cls");
  bind("match-select", "match");
  bind("sort-select", "sort");
  bind("search", "q");

  document.querySelector(".stash-actions").addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "all") state.selected = new Set(RUNES.map((r) => r.name));
    if (action === "clear") state.selected.clear();
    if (action) {
      syncStash();
      update();
    }
  });
}

// ---- Results ----------------------------------------------------------------

function missingRunes(rw) {
  return [...new Set(rw.runes)].filter((r) => !state.selected.has(r));
}

function relevantUsage(rw) {
  const all = usage.get(rw.name);
  if (state.cls === "any") return all;
  if (state.cls === "merc") return all.filter((u) => u.merc);
  return all.filter((u) => !u.merc && u.build.cls === state.cls);
}

function matches(rw) {
  if (!state.tiers.has(tierOf.get(rw.name))) return false;
  if (state.cls !== "any" && relevantUsage(rw).length === 0) return false;

  if (state.match !== "all") {
    if (state.selected.size === 0) return false;
    if (missingRunes(rw).length > Number(state.match)) return false;
  }

  const q = state.q.trim().toLowerCase();
  if (q) {
    const haystack = [rw.name, ...rw.bases, ...rw.stats, ...rw.runes].join(" ").toLowerCase();
    if (!q.split(/\s+/).every((word) => haystack.includes(word))) return false;
  }
  return true;
}

function compare(a, b) {
  if (state.sort === "name") return a.name.localeCompare(b.name);
  if (state.sort === "level") return a.level - b.level || a.name.localeCompare(b.name);
  return TIERS.indexOf(tierOf.get(a.name)) - TIERS.indexOf(tierOf.get(b.name))
    || relevantUsage(b).length - relevantUsage(a).length
    || a.name.localeCompare(b.name);
}

function usageChips(rw) {
  const uses = relevantUsage(rw);
  const chips = [];

  if (state.cls === "any") {
    const counts = new Map();
    for (const u of uses) {
      const key = u.merc ? "merc" : u.build.cls;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const [key] of CLASSES) {
      if (!counts.has(key)) continue;
      const builds = uses
        .filter((u) => (u.merc ? "merc" : u.build.cls) === key)
        .map((u) => `${u.build.name} ${CLASS_NAME[u.build.cls]} (${u.build.tier})`);
      chips.push({ html: `${CLASS_NAME[key]} <b>×${counts.get(key)}</b>`, title: builds.join("\n") });
    }
  } else {
    const byTier = [...uses].sort((a, b) => TIERS.indexOf(a.build.tier) - TIERS.indexOf(b.build.tier));
    for (const u of byTier) {
      const label = state.cls === "merc"
        ? `${u.build.name} ${CLASS_NAME[u.build.cls]}`
        : u.build.name;
      chips.push({
        html: `${label} <b class="tier-${u.build.tier}">${u.build.tier}</b>`,
        title: `${u.build.name} ${CLASS_NAME[u.build.cls]} – ${u.build.tier} tier build`,
      });
    }
  }
  return chips;
}

function tile(rw) {
  const tier = tierOf.get(rw.name);
  const missing = missingRunes(rw);
  const el = document.createElement("article");
  el.className = "tile" + (missing.length && state.selected.size ? " partial" : "");
  el.dataset.name = rw.name;

  const runes = rw.runes
    .map((r) => (missing.includes(r) && state.selected.size ? `<span class="missing">${r}</span>` : r))
    .join("");

  el.innerHTML = `
    <span class="tier-badge tier-${tier}" title="maxroll tier ${tier}">${tier}</span>
    <div class="tile-name">${rw.name}</div>
    <div class="tile-bases">${rw.runes.length} Socket ${rw.bases.join(" / ")}</div>
    <div class="tile-runes">'${runes}'</div>
    <div class="tile-level">Required Level: ${rw.level}</div>
    <ul class="tile-stats">${rw.stats.map((s) => `<li>${s}</li>`).join("")}</ul>
    ${rw.note ? `<div class="tile-note">${rw.note}</div>` : ""}`;

  const chips = usageChips(rw);
  if (chips.length) {
    const box = document.createElement("div");
    box.className = "tile-usage";
    const limit = 8;
    for (const c of chips.slice(0, limit)) {
      const s = document.createElement("span");
      s.className = "use-chip";
      s.innerHTML = c.html;
      s.title = c.title;
      box.append(s);
    }
    if (chips.length > limit) {
      const s = document.createElement("span");
      s.className = "use-chip";
      s.textContent = `+${chips.length - limit} more`;
      s.title = chips.slice(limit).map((c) => c.title).join("\n");
      box.append(s);
    }
    el.append(box);
  }
  return el;
}

function renderResults() {
  const results = document.getElementById("results");
  results.replaceChildren();

  if (state.match !== "all" && state.selected.size === 0) {
    results.innerHTML = `<div class="empty"><strong>Your rune tab is dark.</strong><br>
      Light up the runes you have to see which runewords you can make,
      or set <em>Show</em> to “All runewords”.</div>`;
    return;
  }

  const list = RUNEWORDS.filter(matches).sort(compare);
  const slots = SLOTS.filter(([key]) => state.slots.size === 0 || state.slots.has(key));
  let shown = 0;

  for (const [key] of slots) {
    const items = list.filter((rw) => rw.slots.includes(key));
    if (!items.length) continue;
    shown += items.length;

    const section = document.createElement("section");
    section.className = "slot-section";
    section.innerHTML = `<h2>${SLOT_NAME[key]} <span class="count">${items.length}</span></h2>`;
    const tiles = document.createElement("div");
    tiles.className = "tiles";
    tiles.append(...items.map(tile));
    section.append(tiles);
    results.append(section);
  }

  if (!shown) {
    const hint = state.match === "0"
      ? "Try lighting more runes, or show runewords missing 1–2 runes."
      : "Try widening the tier, slot or class filters.";
    results.innerHTML = `<div class="empty"><strong>No runewords match.</strong><br>${hint}</div>`;
  }
}

let markPinned = () => {};

function update() {
  renderFilters();
  renderResults();
  markPinned();
  if (pinned) renderCube(RUNEWORDS.find((rw) => rw.name === pinned));
  save();
}

load();
renderStash();
setupControls();
markPinned = setupCubePreview();
update();
