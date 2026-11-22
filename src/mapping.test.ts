// Checks the mapping tool: the slots from Server's pose list (each with a
// note and a framing rule), what a cell shows (its picture, a fallback or
// nothing), the framing and other-companion warnings, the changes against
// manifest.json, the export in manifest.json's shape and its import, the
// draft, and the data build.ts writes for the page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  baseline,
  borrowWarning,
  diff,
  draftText,
  exportMapping,
  filterPictures,
  framingWarning,
  importMapping,
  key,
  readDraft,
  resolve,
  type Mapping,
} from "../site/mapping.ts";
import { copied } from "./build.ts";
import type { Coverage } from "./coverage.ts";
import type { Manifest, Picture } from "./manifest.ts";
import type { MappingData, MappingPicture } from "./mapping-model.ts";
import { companionOf, mappingData } from "./mapping.ts";
import type { Shown } from "./pages.ts";
import { MONO, NOTES, slots, type MoodList, type PoseList } from "./slots.ts";

/** Server's pose list and streak moods, as the server submodule pins them. */
const read = (path: string) => JSON.parse(readFileSync(new URL(`../server/tests/fixtures/${path}`, import.meta.url), "utf8"));

/** A small pose list. */
const POSES: PoseList = {
  core: ["face", "happy", "sad"],
  extensions: { streak_hot: "happy" },
  pictures: { level_up: "happy" },
  icons: { icon: "face", icon_happy: "icon" },
};

const MOODS: MoodList = {
  moods: [
    { expected: { mood: "unknown", pose: "face" } },
    { expected: { mood: "sad", pose: "sad" } },
    { expected: { mood: "sad", pose: "sad" } },
  ],
};

/** A picture of Art. */
function picture(path: string, companion: string | null, framing: MappingPicture["framing"] = null): MappingPicture {
  const image = { src: `previews/${path}.webp`, width: 160, height: 160 };
  return {
    path,
    folder: path.slice(0, path.lastIndexOf("/")),
    companion,
    framing,
    width: 512,
    height: 512,
    bytes: 1000,
    href: `files/${path}`,
    thumb: image,
    card: image,
    origin: path.startsWith("archive/anki-tan-pack/") ? "shigeyuki" : "ankiquest",
    originName: "",
    author: path.startsWith("archive/anki-tan-pack/") ? "Shigeyuki" : "AnkiQuest",
    licence: path.includes("anki-tan") ? "CC-BY-SA-4.0" : "AGPL-3.0-or-later",
    licenceName: "",
    licenceHref: "",
    ...(path.startsWith("archive/anki-tan-pack/") ? { pack: path.slice("archive/anki-tan-pack/".length) } : {}),
  };
}

/** Two companions: Aki with face, happy and an unlisted study picture; Anki-tan with face only. */
function data(): MappingData {
  return {
    art: "abc1234",
    slots: slots(POSES, MOODS),
    companions: [
      { id: "aki", name: "Aki", stage: "live", folder: "aki" },
      { id: "anki_tan", name: "Anki-tan", stage: "live", folder: "anki-tan" },
    ],
    pictures: [
      picture("aki/face.png", "aki", "headshot"),
      picture("aki/happy.png", "aki", "full_body"),
      picture("aki/study.png", "aki", "full_body"),
      picture("anki-tan/face.png", "anki_tan", "headshot"),
      picture("archive/anki-tan-pack/emoji/cry.png", "anki_tan"),
    ],
    masters: [
      { companion: "aki", pose: "face", kind: "core", file: "aki/face.png", licence: "AGPL-3.0-or-later", origin: "ankiquest", author: "AnkiQuest", framing: "headshot" },
      { companion: "aki", pose: "happy", kind: "core", file: "aki/happy.png", licence: "AGPL-3.0-or-later", origin: "ankiquest", author: "AnkiQuest", framing: "full_body" },
      { companion: "aki", pose: "study", kind: "picture", file: "aki/study.png", licence: "AGPL-3.0-or-later", origin: "ankiquest", author: "AnkiQuest" },
      { companion: "anki_tan", pose: "face", kind: "core", file: "anki-tan/face.png", licence: "CC-BY-SA-4.0", origin: "derivative", author: "AnkiQuest, after Shigeyuki" },
    ],
  };
}

