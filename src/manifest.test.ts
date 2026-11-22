// Checks how the gallery reads AnkiQuest-Art's manifest, on a made-up Art
// checkout: every picture credited and listed, the build-time guards, and
// the art matrix turned to Art paths.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import type { Coverage } from "./coverage.ts";
import { folder, licence, localize, packUsed, pictures, type Manifest } from "./manifest.ts";

/** A manifest: Aki's own art, Anki-tan's pack sticker and derivative, a shared, a retired and a pack picture. */
function manifest(): Manifest {
  return {
    masters: [
      { companion: "aki", pose: "face", kind: "core", file: "aki/face.png", licence: "AGPL-3.0-or-later", origin: "ankiquest", author: "AnkiQuest" },
      { companion: "aki", pose: "study", kind: "picture", file: "aki/study.png", licence: "AGPL-3.0-or-later", origin: "ankiquest", author: "AnkiQuest" },
      {
        companion: "anki_tan",
        pose: "happy",
        kind: "core",
        file: "anki-tan/happy.png",
        licence: "CC-BY-SA-4.0",
        origin: "shigeyuki",
        author: "Shigeyuki",
        pack: "sticker/good.png",
      },
      {
        companion: "anki_tan_chibi",
        pose: "face",
        kind: "core",
        file: "anki-tan/chibi/face.png",
        licence: "CC-BY-SA-4.0",
        origin: "shigeyuki",
        author: "Shigeyuki",
        pack: "sprite/idle/0001.png",
      },
      { companion: "anki_tan", pose: "sad", kind: "core", file: "anki-tan/sad.png", licence: "CC-BY-SA-4.0", origin: "derivative", author: "AnkiQuest, after Shigeyuki" },
    ],
    shared: [{ name: "friends", shows: ["aki", "anki_tan"], file: "duo/friends.png", licence: "AGPL-3.0-or-later", origin: "ankiquest", author: "AnkiQuest" }],
    missing: [],
    archive: {
      retired: [
        {
          companion: "anki_tan",
          pose: "sad",
          file: "archive/anki-tan/sad-old.png",
          replaced_by: "anki-tan/sad.png",
          licence: "CC-BY-SA-4.0",
          origin: "derivative",
          author: "AnkiQuest, after Shigeyuki",
        },
      ],
      pack: {
        companion: "anki_tan",
        folder: "archive/anki-tan-pack/",
        licence: "CC-BY-SA-4.0",
        origin: "shigeyuki",
        author: "Shigeyuki",
        source: "https://shigeyukey.github.io/shige-addons-wiki/Anki-tan.html",
      },
    },
  };
}

/** A made-up Art checkout with a file per listed picture (its bytes are its path), plus `extra`. */
function checkout(data: Manifest, extra: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), "art-"));
  const files = [
    ...data.masters.map((entry) => entry.file),
    ...data.shared.map((entry) => entry.file),
    ...data.archive.retired.map((entry) => entry.file),
    "archive/anki-tan-pack/emoji/smile.png",
    "docs/review/sheet.png",
    ...extra,
  ];
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), file);
  }
  return root;
}

/** A matrix in the shape art-coverage prints, with Server paths. */
function coverage(): Coverage {
  return {
    schema: 1,
    fixture: "tests/fixtures/companion_poses.json",
    kinds: [{ kind: "core_mood", core: true }],
    items: [
      { name: "face", kind: "core_mood", fallback: null },
      { name: "happy", kind: "core_mood", fallback: null },
      { name: "sad", kind: "core_mood", fallback: null },
    ],
    licences: {
      repository: { spdx: "AGPL-3.0-or-later", file: "LICENSE", credit: null },
      "anki-tan": { spdx: "CC-BY-SA-4.0", file: "static/anki-tan/LICENSE", credit: "Anki-tan by Shigeyuki" },
    },
    companions: [
      {
        id: "aki",
        name: "Aki",
        folder: "static/aki",
        stage: "live",
        licence: "repository",
        items: [
          { name: "face", kind: "core_mood", status: "present", file: "static/aki/face.png" },
          { name: "happy", kind: "core_mood", status: "fallback", shows: "face", file: "static/aki/face.png" },
          { name: "sad", kind: "core_mood", status: "missing" },
        ],
        missing: { core: ["sad"], extensions: [] },
        unlisted: [],
      },
      {
        id: "anki_tan",
        name: "Anki-tan",
        folder: "static/anki-tan",
        stage: "live",
        licence: "anki-tan",
        items: [
          // Server shows the pack's idle frame, which Art keeps as the chibi's face.
          { name: "face", kind: "core_mood", status: "present", file: "static/anki-tan/sprite/idle/0001.png" },
          { name: "happy", kind: "core_mood", status: "present", file: "static/anki-tan/sticker/good.png" },
          { name: "sad", kind: "core_mood", status: "present", file: "static/anki-tan/sad.png" },
        ],
        missing: { core: [], extensions: [] },
        unlisted: [],
      },
      {
        id: "anki_tan_chibi",
        name: "Anki-tan chibi",
        folder: "static/anki-tan/chibi",
        stage: "planned",
        licence: "anki-tan",
        items: [
          { name: "face", kind: "core_mood", status: "present", file: "static/anki-tan/sprite/idle/0001.png" },
          { name: "happy", kind: "core_mood", status: "missing" },
          { name: "sad", kind: "core_mood", status: "missing" },
        ],
        missing: { core: ["happy", "sad"], extensions: [] },
        unlisted: [],
      },
    ],
    archive: [{ folder: "static/cow/archive", licence: "repository", readme: null, files: ["static/cow/archive/face.png"] }],
  };
}

