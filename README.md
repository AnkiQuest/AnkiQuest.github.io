# AnkiQuest companions

The gallery at <https://ankiquest.github.io>: every drawn pose of every live companion, built from the pose masters in [AnkiQuest-Server](https://github.com/AnkiQuest/AnkiQuest-Server).

```sh
node src/build.ts <AnkiQuest-Server checkout> _site
```

Run it in the dev shell (`nix develop`), which has Node 22 and `cwebp`. The `pages` workflow builds and deploys on every push to `master` and daily.
