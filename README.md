# AnkiQuest companions

The gallery at <https://ankiquest.github.io>: every AnkiQuest companion and
pose, which poses are core or extensions, the moods that show each pose,
and which poses are not drawn yet.

This repository holds only the page code and its workflow. The pictures
are the pose masters in
[AnkiQuest-Server](https://github.com/AnkiQuest/AnkiQuest-Server)
`static/<companion>/`; the build copies them unchanged into the site and
nothing here commits them.

## How it builds

`src/build.ts` reads an AnkiQuest-Server checkout:

- `tests/fixtures/companion_poses.json`: the core poses and each
  extension's fallback.
- `tests/fixtures/companion_unlock.json`: which companions are live.
  Secret companions stay hidden, as in the apps.
- `tests/fixtures/streak_moods.json`: the moods that show each pose.
- `static/<companion>/`: the masters. A pose's master is the file the
  folder's `poses.json` lists, else `<pose>.png`, else its older name; a
  missing extension shows the first pose its fallback chain reaches. These
  are the rules of `xtask art-coverage` in AnkiQuest-Server.

It writes `index.html`, `style.css`, `filter.js` and `art/<companion>/<pose>.png`.

The `pages` workflow builds from AnkiQuest-Server `master` and deploys to
GitHub Pages on every push to `main`, daily, by hand, and on a
`repository_dispatch` of type `art-changed`. Pull requests run the tests
and the build without deploying.

## Run locally

Node 22.18 or later runs the TypeScript directly; there are no
dependencies.

```sh
git clone https://github.com/AnkiQuest/AnkiQuest-Server ../AnkiQuest-Server
npm test
node src/build.ts ../AnkiQuest-Server _site
python3 -m http.server -d _site 8000   # or any static file server
```
