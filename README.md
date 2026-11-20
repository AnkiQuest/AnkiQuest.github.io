# AnkiQuest companions

The gallery at <https://ankiquest.github.io>: every drawn pose of every live companion, built from the pose masters in [AnkiQuest-Server](https://github.com/AnkiQuest/AnkiQuest-Server).

The masters come from the AnkiQuest-Server commit the `server` submodule
pins; Dependabot opens a pull request when AnkiQuest-Server moves.

```sh
git submodule update --init
node src/build.ts server _site
```

Run it in the dev shell (`nix develop`), which has Node 22 and `cwebp`. The `pages` workflow builds and deploys on every push to `master`.