test("every item of Server's pose list is a slot with a note, and the monochrome icon is one too", () => {
  const poses = read("companion_poses.json") as PoseList;
  const list = slots(poses, read("streak_moods.json"));
  const names = list.map((slot) => slot.name);
  const items = [...poses.core, ...Object.keys(poses.extensions), ...Object.keys(poses.pictures), ...Object.keys(poses.icons)];
  assert.deepEqual([...names].sort(), [...items, MONO].sort());
  for (const slot of list) {
    assert.ok(slot.note.length > 20, `${slot.name} has a note`);
    assert.equal(slot.title, NOTES[slot.name].title);
  }

  // Groups in order: core moods, extensions, launcher icons, pictures.
  const groups = [...new Set(list.map((slot) => slot.group))];
  assert.deepEqual(groups, ["core", "extension", "icon", "picture"]);
  assert.equal(list.find((slot) => slot.name === "frozen")?.moods.join(), "frozen_1,thawing");
});

test("slots: kinds, fallbacks, framing rules and the moods that show them", () => {
  const list = slots(POSES, MOODS);
  const by = new Map(list.map((slot) => [slot.name, slot]));
  assert.deepEqual(list.map((slot) => slot.name), ["face", "happy", "sad", "streak_hot", "icon", "icon_happy", MONO, "level_up"]);
  assert.deepEqual([by.get("face")?.kind, by.get("streak_hot")?.kind, by.get("icon")?.kind, by.get("level_up")?.kind], ["core", "extension", "picture", "picture"]);
  assert.equal(by.get("face")?.fallback, null);
  assert.equal(by.get(MONO)?.fallback, "face");
  assert.deepEqual(
    list.filter((slot) => slot.framing === "headshot").map((slot) => slot.name),
    ["face", "icon", "icon_happy", MONO],
  );
  assert.deepEqual(by.get("sad")?.moods, ["sad"]);
  assert.throws(() => slots({ ...POSES, extensions: { wings: "happy" } }, MOODS), /no note for wings/);
});

test("a cell shows its picture, else the first fallback down the chain with one, else nothing", () => {
  const d = data();
  const mapping = baseline(d);
  assert.deepEqual(resolve(d, mapping, "aki", "happy"), { status: "present", file: "aki/happy.png" });
  assert.deepEqual(resolve(d, mapping, "aki", "level_up"), { status: "fallback", shows: "happy", file: "aki/happy.png" });

  // icon_happy -> icon -> face: two steps down the chain.
  assert.deepEqual(resolve(d, mapping, "aki", "icon_happy"), { status: "fallback", shows: "face", file: "aki/face.png" });
  assert.deepEqual(resolve(d, mapping, "anki_tan", "level_up"), { status: "missing" });
  assert.deepEqual(resolve(d, mapping, "aki", "sad"), { status: "missing" });

  // Setting a slot to missing makes it show its fallback.
  mapping.set(key("aki", "happy"), { state: "missing" });
  assert.deepEqual(resolve(d, mapping, "aki", "happy"), { status: "missing" });
  assert.deepEqual(resolve(d, mapping, "aki", "level_up"), { status: "missing" });
});

test("framing warns when known and different, never when unknown", () => {
  const d = data();
  const face = d.slots.find((slot) => slot.name === "face")!;
  const happy = d.slots.find((slot) => slot.name === "happy")!;
  const icon = d.slots.find((slot) => slot.name === "icon")!;
  assert.equal(framingWarning(face, picture("x.png", null, "headshot")), null);
  assert.match(framingWarning(icon, picture("x.png", null, "full_body")) ?? "", /should show the head only; this picture shows the full body/);
  assert.match(framingWarning(happy, picture("x.png", null, "bust")) ?? "", /full body; this picture shows the head and shoulders/);
  assert.equal(framingWarning(icon, picture("x.png", null, null)), null);
  assert.equal(framingWarning(icon, undefined), null);
});

