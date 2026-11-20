// Reads the companions, their poses and the moods from an AnkiQuest-Server
// checkout. The rules follow `xtask art-coverage` there: a pose's master is
// the file the folder's poses.json lists, else <pose>.png, else the older
// name in RENAMES; a missing extension shows the first pose its fallback
// chain reaches that exists.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The pose list both clients use. */
const POSES = "tests/fixtures/companion_poses.json";

/** How players earn each companion but the starter, and which are live. */
const UNLOCKS = "tests/fixtures/companion_unlock.json";

/** Today's streak mood and the pose each mood shows. */
const MOODS = "tests/fixtures/streak_moods.json";

/** The companion every player starts with; it is not in UNLOCKS. */
const STARTER = "aki";

/** The `status` UNLOCKS gives a companion players can have. */
const LIVE = "live";

/** The per-folder list of pose files (Anki-tan's pack art). */
const LISTED = "poses.json";

/** Older master file names, checked after the pose's own name. */
const RENAMES: Record<string, string> = {
  happy: "celebrate",
  frozen: "freeze",
  leech_defeated: "leech",
};

/** The names players use for each companion id. */
const NAMES: Record<string, string> = {
  aki: "Aki",
  ankilope: "Ankilope",
  cow: "Bluma",
  anki_tan: "Anki-tan",
  anki_tan_chibi: "Anki-tan chibi",
  quest_chan: "Quest-chan",
  quest_chan_chibi: "Quest-chan chibi",
  leech_kun: "Leech-kun",
};

// String unions, not enums: Node runs this file by stripping types, and
// enums are not erasable.

/** Whether players can have a companion yet. */
export type Stage = "live" | "planned";

/** Whether every companion needs the pose, or it has a fallback. */
export type Kind = "core" | "extension";

/** Whether a pose has a master, shows a fallback, or neither. */
export type Status =
  | { state: "drawn"; file: string }
  | { state: "fallback"; pose: string; file: string }
  | { state: "missing" };

export interface Pose {
  name: string;
  kind: Kind;
  /** The pose an extension falls back to, as the fixture lists it. */
  fallback?: string;
  moods: string[];
  status: Status;
}

export interface Companion {
  id: string;
  name: string;
  stage: Stage;
  poses: Pose[];
  /** The folder's LICENSE text, when it has one. */
  licence?: string;
}

interface PoseList {
  core: string[];
  extensions: Record<string, string>;
}

function json(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The master folder under static/ for a companion id. */
export function folder(id: string): string {
  const chibi = id.endsWith("_chibi");
  const base = (chibi ? id.slice(0, -"_chibi".length) : id).replaceAll("_", "-");
  return chibi ? `${base}/chibi` : base;
}

/** The master file for `pose` in `dir`, or undefined. */
export function master(dir: string, pose: string): string | undefined {
  // A folder with poses.json lists its files; otherwise the file names.
  const listed = join(dir, LISTED);
  if (existsSync(listed)) {
    const file = json(listed).poses?.[pose];
    if (file !== undefined) {
      const path = join(dir, file);
      return existsSync(path) ? path : undefined;
    }
  }
  for (const name of [pose, RENAMES[pose]]) {
    if (name === undefined) {
      continue;
    }
    const path = join(dir, `${name}.png`);
    if (existsSync(path)) {
      return path;
    }
  }
  return undefined;
}

/** The status of `pose` in `dir`, following extension fallbacks. */
export function status(dir: string, list: PoseList, pose: string): Status {
  const file = master(dir, pose);
  if (file !== undefined) {
    return { state: "drawn", file };
  }

  // Walk the chain; the fixture guarantees it ends at a core pose.
  let next = list.extensions[pose];
  while (next !== undefined) {
    const found = master(dir, next);
    if (found !== undefined) {
      return { state: "fallback", pose: next, file: found };
    }
    next = list.extensions[next];
  }
  return { state: "missing" };
}

/** Each pose and the moods that show it, from the mood cases. */
export function moods(server: string): Map<string, string[]> {
  const shown = new Map<string, string[]>();
  for (const { expected } of json(join(server, MOODS)).moods) {
    const list = shown.get(expected.pose) ?? [];
    if (!list.includes(expected.mood)) {
      list.push(expected.mood);
    }
    shown.set(expected.pose, list);
  }
  return shown;
}

/**
 * Every companion players can see, in picker order: the starter, then the
 * unlock list. Secret companions stay hidden, as in the apps; a planned
 * one is listed only once its folder exists.
 */
export function companions(server: string): Companion[] {
  const list: PoseList = json(join(server, POSES));
  const shown = moods(server);
  const unlocks = [{ companion: STARTER, status: LIVE, secret: false }, ...json(join(server, UNLOCKS)).companions];

  const out: Companion[] = [];
  for (const entry of unlocks) {
    const dir = join(server, "static", folder(entry.companion));
    if (entry.secret || !existsSync(dir)) {
      continue;
    }
    const stage: Stage = entry.status === LIVE ? "live" : "planned";

    // Core poses in fixture order, then extensions.
    const pose = (name: string, kind: Kind, fallback?: string): Pose => ({
      name,
      kind,
      fallback,
      moods: shown.get(name) ?? [],
      status: status(dir, list, name),
    });
    const poses = [
      ...list.core.map((name) => pose(name, "core")),
      ...Object.entries(list.extensions).map(([name, to]) => pose(name, "extension", to)),
    ];

    const licence = join(dir, "LICENSE");
    out.push({
      id: entry.companion,
      name: NAMES[entry.companion] ?? entry.companion,
      stage,
      poses,
      licence: existsSync(licence) ? readFileSync(licence, "utf8") : undefined,
    });
  }
  return out;
}