/** Finds a Server file by its bytes: in the made-up checkout, the idle frame is the chibi's face. */
const same = (file: string) => (file === "static/anki-tan/sprite/idle/0001.png" ? "anki-tan/chibi/face.png" : undefined);

test("pictures: masters, shared, retired and pack files, each credited", () => {
  const data = manifest();
  const art = checkout(data);
  try {
    const found = pictures(art, data);
    assert.deepEqual([...found.keys()].sort(), [
      "aki/face.png",
      "aki/study.png",
      "anki-tan/chibi/face.png",
      "anki-tan/happy.png",
      "anki-tan/sad.png",
      "archive/anki-tan-pack/emoji/smile.png",
      "archive/anki-tan/sad-old.png",
      "duo/friends.png",
    ]);
    assert.deepEqual(found.get("archive/anki-tan-pack/emoji/smile.png"), {
      file: "archive/anki-tan-pack/emoji/smile.png",
      origin: "shigeyuki",
      author: "Shigeyuki",
      licence: "CC-BY-SA-4.0",
      pack: "emoji/smile.png",
    });
    assert.equal(found.get("anki-tan/happy.png")?.pack, "sticker/good.png");
    assert.equal(found.get("archive/anki-tan/sad-old.png")?.origin, "derivative");
  } finally {
    rmSync(art, { recursive: true });
  }
});

test("pictures: a picture the manifest does not list fails; docs/ is skipped", () => {
  const data = manifest();
  const art = checkout(data, ["aki/stray.png"]);
  try {
    assert.throws(() => pictures(art, data), /aki\/stray\.png: not in manifest\.json/);
  } finally {
    rmSync(art, { recursive: true });
  }
});

test("pictures: an unknown licence fails", () => {
  const data = manifest();
  data.masters[0].licence = "CC0-1.0";
  const art = checkout(data);
  try {
    assert.throws(() => pictures(art, data), /licence CC0-1\.0 is unknown/);
    assert.throws(() => licence("MIT"), /LICENCES in src\/manifest\.ts/);
  } finally {
    rmSync(art, { recursive: true });
  }
});

test("pictures: a pack file kept in the pack folder and as a master fails", () => {
  const data = manifest();
  const art = checkout(data, ["archive/anki-tan-pack/sticker/good.png"]);
  try {
    assert.throws(() => pictures(art, data), /sticker\/good\.png is also a master/);
  } finally {
    rmSync(art, { recursive: true });
  }
});

test("localize: cells show Art masters by pose; a picture Art keeps for another pose is not drawn", () => {
  const data = manifest();
  const art = checkout(data);
  try {
    const out = localize(coverage(), data, pictures(art, data), same);
    const [aki, tan, chibi] = out.companions;
    assert.equal(aki.folder, "aki");
    assert.deepEqual(aki.items[0], { name: "face", kind: "core_mood", status: "present", file: "aki/face.png" });
    // A fallback cell keeps Server's path: the gallery shows no fallback picture.
    assert.deepEqual(aki.items[1], { name: "happy", kind: "core_mood", status: "fallback", shows: "face", file: "static/aki/face.png" });
    assert.deepEqual(aki.unlisted, ["aki/study.png"]);
    // Server's Anki-tan face is the chibi's face in Art: missing for her.
    assert.deepEqual(tan.items[0], { name: "face", kind: "core_mood", status: "missing" });
    assert.deepEqual(
      tan.items.slice(1).map((cell) => (cell.status === "present" ? cell.file : undefined)),
      ["anki-tan/happy.png", "anki-tan/sad.png"],
    );
    assert.deepEqual(tan.missing, { core: ["face"], extensions: [] });
    assert.equal(chibi.folder, "anki-tan/chibi");
    assert.equal(out.licences["anki-tan"].file, "anki-tan/LICENSE");
    assert.equal(out.licences.repository.file, "LICENSE");
    assert.deepEqual(out.archive, []);
  } finally {
    rmSync(art, { recursive: true });
  }
});

test("localize: a picture Art does not have, a licence that differs or an unknown companion fails", () => {
  const data = manifest();
  const art = checkout(data);
  try {
    const known = pictures(art, data);
    assert.throws(() => localize(coverage(), data, known, () => undefined), /anki_tan face shows static\/anki-tan\/sprite\/idle\/0001\.png, which is not in AnkiQuest-Art/);

    const relicensed = coverage();
    relicensed.companions[1].licence = "repository";
    assert.throws(() => localize(relicensed, data, known, same), /AnkiQuest-Art gives licence CC-BY-SA-4\.0, the art matrix gives anki_tan AGPL/);

    const strange = manifest();
    strange.masters.push({ ...strange.masters[0], companion: "nobody" });
    assert.throws(() => localize(coverage(), strange, known, same), /nobody not in the art matrix/);
  } finally {
    rmSync(art, { recursive: true });
  }
});

test("packUsed: each pack file once, with every companion and pose it shows", () => {
  const data = manifest();
  data.masters.push({ ...data.masters[2], companion: "anki_tan_chibi", file: "anki-tan/chibi/happy.png" });
  assert.deepEqual(packUsed(data), [
    { pack: "sprite/idle/0001.png", file: "anki-tan/chibi/face.png", uses: [{ companion: "anki_tan_chibi", pose: "face" }] },
    {
      pack: "sticker/good.png",
      file: "anki-tan/happy.png",
      uses: [
        { companion: "anki_tan", pose: "happy" },
        { companion: "anki_tan_chibi", pose: "happy" },
      ],
    },
  ]);
});

test("folder: companion ids to Art folders", () => {
  assert.equal(folder("aki"), "aki");
  assert.equal(folder("anki_tan"), "anki-tan");
  assert.equal(folder("anki_tan_chibi"), "anki-tan/chibi");
  assert.equal(folder("quest_chan_chibi"), "quest-chan/chibi");
});
