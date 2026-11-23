// Checks the art matrix derived from the pinned data alone: the items in
// kind order with their fallbacks, each cell from the manifest (present, a
// fallback or missing), the stages from Server's unlock fixture, the
// licences and the unlisted masters.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { matrix } from "./matrix.ts";

/** A fake Art and Server checkout: stores for the two poses.json files. */
function fixture(
  poses: object,
  manifest: object,
  unlocks: object[] = [
    { companion: "cow", status: "live" },
    { companion: "anki_tan", status: "planned" },
    { companion: "anki_tan_chibi", status: "planned" },
  ],
): { art: string; server: string } {
  const root = mkdtempSync(join(tmpdir(), "matrix-"));
  const art = join(root, "art");
  const server = join(root, "server");
  mkdirSync(art, { recursive: true });
  mkdirSync(join(server, "tests/fixtures"), { recursive: true });
  writeFileSync(join(art, "poses.json"), JSON.stringify(poses));
  writeFileSync(join(art, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(server, "tests/fixtures/companion_unlock.json"), JSON.stringify({ companions: unlocks }));
  return { root, art, server };
}

/** A master as manifest.json lists it. */
function master(companion: string, pose: string, file: string): object {
  return { companion, pose, kind: "core", file, licence: "AGPL-3.0-or-later", origin: "ankiquest", author: "AnkiQuest" };
}

test("items come in kind order: core moods, then pictures, icons and extensions by name", () => {
  const { root, art, server } = fixture(
    {
      core: ["face", "happy", "sad"],
      extensions: { streak_hot: "happy", welcome: "happy" },
      pictures: { level_up: "happy", at_risk: "minimum" },
      icons: { icon: "face" },
      core_fallbacks: {},
    },
    { masters: [], shared: [] },
  );
  const coverage = matrix(art, server);
  assert.deepEqual(coverage.kinds, [
    { kind: "core_mood", core: true },
    { kind: "picture", core: true},
    { kind: "icon", core: true},
    { kind: "extension", core: false},
  ]);
  assert.deepEqual(coverage.items.map((item) => item.name), [
    "face", "happy", "sad",
    "at_risk", "level_up",
    "icon",
    "streak_hot", "welcome",
  ]);
  assert.equal(coverage.companions.length, 4);
  rmSync(root, { recursive: true, force: true });
});

test("a master shows present; a missing item shows its fallback; the last one missing", () => {
  const { root, art, server } = fixture(
    {
      core: ["face", "happy", "hopeful", "neglected"],
      extensions: { streak_hot: "happy", abandoned: "neglected" },
      pictures: { level_up: "happy" },
      icons: {},
      core_fallbacks: { happy: "hopeful" },
    },
    {
      masters: [master("aki", "face", "aki/face.png"), master("aki", "hopeful", "aki/hopeful.png")],
      shared: [],
    },
  );
  const coverage = matrix(art, server);
  const aki = coverage.companions[0];
  assert.equal(aki.id, "aki");
  assert.equal(aki.stage, "live");
  const cell = (name: string) => aki.items.find((item) => item.name === name);
  assert.deepEqual(cell("face"), { name: "face", kind: "core_mood", status: "present", file: "aki/face.png" });
  assert.deepEqual(cell("happy"), { name: "happy", kind: "core_mood", status: "fallback", shows: "hopeful", file: "aki/hopeful.png" });
  assert.deepEqual(cell("streak_hot"), { name: "streak_hot", kind: "extension", status: "fallback", shows: "hopeful", file: "aki/hopeful.png" });
  assert.deepEqual(cell("level_up"), { name: "level_up", kind: "picture", status: "fallback", shows: "hopeful", file: "aki/hopeful.png" });
  // `neglected` has no fallback and no master.
  assert.deepEqual(cell("neglected"), { name: "neglected", kind: "core_mood", status: "missing" });
  assert.deepEqual(cell("abandoned"), { name: "abandoned", kind: "extension", status: "missing" });
  assert.deepEqual(aki.missing, { core: ["happy", "neglected", "level_up"], extensions: ["abandoned", "streak_hot"] });
  rmSync(root, { recursive: true, force: true });
});

test("stages come from the unlock fixture; a companion it does not list stays out", () => {
  const { root, art, server } = fixture(
    { core: ["face"], extensions: {}, pictures: {}, icons: {} },
    { masters: [], shared: [] },
  );
  const coverage = matrix(art, server);
  const byId = Object.fromEntries(coverage.companions.map((companion) => [companion.id, companion.stage]));
  assert.deepEqual(byId, { aki: "live", cow: "live", anki_tan: "planned", anki_tan_chibi: "planned" });
  assert.ok(!coverage.companions.some((companion) => companion.id === "quest_chan"));
  rmSync(root, { recursive: true, force: true });
});

test("a companion the pose list does not know fails the build", () => {
  const { root, art, server } = fixture(
    { core: ["face"], extensions: {}, pictures: {}, icons: {} },
    { masters: [master("nobody", "face", "nobody/face.png")], shared: [] },
  );
  assert.throws(() => matrix(art, server), /nobody not in the art matrix/);
  rmSync(root, { recursive: true, force: true });
});

test("Anki-tan's licence is her own; the others are the repository's", () => {
  const { root, art, server } = fixture(
    { core: ["face"], extensions: {}, pictures: {}, icons: {} },
    { masters: [], shared: [] },
  );
  const coverage = matrix(art, server);
  const licenceOf = (id: string) => ({
    licence: coverage.companions.find((companion) => companion.id === id)?.licence,
    file: coverage.licences[coverage.companions.find((companion) => companion.id === id)?.licence ?? ""]?.file,
  });
  assert.deepEqual(licenceOf("aki"), { licence: "AGPL-3.0-or-later", file: "LICENSE" });
  assert.deepEqual(licenceOf("anki_tan"), { licence: "CC-BY-SA-4.0", file: "anki-tan/LICENSE" });
  assert.deepEqual(licenceOf("anki_tan_chibi"), { licence: "CC-BY-SA-4.0", file: "anki-tan/LICENSE" });
  assert.equal(coverage.licences["CC-BY-SA-4.0"].credit, "Anki-tan by Shigeyuki (https://www.patreon.com/Shigeyuki)");
  rmSync(root, { recursive: true, force: true });
});

test("masters the pose list does not list are unlisted", () => {
  const { root, art, server } = fixture(
    { core: ["face"], extensions: {}, pictures: {}, icons: {} },
    { masters: [master("aki", "face", "aki/face.png"), master("aki", "duo", "duo/friends.png")], shared: [] },
  );
  const coverage = matrix(art, server);
  const aki = coverage.companions.find((companion) => companion.id === "aki");
  assert.deepEqual(aki?.unlisted, ["duo/friends.png"]);
  rmSync(root, { recursive: true, force: true });
});
