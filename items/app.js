import { ITEMS, SETS } from "../data/items.js";
import { RUNEWORDS, RUNEWORD_TIERS, SLOTS as RW_SLOTS } from "../runes/data.js";
import {
  BUILDS, CLASSES, CLASS_NAME, TIERS, BUILD_SLOTS, usesFor, usageBlock, deriveRatings,
} from "../assets/builds.js";

const STORAGE_KEY = "d2tools.items.v1";
const RUNES_STORAGE_KEY = "d2tools.runes.v1";

const ITEM_SLOTS = [
  ["weapon", "Weapons"], ["offhand", "Off-Hand"], ["helm", "Helms"], ["armor", "Body Armor"],
  ["gloves", "Gloves"], ["belt", "Belts"], ["boots", "Boots"], ["amulet", "Amulets"],
  ["ring", "Rings"], ["charm", "Charms"], ["jewel", "Jewels"],
];
const QUALITIES = [["unique", "Unique"], ["set", "Set"]];
const ITEM_SLOT_NAME = Object.fromEntries(ITEM_SLOTS);
const RW_SLOT_NAME = Object.fromEntries(RW_SLOTS);

const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
const SET_BY_NAME = new Map(SETS.map((s) => [s.name, s]));
const SET_MEMBERS = new Map();
for (const i of ITEMS) if (i.set) SET_MEMBERS.set(i.set, [...(SET_MEMBERS.get(i.set) || []), i]);
const RW_BY_NAME = new Map(RUNEWORDS.map((rw) => [rw.name, rw]));

const RATING = deriveRatings(ITEMS.map((i) => i.id));
const RW_TIER = new Map();
for (const [tier, names] of Object.entries(RUNEWORD_TIERS)) for (const n of names) RW_TIER.set(n, tier);

const keyOfRw = (rw) => `r:${rw.name}`;
function nameOf(key) {
  if (key.startsWith("r:")) return key.slice(2);
  return ITEM_BY_ID.get(key)?.name ?? key;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---- State ------------------------------------------------------------------

const state = {
  tab: "items",
  found: new Set(),
  items: { q: "", quality: new Set(), slots: new Set(), tiers: new Set(["S", "A", "B", "C", "D"]), cls: "any", show: "all", sort: "rating" },
  runewords: { q: "", slots: new Set(), tiers: new Set(["S", "A", "B", "C"]), cls: "any", show: "all", sort: "tier" },
  builds: { q: "", cls: "any", sort: "coverage", makeable: true },
};
let runes = new Set(); // runes lit on the Rune Tab

const SET_KEYS = { items: ["quality", "slots", "tiers"], runewords: ["slots", "tiers"], builds: [] };

function validKey(key) {
  return key.startsWith("r:") ? RW_BY_NAME.has(key.slice(2)) : ITEM_BY_ID.has(key);
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved) {
      state.tab = saved.tab || state.tab;
      state.found = new Set((saved.found || []).filter(validKey));
      for (const view of ["items", "runewords", "builds"]) {
        const s = saved[view];
        if (!s) continue;
        for (const [k, v] of Object.entries(s)) {
          if (!(k in state[view])) continue;
          state[view][k] = SET_KEYS[view].includes(k) ? new Set(v) : v;
        }
      }
    }
  } catch { /* storage unavailable */ }
  if (!["items", "runewords", "builds"].includes(state.tab)) state.tab = "items";
  loadRunes();
}

function loadRunes() {
  try {
    const saved = JSON.parse(localStorage.getItem(RUNES_STORAGE_KEY) || "null");
    runes = new Set(saved?.selected || []);
  } catch { runes = new Set(); }
}

function save() {
  const plain = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v instanceof Set ? [...v] : v]));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tab: state.tab,
      found: [...state.found],
      items: plain(state.items),
      runewords: plain(state.runewords),
      builds: plain(state.builds),
    }));
  } catch { /* storage unavailable */ }
}

