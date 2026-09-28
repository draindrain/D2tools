import { RUNES, RUNE_LAYOUT, RUNEWORDS, RUNEWORD_TIERS, BUILDS, CLASSES, SLOTS } from "./data.js";

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

function stoneSvg(name) {
  const size = name.length <= 2 ? 19 : name.length === 3 ? 17 : name.length === 4 ? 14 : 12;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `
    <path d="M32 5 C44 5 55 11 58 23 C61 35 57 49 46 56 C38 61 25 61 17 55 C7 48 3 35 7 22 C10 12 20 5 32 5 Z"
          fill="url(#stone-fill)" stroke="url(#stone-rim)" stroke-width="2"/>
    <path d="M18 16 C24 10 36 9 44 13" fill="none" stroke="rgba(255,236,200,.45)" stroke-width="2" stroke-linecap="round"/>
    <text class="stone-glyph" x="32" y="${35 + size * 0.33}" text-anchor="middle" font-size="${size}">${name}</text>`;
  return svg;
}

function renderStash() {
  const grid = document.getElementById("rune-grid");
  grid.replaceChildren();
  for (const row of RUNE_LAYOUT) {
    const rowEl = document.createElement("div");
    rowEl.className = "rune-row";
    rowEl.style.setProperty("--cols", Math.max(...RUNE_LAYOUT.map((r) => r.length)));
    for (const name of row) {
      const rune = RUNE_BY_NAME.get(name.toLowerCase());
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rune";
      btn.dataset.rune = rune.name;
      btn.title = `${rune.name} Rune (#${rune.number}) · Required level ${rune.level}`;
      btn.setAttribute("aria-label", `${rune.name} rune`);
      btn.setAttribute("aria-pressed", String(state.selected.has(rune.name)));

      const num = document.createElement("span");
      num.className = "rune-num";
      num.textContent = rune.number;

      const label = document.createElement("span");
      label.className = "rune-name";
      label.textContent = rune.name;

      btn.append(num, stoneSvg(rune.name), label);
      rowEl.append(btn);
    }
    grid.append(rowEl);
  }

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".rune");
    if (!btn) return;
    const name = btn.dataset.rune;
    if (state.selected.has(name)) state.selected.delete(name);
    else state.selected.add(name);
    btn.setAttribute("aria-pressed", String(state.selected.has(name)));
    update();
  });
}

function syncStash() {
  for (const btn of document.querySelectorAll(".rune")) {
    btn.setAttribute("aria-pressed", String(state.selected.has(btn.dataset.rune)));
  }
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

function update() {
  renderFilters();
  renderResults();
  save();
}

load();
renderStash();
setupControls();
update();
