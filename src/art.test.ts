// Checks the pose and grouping rules against a small made-up Server
// checkout, and the grouping against the pinned one in server/.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { classify, companions, creditFor, folder, pictures, status, type Companion, type Rules } from "./art.ts";
import { apngDelay, caption, esc, page, previewSize, type Art, type Shown } from "./build.ts";

/** The AnkiQuest-Server commit the submodule pins. */
const PINNED = fileURLToPath(new URL("../server", import.meta.url));

const LIST = {
  core: ["face", "streak", "frozen"],
  extensions: { streak_hot: "streak", streak_blazing: "streak_hot", frozen_2: "frozen" },
};

function server(): string {
  const root = mkdtempSync(join(tmpdir(), "gallery-"));
  const fixtures = join(root, "tests/fixtures");
  mkdirSync(fixtures, { recursive: true });
  writeFileSync(join(fixtures, "companion_poses.json"), JSON.stringify(LIST));
  writeFileSync(
    join(fixtures, "companion_unlock.json"),
    JSON.stringify({
      companions: [
        { companion: "cow", status: "live", secret: false },
        { companion: "anki_tan_chibi", status: "planned", secret: true },
        { companion: "quest_chan", status: "planned", secret: false },
      ],
    }),
  );
  writeFileSync(
    join(fixtures, "streak_moods.json"),
    JSON.stringify({
      moods: [
        { expected: { mood: "fire", pose: "streak" } },
        { expected: { mood: "fire", pose: "streak_hot" } },
        { expected: { mood: "frozen_1", pose: "frozen" } },
        { expected: { mood: "thawing", pose: "frozen" } },
        { expected: { mood: "frozen_1", pose: "frozen" } },
      ],
    }),
  );
  for (const dir of ["aki", "cow", "anki-tan/chibi"]) {
    mkdirSync(join(root, "static", dir), { recursive: true });
  }
  return root;
}

test("folders follow the id", () => {
  assert.equal(folder("aki"), "aki");
  assert.equal(folder("anki_tan"), "anki-tan");
  assert.equal(folder("anki_tan_chibi"), "anki-tan/chibi");
});

test("statuses follow fallbacks and old names", () => {
  const dir = join(server(), "static/aki");
  writeFileSync(join(dir, "streak.png"), "");

  // Drawn, fallback through two steps, and a chain with no master.
  assert.equal(status(dir, LIST, "streak").state, "drawn");
  assert.deepEqual(status(dir, LIST, "streak_blazing"), {
    state: "fallback",
    pose: "streak",
    file: join(dir, "streak.png"),
  });
  assert.equal(status(dir, LIST, "frozen_2").state, "missing");

  // The older file name counts after the pose's own.
  writeFileSync(join(dir, "freeze.png"), "");
  assert.equal(status(dir, LIST, "frozen").state, "drawn");
});

test("a poses.json list names the files", () => {
  const dir = join(server(), "static/cow");
  mkdirSync(join(dir, "emoji"));
  writeFileSync(join(dir, "emoji/fire.png"), "");
  writeFileSync(join(dir, "streak_hot.png"), "");
  writeFileSync(join(dir, "poses.json"), JSON.stringify({ poses: { streak: "emoji/fire.png" } }));

  assert.deepEqual(status(dir, LIST, "streak"), { state: "drawn", file: join(dir, "emoji/fire.png") });
  assert.equal(status(dir, LIST, "streak_hot").state, "drawn");
});

test("companions: starter first, secret and undrawn ones hidden", () => {
  const list = companions(server(), {});
  assert.deepEqual(
    list.map((c) => [c.name, c.stage]),
    [
      ["Aki", "live"],
      ["Bluma", "live"],
    ],
  );
  const frozen = list[0].poses.find((p) => p.name === "frozen");
  assert.deepEqual(frozen?.moods, ["frozen_1", "thawing"]);
  assert.equal(list[0].poses.find((p) => p.name === "streak_hot")?.kind, "extension");
});

test("escapes markup", () => {
  assert.equal(esc(`<a href="x">'&'</a>`), "&#60;a href=&#34;x&#34;&#62;&#39;&#38;&#39;&#60;/a&#62;");
});

test("previews are at most 480 px wide and keep the shape", () => {
  assert.deepEqual(previewSize(1254, 1254), [480, 480]);
  assert.deepEqual(previewSize(1024, 1536), [480, 720]);
  assert.deepEqual(previewSize(400, 300), [400, 300]);
});

