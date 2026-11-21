// Checks the pose rules and the split into Shigeyuki's originals, art in
// use and retired art against small made-up Server and Art checkouts, and
// the whole page against the pinned ones in server/ and art/.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { companions, folder, manifest, status, unlisted, type Companion } from "./art.ts";
import { apngDelay, esc, page, previewSize, shows, type Shown } from "./build.ts";

/** The AnkiQuest-Server commit the submodule pins: fixtures. */
const SERVER = fileURLToPath(new URL("../server", import.meta.url));

/** The AnkiQuest-Art commit the submodule pins: pictures. */
const ART = fileURLToPath(new URL("../art", import.meta.url));

const LIST = {
  core: ["face", "streak", "frozen"],
  extensions: { streak_hot: "streak", streak_blazing: "streak_hot", frozen_2: "frozen" },
};

function server(): string {
  const root = mkdtempSync(join(tmpdir(), "gallery-server-"));
  const fixtures = join(root, "tests/fixtures");
  mkdirSync(fixtures, { recursive: true });
  writeFileSync(join(fixtures, "companion_poses.json"), JSON.stringify(LIST));
  writeFileSync(
    join(fixtures, "companion_unlock.json"),
    JSON.stringify({
      companions: [
        { companion: "anki_tan", status: "live", secret: false },
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
        { expected: { mood: "frozen_1", pose: "frozen" } },
        { expected: { mood: "thawing", pose: "frozen" } },
        { expected: { mood: "frozen_1", pose: "frozen" } },
      ],
    }),
  );
  return root;
}

/** Writes `files` (path to contents) under `root`. */
function write(root: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
}

const SHIGEYUKI = { origin: "shigeyuki", author: "Shigeyuki", licence: "CC-BY-SA-4.0" };
const DERIVED = { origin: "derivative", author: "AnkiQuest, after Shigeyuki", licence: "CC-BY-SA-4.0" };
const OWN = { origin: "ankiquest", author: "AnkiQuest", licence: "AGPL-3.0-or-later" };

/** An Art checkout: Aki, Anki-tan with a pack, and her chibi sharing one pack file. */
function art(): string {
  const root = mkdtempSync(join(tmpdir(), "gallery-art-"));
  write(root, {
    "aki/face.png": "face",
    "aki/icon.png": "icon",
    "anki-tan/streak.png": "fire",
    "anki-tan/frozen.png": "cold",
    "anki-tan/chibi/streak.png": "fire",
    "anki-tan/chibi/face.png": "frame 1",
    "duo/friends.png": "friends",
    "archive/anki-tan/frozen-old.png": "colder",
    "archive/anki-tan-pack/emoji/smile.png": "smile",
    "archive/anki-tan-pack/sprite/idle/2.png": "frame 2",
    "archive/anki-tan-pack/sprite/Anki-tan_idle_240px.png": "animation",
    "archive/anki-tan-pack/sprite/hello/1.png": "hello 1",
    "archive/anki-tan-pack/sprite/Anki-tan_hello_240px.png": "hello",
    "docs/review.png": "a review sheet, not art",
  });
  const data = {
    masters: [
      { companion: "aki", pose: "face", kind: "core", file: "aki/face.png", ...OWN },
      { companion: "aki", pose: "icon", kind: "picture", file: "aki/icon.png", ...OWN },
      { companion: "anki_tan", pose: "streak", kind: "core", file: "anki-tan/streak.png", ...SHIGEYUKI, pack: "emoji/fire.png" },
      { companion: "anki_tan", pose: "frozen", kind: "core", file: "anki-tan/frozen.png", ...DERIVED },
      { companion: "anki_tan_chibi", pose: "streak", kind: "core", file: "anki-tan/chibi/streak.png", ...SHIGEYUKI, pack: "emoji/fire.png" },
      { companion: "anki_tan_chibi", pose: "face", kind: "core", file: "anki-tan/chibi/face.png", ...SHIGEYUKI, pack: "sprite/idle/1.png" },
    ],
    shared: [{ name: "friends", shows: ["aki", "anki_tan"], file: "duo/friends.png", ...OWN }],
    missing: [{ companion: "anki_tan", pose: "face", issue: "https://example.org/57" }],
    archive: {
      retired: [
        {
          companion: "anki_tan",
          pose: "frozen",
          file: "archive/anki-tan/frozen-old.png",
          replaced_by: "anki-tan/frozen.png",
          note: "Colder.",
          ...DERIVED,
        },
      ],
      pack: { companion: "anki_tan", folder: "archive/anki-tan-pack/", source: "https://example.org", ...SHIGEYUKI },
    },
  };
  writeFileSync(join(root, "manifest.json"), JSON.stringify(data));
  return root;
}

const NOTES = { "aki/icon.png": "Launcher icon", "duo/friends.png": "Friends panel" };