// ---- Share links ------------------------------------------------------------
// #found=u<bits>.s<bits>.r<bits>: bitsets (base64url) over unique numbers,
// set item numbers and runeword positions in RUNEWORDS.

function toBits(nums) {
  if (!nums.length) return "";
  const bytes = new Uint8Array((Math.max(...nums) >> 3) + 1);
  for (const n of nums) bytes[n >> 3] |= 1 << (n & 7);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBits(s) {
  const out = [];
  if (!s) return out;
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  for (let i = 0; i < bin.length; i++) {
    for (let b = 0; b < 8; b++) if (bin.charCodeAt(i) & (1 << b)) out.push(i * 8 + b);
  }
  return out;
}

function encodeFound() {
  const u = [], s = [], r = [];
  for (const key of state.found) {
    if (key.startsWith("r:")) r.push(RUNEWORDS.findIndex((rw) => rw.name === key.slice(2)));
    else (key[0] === "u" ? u : s).push(Number(key.slice(1)));
  }
  return `u${toBits(u)}.s${toBits(s)}.r${toBits(r.filter((n) => n >= 0))}`;
}

function decodeFound(str) {
  const found = new Set();
  for (const part of str.split(".")) {
    const kind = part[0];
    for (const n of fromBits(part.slice(1))) {
      const key = kind === "r" ? (RUNEWORDS[n] && keyOfRw(RUNEWORDS[n])) : `${kind}${n}`;
      if (key && validKey(key)) found.add(key);
    }
  }
  return found;
}

function importFromHash() {
  const param = new URLSearchParams(location.hash.slice(1)).get("found");
  if (param === null) return;
  history.replaceState(null, "", location.pathname + location.search);
  let incoming;
  try { incoming = decodeFound(param); } catch { return; }
  const same = incoming.size === state.found.size && [...incoming].every((k) => state.found.has(k));
  if (same) return;
  if (state.found.size && !confirm(`Replace your ${state.found.size} found items with the ${incoming.size} from this link?`)) return;
  state.found = incoming;
  save();
}

// ---- Ownership ----------------------------------------------------------------

const makeable = (rw) => runes.size > 0 && rw.runes.every((r) => runes.has(r));
const isFound = (key) => state.found.has(key);

function toggleFound(key) {
  if (state.found.has(key)) state.found.delete(key);
  else state.found.add(key);
  save();
  renderFoundBar();
}

// A found toggle for a tile. Updates the tile in place unless the current
// filter would hide it, in which case the whole view is redrawn.
function foundToggle(key, name, tileEl, view) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "found-toggle";
  const sync = () => {
    const on = isFound(key);
    b.setAttribute("aria-pressed", String(on));
    b.title = on ? `Found – click to unmark ${name}` : `Mark ${name} as found`;
    b.setAttribute("aria-label", b.title);
    tileEl.classList.toggle("found", on);
  };
  b.addEventListener("click", () => {
    toggleFound(key);
    if (state[view].show !== "all") render();
    else sync();
  });
  sync();
  return b;
}

// ---- Filters -------------------------------------------------------------------

function chip(label, pressed, onToggle) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.innerHTML = label;
  b.setAttribute("aria-pressed", String(pressed));
  b.addEventListener("click", () => {
    onToggle();
    update();
  });
  return b;
}

function multiChips(el, options, set) {
  el.replaceChildren(
    chip("All", set.size === 0, () => set.clear()),
    ...options.map(([key, label]) => chip(label, set.has(key), () => {
      if (set.has(key)) set.delete(key);
      else set.add(key);
      if (set.size === options.length) set.clear();
    })),
  );
}

function tierChips(el, set) {
  el.replaceChildren(...TIERS.map((t) => chip(`<span class="tier-letter tier-${t}">${t}</span>`, set.has(t), () => {
    if (set.has(t)) set.delete(t);
    else set.add(t);
  })));
}

