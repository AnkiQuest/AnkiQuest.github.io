# AnkiQuest companions

The gallery at <https://ankiquest.github.io>: every picture of every companion, built from the masters in [AnkiQuest-Server](https://github.com/AnkiQuest/AnkiQuest-Server) `static/`. Each companion's pictures are grouped into poses, moments, icons, pack art and older versions; `RULES` in `src/art.ts` files every picture that is not a pose master, and the build fails on a picture it does not file.

The masters come from the AnkiQuest-Server commit the `server` submodule
pins; Dependabot opens a pull request when AnkiQuest-Server moves.

```sh
git submodule update --init
node src/build.ts server _site
```

Run it in the dev shell (`nix develop`), which has Node 22, `cwebp` and `webpmux`. The `pages` workflow builds and deploys on every push to `master`.

## Licence

AGPL-3.0-or-later ([LICENSE](LICENSE)). The pictures keep the licence of their masters in AnkiQuest-Server; the gallery shows the credit and licence from each folder's `LICENSE` or `README.md` there.