test("a picture of another companion warns; Anki-tan chibi may use Anki-tan's", () => {
  const d = data();
  d.companions.push({ id: "anki_tan_chibi", name: "Anki-tan chibi", stage: "planned", folder: "anki-tan/chibi" });
  assert.match(borrowWarning(d, "anki_tan", picture("aki/face.png", "aki")) ?? "", /picture of Aki/);
  assert.equal(borrowWarning(d, "aki", picture("aki/face.png", "aki")), null);
  assert.equal(borrowWarning(d, "anki_tan_chibi", picture("archive/anki-tan-pack/emoji/cry.png", "anki_tan")), null);
  assert.equal(borrowWarning(d, "aki", picture("duo/friends.png", null)), null);
});

test("the changes list every slot that differs from manifest.json", () => {
  const d = data();
  const base = baseline(d);
  const current: Mapping = new Map(base);
  assert.deepEqual(diff(d, base, current), []);
  current.set(key("anki_tan", "sad"), { state: "picture", file: "archive/anki-tan-pack/emoji/cry.png" });
  current.set(key("aki", "happy"), { state: "missing" });
  current.set(key("aki", "face"), { state: "picture", file: "aki/face.png" });
  assert.deepEqual(diff(d, base, current), [
    { companion: "aki", pose: "happy", before: { state: "picture", file: "aki/happy.png" }, after: { state: "missing" } },
    { companion: "anki_tan", pose: "sad", before: { state: "missing" }, after: { state: "picture", file: "archive/anki-tan-pack/emoji/cry.png" } },
  ]);
});

test("the export is manifest.json's masters: archive pictures become masters copied from the archive", () => {
  const d = data();
  const current = baseline(d);
  current.set(key("anki_tan", "sad"), { state: "picture", file: "archive/anki-tan-pack/emoji/cry.png" });
  current.set(key("aki", "happy"), { state: "missing" });
  const exported = exportMapping(d, current);
  assert.equal(exported.art, "abc1234");
  assert.deepEqual(
    exported.masters.map((entry) => `${entry.companion}/${entry.pose}`),
    ["aki/face", "aki/study", "anki_tan/face", "anki_tan/sad"],
  );
  assert.deepEqual(exported.masters.find((entry) => entry.pose === "sad"), {
    companion: "anki_tan",
    pose: "sad",
    kind: "core",
    file: "anki-tan/sad.png",
    licence: "CC-BY-SA-4.0",
    origin: "shigeyuki",
    author: "Shigeyuki",
    pack: "emoji/cry.png",
    from: "archive/anki-tan-pack/emoji/cry.png",
  });

  // A master kept as is keeps its framing; a pose that is no slot passes through.
  assert.deepEqual(exported.masters[0], { ...d.masters[0] });
  assert.deepEqual(exported.masters[1], d.masters[2]);

  // Core poses without a picture are missing; other slots are not listed.
  assert.deepEqual(exported.missing.map((entry) => `${entry.companion}/${entry.pose}`), ["aki/happy", "aki/sad", "anki_tan/happy"]);
});

test("an exported mapping imports back to the same grid", () => {
  const d = data();
  const current = baseline(d);
  current.set(key("anki_tan", "sad"), { state: "picture", file: "archive/anki-tan-pack/emoji/cry.png" });
  current.set(key("anki_tan", "icon"), { state: "picture", file: "aki/face.png" });
  current.set(key("aki", "happy"), { state: "missing" });
  const text = JSON.stringify(exportMapping(d, current));
  const { mapping, problems } = importMapping(d, text);
  assert.deepEqual(problems, []);
  assert.deepEqual([...mapping].sort(), [...current].sort());
  assert.deepEqual(diff(d, current, mapping), []);

  // A bare masters list works too; unknown pictures and companions are reported.
  const odd = JSON.stringify([
    { companion: "aki", pose: "face", file: "aki/gone.png" },
    { companion: "leech_kun", pose: "face", file: "leech-kun/face.png" },
  ]);
  const read = importMapping(d, odd);
  assert.equal(read.problems.length, 2);
  assert.deepEqual(read.mapping.get(key("aki", "face")), { state: "picture", file: "aki/face.png" });
  assert.deepEqual(read.mapping.get(key("aki", "happy")), { state: "missing" });
  assert.throws(() => importMapping(d, "{}"), /no masters list/);
});