test("folders follow the id", () => {
  assert.equal(folder("aki"), "aki");
  assert.equal(folder("anki_tan"), "anki-tan");
  assert.equal(folder("anki_tan_chibi"), "anki-tan/chibi");
});

test("statuses follow fallbacks; a missing pose keeps its issue", () => {
  const drawn = new Map([["streak", "aki/streak.png"]]);
  assert.deepEqual(status(drawn, LIST, "streak"), { state: "drawn", file: "aki/streak.png" });
  assert.deepEqual(status(drawn, LIST, "streak_blazing"), { state: "fallback", pose: "streak", file: "aki/streak.png" });
  assert.deepEqual(status(drawn, LIST, "frozen_2", "https://example.org/57"), {
    state: "missing",
    issue: "https://example.org/57",
  });
});

test("companions with art, chibi as a future companion, shared last", () => {
  const list = companions(server(), art(), NOTES);
  assert.deepEqual(
    list.map((c) => [c.id, c.name, c.stage]),
    [
      ["aki", "Aki", "live"],
      ["anki_tan", "Anki-tan", "live"],
      ["anki_tan_chibi", "Anki-tan chibi", "planned"],
      ["friends", "Aki and Anki-tan", "shared"],
    ],
  );
  const frozen = list[1].poses.find((p) => p.name === "frozen");
  assert.deepEqual(frozen?.moods, ["frozen_1", "thawing"]);
  assert.equal(frozen?.origin, "derivative");
});

test("Anki-tan: the whole pack is Shigeyuki's, our art is used or retired", () => {
  const tan = companions(server(), art(), NOTES)[1];

  // The pack as he made it: masters under their pack path, each use named.
  assert.deepEqual(
    tan.original.map((p) => [p.name, p.file, p.note]),
    [
      ["emoji/fire.png", "anki-tan/streak.png", "Used for Anki-tan: streak; Anki-tan chibi: streak"],
      ["emoji/smile.png", "archive/anki-tan-pack/emoji/smile.png", ""],
      ["sprite/Anki-tan_hello_240px.png", "archive/anki-tan-pack/sprite/Anki-tan_hello_240px.png", ""],
      ["sprite/Anki-tan_idle_240px.png", "archive/anki-tan-pack/sprite/Anki-tan_idle_240px.png", ""],
      ["sprite/hello/1.png", "archive/anki-tan-pack/sprite/hello/1.png", ""],
      ["sprite/idle/1.png", "anki-tan/chibi/face.png", "Used for Anki-tan chibi: face"],
      ["sprite/idle/2.png", "archive/anki-tan-pack/sprite/idle/2.png", ""],
    ],
  );
  assert.ok(tan.original.every((p) => p.author === "Shigeyuki" && p.licence === "CC BY-SA 4.0"));

  // The animations take their frames from the pack, a master included.
  assert.deepEqual(
    tan.sequences.map((s) => [s.name, s.frames.map((f) => f.file), s.animation.file]),
    [
      ["hello", ["archive/anki-tan-pack/sprite/hello/1.png"], "archive/anki-tan-pack/sprite/Anki-tan_hello_240px.png"],
      ["idle", ["anki-tan/chibi/face.png", "archive/anki-tan-pack/sprite/idle/2.png"], "archive/anki-tan-pack/sprite/Anki-tan_idle_240px.png"],
    ],
  );

  assert.deepEqual(
    tan.used.map((p) => [p.file, p.origin, p.note]),
    [["anki-tan/frozen.png", "derivative", "frozen"]],
  );
  assert.deepEqual(
    tan.retired.map((p) => [p.file, p.note, p.licence]),
    [["archive/anki-tan/frozen-old.png", "Replaced by anki-tan/frozen.png. Colder.", "CC BY-SA 4.0"]],
  );
  assert.deepEqual(tan.poses.find((p) => p.name === "face")?.status, { state: "missing", issue: "https://example.org/57" });
});

test("the chibi shows only the pack files it uses", () => {
  const chibi = companions(server(), art(), NOTES)[2];
  assert.deepEqual(
    chibi.original.map((p) => p.name),
    ["emoji/fire.png", "sprite/idle/1.png"],
  );
  assert.deepEqual(chibi.used, []);
  assert.deepEqual(chibi.sequences, []);
});

test("our own art carries its note, author and licence", () => {
  const aki = companions(server(), art(), NOTES)[0];
  assert.deepEqual(
    aki.used.map((p) => [p.file, p.note, p.author, p.licence]),
    [
      ["aki/face.png", "face", "AnkiQuest", "AGPL-3.0-or-later"],
      ["aki/icon.png", "Launcher icon", "AnkiQuest", "AGPL-3.0-or-later"],
    ],
  );
});

test("a picture the manifest does not list fails, docs/ aside", () => {
  const root = art();
  assert.deepEqual(unlisted(root, manifest(root)), []);
  write(root, { "aki/new.png": "" });
  assert.deepEqual(unlisted(root, manifest(root)), ["aki/new.png"]);
  assert.throws(() => companions(server(), root, NOTES), /aki\/new\.png: not in manifest\.json/);
});

