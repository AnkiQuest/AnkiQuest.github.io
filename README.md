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
```

The `wiring` workflow runs it daily and opens a pull request when the map changes. Private repositories are never read: the page shows them only as nodes with their links to AnkiQuest repositories.

The page lays the map out by hand: `LAYOUT` in `site/wiring.ts` places every node in a lane (upstreams, core, clients, app forks, server and web, shared infrastructure), so the picture stays the same between regenerations. A new node is placed at the bottom of its lane until it gets an entry there.

## Licence

AGPL-3.0-or-later ([LICENSE](LICENSE)). The pictures keep the licence of their masters in AnkiQuest-Server; the gallery shows the credit and licence from each folder's `LICENSE` or `README.md` there.
