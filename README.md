# D2tools

Tools for Diablo II: Resurrected, hosted at https://d2tools.drnz.se.

A plain static site with no build step: HTML, CSS and ES modules.

## Tools

- **Rune Tab** (`runes/`): light up the runes you own, in a layout modelled on the
  D2R stash Runes tab, and see which runewords you can make. You can filter by item
  slot, maxroll tier (D and F are hidden by default), class, and missing runes.
  - Rune, runeword, tier and build data lives in `runes/data.js`.
  - The grid arrangement is set by `RUNE_LAYOUT` in `runes/data.js`.
  - Tiers come from the [maxroll.gg Runeword Tier List](https://maxroll.gg/d2/tierlists/runeword-tier-list).
    Class usefulness comes from the runewords used in the
    [maxroll.gg Late Game Tier List](https://maxroll.gg/d2/tierlists/overall-tier-list) build guides.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

## Hosting (GitHub Pages)

1. In the repo, go to Settings → Pages and set Source to "Deploy from a branch", using `main` and `/ (root)`.
2. At your DNS provider for `drnz.se`, add a `CNAME` record from `d2tools` to `draindrain.github.io`.
3. The `CNAME` file in this repo sets the custom domain. Once DNS resolves, enable "Enforce HTTPS".