function classOptions(select, withMerc = true) {
  select.replaceChildren(
    new Option("Any class", "any"),
    ...CLASSES.map(([key, label]) => new Option(label, key)),
    ...(withMerc ? [new Option("Mercenary", "merc")] : []),
  );
}

function bindControls(prefix, view) {
  for (const el of document.querySelectorAll(`[id^="${prefix}-"][data-key]`)) {
    const key = el.dataset.key;
    el.value = state[view][key];
    el.addEventListener("input", () => {
      state[view][key] = el.value;
      update();
    });
  }
}

function matchesQuery(q, parts) {
  q = q.trim().toLowerCase();
  if (!q) return true;
  const haystack = parts.join(" ").toLowerCase();
  return q.split(/\s+/).every((w) => haystack.includes(w));
}

const byTierThen = (tierOf, count) => (a, b) =>
  TIERS.indexOf(tierOf(a)) - TIERS.indexOf(tierOf(b)) || count(b) - count(a) || a.name.localeCompare(b.name);

// ---- Uniques & Sets ---------------------------------------------------------------

function itemMatches(item) {
  const f = state.items;
  if (f.quality.size && !f.quality.has(item.q)) return false;
  if (f.slots.size && !f.slots.has(item.slot)) return false;
  if (!f.tiers.has(RATING.get(item.id))) return false;
  if (f.cls !== "any" && usesFor(item.id, f.cls).length === 0) return false;
  if (f.show === "found" && !isFound(item.id)) return false;
  if (f.show === "missing" && isFound(item.id)) return false;
  return matchesQuery(f.q, [item.name, item.base, item.set || "", ...item.stats]);
}

function itemCompare(a, b) {
  const f = state.items;
  const n = (i) => usesFor(i.id, f.cls).length;
  if (f.sort === "name") return a.name.localeCompare(b.name);
  if (f.sort === "level") return a.level - b.level || a.name.localeCompare(b.name);
  if (f.sort === "builds") return n(b) - n(a) || a.name.localeCompare(b.name);
  return byTierThen((i) => RATING.get(i.id), n)(a, b);
}

function setBonusHtml(item) {
  const set = SET_BY_NAME.get(item.set);
  const own = (item.bonus || []).map(([n, lines]) => lines.map((l) => `<li>${esc(l)} <span class="bonus-n">(${n} Items)</span></li>`).join("")).join("");
  const members = (SET_MEMBERS.get(item.set) || []).map((m) => `<li class="${m.id === item.id ? "self" : ""}">${esc(m.name)}</li>`).join("");
  const partial = (set?.partial || []).map(([n, lines]) => lines.map((l) => `<li>${esc(l)} <span class="bonus-n">(${n} Items)</span></li>`).join("")).join("");
  const full = (set?.full || []).map((l) => `<li>${esc(l)}</li>`).join("");
  return `
    ${own ? `<ul class="tile-bonus">${own}</ul>` : ""}
    <details class="set-info">
      <summary>${esc(item.set)}</summary>
      <ul class="set-members">${members}</ul>
      ${partial ? `<ul class="tile-bonus">${partial}</ul>` : ""}
      ${full ? `<div class="set-full-label">Full Set</div><ul class="tile-bonus">${full}</ul>` : ""}
    </details>`;
}

function itemTile(item) {
  const rating = RATING.get(item.id);
  const el = document.createElement("article");
  el.className = `tile item-tile q-${item.q}`;
  el.innerHTML = `
    <span class="tier-badge tier-${rating}" title="Rating ${rating}, from how maxroll build guides use it">${rating}</span>
    <div class="tile-name">${esc(item.name)}</div>
    <div class="tile-bases">${esc(item.base)}</div>
    ${item.level ? `<div class="tile-level">Required Level: ${item.level}</div>` : ""}
    <ul class="tile-stats">${item.stats.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
    ${item.set ? setBonusHtml(item) : ""}`;
  el.prepend(foundToggle(item.id, item.name, el, "items"));
  const usage = usageBlock(item.id, item.name, state.items.cls);
  if (usage) el.append(usage);
  return el;
}