test("each picture is filed into one group", () => {
  const root = server();
  const dir = join(root, "static/aki");
  for (const file of ["frozen.png", "freeze.png", "old.png", "face-32.png"]) {
    writeFileSync(join(dir, file), file);
  }
  writeFileSync(join(dir, "streak.png"), "streak");
  writeFileSync(join(dir, "same.png"), "streak");
  mkdirSync(join(dir, "emoji"));
  writeFileSync(join(dir, "emoji/a.png"), "");
  writeFileSync(join(dir, "README.md"), "Notes, not a picture.");

  const rules: Rules[string] = {
    "freeze.png": { group: "moment", note: "Freeze used" },
    "face-32.png": { group: "icon", note: "Tab icon" },
    "old.png": { group: "older", replacedBy: "freeze.png" },
    "same.png": { group: "older", replacedBy: "streak.png", note: "Saved" },
    "emoji/": { group: "pack", pack: "emoji" },
  };
  const filed = companions(root, { aki: rules })[0].pictures;

  // Poses by the pose list, the rest by file or folder rule; no notes.
  assert.deepEqual(
    filed.map((picture) => [picture.name, picture.place]),
    [
      ["emoji/a.png", { group: "pack", pack: "emoji" }],
      ["face-32.png", { group: "icon", note: "Tab icon" }],
      ["freeze.png", { group: "moment", note: "Freeze used" }],
      ["frozen.png", { group: "pose", poses: ["frozen"] }],
      ["old.png", { group: "older", replacedBy: "freeze.png", copy: "changed" }],
      ["same.png", { group: "older", replacedBy: "streak.png", note: "Saved", copy: "same" }],
      ["streak.png", { group: "pose", poses: ["streak"] }],
    ],
  );
  assert.equal(filed[0].file, "aki/emoji/a.png");
});

test("a picture no rule files fails the build", () => {
  const root = server();
  const dir = join(root, "static/aki");
  writeFileSync(join(dir, "new.png"), "");
  assert.throws(() => classify(root, dir, [], {}), /static\/aki: new\.png \(no group\)/);
});

