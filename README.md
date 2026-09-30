# D2tools

Tools for Diablo II: Resurrected, hosted at https://d2tools.drnz.se.

A plain static site with no build step: HTML, CSS and ES modules.

## Tools

- **Rune Tab** (`runes/`): light up the runes you own, in a layout modelled on the
  D2R stash Runes tab, and see which runewords you can make. You can filter by item
  slot, maxroll tier (D and F are hidden by default), class, and missing runes.
  - Rune, runeword, tier and build data lives in `runes/data.js`.
  - The grid follows the in-game Runes tab layout (9 columns, the last runes wrapping around the cube space), set by `RUNE_LAYOUT` in `runes/data.js`.
  - Rune glyphs in `runes/glyphs.js` are vector outlines traced from an in-game screenshot.
  - Tiers come from the [maxroll.gg Runeword Tier List](https://maxroll.gg/d2/tierlists/runeword-tier-list).
    Class usefulness comes from the shared build data (see below).
- **Items** (`items/`): search unique items, set items and runewords, mark the ones
  you've found, and rank the maxroll builds by how many gear slots your found items
  cover. It has three tabs:
  - *Uniques & Sets*: full item text, a derived S–F rating and the builds that use each item.
  - *Runewords*: the Rune Tab's runewords with found toggles and "can make" from the runes lit on the Rune Tab.
  - *Builds*: coverage per build for the character and the mercenary. Best-in-slot items
    (★, from the guide's standard planner loadout) are counted apart from the alternatives
    the guide lists. Rings count as two slots. Rare, crafted and magic options aren't tracked.
  - Found items are saved in the browser; "Copy share link" packs them into the URL.

Both tools show how many builds use an item; clicking that opens a list of the builds
per class, linking to their maxroll guides.

### Build and item data

`data/builds.js` and `data/items.js` are generated from maxroll.gg by
`tools/scrape-maxroll.mjs` (Node 18+, no dependencies). Re-run it when maxroll updates
its guides:

```sh
node tools/scrape-maxroll.mjs          # re-uses downloads in tools/.cache
node tools/scrape-maxroll.mjs --fresh  # downloads everything again
```

It reads the [Late Game Tier List](https://maxroll.gg/d2/tierlists/overall-tier-list) for
the builds, each guide's "Item Options" gear table and Mercenary section, the guide's
planner profile for the best-in-slot loadout, and the D2 planner's game data for item stats.
Unique and set ratings are derived in `assets/builds.js`: each build that uses an item adds
its tier weight (scaled for best vs. alternative and character vs. mercenary), and used
items are ranked into S–D by score. Items no build uses are F.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

## Hosting (GitHub Pages)

Every push to `main` (including merged pull requests) deploys the site with the
workflow in `.github/workflows/deploy.yml`. It can also be run by hand from the
Actions tab.

One-time setup:

1. Settings → Pages: Source is "GitHub Actions", and Custom domain is `d2tools.drnz.se` with "Enforce HTTPS" on.
2. At the DNS provider for `drnz.se`, a `CNAME` record points `d2tools` to `draindrain.github.io`.