function renderItems() {
  const f = state.items;
  multiChips(document.getElementById("items-quality"), QUALITIES, f.quality);
  multiChips(document.getElementById("items-slots"), ITEM_SLOTS, f.slots);
  tierChips(document.getElementById("items-tiers"), f.tiers);

  const note = [];
  const hidden = TIERS.filter((t) => !f.tiers.has(t));
  if (hidden.length) note.push(`Hiding rating ${hidden.join(", ")}.`);
  note.push("Ratings come from how often maxroll build guides use an item, weighted by build tier and whether it's the best-in-slot pick; F means no guide uses it.");
  document.getElementById("items-note").textContent = note.join(" ");

  const list = ITEMS.filter(itemMatches).sort(itemCompare);
  renderGrouped(document.getElementById("items-results"), list, ITEM_SLOTS, (i) => i.slot, itemTile,
    "No items match.", "Try widening the rating, slot or class filters.");
}

// ---- Runewords ---------------------------------------------------------------------

function rwMatches(rw) {
  const f = state.runewords;
  const key = keyOfRw(rw);
  if (f.slots.size && !rw.slots.some((s) => f.slots.has(s))) return false;
  if (!f.tiers.has(RW_TIER.get(rw.name))) return false;
  if (f.cls !== "any" && usesFor(key, f.cls).length === 0) return false;
  if (f.show === "found" && !isFound(key)) return false;
  if (f.show === "missing" && isFound(key)) return false;
  if (f.show === "makeable" && !makeable(rw)) return false;
  return matchesQuery(f.q, [rw.name, ...rw.bases, ...rw.stats, ...rw.runes]);
}

function rwCompare(a, b) {
  const f = state.runewords;
  const n = (rw) => usesFor(keyOfRw(rw), f.cls).length;
  if (f.sort === "name") return a.name.localeCompare(b.name);
  if (f.sort === "level") return a.level - b.level || a.name.localeCompare(b.name);
  if (f.sort === "builds") return n(b) - n(a) || a.name.localeCompare(b.name);
  return byTierThen((rw) => RW_TIER.get(rw.name), n)(a, b);
}

function rwTile(rw) {
  const key = keyOfRw(rw);
  const tier = RW_TIER.get(rw.name);
  const el = document.createElement("article");
  el.className = "tile item-tile q-runeword";
  const runeHtml = rw.runes.map((r) => (runes.size && !runes.has(r) ? `<span class="missing">${r}</span>` : r)).join("");
  el.innerHTML = `
    <span class="tier-badge tier-${tier}" title="maxroll tier ${tier}">${tier}</span>
    <div class="tile-name">${esc(rw.name)}</div>
    <div class="tile-bases">${rw.runes.length} Socket ${esc(rw.bases.join(" / "))}</div>
    <div class="tile-runes">'${runeHtml}'${makeable(rw) ? ` <span class="can-make" title="You have these runes lit on the Rune Tab">Can make</span>` : ""}</div>
    <div class="tile-level">Required Level: ${rw.level}</div>
    <ul class="tile-stats">${rw.stats.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
    ${rw.note ? `<div class="tile-note">${esc(rw.note)}</div>` : ""}`;
  el.prepend(foundToggle(key, rw.name, el, "runewords"));
  const usage = usageBlock(key, rw.name, state.runewords.cls);
  if (usage) el.append(usage);
  return el;
}

