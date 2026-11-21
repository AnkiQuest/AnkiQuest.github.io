# AnkiQuest companions

The gallery at <https://ankiquest.github.io>: every picture of every companion, built from the masters in [AnkiQuest-Server](https://github.com/AnkiQuest/AnkiQuest-Server) `static/`. Each companion's pictures are grouped into poses, moments, icons, pack art and older versions; `RULES` in `src/art.ts` files every picture that is not a pose master, and the build fails on a picture it does not file.

The masters come from the AnkiQuest-Server commit the `server` submodule
pins; Dependabot opens a pull request when AnkiQuest-Server moves.

```sh
git submodule update --init
node src/build.ts server _site
```

Run it in the dev shell (`nix develop`), which has Node 22, `cwebp` and `webpmux`. The `pages` workflow builds and deploys on every push to `master`.

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

AGPL-3.0-or-later ([LICENSE](LICENSE)). The pictures keep the licence of their masters in AnkiQuest-Server; the gallery shows the credit and licence from each folder's `LICENSE` or `README.md` there.
