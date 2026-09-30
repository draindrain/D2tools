// Shared build usage for the Rune Tab and Items pages: which maxroll builds
// use an item, derived item ratings, and the "used in builds" modal.
//
// Item keys: u<n> unique, s<n> set item (data/items.js), r:<Name> runeword.

import { BUILDS } from "../data/builds.js";

export { BUILDS };

export const CLASSES = [
  ["ama", "Amazon"], ["asn", "Assassin"], ["bar", "Barbarian"], ["dru", "Druid"],
  ["nec", "Necromancer"], ["pal", "Paladin"], ["sor", "Sorceress"], ["war", "Warlock"],
];
export const CLASS_NAME = { ...Object.fromEntries(CLASSES), merc: "Mercenary" };

export const TIERS = ["S", "A", "B", "C", "D", "F"];

export const BUILD_SLOTS = {
  weapon: "Weapon", offhand: "Off-Hand", swap: "Weapon Swap", swapoff: "Off-Hand Swap",
  helm: "Helm", armor: "Body Armor", gloves: "Gloves", belt: "Belt", boots: "Boots",
  amulet: "Amulet", ring: "Rings", charms: "Charms",
};

export const buildUrl = (build) => build.url;

// key -> [{ build, slot, best, merc }], one entry per build and role
// (character or mercenary), keeping the best-in-slot entry when an item is
// listed in several slots.
export const USAGE = new Map();
for (const build of BUILDS) {
  for (const [list, merc] of [[build.slots, false], [build.merc, true]]) {
    for (const s of list) {
      for (const [keys, best] of [[s.best, true], [s.alt, false]]) {
        for (const key of keys) {
          if (!USAGE.has(key)) USAGE.set(key, []);
          const uses = USAGE.get(key);
          const prev = uses.find((u) => u.build === build && u.merc === merc);
          if (!prev) uses.push({ build, slot: s.slot, best, merc });
          else if (best && !prev.best) Object.assign(prev, { slot: s.slot, best });
        }
      }
    }
  }
}

export const usesOf = (key) => USAGE.get(key) || [];

// Filter uses by the class select: "any", a class key, or "merc".
export function usesFor(key, cls) {
  const all = usesOf(key);
  if (cls === "any") return all;
  if (cls === "merc") return all.filter((u) => u.merc);
  return all.filter((u) => !u.merc && u.build.cls === cls);
}

// ---- Derived ratings for unique and set items ------------------------------
//
// maxroll has no unique/set tier list, so items are rated by how the build
// guides use them: each build adds its tier weight, scaled by whether the item
// is best in slot or an alternative and whether it is worn by the character
// or the mercenary. Used items are then ranked into S–D by score; items no
// build uses are F.

const TIER_WEIGHT = { S: 6, A: 5, B: 4, C: 3, D: 2, F: 1 };
const ROLE_WEIGHT = { best: 1, alt: 0.35, mercBest: 0.5, mercAlt: 0.2 };
// Share of used items in each rating, best first (the rest are D).
const RATING_SHARE = { S: 0.08, A: 0.16, B: 0.24, C: 0.26 };

export function usageScore(key) {
  let score = 0;
  for (const u of usesOf(key)) {
    const role = u.merc ? (u.best ? "mercBest" : "mercAlt") : (u.best ? "best" : "alt");
    score += TIER_WEIGHT[u.build.tier] * ROLE_WEIGHT[role];
  }
  return score;
}

export function deriveRatings(keys) {
  const scored = keys.map((key) => [key, usageScore(key)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  const rating = new Map(keys.map((k) => [k, "F"]));
  let start = 0;
  for (const [tier, share] of Object.entries(RATING_SHARE)) {
    const end = start + Math.round(scored.length * share);
    // Ties stay together in the higher rating.
    let i = start;
    for (; i < scored.length && (i < end || scored[i][1] === scored[i - 1]?.[1]); i++) rating.set(scored[i][0], tier);
    start = i;
  }
  for (let i = start; i < scored.length; i++) rating.set(scored[i][0], "D");
  return rating;
}

// ---- Usage chips -------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Clickable "used in N builds" block for a tile. Returns null when unused.
export function usageBlock(key, name, cls = "any") {
  const uses = usesFor(key, cls);
  if (!uses.length) return null;

  const counts = new Map();
  for (const u of uses) {
    const k = u.merc ? "merc" : u.build.cls;
    const c = counts.get(k) || { n: 0, best: 0 };
    c.n++;
    if (u.best) c.best++;
    counts.set(k, c);
  }
  const order = [...CLASSES.map(([k]) => k), "merc"];

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tile-usage";
  btn.title = "Show the builds that use this";
  const best = uses.filter((u) => u.best).length;
  const builds = new Set(uses.map((u) => u.build)).size;
  btn.innerHTML = `
    <span class="usage-total">${builds} build${builds === 1 ? "" : "s"}${best ? ` · <span class="best-mark">★</span>${best} best in slot` : ""}</span>
    ${order.filter((k) => counts.has(k)).map((k) => {
      const c = counts.get(k);
      return `<span class="use-chip">${CLASS_NAME[k]} <b>×${c.n}</b></span>`;
    }).join("")}`;
  btn.addEventListener("click", () => openBuildsModal(name, uses));
  return btn;
}

// ---- Builds modal --------------------------------------------------------------

let dialog;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "builds-modal panel";
  dialog.addEventListener("click", (e) => {
    // Click on the backdrop (outside the content box) closes.
    if (e.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  return dialog;
}

export function openBuildsModal(name, uses) {
  const dlg = ensureDialog();
  const groups = [...CLASSES, ["merc", "Mercenary"]]
    .map(([k, label]) => [label, uses.filter((u) => (k === "merc" ? u.merc : !u.merc && u.build.cls === k))])
    .filter(([, list]) => list.length);

  const row = (u) => `
    <li>
      <a href="${esc(u.build.url)}" target="_blank" rel="noopener">
        <span class="tier-letter tier-${u.build.tier}" title="${u.build.tier} tier build">${u.build.tier}</span>
        <span class="bm-build">${esc(u.build.name)}${u.merc ? ` <span class="bm-muted">${esc(CLASS_NAME[u.build.cls])}</span>` : ""}</span>
        <span class="bm-slot">${esc(BUILD_SLOTS[u.slot] || u.slot)}</span>
        <span class="bm-role ${u.best ? "best" : "alt"}">${u.best ? "★ Best" : "Alt"}</span>
      </a>
    </li>`;

  const nBuilds = new Set(uses.map((u) => u.build)).size;
  const byRank = (a, b) => TIERS.indexOf(a.build.tier) - TIERS.indexOf(b.build.tier) || b.best - a.best || a.build.name.localeCompare(b.build.name);

  dlg.innerHTML = `
    <form method="dialog" class="bm-head">
      <h2>${esc(name)}</h2>
      <button class="bm-close" aria-label="Close">×</button>
    </form>
    <p class="bm-note">Used in ${nBuilds} maxroll build guide${nBuilds === 1 ? "" : "s"}.
      <span class="bm-role best">★ Best</span> is in the guide's standard loadout;
      <span class="bm-role alt">Alt</span> is another option it lists for the slot.</p>
    ${groups.map(([label, list]) => `
      <section>
        <h3>${label} <span class="count">${list.length}</span></h3>
        <ul class="bm-list">${[...list].sort(byRank).map(row).join("")}</ul>
      </section>`).join("")}`;
  dlg.showModal();
}