function renderRunewords() {
  const f = state.runewords;
  multiChips(document.getElementById("rw-slots"), RW_SLOTS, f.slots);
  tierChips(document.getElementById("rw-tiers"), f.tiers);

  const note = [];
  const hidden = TIERS.filter((t) => !f.tiers.has(t));
  if (hidden.length) note.push(`Hiding tier ${hidden.join(", ")} runewords.`);
  note.push(runes.size
    ? `Runes missing from your Rune Tab are shown in red (${runes.size} runes lit).`
    : "Light up runes on the Rune Tab to see which runewords you can make.");
  document.getElementById("rw-note").textContent = note.join(" ");

  const list = RUNEWORDS.filter(rwMatches).sort(rwCompare);
  // A runeword that fits several slots is listed under each of them.
  renderGrouped(document.getElementById("rw-results"), list,
    RW_SLOTS.filter(([k]) => !f.slots.size || f.slots.has(k)), (rw) => rw.slots, rwTile,
    "No runewords match.", "Try widening the tier, slot or class filters.");
}

// ---- Shared grouped list ---------------------------------------------------------------

function renderGrouped(results, list, slots, slotOf, tile, emptyTitle, emptyHint) {
  results.replaceChildren();
  for (const [key, label] of slots) {
    const items = list.filter((x) => [].concat(slotOf(x)).includes(key));
    if (!items.length) continue;
    const section = document.createElement("section");
    section.className = "slot-section";
    section.innerHTML = `<h2>${label} <span class="count">${items.length}</span></h2>`;
    const tiles = document.createElement("div");
    tiles.className = "tiles";
    tiles.append(...items.map(tile));
    section.append(tiles);
    results.append(section);
  }
  if (!results.children.length) {
    results.innerHTML = `<div class="empty"><strong>${emptyTitle}</strong><br>${emptyHint}</div>`;
  }
}

// ---- Builds -------------------------------------------------------------------------------

function owned(key) {
  if (isFound(key)) return "found";
  if (state.builds.makeable && key.startsWith("r:")) {
    const rw = RW_BY_NAME.get(key.slice(2));
    if (rw && makeable(rw)) return "makeable";
  }
  return null;
}

// Coverage of a build's slot list: slots with at least one tracked (unique,
// set or runeword) option count; rings count as two slots.
function coverage(slots) {
  let total = 0, have = 0, best = 0;
  const rows = [];
  for (const s of slots) {
    const n = s.slot === "ring" ? 2 : 1;
    const tracked = s.best.length + s.alt.length > 0;
    const bestOwned = s.best.filter(owned).length;
    const altOwned = s.alt.filter(owned).length;
    const h = tracked ? Math.min(n, bestOwned + altOwned) : 0;
    const b = Math.min(n, bestOwned);
    if (tracked) { total += n; have += h; best += b; }
    rows.push({ ...s, n, tracked, have: h, bestHave: b });
  }
  return { total, have, best, rows };
}

function buildMatches(b) {
  const f = state.builds;
  if (f.cls !== "any" && b.cls !== f.cls) return false;
  return matchesQuery(f.q, [b.name, CLASS_NAME[b.cls]]);
}

function buildCompare(a, b) {
  const f = state.builds;
  const tier = (x) => TIERS.indexOf(x.build.tier);
  const name = (x, y) => x.build.name.localeCompare(y.build.name) || x.build.cls.localeCompare(y.build.cls);
  if (f.sort === "name") return name(a, b);
  if (f.sort === "tier") return tier(a) - tier(b) || b.char.have - a.char.have || name(a, b);
  if (f.sort === "best") return b.char.best - a.char.best || b.char.have - a.char.have || tier(a) - tier(b) || name(a, b);
  return b.char.have - a.char.have || b.char.best - a.char.best
    || b.char.have / b.char.total - a.char.have / a.char.total || tier(a) - tier(b) || name(a, b);
}

function coverageBar(label, cov) {
  if (!cov.total) return "";
  const pct = (n) => `${(100 * n) / cov.total}%`;
  return `
    <div class="cov-row">
      <span class="cov-label">${label}</span>
      <span class="cov-bar" role="img" aria-label="${cov.have} of ${cov.total} slots covered, ${cov.best} with best-in-slot items">
        <span class="cov-best" style="width:${pct(cov.best)}"></span><span class="cov-alt" style="width:${pct(cov.have - cov.best)}"></span>
      </span>
      <span class="cov-num"><b>${cov.have}</b>/${cov.total}${cov.best ? ` · <span class="best-mark">★</span>${cov.best}` : ""}</span>
    </div>`;
}

