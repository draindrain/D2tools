#!/usr/bin/env node
// Regenerates data/items.js and data/builds.js from maxroll.gg.
//
//   node tools/scrape-maxroll.mjs            # uses tools/.cache when present
//   node tools/scrape-maxroll.mjs --fresh    # re-downloads everything
//
// Needs Node 18+ (built-in fetch). No npm dependencies.
//
// Sources:
// - Late Game tier list: which builds exist, their tier and guide URL.
// - Each build guide: the "Item Options" gear table (every option per slot),
//   the Mercenary section, and the planner profile it embeds.
// - The planner profile (planners.maxroll.gg JSON): the item equipped in each
//   slot of the guide's "Standard" loadout. Those are the best-in-slot items;
//   everything else listed for the slot is an alternative.
// - The D2 planner's game data bundle: unique and set item stats, bases, and
//   the string table used to turn them into tooltip text.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CACHE = path.join(ROOT, "tools", ".cache");
const FRESH = process.argv.includes("--fresh");
const MAXROLL = "https://maxroll.gg";
const PLANNER_API = "https://planners.maxroll.gg/profiles/d2";

fs.mkdirSync(CACHE, { recursive: true });

async function get(url) {
  const file = path.join(CACHE, url.replace(/^https?:\/\//, "").replace(/[^a-z0-9.]+/gi, "_"));
  if (!FRESH && fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "d2tools-scraper (+https://d2tools.drnz.se)" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const text = await res.text();
      fs.writeFileSync(file, text);
      return text;
    } catch (err) {
      if (attempt >= 4) throw new Error(`GET ${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

const warnings = [];
const warn = (msg) => warnings.push(msg);

const decode = (s) => s
  .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const text = (html) => decode(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

// Server-rendered markup only (the page also embeds a JSON copy of itself).
function pageBody(html) {
  const cut = html.indexOf("window.__remixContext");
  return cut > 0 ? html.slice(0, cut) : html;
}

// ---- Game data -------------------------------------------------------------

async function loadGameData() {
  const page = await get(`${MAXROLL}/d2/d2planner`);
  const assetPath = page.match(/"assetPath":"([^"]+)"/)?.[1] ?? "https://assets-ng.maxroll.gg";
  const autoLoader = page.match(/"d2":\{"scripts":\["([^"]+)"/)?.[1] ?? "/d2planner/auto-loader.js";
  const base = new URL(autoLoader, assetPath + "/");
  const auto = await get(base.href);
  const loaderName = auto.match(/"\.\/(loader-[^"]+\.js)"/)[1];
  const loader = await get(new URL(loaderName, base).href);
  const dataName = loader.match(/"\.\/(data\.min-[^"]+\.js)"/)[1];
  const stringsName = loader.match(/"\.\/(strings\.min-[^"]+\.js)"/)[1];
  // Save as .mjs so Node can import them as ES modules.
  const load = async (name) => {
    const src = await get(new URL(name, base).href);
    const file = path.join(CACHE, name.replace(/\.js$/, ".mjs"));
    fs.writeFileSync(file, src);
    return import(pathToFileURL(file).href);
  };
  const data = await load(dataName);
  const strings = (await load(stringsName)).default;
  const str = new Map();
  // Later entries win: some keys come first in a low-violence variant
  // (e.g. "Wormsteel" before "Wormskull").
  for (const [, key, value] of strings) str.set(key, value);
  return { d: data, str };
}

const { d, str } = await loadGameData();
const S = (key) => (key != null && str.has(key) ? str.get(key) : key);
const CLASS_KEYS = ["ama", "sor", "nec", "pal", "bar", "dru", "ass", "war"];

// ---- Item bases and slots ----------------------------------------------------

function baseOf(code) {
  return d.armor[code] || d.weapons[code] || d.misc[code];
}

function typeAncestors(type, seen = new Set()) {
  if (!type || seen.has(type)) return seen;
  seen.add(type);
  const t = d.itemTypes[type];
  if (t) { typeAncestors(t.equiv1, seen); typeAncestors(t.equiv2, seen); }
  return seen;
}

// Item slot on the Items page, from the base item type.
function slotOfBase(code) {
  const base = baseOf(code);
  if (!base) return "other";
  const types = typeAncestors(base.type);
  typeAncestors(base.type2, types);
  if (types.has("ring")) return "ring";
  if (types.has("amul")) return "amulet";
  if (types.has("char")) return "charm";
  if (types.has("jewl")) return "jewel";
  if (types.has("helm") || types.has("pelt") || types.has("phlm") || types.has("circ")) return "helm";
  if (types.has("tors")) return "armor";
  if (types.has("glov")) return "gloves";
  if (types.has("belt")) return "belt";
  if (types.has("boot")) return "boots";
  if (types.has("shld")) return "offhand";
  if (types.has("weap")) return "weapon";
  if (types.has("misl") || types.has("bowq") || types.has("xboq")) return "offhand"; // quivers
  return "other";
}

// ---- Property text -------------------------------------------------------

const skillById = new Map(Object.values(d.skills).map((s) => [s.id, s]));
const skillByName = new Map(Object.values(d.skills).map((s) => [s.skill.toLowerCase(), s]));

function skillOf(par) {
  if (par == null || par === "") return null;
  return (typeof par === "number" || /^\d+$/.test(par))
    ? skillById.get(Number(par))
    : skillByName.get(String(par).toLowerCase());
}
function skillName(par) {
  const s = skillOf(par);
  if (!s) return String(par);
  return S(d.skillDesc[s.skilldesc]?.strname) || s.skill;
}
function classOnly(cls) {
  const c = d.charStats[cls];
  return c ? S(c.strclassonly) : "";
}

const range = (min, max) => {
  if (min === max || max == null) return String(Math.abs(min));
  const [lo, hi] = [Math.abs(min), Math.abs(max)].sort((a, b) => a - b);
  return `${lo}-${hi}`;
};
const isRange = (min, max) => max != null && min !== max;

// Fill a D2R printf-style template (%d, %+d, %s, %%, %0/%1).
function fill(template, args) {
  let i = 0;
  return template
    .replace(/%(\+?)d|%s|%%|%(\d)/g, (m, plus, pos) => {
      if (m === "%%") return "%";
      const a = pos != null ? args[Number(pos)] : args[i++];
      if (a == null) return "";
      if (typeof a === "string") return a;
      const neg = a.min < 0 && (a.max == null || a.max <= 0);
      const body = isRange(a.min, a.max) ? `(${range(a.min, a.max)})` : range(a.min, a.max);
      if (neg) return `-${body}`;
      return (plus ? "+" : "") + body;
    })
    .replace(/%%/g, "%")
    .replace(/\s+/g, " ")
    .trim();
}

const statCost = (stat) => d.itemStatCost[stat] || {};
const statTemplate = (stat, neg) => S(neg ? statCost(stat).descstrneg : statCost(stat).descstrpos);

const ELEMENT = { fire: "Fire", light: "Lightning", cold: "Cold", magic: "Magic", poison: "Poison" };
const RESISTS = ["fireresist", "lightresist", "coldresist", "poisonresist"];
const MAXRESISTS = ["maxfireresist", "maxlightresist", "maxcoldresist", "maxpoisonresist"];
const ATTRS = ["strength", "energy", "dexterity", "vitality"];

// One property (code, param, min, max) -> [{ text, prio }]
function propLines(code, par, min, max) {
  if (!code || code.startsWith("*")) return [];
  const group = d.propertyGroups?.[code];
  if (group) {
    const parts = [];
    for (let i = 1; group[`prop${i}`]; i++) {
      for (const l of propLines(group[`prop${i}`], group[`par${i}`] ?? group[`parmin${i}`], group[`modmin${i}`], group[`modmax${i}`])) parts.push(l.text);
    }
    if (!parts.length) return [];
    return [{ text: `${group.pickmode === 1 ? "One of" : "Random"}: ${parts.join(" / ")}`, prio: 0 }];
  }
  const prop = d.properties[code] || d.properties[code.toLowerCase()];
  if (!prop) { warn(`unknown property ${code}`); return []; }

  const stats = [];
  for (let i = 1; i <= 7; i++) if (prop[`func${i}`]) stats.push({ func: prop[`func${i}`], stat: prop[`stat${i}`], val: prop[`val${i}`] });
  const statNames = stats.map((s) => s.stat);
  const prioStats = stats[0].func === 7 ? ["item_maxdamage_percent"] : statNames;
  const prio = Math.max(0, ...prioStats.map((s) => statCost(s).descpriority || 0));
  const v = { min, max };
  const out = (t) => (t ? [{ text: t, prio }] : []);

  if (MAXRESISTS.every((s) => statNames.includes(s))) return out(fill("%+d% to All Maximum Resistances", [v]));
  if (RESISTS.every((s) => statNames.includes(s))) return out(fill("All Resistances %+d", [v]));
  if (ATTRS.every((s) => statNames.includes(s))) return out(fill("%+d to All Attributes", [v]));

  const f = stats[0].func;
  const st = stats[0].stat;
  switch (f) {
    case 7: return out(fill("%+d% Enhanced Damage", [v]));
    case 14: return out(`Socketed (${min == null ? par : range(min, max)})`);
    case 20: return out("Indestructible");
    case 23: return out("Ethereal (Cannot be Repaired)");
    case 21: { // +x to <class> skills
      const cls = CLASS_KEYS[stats[0].val];
      return out(fill(S(d.charStats[cls]?.strallskills) || "%+d to Class Skills", [v]));
    }
    case 36: return out(`+${stats[0].val} to Random Class Skills`);
    case 12: { // +x to a random skill of one class: par = level, min..max = skill ids
      const cls = skillOf(min)?.charclass;
      const name = S(d.charStats[cls]?.class) || d.charStats[cls]?.class || "Class";
      return out(`+${par} to a Random ${name} Skill ${classOnly(cls)}`.trim());
    }
    case 10: { // skill tab
      const cls = CLASS_KEYS[Math.floor(par / 3)];
      const t = S(d.charStats[cls]?.[`strskilltab${(par % 3) + 1}`]);
      return out(t ? `${fill(t, [v])} ${classOnly(cls)}` : "");
    }
    case 22: {
      const s = skillOf(par);
      if (st === "item_aura") return out(fill(statTemplate(st), [v, skillName(par)]));
      if (st === "item_singleskill") return out(fill(statTemplate(st), [v, skillName(par), classOnly(s?.charclass)]));
      return out(fill(statTemplate(st), [v, skillName(par)]));
    }
    case 11: // chance to cast: min = chance, max = level
      return out(fill(statTemplate(st), [{ min }, { min: max }, skillName(par)]));
    case 19: // charges: min = charges, max = level
      return out(fill(statTemplate(st), [{ min: max }, skillName(par), { min }, { min }]));
    case 24: {
      if (st !== "item_reanimate") return [];
      const mon = Object.values(d.monsters).find((m) => m.hcIdx === Number(par) || m.id === Number(par));
      return out(`${range(min, max)}% Reanimate as: ${mon ? S(mon.namestr) : "a Monster"}`);
    }
    case 17: { // per character level
      if (!statCost(st).descfunc) return [];
      const c = statCost(st);
      const shift = c.opparam ?? 3;
      const value = par ?? min; // per-level values are stored as the parameter
      const per = +(value / 2 ** shift).toFixed(3);
      const t = statTemplate(st).replace(/%\+d/, `+(${per} per Level)`).replace(/%d/, `(${per} per Level)`);
      return out(fill(t, []));
    }
  }

  // Damage pairs: min/max stats in one property.
  if (stats.some((s) => s.func === 15) && stats.some((s) => s.func === 16)) {
    const minStat = stats.find((s) => s.func === 15).stat;
    if (minStat === "poisonmindam") {
      const frames = Number(par) || 0;
      const total = (x) => Math.round((x * frames) / 256);
      const secs = frames ? Math.round(frames / 25) : 0;
      return out(`+${isRange(min, max) ? `${total(min)}-${total(max)}` : total(min)} Poison Damage over ${secs} Seconds`);
    }
    const elem = Object.entries(ELEMENT).find(([k]) => minStat.startsWith(k))?.[1];
    return out(`Adds ${min}-${max}${elem ? ` ${elem}` : ""} Damage`);
  }
  if (f === 5) return out(fill("%+d to Minimum Damage", [v]));
  if (f === 6) return out(fill("%+d to Maximum Damage", [v]));

  // Plain stats: one line per distinct stat with a description.
  const lines = [];
  for (const s of stats) {
    const c = statCost(s.stat);
    if (!c.descfunc) continue;
    const neg = min < 0 && (max == null || max <= 0);
    const t = statTemplate(s.stat, neg);
    if (!t) continue;
    let value = v;
    if (c.descfunc === 5) value = { min: Math.round((min * 100) / 128), max: Math.round((max * 100) / 128) };
    if (c.descfunc === 11) { lines.push(`Repairs 1 Durability in ${Math.round(100 / min)} Seconds`); continue; }
    if (c.descfunc === 12) { lines.push(max > 1 || min > 1 ? `${t} +${range(min, max)}` : t); continue; }
    lines.push(/%/.test(t) ? fill(t, [value]) : t);
  }
  return [...new Set(lines)].map((text) => ({ text, prio }));
}

function formatProps(entries) {
  const lines = entries.flatMap(([code, par, min, max]) => propLines(code, par, min, max));
  return lines.sort((a, b) => b.prio - a.prio).map((l) => l.text).filter(Boolean);
}

function readProps(row, prefix, count, suffix = "") {
  const entries = [];
  for (let i = 1; i <= count; i++) {
    const code = row[`${prefix}${i}${suffix}`];
    if (!code) continue;
    const p = prefix === "prop" ? "" : prefix[0];
    entries.push([
      code,
      row[`${p}par${i}${suffix}`] ?? row[`par${i}${suffix}`],
      row[`${p}min${i}${suffix}`] ?? row[`min${i}${suffix}`],
      row[`${p}max${i}${suffix}`] ?? row[`max${i}${suffix}`],
    ]);
  }
  return entries;
}

// ---- Unique and set items -------------------------------------------------

const ITEMS = new Map(); // key -> item

for (const [key, u] of Object.entries(d.uniqueItems)) {
  const num = Number(key.replace(/\D/g, ""));
  const base = baseOf(u.code);
  ITEMS.set(`u${num}`, {
    id: `u${num}`,
    q: "unique",
    name: S(u.index),
    base: base ? S(base.namestr) : u.code,
    slot: slotOfBase(u.code),
    level: u.lvlreq || 0,
    stats: formatProps(readProps(u, "prop", 12)),
    spawnable: !!u.spawnable,
  });
}

const setBonusLines = (row, prefix) => {
  // prefix "aprop" on set items: aprop{n}a / aprop{n}b -> worn with n+1 items
  const out = [];
  for (let n = 1; n <= 5; n++) {
    const entries = ["a", "b"].map((s) => [row[`${prefix}${n}${s}`], row[`apar${n}${s}`], row[`amin${n}${s}`], row[`amax${n}${s}`]]).filter((e) => e[0]);
    const lines = formatProps(entries);
    if (lines.length) out.push([n + 1, lines]);
  }
  return out;
};

for (const [key, s] of Object.entries(d.setItems)) {
  const num = Number(key.replace(/\D/g, ""));
  const base = baseOf(s.item);
  ITEMS.set(`s${num}`, {
    id: `s${num}`,
    q: "set",
    name: S(s.index),
    set: S(s.set),
    base: base ? S(base.namestr) : s.item,
    slot: slotOfBase(s.item),
    level: s.lvlreq || 0,
    stats: formatProps(readProps(s, "prop", 9)),
    bonus: setBonusLines(s, "aprop"),
    spawnable: !!s.spawnable,
  });
}

const SETS = Object.values(d.sets).map((set) => {
  const partial = [];
  for (let n = 2; n <= 5; n++) {
    const entries = ["a", "b"].map((x) => [set[`pcode${n}${x}`], set[`pparam${n}${x}`], set[`pmin${n}${x}`], set[`pmax${n}${x}`]]).filter((e) => e[0]);
    const lines = formatProps(entries);
    if (lines.length) partial.push([n, lines]);
  }
  const full = formatProps([...Array(8)].map((_, i) => [set[`fcode${i + 1}`], set[`fparam${i + 1}`], set[`fmin${i + 1}`], set[`fmax${i + 1}`]]).filter((e) => e[0]));
  return { name: S(set.name || set.index), partial, full };
});

// Name lookup for bare item mentions in guide text. Labels are sometimes
// squashed ("thestoneofjordan"), so names are compared without spaces or
// punctuation.
const norm = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const ITEM_BY_NAME = new Map();
for (const item of ITEMS.values()) {
  const k = norm(item.name);
  if (!ITEM_BY_NAME.has(k) || (item.spawnable && !ITEM_BY_NAME.get(k).spawnable)) ITEM_BY_NAME.set(k, item);
}

// ---- Runewords ------------------------------------------------------------

const { RUNEWORDS } = await import(pathToFileURL(path.join(ROOT, "runes", "data.js")).href);
const RW_NAMES = RUNEWORDS.map((r) => r.name).sort((a, b) => b.length - a.length);
const RUNE_NAMES = ["El", "Eld", "Tir", "Nef", "Eth", "Ith", "Tal", "Ral", "Ort", "Thul", "Amn", "Sol", "Shael", "Dol", "Hel", "Io", "Lum", "Ko", "Fal", "Lem", "Pul", "Um", "Mal", "Ist", "Gul", "Vex", "Ohm", "Lo", "Sur", "Ber", "Jah", "Cham", "Zod"];
const rwByRunes = new Map(RUNEWORDS.map((r) => [r.runes.join(" "), r.name]));
const rwIdName = new Map(); // "runeword059" -> "Enigma", learned while scraping

function runewordFromLabel(label) {
  const clean = label.replace(/\d+$/, "").trim().toLowerCase();
  return RW_NAMES.find((n) => clean === n.toLowerCase() || clean.startsWith(n.toLowerCase() + " "))
    || RW_NAMES.find((n) => norm(clean) === norm(n));
}
function runewordFromSockets(socketed) {
  if (!Array.isArray(socketed)) return undefined;
  const runes = socketed.map((s) => (typeof s === "string" && /^r\d+$/.test(s) ? RUNE_NAMES[Number(s.slice(1)) - 1] : null));
  if (runes.some((r) => !r)) return undefined;
  return rwByRunes.get(runes.join(" "));
}

// ---- Resolving planner / guide item references ---------------------------

const profileCache = new Map();
async function profile(id) {
  if (!profileCache.has(id)) {
    const raw = JSON.parse(await get(`${PLANNER_API}/${id}`));
    const data = JSON.parse(raw.data);
    profileCache.set(id, data.planner ?? data); // older profiles have no "planner" wrapper
  }
  return profileCache.get(id);
}

// A planner item -> { key, label } where key is null for untracked items
// (rares, crafted, magic, bases).
function keyOfPlannerItem(item, label = "") {
  if (!item) return null;
  const u = item.unique;
  if (typeof u === "string") {
    if (u.startsWith("unique")) return `u${Number(u.slice(6))}`;
    if (u.startsWith("set")) return `s${Number(u.slice(3))}`;
    if (u.startsWith("runeword")) {
      const id = u.split("#")[0];
      const name = runewordFromSockets(item.socketedItems) || rwIdName.get(id) || runewordFromLabel(label);
      if (name) { rwIdName.set(id, name); return `r:${name}`; }
      warn(`could not name ${u} (${label})`);
      return null;
    }
  }
  return null;
}

// A <span class="d2planner-item" ...>label</span> reference -> key or null.
async function keyOfRef(ref) {
  const { id, prof, label } = ref;
  if (id) {
    const [base] = id.split("#");
    if (/^unique\d+$/.test(base)) return `u${Number(base.slice(6))}`;
    if (/^set\d+$/.test(base)) return `s${Number(base.slice(3))}`;
    if (/^runeword\d+$/.test(base)) return keyOfPlannerItem({ unique: base }, label);
    if (/^\d+$/.test(base) && prof) {
      try {
        const p = await profile(prof);
        return keyOfPlannerItem(p.items[base], label);
      } catch (err) {
        warn(`${err.message}; resolving "${label}" by name`);
      }
    }
  }
  const clean = (label || "").replace(/\d+$/, "").trim();
  // "Raven Frost Ring": also try without a trailing base word.
  const byName = ITEM_BY_NAME.get(norm(clean)) || ITEM_BY_NAME.get(norm(clean.replace(/\s+\S+$/, "")));
  if (byName && clean) return byName.id;
  const rw = label && runewordFromLabel(label);
  return rw ? `r:${rw}` : null;
}

function refsIn(html) {
  return [...html.matchAll(/<span class="d2planner-item"([^>]*)>(.*?)<\/span>/gs)].map((m) => ({
    id: m[1].match(/data-d2planner-id="([^"]+)"/)?.[1],
    prof: m[1].match(/data-d2planner-profile="([^"]+)"/)?.[1],
    label: text(m[2]),
  }));
}

// ---- Builds ----------------------------------------------------------------

const CLASS_WORDS = [
  [/\bAmazon\b/, "ama"], [/\bAssassin\b/, "asn"], [/\bBarbarian\b/, "bar"], [/\bDruid\b/, "dru"],
  [/\bNecro(mancer)?\b/, "nec"], [/\bPaladin\b/, "pal"], [/\bSorc(eress)?\b/, "sor"], [/\bWarlock\b/, "war"],
];
const PLANNER_CLASS = { ama: "ama", sor: "sor", nec: "nec", pal: "pal", bar: "bar", dru: "dru", ass: "asn", asn: "asn", war: "war" };

const TABLE_SLOTS = [
  [/^weapons?$/i, "weapon"], [/^off-?hand$/i, "offhand"], [/^weapon-?\s?swap$/i, "swap"], [/^off-?hand[- ]?swap$/i, "swapoff"],
  [/^helm(et)?s?$/i, "helm"], [/^body armors?$/i, "armor"], [/^gloves$/i, "gloves"], [/^belts?$/i, "belt"],
  [/^boots/i, "boots"], [/^amulets?$/i, "amulet"], [/^rings?$/i, "ring"], [/charms?$/i, "charms"],
];
const PLANNER_SLOTS = { rarm: "weapon", larm: "offhand", rarm2: "swap", larm2: "swapoff", head: "helm", tors: "armor", glov: "gloves", belt: "belt", feet: "boots", neck: "amulet", rrin: "ring", lrin: "ring" };
const MERC_SLOTS = { rarm: "weapon", larm: "offhand", head: "helm", tors: "armor" };
// Items page slot -> merc build slot, for merc items mentioned in guide text.
const MERC_SLOT_OF_ITEM = { weapon: "weapon", offhand: "offhand", helm: "helm", armor: "armor" };
// Item slots that can fill each build slot. Guides also list socket fillers
// (jewels, facets) in gear rows; those are dropped.
const FITS = {
  weapon: ["weapon"], swap: ["weapon"], offhand: ["offhand", "weapon"], swapoff: ["offhand", "weapon"],
  helm: ["helm"], armor: ["armor"], gloves: ["gloves"], belt: ["belt"], boots: ["boots"],
  amulet: ["amulet"], ring: ["ring"], charms: ["charm"],
};
const fits = (key, slot) => itemSlotsOfKey(key).some((s) => FITS[slot].includes(s));

const BEST_PROFILE = /standard|best in slot/i;
const NOT_GEAR_PROFILE = /skill|white|embed|test|copy|starter|budget|sunder|^set \d/i;

function pickBestProfile(profiles) {
  return profiles.find((p) => BEST_PROFILE.test(p.name) && !NOT_GEAR_PROFILE.test(p.name))
    || profiles.find((p) => !NOT_GEAR_PROFILE.test(p.name) && p.items && Object.keys(p.items).length)
    || profiles[0];
}

function itemSlotsOfKey(key) {
  if (key.startsWith("r:")) {
    const rw = RUNEWORDS.find((r) => r.name === key.slice(2));
    return (rw?.slots || []).map((s) => (s === "shield" ? "offhand" : s));
  }
  return [ITEMS.get(key)?.slot];
}

async function scrapeBuild(entry) {
  const html = pageBody(await get(MAXROLL + entry.path));

  // Main planner profile: the first one the guide embeds.
  const profileId = html.match(/class="d2-(?:player|skillbar|skills)" data-d2-id="([a-z0-9]{8})"/)?.[1];
  if (!profileId) throw new Error(`${entry.path}: no planner profile`);
  const plan = await profile(profileId);
  const best = pickBestProfile(plan.profiles);

  const slots = new Map(); // slot -> { best: Set, alt: Set, other: Set }
  const mercSlots = new Map();
  const slotOf = (map, s) => {
    if (!map.has(s)) map.set(s, { best: new Set(), alt: new Set(), other: new Set() });
    return map.get(s);
  };

  // Gear table
  const table = [...html.matchAll(/<table.*?<\/table>/gs)].map((m) => m[0]).find((t) => /Item Options/.test(t));
  if (!table) warn(`${entry.path}: no gear table`);
  for (const row of table ? [...table.matchAll(/<tr.*?<\/tr>/gs)].map((m) => m[0]).slice(1) : []) {
    const cells = [...row.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gs)].map((m) => m[1]);
    const label = text(cells[0] || "").replace(/\d+$/, "");
    const slot = TABLE_SLOTS.find(([re]) => re.test(label))?.[1];
    if (!slot) { warn(`${entry.path}: unknown gear row "${label}"`); continue; }
    for (const ref of refsIn(cells[1] || "")) {
      const key = await keyOfRef(ref);
      if (key && fits(key, slot)) slotOf(slots, slot).alt.add(key);
      else if (slot !== "charms" && ref.label) slotOf(slots, slot).other.add(ref.label.replace(/\d+$/, ""));
    }
  }

  // Best-in-slot: the Standard loadout.
  for (const [ps, slot] of Object.entries(PLANNER_SLOTS)) {
    const key = keyOfPlannerItem(plan.items[best.items?.[ps]]);
    if (key) slotOf(slots, slot).best.add(key);
  }
  for (const idx of best.inventory || []) {
    const key = keyOfPlannerItem(plan.items[idx]);
    if (key && ITEMS.get(key)?.slot === "charm") slotOf(slots, "charms").best.add(key);
  }

  // Mercenary: Standard loadout = best; other gear loadouts and items named in
  // the guide's Mercenary sections = alternatives.
  for (const p of plan.profiles) {
    if (p !== best && NOT_GEAR_PROFILE.test(p.name)) continue;
    for (const [ps, slot] of Object.entries(MERC_SLOTS)) {
      const key = keyOfPlannerItem(plan.items[p.mercItems?.[ps]]);
      if (key) slotOf(mercSlots, slot)[p === best ? "best" : "alt"].add(key);
    }
  }
  const headings = [...html.matchAll(/<h([1-4])[^>]*>(.*?)<\/h\1>/gs)].map((m) => ({ at: m.index, end: m.index + m[0].length, title: text(m[2]) }));
  for (let i = 0; i < headings.length; i++) {
    if (!/mercenar/i.test(headings[i].title)) continue;
    const section = html.slice(headings[i].end, headings[i + 1]?.at ?? headings[i].end + 20000);
    for (const ref of refsIn(section)) {
      const key = await keyOfRef(ref);
      const slot = key && MERC_SLOT_OF_ITEM[itemSlotsOfKey(key)[0]];
      if (slot) slotOf(mercSlots, slot).alt.add(key);
    }
  }

  const finish = (map, order) => order.filter((s) => map.has(s)).map((s) => {
    const { best: b, alt, other } = map.get(s);
    for (const k of b) alt.delete(k);
    const o = { slot: s, best: [...b], alt: [...alt] };
    if (other.size) o.other = [...other];
    return o;
  }).filter((s) => s.best.length || s.alt.length || s.other);

  const cls = CLASS_WORDS.find(([re]) => re.test(entry.title))?.[1] || PLANNER_CLASS[best.class] || "ama";
  const name = entry.title.replace(CLASS_WORDS.find(([, k]) => k === cls)?.[0] ?? "", "").replace(/\s+/g, " ").trim();
  return {
    id: entry.path.split("/").pop(),
    name,
    cls,
    tier: entry.tier,
    url: MAXROLL + entry.path,
    loadout: best.name.trim(),
    slots: finish(slots, ["weapon", "offhand", "swap", "swapoff", "helm", "armor", "gloves", "belt", "boots", "amulet", "ring", "charms"]),
    merc: finish(mercSlots, ["weapon", "offhand", "helm", "armor"]),
  };
}

async function tierList() {
  const html = pageBody(await get(`${MAXROLL}/d2/tierlists/overall-tier-list`));
  const re = /_Tierlist__tierName_[^"]*"[^>]*>(?:<[^>]+>)*([^<]*)|href="(\/d2\/guides\/[^"]+)"[^>]*>.*?_Tierlist__tierItemText_[^"]*">(.*?)<\/span>/gs;
  const out = [];
  let tier = null;
  for (const m of html.matchAll(re)) {
    if (m[1] != null) tier = m[1].trim();
    else if (tier) out.push({ tier, path: m[2], title: text(m[3]) });
  }
  if (!out.length) throw new Error("tier list: no builds found (page layout changed?)");
  return out;
}

const entries = await tierList();
const BUILDS = [];
for (const entry of entries) {
  try {
    BUILDS.push(await scrapeBuild(entry));
    process.stderr.write(".");
  } catch (err) {
    warn(`${entry.path}: ${err.message}`);
  }
}
process.stderr.write("\n");

// ---- Output -----------------------------------------------------------------

const used = new Set(BUILDS.flatMap((b) => [...b.slots, ...b.merc].flatMap((s) => [...s.best, ...s.alt])));
for (const k of used) if (!k.startsWith("r:") && !ITEMS.has(k)) warn(`build references unknown item ${k}`);

// Keep spawnable items plus anything a build uses; drop items without a name.
const items = [...ITEMS.values()]
  .filter((i) => (i.spawnable || used.has(i.id)) && i.name && !/^\s*$/.test(i.name))
  .map(({ spawnable, ...i }) => i);
const setNames = new Set(items.filter((i) => i.q === "set").map((i) => i.set));
const sets = SETS.filter((s) => setNames.has(s.name));

const stamp = new Date().toISOString().slice(0, 10);
const header = (what) => `// Generated by tools/scrape-maxroll.mjs on ${stamp} – do not edit by hand.\n// ${what}\n\n`;
const json = (v) => JSON.stringify(v, null, 0);

fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data", "items.js"),
  header(`Unique and set items from the maxroll.gg D2 planner data (game data ${d.version}).`)
  + "// id: u<n> unique, s<n> set item (maxroll numbering). slot: items page slot.\n"
  + `export const ITEMS = [\n${items.map((i) => "  " + json(i)).join(",\n")},\n];\n\n`
  + `export const SETS = [\n${sets.map((s) => "  " + json(s)).join(",\n")},\n];\n`);

fs.writeFileSync(path.join(ROOT, "data", "builds.js"),
  header("Builds from the maxroll.gg Late Game Tier List and the gear in each build guide.")
  + "// slots[].best: items in the guide's Standard planner loadout (best in slot).\n"
  + "// slots[].alt: other options the guide lists for that slot.\n"
  + "// slots[].other: untracked options (rare, crafted, magic items).\n"
  + "// Item keys: u<n> unique, s<n> set item (see data/items.js), r:<Name> runeword.\n"
  + `export const BUILDS = [\n${BUILDS.map((b) => "  " + json(b)).join(",\n")},\n];\n`);

console.log(`${items.length} items, ${sets.length} sets, ${BUILDS.length} builds.`);
if (warnings.length) console.log(`\n${warnings.length} warnings:\n` + [...new Set(warnings)].map((w) => "  " + w).join("\n"));