test("a pose master a file rule also names, or a stale rule, fails", () => {
  const root = server();
  const dir = join(root, "static/aki");
  writeFileSync(join(dir, "streak.png"), "");
  const poses = companions(root, {})[0].poses;
  const twice: Rules[string] = { "streak.png": { group: "moment", note: "x" } };
  assert.throws(() => classify(root, dir, poses, twice), /streak\.png \(a pose master and a file rule\)/);

  const stale: Rules[string] = { "gone.png": { group: "older", replacedBy: "lost.png" } };
  assert.throws(() => classify(root, dir, poses, stale), /gone\.png \(no such file\), gone\.png \(replaced by lost\.png/);
});

test("a folder that is no companion's fails the build", () => {
  const root = server();
  mkdirSync(join(root, "static/stranger"));
  assert.throws(() => companions(root, {}), /static\/stranger: not a companion's folder/);
});

test("credit: nearest LICENSE, else README, else the server's licence", () => {
  const root = server();
  const top = join(root, "static/cow");
  mkdirSync(join(top, "archive/addon"), { recursive: true });
  writeFileSync(join(top, "LICENSE"), "Bluma by someone.\n\nLicensed CC BY-SA 4.0.\n\nMore terms.");
  writeFileSync(join(top, "archive/README.md"), "# Old\n\nKept as they were. Generated with image_gen.\n[The repository licence](../LICENSE) applies.\n\n| a | b |");

  assert.deepEqual(creditFor(root, top, join(top, "face.png")), {
    source: "cow/LICENSE",
    text: "Bluma by someone. Licensed CC BY-SA 4.0.",
    licence: "CC BY-SA 4.0",
  });
  assert.deepEqual(creditFor(root, top, join(top, "archive/addon/a.png")), {
    source: "cow/archive/README.md",
    text: "Generated with image_gen. The repository licence applies.",
    licence: "AGPL-3.0-or-later",
  });
  const aki = join(root, "static/aki");
  assert.equal(creditFor(root, aki, join(aki, "face.png")).source, "");

  // A README that names no licence the gallery knows fails.
  writeFileSync(join(top, "archive/README.md"), "Credit: someone.");
  assert.throws(() => creditFor(root, top, join(top, "archive/a.png")), /names no licence/);
});

test("captions say what replaced an older file", () => {
  assert.equal(caption({ group: "older", replacedBy: "happy.png", copy: "same" }), "Earlier name of happy.png, same picture.");
  assert.equal(
    caption({ group: "older", replacedBy: "neglected.png", copy: "changed", note: "Three stars" }),
    "Replaced by neglected.png. Three stars.",
  );
  assert.equal(caption({ group: "pose", poses: ["streak_hot"] }), "streak hot");
});

test("reads an animated PNG's frame delay", () => {
  // Signature, then an fcTL chunk whose delay is 1/8 s.
  const chunk = Buffer.alloc(12 + 26);
  chunk.writeUInt32BE(26, 0);
  chunk.write("fcTL", 4, "latin1");
  chunk.writeUInt16BE(1, 8 + 20);
  chunk.writeUInt16BE(8, 8 + 22);
  const path = join(mkdtempSync(join(tmpdir(), "gallery-")), "a.png");
  writeFileSync(path, Buffer.concat([Buffer.alloc(8), chunk]));
  assert.equal(apngDelay(path), 125);
});

/** Every picture under each section's folder in the pinned checkout. */
function pinnedPictures(list: Companion[]): string[] {
  const found: string[] = [];
  const static_ = join(PINNED, "static");
  for (const name of readdirSync(static_).sort()) {
    const dir = join(static_, name);
    if (statSync(dir).isDirectory() && list.some((companion) => companion.pictures.some((p) => p.file.startsWith(`${name}/`)))) {
      found.push(...pictures(dir));
    }
  }
  return found;
}

test("pinned server: every picture is filed exactly once", () => {
  const list = companions(PINNED);
  const filed = list.flatMap((companion) => companion.pictures.map((picture) => picture.path));
  assert.equal(new Set(filed).size, filed.length, "a picture is filed twice");
  assert.deepEqual([...filed].sort(), pinnedPictures(list).sort());

  // Each folder under static/ with pictures has a section.
  const static_ = join(PINNED, "static");
  for (const name of readdirSync(static_)) {
    const dir = join(static_, name);
    if (statSync(dir).isDirectory() && pictures(dir).length > 0) {
      assert.ok(filed.some((path) => path.startsWith(`${dir}/`)), `static/${name} has no section`);
    }
  }
});

test("pinned server: the pose section is unchanged", () => {
  const list = companions(PINNED);
  const shown: Shown = { art: new Map<string, Art>(), clips: new Map() };
  const art = (master: string): Art => ({ master, preview: master.replace(/\.png$/, ".webp"), width: 480, height: 480 });

  // The pose list's drawn masters are the pictures filed as poses.
  for (const companion of list) {
    const drawn = companion.poses.flatMap((pose) => (pose.status.state === "drawn" ? [pose.status.file] : []));
    const filed = companion.pictures.filter((picture) => picture.place.group === "pose").map((picture) => picture.path);
    assert.deepEqual([...new Set(drawn)].sort(), filed.sort(), companion.id);

    for (const pose of companion.poses) {
      if (pose.status.state === "drawn") {
        shown.art.set(pose.status.file, art(`art/${companion.id}/${pose.name}.png`));
      }
    }
    for (const picture of companion.pictures) {
      if (!shown.art.has(picture.path)) {
        shown.art.set(picture.path, art(`files/${picture.file}`));
      }
    }
    for (const sequence of companion.sequences) {
      shown.clips.set(sequence.frames, { art: art(`files/${sequence.animation}`), frames: [], delay: 125 });
    }
  }

  // Each grid holds the cards the gallery showed before the groups, as it wrote them.
  const html = page(list, shown);
  for (const companion of list) {
    const cards = companion.poses
      .filter((pose) => pose.status.state === "drawn")
      .map((pose) => {
        const label = pose.name.replaceAll("_", " ");
        const base = `art/${companion.id}/${pose.name}`;
        return `<li><a href="${base}.png"><img src="${base}.webp" alt="${companion.name}, ${label}" width="480" height="480" loading="lazy" decoding="async"></a><span>${label}</span></li>`;
      });
    const grid = new RegExp(`<section id="${companion.id}">[\\s\\S]*?<h3>Poses</h3>\\n<ul class="grid">\\n([\\s\\S]*?)\\n</ul>`).exec(html);
    if (cards.length === 0) {
      assert.equal(grid?.index, undefined, companion.id);
      continue;
    }
    assert.equal(grid?.[1], cards.join("\n"), companion.id);
  }
});
