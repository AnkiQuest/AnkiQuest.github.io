// The art matrix, derived from the pinned data alone: AnkiQuest-Art's
// manifest.json (who shows what, credited how), its poses.json (the pose
// list and its fallbacks) and Server's companion_unlock.json (which
// companions are live). Server's `xtask art-coverage --json` is gone for
// good, so the gallery computes the matrix it read from there. Paths are
// AnkiQuest-Art's, as manifest.ts `localize` leaves them, and the archive
// stays empty: the archive page shows Art's own.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Cell, Companion, Coverage, Item, Kind, Licence, Stage } from "./coverage.ts";
import { folder, licence, readManifest, type Manifest } from "./manifest.ts";

/** Art's pose list, which the pose list reader and the matrix share. */
const POSES = "poses.json";

/** The companions, by id in picker order, with the name the pages show. */
const COMPANIONS: Record<string, string> = {
  aki: "Aki",
  ankilope: "Ankilope",
  cow: "Bluma",
  anki_tan: "Anki-tan",
  anki_tan_chibi: "Anki-tan chibi",
  quest_chan: "Quest-chan",
  quest_chan_chibi: "Quest-chan chibi",
  leech_kun: "Leech-kun",
};

/** The companion every player starts with; it is never in the unlock fixture. */
const STARTER = "aki";

/** How the Server fixture says players can earn each companion but the starter. */
const UNLOCKS = "tests/fixtures/companion_unlock.json";

/** The `status` the unlock fixture gives a companion players can have. */
const LIVE = "live";

/** The kinds of item, in report order; the first three are the core set. */
const KINDS: Kind[] = [
  { kind: "core_mood", core: true },
  { kind: "picture", core: true},
  { kind: "icon", core: true},
  { kind: "extension", core: false},
];

/** The credit Shigeyuki's licence requires. */
const ANKI_TAN_CREDIT = "Anki-tan by Shigeyuki (https://www.patreon.com/Shigeyuki)";

/** The pose list, with every item's kind, fallback chain and companions. */
interface Poses {
  core: string[];
  pictures: Record<string, string>;
  icons: Record<string, string>;
  extensions: Record<string, string>;
  coreFallbacks: Record<string, string>;
}

/**
 * What an item shows when its companion has no master for it: a fallback
 * only shows a core mood that exists.
 */
function fallback(poses: Poses, item: string): string | null {
  if (poses.core.includes(item)) {
    const shown = poses.coreFallbacks[item];
    return shown !== undefined && poses.core.includes(shown) ? shown : null;
  }
  return poses.pictures[item] ?? poses.icons[item] ?? poses.extensions[item] ?? null;
}

/** `item`, then each fallback in turn, ending at a core mood without one. */
function chain(poses: Poses, item: string): string[] {
  const steps = [item];
  while (true) {
    const next = fallback(poses, steps[steps.length - 1]);
    if (next === null || steps.includes(next)) {
      return steps;
    }
    steps.push(next);
  }
}

/** The pose list from Art's poses.json, with its core fallbacks. */
export function poseListForMatrix(art: string): Poses {
  const value = JSON.parse(readFileSync(join(art, POSES), "utf8")) as Record<string, object>;
  const list = (key: string): Record<string, string> =>
    (value[key] ?? {}) as Record<string, string>;
  const core = value["core"];
  if (!Array.isArray(core) || core.length === 0) {
    throw new Error(`${POSES}: no core poses`);
  }
  return {
    core: core as string[],
    pictures: list("pictures"),
    icons: list("icons"),
    extensions: list("extensions"),
    coreFallbacks: list("core_fallbacks"),
  };
}

/**
 * Every item once, in kind order: the core moods in the pose list's order,
 * the pictures, icons and extensions by name.
 */