test("the draft keeps only the changes and drops slots no longer in the grid", () => {
  const d = data();
  const base = baseline(d);
  const current: Mapping = new Map(base);
  current.set(key("aki", "sad"), { state: "picture", file: "aki/happy.png" });
  const text = draftText(d, base, current);
  assert.deepEqual(JSON.parse(text).changes, [["aki/sad", { state: "picture", file: "aki/happy.png" }]]);
  const draft = readDraft(base, text);
  assert.equal(draft?.art, "abc1234");
  assert.deepEqual(diff(d, current, draft!.mapping), []);

  const stale = JSON.stringify({ version: 1, art: null, changes: [["aki/wings", { state: "missing" }], ["aki/face", { state: "nonsense" }]] });
  assert.deepEqual(diff(d, base, readDraft(base, stale)!.mapping), []);
  assert.equal(readDraft(base, null), null);
  assert.equal(readDraft(base, JSON.stringify({ version: 0, changes: [] })), null);
});

test("the picker filters by words, folder, companion and framing, this companion's first", () => {
  const { pictures } = data();
  const all = { text: "", folder: "", companion: "", framing: "" };
  assert.deepEqual(filterPictures(pictures, all, "anki_tan").map((p) => p.path).slice(0, 2), ["anki-tan/face.png", "archive/anki-tan-pack/emoji/cry.png"]);
  assert.deepEqual(filterPictures(pictures, { ...all, text: "EMOJI cry" }, "aki").map((p) => p.path), ["archive/anki-tan-pack/emoji/cry.png"]);
  assert.deepEqual(filterPictures(pictures, { ...all, folder: "aki", framing: "full_body" }, "aki").map((p) => p.path), ["aki/happy.png", "aki/study.png"]);
  assert.deepEqual(filterPictures(pictures, { ...all, framing: "unknown" }, "aki").map((p) => p.path), ["archive/anki-tan-pack/emoji/cry.png"]);
  assert.deepEqual(filterPictures(pictures, { ...all, companion: "aki" }, "aki").length, 3);
});

/** A small manifest for the build side. */
const MANIFEST: Manifest = {
  masters: [
    { companion: "aki", pose: "face", kind: "core", file: "aki/face.png", licence: "AGPL-3.0-or-later", origin: "ankiquest", author: "AnkiQuest", framing: "headshot" } as Manifest["masters"][number],
    { companion: "anki_tan_chibi", pose: "face", kind: "core", file: "anki-tan/chibi/face.png", licence: "CC-BY-SA-4.0", origin: "shigeyuki", author: "Shigeyuki", pack: "sprite/idle/0001.png" },
  ],
  shared: [{ name: "friends", shows: ["aki", "ankilope"], file: "duo/friends.png", licence: "AGPL-3.0-or-later", origin: "ankiquest", author: "AnkiQuest" }],
  missing: [],
  archive: {
    retired: [{ companion: "anki_tan", pose: "sad", file: "archive/anki-tan/sad-old.png", replaced_by: "anki-tan/sad.png", licence: "CC-BY-SA-4.0", origin: "derivative", author: "AnkiQuest" }],
    pack: { companion: "anki_tan", folder: "archive/anki-tan-pack/", licence: "CC-BY-SA-4.0", origin: "shigeyuki", author: "Shigeyuki", source: "https://example.org" },
  },
};

const COLUMNS = [
  { id: "aki", name: "Aki", folder: "aki", stage: "live" },
  { id: "anki_tan", name: "Anki-tan", folder: "anki-tan", stage: "live" },
  { id: "anki_tan_chibi", name: "Anki-tan chibi", folder: "anki-tan/chibi", stage: "planned" },
];

