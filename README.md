# AnkiQuest companions

The gallery at <https://ankiquest.github.io>: every picture of every companion, from [AnkiQuest-Art](https://github.com/AnkiQuest/AnkiQuest-Art). Each companion's section has:

- a table of the poses in AnkiQuest-Server's `tests/fixtures/companion_poses.json` and what the companion shows for each: its master, a fallback, or missing;
- Shigeyuki's original art: his Anki-tan asset pack as he made it, under Anki-tan, with the pictures the apps use marked; under Anki-tan chibi, the pack pictures she uses;
- art we made: derivatives of Shigeyuki's Anki-tan (CC BY-SA 4.0) and AnkiQuest's own companions (AGPL-3.0-or-later), split into what the apps use (Art's masters) and what is retired (Art's archive).

Every card shows the picture's author and licence. `src/art.ts` reads them from Art's `manifest.json` (`origin`, `author`, `licence`, `pack`, `missing`, `archive`); a picture in Art the manifest does not list, or a picture with no entry in `NOTES`, fails the build.

The pictures come from the AnkiQuest-Art commit the `art` submodule pins, and the pose list, unlocks and moods from the AnkiQuest-Server commit the `server` submodule pins; Dependabot opens a pull request when either moves.

```sh
git submodule update --init
node src/build.ts server art _site
```

Run it in the dev shell (`nix develop`), which has Node 22, `cwebp` and `webpmux`. The `pages` workflow builds and deploys on every push to `master`.

## Wiring map

`wiring.html` shows how the AnkiQuest repositories, their upstreams and packages feed each other (submodules, Maven, Cargo, flake inputs, reusable workflows, pinned Server data, `AGENTS.md`, upstream merges, watched sources) and which pins are out of date. Its data, `wiring.json`, comes from `src/wiring.ts`, which reads every repository's default branch with git and the GitHub API:

```sh
node src/wiring.ts wiring.json
```

The `wiring` workflow runs it daily and opens a pull request when the map changes. Private repositories are never read: the page shows them only as nodes with their links to AnkiQuest repositories.

## Licence

AGPL-3.0-or-later ([LICENSE](LICENSE)). The pictures keep their licence in AnkiQuest-Art; the gallery shows each picture's author and licence from its manifest, and the credit from each companion's `LICENSE`.