function items(poses: Poses): { list: Item[]; byName: Map<string, Item> } {
  const byName = new Map<string, Item>();
  const add = (name: string, kind: string) => {
    byName.set(name, { name, kind, fallback: fallback(poses, name) });
  };
  poses.core.forEach((name) => add(name, "core_mood"));
  Object.keys(poses.pictures).sort().forEach((name) => add(name, "picture"));
  Object.keys(poses.icons).sort().forEach((name) => add(name, "icon"));
  Object.keys(poses.extensions).sort().forEach((name) => add(name, "extension"));
  return { list: [...byName.values()], byName };
}

/** The licences a companion's or archive folder's licence key names. */
const LICENCES: Record<string, Licence> = {
  "AGPL-3.0-or-later": { spdx: "AGPL-3.0-or-later", file: licence("AGPL-3.0-or-later").file, credit: null },
  "CC-BY-SA-4.0": { spdx: "CC-BY-SA-4.0", file: licence("CC-BY-SA-4.0").file, credit: ANKI_TAN_CREDIT },
};

/** The licence key of the pictures in a companion's Art folder. */
function licenceOf(id: string): string {
  const art = folder(id);
  return art === "anki-tan" || art.startsWith("anki-tan/") ? "CC-BY-SA-4.0" : "AGPL-3.0-or-later";
}

/** Whether players can have the companion yet, from the unlock fixture. */
function stages(server: string): Map<string, Stage> {
  const unlock = JSON.parse(readFileSync(join(server, UNLOCKS), "utf8")) as {
    companions: { companion: string; status: string }[];
  };
  const found = new Map<string, Stage>();
  for (const entry of unlock.companions) {
    found.set(entry.companion, entry.status === LIVE ? "live" : "planned");
  }
  return found;
}

/** Builds the art matrix from the two pinned checkouts. */
export function matrix(art: string, server: string): Coverage {
  const data = readManifest(art);
  const poses = poseListForMatrix(art);
  const { list, byName } = items(poses);
  const coreKinds = new Set(KINDS.filter((kind) => kind.core).map((kind) => kind.kind));
  const stagesBy = stages(server);

  const strangers = [...new Set(data.masters.map((entry) => entry.companion))]
    .filter((id) => COMPANIONS[id] === undefined);
  if (strangers.length > 0) {
    throw new Error(`manifest.json: ${strangers.join(", ")} not in the art matrix`);
  }

  const companions: Companion[] = [];
  for (const [id, name] of Object.entries(COMPANIONS)) {
    // A companion the unlock fixture does not list stays out, the starter
    // apart; the fixture decides its stage.
    let stage: Stage | undefined = stagesBy.get(id);
    if (id === STARTER) {
      stage = "live";
    }
    if (stage === undefined) {
      continue;
    }

    const masters = new Map(
      data.masters
        .filter((entry) => entry.companion === id)
        .map((entry) => [entry.pose, entry.file]),
    );
    const cell = (item: Item): Cell => {
      for (const step of chain(poses, item.name)) {
        const file = masters.get(step);
        if (file !== undefined) {
          return step === item.name
            ? { name: item.name, kind: item.kind, status: "present", file }
            : { name: item.name, kind: item.kind, status: "fallback", shows: step, file };
        }
      }
      return { name: item.name, kind: item.kind, status: "missing" };
    };
    const missing = { core: [] as string[], extensions: [] as string[] };
    for (const item of list) {
      if (!masters.has(item.name)) {
        (coreKinds.has(item.kind) ? missing.core : missing.extensions).push(item.name);
      }
    }
    const cells = list.map(cell);
    companions.push({
      id,
      name,
      folder: folder(id),
      stage,
      licence: licenceOf(id),
      items: cells,
      missing,
      unlisted: data.masters
        .filter((entry) => entry.companion === id && !byName.has(entry.pose))
        .map((entry) => entry.file)
        .sort(),
    });
  }

  return {
    schema: 1,
    fixture: POSES,
    kinds: KINDS,
    items: list,
    licences: LICENCES,
    companions,
    archive: [],
  };
}