function pill(key, best) {
  const state_ = owned(key);
  const cls = ["pill", best ? "best" : "", state_ === "found" ? "owned" : "", state_ === "makeable" ? "makeable" : ""].filter(Boolean).join(" ");
  const name = nameOf(key);
  const status = state_ === "found" ? "found" : state_ === "makeable" ? "can make from your runes" : "not found";
  return `<button type="button" class="${cls}" data-key="${esc(key)}" title="${esc(`${best ? "Best in slot" : "Alternative"}: ${name} (${status}). Click to mark as ${isFound(key) ? "not found" : "found"}.`)}">${best ? "★ " : ""}${esc(name)}</button>`;
}

function slotTable(cov) {
  return `<table class="slot-table"><tbody>${cov.rows.map((r) => {
    const mark = !r.tracked ? "" : r.bestHave ? `<span class="slot-ok best" title="Best in slot covered">★</span>`
      : r.have ? `<span class="slot-ok" title="Covered with an alternative">✓</span>` : `<span class="slot-miss" title="Not covered">–</span>`;
    const count = r.n > 1 && r.tracked ? ` <span class="bm-muted">${r.have}/${r.n}</span>` : "";
    return `<tr>
      <th scope="row">${mark}${esc(BUILD_SLOTS[r.slot] || r.slot)}${count}</th>
      <td>
        ${r.best.map((k) => pill(k, true)).join("")}${r.alt.map((k) => pill(k, false)).join("")}
        ${r.other?.length ? `<span class="untracked" title="Rare, crafted and magic items are not tracked">${esc(r.other.join(", "))}</span>` : ""}
      </td>
    </tr>`;
  }).join("")}</tbody></table>`;
}

const openBuilds = new Set();

function buildCard({ build, char, merc }) {
  const el = document.createElement("article");
  el.className = "build-card";
  el.innerHTML = `
    <header>
      <span class="tier-badge tier-${build.tier}" title="${build.tier} tier on the maxroll Late Game Tier List">${build.tier}</span>
      <h3>${esc(build.name)} <span class="bm-muted">${esc(CLASS_NAME[build.cls])}</span></h3>
      <a class="guide-link" href="${esc(build.url)}" target="_blank" rel="noopener">maxroll guide ↗</a>
    </header>
    ${coverageBar("Character", char)}
    ${coverageBar("Mercenary", merc)}
    <details ${openBuilds.has(build.id) ? "open" : ""}>
      <summary>Gear by slot</summary>
      <h4>Character</h4>
      ${slotTable(char)}
      ${merc.rows.length ? `<h4>Mercenary</h4>${slotTable(merc)}` : ""}
      <p class="bm-muted loadout-note">★ = item in the guide's “${esc(build.loadout)}” planner loadout.</p>
    </details>`;
  const details = el.querySelector("details");
  details.addEventListener("toggle", () => {
    if (details.open) openBuilds.add(build.id);
    else openBuilds.delete(build.id);
  });
  el.addEventListener("click", (e) => {
    const p = e.target.closest(".pill[data-key]");
    if (!p) return;
    toggleFound(p.dataset.key);
    render();
  });
  return el;
}

