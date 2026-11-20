// Checks the pose rules against a small made-up Server checkout.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { companions, folder, status } from "./art.ts";
import { esc } from "./build.ts";

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
  const list = companions(server());
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
