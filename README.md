# AnkiQuest companions

The gallery at <https://ankiquest.github.io>: the art matrix of every companion by every item of the pose list (AnkiQuest-Art's `poses.json`), each cell drawn, empty (naming the fallback the apps show) or missing; a page per companion with what it is missing, why and the issue tracking it; and the archive, apart from current art. Every picture card shows who made it, its author and its licence, from [AnkiQuest-Art](https://github.com/AnkiQuest/AnkiQuest-Art)'s `manifest.json`:

- Shigeyuki's original art: files of his Anki-tan asset pack, unchanged. Each companion page lists them apart from the art we made; the archive page links his own Anki-tan page instead of showing his pack, and names the pack files the apps use;
- art we made: derivatives of Shigeyuki's Anki-tan (CC BY-SA 4.0) and AnkiQuest's own companions (AGPL-3.0-or-later), in use (the masters, on the matrix and companion pages) or retired (Art's archive, on the archive page; Anki-tan's retired art is not shown).

Anki-tan chibi has her own column and page as a future companion.

What each companion shows comes from the art matrix the site derives itself (`src/matrix.ts`): the items and fallbacks of AnkiQuest-Art's `poses.json`, the masters of its `manifest.json`, and the live and planned companions of AnkiQuest-Server `master` (`tests/fixtures/companion_unlock.json`, cloned into `server/`). `src/manifest.ts` finds each picture the matrix shows in Art and copies it to `files/<Art path>` with its WebP previews. A picture in Art that the manifest does not list, a licence the gallery does not know, or a manifest companion the companion table does not list fails the build. The AnkiQuest-Art release arrives through the `ankiquest-art.json` pin (staged by `src/art-release.ts`, which downloads and hash-checks the assets; AnkiQuest-Sync bumps it). Server changes reach the site through the `pages` workflow's daily run.

```sh
git clone --depth 1 --filter=blob:none --sparse https://github.com/AnkiQuest/AnkiQuest-Server server
git -C server sparse-checkout set tests/fixtures  # server master's fixtures
node src/art-release.ts ankiquest-art.json .art   # stage the pinned Art release
node src/build.ts server .art _site                # from that data
node src/build.ts server .art _site coverage.json  # or trusts a matrix JSON
```

Run it in the dev shell (`nix develop`), which has Node 22 and `cwebp`. `npm test` checks how the JSON and Art's manifest become pages, and the mapping tool. The `pages` workflow builds and deploys on every push to `master` and daily.

## Mapping tool

`mapping.html` chooses which picture of Art each companion shows for every slot: the core moods, extensions, launcher icons and moment and notification pictures of AnkiQuest-Art's `poses.json`, and the monochrome launcher icon the exporter makes. A slot without a picture shows its fallback, or for a core mood its `core_fallbacks` entry (happy and streak show hopeful while undrawn). Each row says in plain words where the apps show the slot (`src/slots.ts`; a new pose without a note there fails the build) and its framing rule: head only for the face and launcher icons, full body for the rest, warned about, not blocked, when a master's `framing` in `manifest.json` disagrees. A click on a cell opens a picker of every picture in Art, archive and Shigeyuki's pack included. Changes stay in the page, with a draft in the browser's storage; the page lists them against `manifest.json` and exports JSON in the shape of its `masters` (`from` names an archive picture to copy to `file`), to attach to a pull request or issue in AnkiQuest-Art or hand to an agent. The build writes its data to `mapping.json` (`src/mapping.ts`); `site/mapping.ts` is the page's script.

## Wiring map

`wiring.html` shows how the AnkiQuest repositories, their upstreams and packages feed each other (submodules, Maven, Cargo, flake inputs, reusable workflows, pinned Server data, `AGENTS.md`, upstream merges, watched sources) and which pins are out of date. Its data, `wiring.json`, comes from `src/wiring.ts`, which reads every repository's default branch with git and the GitHub API:

```sh
node src/wiring.ts wiring.json
npm ci
node src/wiring-mermaid.ts
```

`src/wiring-mermaid.ts` writes the same map as Mermaid, `wiring.mmd` (one subgraph per lane, for agents), and renders it with mermaid-cli to `wiring.svg` and `wiring-dark.svg`, which the page shows. The site serves `wiring.json`, `wiring.mmd` and both SVGs at its root. `npm test` checks that the committed files match `wiring.json` and needs `npm ci` first; set `PUPPETEER_EXECUTABLE_PATH` to use a Chromium already installed. Every edge joins one pair of nodes and lists each kind of link between them (a Cargo pin and a watched source of the same repository are one edge), with each fact's pin and file.

The `wiring` workflow runs both daily and opens a pull request when the map changes. Private repositories are never read: the page shows them only as nodes with their links to AnkiQuest repositories.

The page lays the map out by hand: `LAYOUT` in `site/wiring.ts` places every node in a lane (upstreams, core, clients, app forks, server and web, shared infrastructure), so the picture stays the same between regenerations. A new node is placed at the bottom of its lane until it gets an entry there.

## Licence

AGPL-3.0-or-later ([LICENSE](LICENSE)). The pictures keep their licence in AnkiQuest-Art; the gallery shows each picture's author and licence from its manifest, and each companion page its licence and credit.