test("each picture's companion comes from the manifest, the pack or its folder", () => {
  assert.equal(companionOf("aki/face.png", MANIFEST, COLUMNS), "aki");
  assert.equal(companionOf("anki-tan/chibi/happy.png", MANIFEST, COLUMNS), "anki_tan_chibi");
  assert.equal(companionOf("anki-tan/happy.png", MANIFEST, COLUMNS), "anki_tan");
  assert.equal(companionOf("archive/anki-tan/sad-old.png", MANIFEST, COLUMNS), "anki_tan");
  assert.equal(companionOf("archive/anki-tan-pack/emoji/cry.png", MANIFEST, COLUMNS), "anki_tan");
  assert.equal(companionOf("archive/aki/old.png", MANIFEST, COLUMNS), "aki");
  assert.equal(companionOf("duo/friends.png", MANIFEST, COLUMNS), null);
});

test("mapping.json: every picture with its credit and framing, the manifest's masters, and every companion", () => {
  const shown = new Map<string, Shown>(
    ["aki/face.png", "anki-tan/chibi/face.png", "archive/anki-tan-pack/emoji/cry.png", "duo/friends.png"].map((file) => {
      const image = { src: `previews/${file}`, width: 160, height: 160 };
      const pack = file.startsWith("archive/anki-tan-pack/");
      return [
        file,
        {
          href: `files/${file}`,
          size: [640, 480],
          thumb: image,
          card: image,
          picture: { file, origin: pack ? "shigeyuki" : "ankiquest", author: pack ? "Shigeyuki" : "AnkiQuest", licence: pack ? "CC-BY-SA-4.0" : "AGPL-3.0-or-later", ...(pack ? { pack: "emoji/cry.png" } : {}) },
        },
      ];
    }),
  );
  const out = mappingData(MANIFEST, shown, () => 2048, [...COLUMNS, { id: "cow", name: "Bluma", stage: "live" }], POSES, MOODS, null);
  assert.deepEqual(out.companions.map((c) => `${c.id}:${c.folder}`), ["aki:aki", "anki_tan:anki-tan", "anki_tan_chibi:anki-tan/chibi", "cow:cow"]);
  assert.deepEqual(out.pictures.map((p) => p.path), ["aki/face.png", "anki-tan/chibi/face.png", "archive/anki-tan-pack/emoji/cry.png", "duo/friends.png"]);
  const face = out.pictures[0];
  assert.deepEqual([face.framing, face.width, face.height, face.bytes, face.licenceName, face.originName], ["headshot", 640, 480, 2048, "AGPL-3.0-or-later", "Made by AnkiQuest"]);
  const cry = out.pictures[2];
  assert.deepEqual([cry.framing, cry.folder, cry.companion, cry.pack, cry.licenceName], [null, "archive/anki-tan-pack/emoji", "anki_tan", "emoji/cry.png", "CC BY-SA 4.0"]);
  assert.equal(out.masters[0].framing, "headshot");
  assert.equal(out.masters[1].pack, "sprite/idle/0001.png");
  assert.equal(out.slots.length, 8);

  // A framing the gallery does not know fails the build.
  const odd = { ...MANIFEST, masters: [{ ...MANIFEST.masters[0], framing: "knees" } as Manifest["masters"][number]] };
  assert.throws(() => mappingData(odd, shown, () => 0, COLUMNS, POSES, MOODS, null), /framing knees/);
});

test("copied: the site gets every picture of Art, so the mapping tool can offer the pack and hidden retired ones", () => {
  const coverage = {
    companions: [{ items: [{ status: "present", file: "aki/face.png" }], unlisted: [] }],
    archive: [],
  } as unknown as Coverage;
  const known = new Map<string, Picture>(
    ["aki/face.png", "archive/anki-tan-pack/emoji/smile.png", "archive/anki-tan/sad-old.png"].map((file) => [
      file,
      { file, origin: "shigeyuki", author: "Shigeyuki", licence: "CC-BY-SA-4.0" },
    ]),
  );
  assert.deepEqual(copied(coverage, known), ["aki/face.png", "archive/anki-tan-pack/emoji/smile.png", "archive/anki-tan/sad-old.png"]);
});
