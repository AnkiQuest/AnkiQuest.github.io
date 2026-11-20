# AnkiQuest companions

The gallery at <https://ankiquest.github.io>: every drawn pose of every live companion, built from the pose masters in [AnkiQuest-Server](https://github.com/AnkiQuest/AnkiQuest-Server).

```sh
node src/build.ts <AnkiQuest-Server checkout> _site
```

Needs Node 22.18 or later and `cwebp` (package `webp`). The `pages` workflow builds and deploys on every push to `main` and daily.

## Licence

AGPL-3.0-or-later ([LICENSE](LICENSE)). The poses keep the licence of their masters in AnkiQuest-Server; the gallery shows each companion's credit from its `LICENSE` file there.