function renderBuilds() {
  const f = state.builds;
  const checkbox = document.getElementById("builds-makeable");
  checkbox.checked = f.makeable;

  const nFound = state.found.size;
  const note = [];
  if (!nFound && !(f.makeable && runes.size)) {
    note.push("Mark items as found on the other tabs (or click them below) to see how much of each build you can put together.");
  } else {
    note.push(`Counting ${nFound} found item${nFound === 1 ? "" : "s"}`
      + (f.makeable ? (runes.size ? ` and runewords makeable from your ${runes.size} lit runes.` : "; no runes are lit on the Rune Tab.") : "."));
  }
  note.push("Only unique, set and runeword options count; slots whose options are all rare, crafted or magic are left out.");
  document.getElementById("builds-note").textContent = note.join(" ");

  const list = BUILDS.filter(buildMatches)
    .map((build) => ({ build, char: coverage(build.slots), merc: coverage(build.merc) }))
    .sort(buildCompare);

  const results = document.getElementById("builds-results");
  results.replaceChildren();
  if (!list.length) {
    results.innerHTML = `<div class="empty"><strong>No builds match.</strong></div>`;
    return;
  }
  const grid = document.createElement("div");
  grid.className = "build-grid";
  grid.append(...list.map(buildCard));
  results.append(grid);
}

// ---- Page ------------------------------------------------------------------------------------

function renderFoundBar() {
  let u = 0, s = 0, r = 0;
  for (const k of state.found) {
    if (k.startsWith("r:")) r++;
    else if (k[0] === "u") u++;
    else s++;
  }
  const parts = [`${u} unique${u === 1 ? "" : "s"}`, `${s} set item${s === 1 ? "" : "s"}`, `${r} runeword${r === 1 ? "" : "s"}`];
  document.getElementById("found-summary").innerHTML = `<span class="filter-label">Found</span> ${parts.join(" · ")}`;
  document.getElementById("share-found").disabled = state.found.size === 0;
  document.getElementById("clear-found").disabled = state.found.size === 0;
}

function renderTabs() {
  for (const btn of document.querySelectorAll("[role=tab]")) {
    const on = btn.dataset.tab === state.tab;
    btn.setAttribute("aria-selected", String(on));
    btn.tabIndex = on ? 0 : -1;
    document.getElementById(btn.getAttribute("aria-controls")).hidden = !on;
  }
}

function render() {
  renderTabs();
  renderFoundBar();
  if (state.tab === "items") renderItems();
  if (state.tab === "runewords") renderRunewords();
  if (state.tab === "builds") renderBuilds();
}

function update() {
  render();
  save();
}

function setupControls() {
  for (const id of ["items-cls", "rw-cls"]) classOptions(document.getElementById(id));
  classOptions(document.getElementById("builds-cls"), false);
  bindControls("items", "items");
  bindControls("rw", "runewords");
  bindControls("builds", "builds");

  document.getElementById("builds-makeable").addEventListener("change", (e) => {
    state.builds.makeable = e.target.checked;
    update();
  });

  const tabs = [...document.querySelectorAll("[role=tab]")];
  for (const btn of tabs) {
    btn.addEventListener("click", () => {
      state.tab = btn.dataset.tab;
      update();
    });
    btn.addEventListener("keydown", (e) => {
      const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!dir) return;
      const next = tabs[(tabs.indexOf(btn) + dir + tabs.length) % tabs.length];
      state.tab = next.dataset.tab;
      update();
      next.focus();
    });
  }

  const share = document.getElementById("share-found");
  share.addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}#found=${encodeFound()}`;
    try {
      await navigator.clipboard.writeText(url);
      share.textContent = "Link copied";
    } catch {
      prompt("Copy this link:", url);
    }
    setTimeout(() => { share.textContent = "Copy share link"; }, 2000);
  });

  document.getElementById("clear-found").addEventListener("click", () => {
    if (!confirm(`Clear all ${state.found.size} found items?`)) return;
    state.found.clear();
    update();
  });

  // Keep up with the Rune Tab when it's open in another browser tab.
  window.addEventListener("storage", (e) => {
    if (e.key === RUNES_STORAGE_KEY) { loadRunes(); render(); }
    if (e.key === STORAGE_KEY) { load(); render(); }
  });
  window.addEventListener("hashchange", () => { importFromHash(); render(); });
}

load();
importFromHash();
setupControls();
update();