test("a picture with no note, or a note for no picture, fails", () => {
  assert.throws(() => companions(server(), art(), { "duo/friends.png": "x" }), /aki\/icon\.png is a picture with no note/);
  assert.throws(() => companions(server(), art(), { ...NOTES, "aki/gone.png": "x" }), /aki\/gone\.png/);
});

test("pose table text", () => {
  assert.equal(shows({ name: "face", kind: "core", moods: [], status: { state: "missing", issue: "https://x/57" } }), 'Missing (<a href="https://x/57">to draw</a>)');
  assert.equal(
    shows({ name: "streak", kind: "core", moods: [], status: { state: "drawn", file: "a.png" }, origin: "shigeyuki" }),
    "<code>a.png</code> (Shigeyuki's)",
  );
  assert.equal(
    shows({ name: "streak_hot", kind: "extension", moods: [], status: { state: "fallback", pose: "streak", file: "a.png" } }),
    "Falls back to streak",
  );
});

test("escapes markup", () => {
  assert.equal(esc(`<a href="x">'&'</a>`), "&#60;a href=&#34;x&#34;&#62;&#39;&#38;&#39;&#60;/a&#62;");
});

test("previews are at most 480 px wide and keep the shape", () => {
  assert.deepEqual(previewSize(1254, 1254), [480, 480]);
  assert.deepEqual(previewSize(1024, 1536), [480, 720]);
  assert.deepEqual(previewSize(400, 300), [400, 300]);
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

/** The page for `list` with made-up previews. */
function html(list: Companion[]): string {
  const shown: Shown = { art: new Map(), clips: new Map() };
  const fake = (file: string) => ({ master: file, preview: file, width: 480, height: 480 });
  for (const companion of list) {
    for (const picture of [...companion.original, ...companion.used, ...companion.retired]) {
      shown.art.set(picture.file, fake(picture.file));
    }
    for (const sequence of companion.sequences) {
      shown.clips.set(sequence.name, { art: fake(sequence.animation.file), frames: sequence.frames.map((f) => f.file), delay: 40 });
    }
  }
  return page(list, shown);
}

test("pinned: every picture is shown, Shigeyuki's apart from ours", () => {
  const list = companions(SERVER, ART);
  const page = html(list);

  // The manifest accounts for every picture, and the page shows each file.
  assert.deepEqual(unlisted(ART, manifest(ART)), []);
  const data = manifest(ART);
  const files = [
    ...data.masters.map((m) => m.file),
    ...data.shared.map((s) => s.file),
    ...data.archive.retired.map((r) => r.file),
  ];
  const shownFiles = new Set(
    list.flatMap((c) => [
      ...c.original.map((p) => p.file),
      ...c.used.map((p) => p.file),
      ...c.retired.map((p) => p.file),
      ...c.sequences.flatMap((s) => [s.animation.file, ...s.frames.map((f) => f.file)]),
    ]),
  );
  // A master that copies a pack file another master holds is shown as that file.
  const copies = data.masters.filter((m) => m.pack !== undefined && !shownFiles.has(m.file));
  for (const copy of copies) {
    const holder = data.masters.find((m) => m.pack === copy.pack && shownFiles.has(m.file));
    assert.ok(holder, `${copy.file} is not shown`);
  }
  assert.deepEqual(
    files.filter((f) => !shownFiles.has(f) && !copies.some((c) => c.file === f)),
    [],
  );

  // Anki-tan: Shigeyuki's section before ours; her face is missing; the chibi is a future companion.
  const tan = /<section id="anki_tan">[\s\S]*?<\/section>/.exec(page)?.[0] ?? "";
  assert.ok(tan.indexOf("<h3>Shigeyuki's original art</h3>") < tan.indexOf("<h3>Art we made</h3>"));
  assert.match(tan, /<tr><td>face<\/td><td>core<\/td><td>Missing/);
  assert.match(tan, /<h4>Retired<\/h4>[\s\S]*neglected-three-blue-stars\.png/);
  const chibi = /<section id="anki_tan_chibi">[\s\S]*?<\/section>/.exec(page)?.[0] ?? "";
  assert.match(chibi, /Future companion/);
  assert.match(chibi, /<tr><td>face<\/td><td>core<\/td><td><code>anki-tan\/chibi\/face\.png<\/code> \(Shigeyuki's\)/);

  // Our own companions have no Shigeyuki section.
  for (const id of ["aki", "ankilope", "cow"]) {
    const part = new RegExp(`<section id="${id}">[\\s\\S]*?</section>`).exec(page)?.[0] ?? "";
    assert.ok(part.includes("<h3>Art we made</h3>"), id);
    assert.ok(!part.includes("Shigeyuki"), id);
  }
});
