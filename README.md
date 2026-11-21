# AnkiQuest companions

The gallery at <https://ankiquest.github.io>: the art matrix of every companion by every item of AnkiQuest-Server's pose list (`tests/fixtures/companion_poses.json`), each cell drawn, showing its fallback, or missing; a page per companion with what it is missing, why and the issue tracking it; and the archive of replaced pictures, apart from current art. Every picture shows its licence.

The pages come from AnkiQuest-Server's `xtask art-coverage --json` (schema 1, `docs/branding/art-coverage.md` there), run in the AnkiQuest-Server commit the `server` submodule pins. The build copies each picture, licence and README the JSON names to `files/<path>` and makes the WebP previews; nothing here walks the masters' folders, so the paths follow the masters when they move. Dependabot opens a pull request when AnkiQuest-Server moves.

```sh
git submodule update --init
node src/build.ts server _site                 # runs cargo in server/
node src/build.ts server _site coverage.json   # or reads the JSON from a file
```

Run it in the dev shell (`nix develop`), which has Node 22 and `cwebp`; the first form also needs `cargo`. `npm test` checks how the JSON becomes pages. The `pages` workflow builds and deploys on every push to `master`.

## Wiring map

`wiring.html` shows how the AnkiQuest repositories, their upstreams and packages feed each other (submodules, Maven, Cargo, flake inputs, reusable workflows, pinned Server data, `AGENTS.md`, upstream merges, watched sources) and which pins are out of date. Its data, `wiring.json`, comes from `src/wiring.ts`, which reads every repository's default branch with git and the GitHub API:

```sh
node src/wiring.ts wiring.json
```

The `wiring` workflow runs it daily and opens a pull request when the map changes. Private repositories are never read: the page shows them only as nodes with their links to AnkiQuest repositories.

## Licence

AGPL-3.0-or-later ([LICENSE](LICENSE)). The pictures keep the licence of their masters in AnkiQuest-Server; the gallery shows the licence and credit art-coverage gives for each companion and archive folder.
