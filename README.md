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
    Class usefulness comes from the runewords used in the
    [maxroll.gg Late Game Tier List](https://maxroll.gg/d2/tierlists/overall-tier-list) build guides.

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
