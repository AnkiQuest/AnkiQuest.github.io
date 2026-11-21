// Reads the companions and their pictures from an AnkiQuest-Art checkout,
// and the pose list, unlocks and moods from an AnkiQuest-Server checkout.
//
// Art's manifest.json lists every master with its origin: a file of
// Shigeyuki's Anki-tan pack, a derivative AnkiQuest made from his Anki-tan,
// or AnkiQuest's own art. Each companion's pictures fall into three parts:
// Shigeyuki's originals, our art in use (the masters) and our retired art
// (the archive). A picture in the checkout that the manifest does not
// account for, or a picture with no note, fails the build.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** The pose list both clients use. */
const POSES = "tests/fixtures/companion_poses.json";

/** How players earn each companion but the starter, and which are live. */
const UNLOCKS = "tests/fixtures/companion_unlock.json";

/** Today's streak mood and the pose each mood shows. */
const MOODS = "tests/fixtures/streak_moods.json";

/** Art's record of every master, the missing poses and the archive. */
const MANIFEST = "manifest.json";

/** Art's folder of generation records; its pictures are not companion art. */
const DOCS = "docs";

/** The companion every player starts with; it is not in UNLOCKS. */
const STARTER = "aki";

/** The `status` UNLOCKS gives a companion players can have. */
const LIVE = "live";

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

/** Licences the manifest names (SPDX), as the page shows them. */
const LICENCES: Record<string, string> = {
  "CC-BY-SA-4.0": "CC BY-SA 4.0",
  "AGPL-3.0-or-later": "AGPL-3.0-or-later",
};

// String unions, not enums: Node runs this file by stripping types, and
// enums are not erasable.

/** Whether players can have a companion yet; `shared` shows several together. */
export type Stage = "live" | "planned" | "shared";

/** Whether every companion needs the pose, or it has a fallback. */
export type Kind = "core" | "extension";

/**
 * Who made a picture: Shigeyuki (a file of his pack, unchanged), AnkiQuest
 * from his Anki-tan, or AnkiQuest for its own companions.
 */
export type Origin = "shigeyuki" | "derivative" | "ankiquest";

/** Whether a pose has a master, shows a fallback, or neither. */
export type Status =
  | { state: "drawn"; file: string }
  | { state: "fallback"; pose: string; file: string }
  | { state: "missing"; issue?: string };

export interface Pose {
  name: string;
  kind: Kind;
  /** The pose an extension falls back to, as the fixture lists it. */
  fallback?: string;
  moods: string[];
  status: Status;
  /** Who made the master the pose shows, when it shows one. */
  origin?: Origin;
}

/** One picture file in the Art checkout. */
export interface Picture {
  /** Relative to the Art checkout, such as `aki/freeze.png`. */
  file: string;
  /** Absolute path. */
  path: string;
  /** The name the card shows: the pack path for Shigeyuki's files, else `file`. */
  name: string;
  origin: Origin;
  author: string;
  /** The licence as the page shows it. */
  licence: string;
  /** What the picture is or where it is used; empty when unused. */
  note: string;
  /** For a pose master, the pose names it shows. */
  poses: string[];
}

/** An animation of Shigeyuki's pack: its frames and his animated PNG of it. */
export interface Sequence {
  name: string;
  /** The frames in order, each with the Art file that holds it. */
  frames: Picture[];
  animation: Picture;
}

export interface Companion {
  id: string;
  name: string;
  stage: Stage;
  poses: Pose[];
  /** Shigeyuki's pictures, as his pack lays them out. */
  original: Picture[];
  /** The animations among the originals. */
  sequences: Sequence[];
  /** Art we made that the apps use: the masters. */
  used: Picture[];
  /** Art we made that is retired: the archive. */
  retired: Picture[];
  /** The companion folder's LICENSE text, when it has one. */
  licence?: string;
}

/** A master as manifest.json lists it. */
interface Entry {
  companion: string;
  pose: string;
  kind: Kind | "picture";
  file: string;
  licence: string;
  origin: Origin;
  author: string;
  /** The file's path in Shigeyuki's pack. */
  pack?: string;
}

/** A shared picture as manifest.json lists it. */
interface SharedEntry {
  name: string;
  shows: string[];
  file: string;
  licence: string;
  origin: Origin;
  author: string;
}

/** A retired picture as manifest.json lists it. */
interface RetiredEntry {
  companion: string;
  pose: string;
  file: string;
  replaced_by: string;
  note?: string;
  licence: string;
  origin: Origin;
  author: string;
}

/** The rest of Shigeyuki's pack, by folder, as manifest.json lists it. */
interface PackEntry {
  companion: string;
  folder: string;
  licence: string;
  origin: Origin;
  author: string;
  source: string;
}

export interface Manifest {
  masters: Entry[];
  shared: SharedEntry[];
  missing: { companion: string; pose: string; issue: string }[];
  archive: { retired: RetiredEntry[]; pack: PackEntry };
}

interface PoseList {
  core: string[];
  extensions: Record<string, string>;
}

/** Files that count as pictures; other files (README, LICENSE, JSON) are notes. */
const IMAGE = /\.(png|webp|jpe?g|gif|svg)$/i;

/**
 * What each master that is not a pose is for, by Art path. Uses are from
 * the exporters (Server `build.rs` and `xtask art`, the add-on's
 * `art-exports.json`) and the Android app. Every picture the manifest
 * lists needs a note here; a note for a file it does not list fails.
 */
export const NOTES: Record<string, string> = {
  "aki/achievement.png": "Achievement and other celebrations",
  "aki/at_risk.png": "Streak at risk",
  "aki/backlog.png": "Backlog goal",
  "aki/challenge.png": "Challenge sent or accepted",
  "aki/challenge_lost.png": "Challenge lost",
  "aki/challenge_won.png": "Challenge won",
  "aki/comeback.png": "Back after a break",
  "aki/deck_conquered.png": "Deck conquered",
  "aki/freeze.png": "Streak freeze used: share cards, web and add-on; Android shows it on frozen day 2",
  "aki/freeze_used.png": "Streak freeze used: Android",
  "aki/goal.png": "Daily goal reached",
  "aki/level_up.png": "Level up",
  "aki/minimum.png": "Daily minimum done",
  "aki/nudge.png": "Nudge from a friend",
  "aki/place_1.png": "First place on the weekly board",
  "aki/place_2.png": "Second place on the weekly board",
  "aki/place_3.png": "Third place on the weekly board",
  "aki/icon_frozen.png": "Android launcher icon, frozen",
  "aki/icon_happy.png": "Android launcher icon, happy",
  "aki/icon_sleepy.png": "Android launcher icon, sleepy",
  "aki/icon_worried.png": "Android launcher icon, worried",
  "ankilope/backlog.png": "Backlog goal",
  "ankilope/challenge.png": "Challenge sent or accepted",
  "ankilope/challenge_lost.png": "Challenge lost",
  "ankilope/challenge_won.png": "Challenge won",
  "ankilope/nudge.png": "Nudge from a friend",
  "ankilope/place_1.png": "First place on the weekly board",
  "ankilope/place_2.png": "Second place on the weekly board",
  "ankilope/place_3.png": "Third place on the weekly board",
  "ankilope/study.png": "Studying: the apps show it for streak and review",
  "anki-tan/icon.png": "Android launcher icon",
  "anki-tan/icon_mono.png": "Android themed launcher icon",
  "duo/friends.png": "Friends panel on the Android home screen",
};

/** Shigeyuki's animations: frame folder and animated PNG, as pack paths. */
const SEQUENCES = [
  { name: "hello", frames: "sprite/hello/", animation: "sprite/Anki-tan_hello_240px.png" },
  { name: "idle", frames: "sprite/idle/", animation: "sprite/Anki-tan_idle_240px.png" },
];

function json(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Art's manifest. */
export function manifest(art: string): Manifest {
  return json(join(art, MANIFEST));
}

/** The licence `spdx` as the page shows it; an unknown one fails. */
export function licenceName(spdx: string): string {
  const name = LICENCES[spdx];
  if (name === undefined) {
    throw new Error(`manifest.json: licence ${spdx} is unknown; add it to LICENCES in src/art.ts`);
  }
  return name;
}

/** A pose name as words: streak_hot becomes "streak hot". */
export function words(name: string): string {
  return name.replaceAll("_", " ");
}

/** Every picture under `dir`, sorted, skipping the folders in `skip`. */
export function pictures(dir: string, skip: Set<string> = new Set()): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!skip.has(path) && name !== ".git") {
        found.push(...pictures(path, skip));
      }
      continue;
    }
    if (IMAGE.test(name)) {
      found.push(path);
    }
  }
  return found;
}

/** The status of `pose` among `drawn` (pose name to file), following fallbacks. */
export function status(drawn: Map<string, string>, list: PoseList, pose: string, issue?: string): Status {
  const file = drawn.get(pose);
  if (file !== undefined) {
    return { state: "drawn", file };
  }

  // Walk the chain; the fixture guarantees it ends at a core pose.
  let next = list.extensions[pose];
  while (next !== undefined) {
    const found = drawn.get(next);
    if (found !== undefined) {
      return { state: "fallback", pose: next, file: found };
    }
    next = list.extensions[next];
  }
  return { state: "missing", issue };
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

/** A Shigeyuki pack file: where it is in Art and who uses it. */
interface PackFile {
  file: string;
  uses: string[];
}

/**
 * Shigeyuki's pack as he made it, by pack path: the masters taken from it
 * and the rest under the archive's pack folder. A master that copies a
 * pack file another master holds adds its use to that file.
 */
export function packFiles(art: string, data: Manifest): Map<string, PackFile> {
  const files = new Map<string, PackFile>();
  for (const entry of data.masters) {
    if (entry.pack === undefined) {
      continue;
    }
    const use = `${NAMES[entry.companion] ?? entry.companion}: ${words(entry.pose)}`;
    const known = files.get(entry.pack);
    if (known !== undefined && !readFileSync(join(art, known.file)).equals(readFileSync(join(art, entry.file)))) {
      throw new Error(`${known.file} and ${entry.file} both name pack ${entry.pack} but differ`);
    }
    if (known === undefined) {
      files.set(entry.pack, { file: entry.file, uses: [use] });
    } else {
      known.uses.push(use);
    }
  }

  const folder = data.archive.pack.folder;
  for (const path of pictures(join(art, folder))) {
    const pack = relative(join(art, folder), path);
    if (files.has(pack)) {
      throw new Error(`${folder}${pack} is also a master; the pack keeps each file once`);
    }
    files.set(pack, { file: relative(art, path), uses: [] });
  }
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The card for a master. */
function masterPicture(art: string, entry: Entry, poses: string[], notes: Record<string, string>): Picture {
  const note = entry.kind === "picture" ? notes[entry.file] : poses.map(words).join(", ");
  if (note === undefined) {
    throw new Error(`${entry.file} is a picture with no note; add it to NOTES in src/art.ts`);
  }
  return {
    file: entry.file,
    path: join(art, entry.file),
    name: entry.file,
    origin: entry.origin,
    author: entry.author,
    licence: licenceName(entry.licence),
    note,
    poses,
  };
}

/** The card for a file of Shigeyuki's pack. */
function packPicture(art: string, pack: string, file: PackFile, credit: PackEntry): Picture {
  return {
    file: file.file,
    path: join(art, file.file),
    name: pack,
    origin: "shigeyuki",
    author: credit.author,
    licence: licenceName(credit.licence),
    note: file.uses.length > 0 ? `Used for ${file.uses.join("; ")}` : "",
    poses: [],
  };
}

/** Shigeyuki's animations, from the pack files. */
function sequences(art: string, pack: Map<string, PackFile>, credit: PackEntry): Sequence[] {
  return SEQUENCES.map((sequence) => {
    const animation = pack.get(sequence.animation);
    const frames = [...pack].filter(([name]) => name.startsWith(sequence.frames));
    if (animation === undefined || frames.length === 0) {
      throw new Error(`pack ${sequence.frames} or ${sequence.animation} is missing; update SEQUENCES in src/art.ts`);
    }
    return {
      name: sequence.name,
      frames: frames.map(([name, file]) => packPicture(art, name, file, credit)),
      animation: packPicture(art, sequence.animation, animation, credit),
    };
  });
}

/** The Art folder of a companion id: `anki_tan_chibi` is `anki-tan/chibi`. */
export function folder(id: string): string {
  const chibi = id.endsWith("_chibi");
  const base = (chibi ? id.slice(0, -"_chibi".length) : id).replaceAll("_", "-");
  return chibi ? `${base}/chibi` : base;
}

/**
 * Every companion with art, in picker order (the starter, then the unlock
 * list), then the shared pictures. A planned companion is shown once Art
 * has masters for it, as a future companion.
 */
export function companions(server: string, art: string, notes: Record<string, string> = NOTES): Companion[] {
  const list: PoseList = json(join(server, POSES));
  const shown = moods(server);
  const data = manifest(art);
  const unlocks = [{ companion: STARTER, status: LIVE }, ...json(join(server, UNLOCKS)).companions];

  // Every manifest companion must be one the fixture knows.
  const known = new Set(unlocks.map((entry) => entry.companion));
  const strangers = [...new Set(data.masters.map((entry) => entry.companion))].filter((id) => !known.has(id));
  if (strangers.length > 0) {
    throw new Error(`manifest.json: ${strangers.join(", ")} not in ${UNLOCKS}`);
  }

  // Every picture in the checkout must be in the manifest.
  const loose = unlisted(art, data);
  if (loose.length > 0) {
    throw new Error(`${loose.join(", ")}: not in manifest.json`);
  }

  // NOTES must name only listed pictures.
  const listed = new Set(data.masters.filter((entry) => entry.kind === "picture").map((entry) => entry.file));
  for (const shared of data.shared) {
    listed.add(shared.file);
  }
  const stale = Object.keys(notes).filter((file) => !listed.has(file));
  if (stale.length > 0) {
    throw new Error(`NOTES in src/art.ts names files manifest.json does not list as pictures: ${stale.join(", ")}`);
  }

  const pack = packFiles(art, data);
  const credit = data.archive.pack;

  const out: Companion[] = [];
  for (const entry of unlocks) {
    const id: string = entry.companion;
    const masters = data.masters.filter((master) => master.companion === id);
    if (masters.length === 0) {
      continue;
    }

    // Poses: core in fixture order, then extensions, each from its master.
    const drawn = new Map<string, string>();
    for (const master of masters) {
      if (master.kind !== "picture") {
        drawn.set(master.pose, master.file);
      }
    }
    const missing = new Map(data.missing.filter((m) => m.companion === id).map((m) => [m.pose, m.issue]));
    const pose = (name: string, kind: Kind, fallback?: string): Pose => {
      const found = status(drawn, list, name, missing.get(name));
      const file = found.state === "missing" ? undefined : found.file;
      const origin = masters.find((master) => master.file === file)?.origin;
      return { name, kind, fallback, moods: shown.get(name) ?? [], status: found, origin };
    };
    const poses = [
      ...list.core.map((name) => pose(name, "core")),
      ...Object.entries(list.extensions).map(([name, to]) => pose(name, "extension", to)),
    ];

    // Shigeyuki's originals: the whole pack under its companion, the files it uses under a chibi.
    const ownPack = masters.filter((master) => master.pack !== undefined).map((master) => master.pack as string);
    const original = [...pack]
      .filter(([name]) => (id === credit.companion ? true : ownPack.includes(name)))
      .map(([name, file]) => packPicture(art, name, file, credit));

    // Our art: masters in use, pose masters first, and the archive's retired pictures.
    const ours = masters.filter((master) => master.origin !== "shigeyuki");
    const posesOf = (file: string) => masters.filter((m) => m.file === file && m.kind !== "picture").map((m) => m.pose);
    const used = [
      ...ours.filter((master) => master.kind !== "picture"),
      ...ours.filter((master) => master.kind === "picture"),
    ].map((master) => masterPicture(art, master, posesOf(master.file), notes));
    const retired = data.archive.retired
      .filter((old) => old.companion === id)
      .map((old) => retiredPicture(art, old));

    const licence = join(art, folder(id), "LICENSE");
    const top = join(art, folder(id).split("/")[0], "LICENSE");
    const text = existsSync(licence) ? licence : existsSync(top) ? top : undefined;
    out.push({
      id,
      name: NAMES[id] ?? id,
      stage: entry.status === LIVE ? "live" : "planned",
      poses,
      original,
      sequences: id === credit.companion ? sequences(art, pack, credit) : [],
      used,
      retired,
      licence: text === undefined ? undefined : readFileSync(text, "utf8"),
    });
  }

  // Shared pictures, under the companions they show.
  for (const shared of data.shared) {
    out.push({
      id: shared.name,
      name: shared.shows.map((id) => NAMES[id] ?? id).join(" and "),
      stage: "shared",
      poses: [],
      original: [],
      sequences: [],
      used: [
        {
          file: shared.file,
          path: join(art, shared.file),
          name: shared.file,
          origin: shared.origin,
          author: shared.author,
          licence: licenceName(shared.licence),
          note: notes[shared.file] ?? "",
          poses: [],
        },
      ],
      retired: [],
    });
  }
  return out;
}

/** The card for a retired picture. */
function retiredPicture(art: string, old: RetiredEntry): Picture {
  const replaced = `Replaced by ${old.replaced_by}.`;
  return {
    file: old.file,
    path: join(art, old.file),
    name: old.file,
    origin: old.origin,
    author: old.author,
    licence: licenceName(old.licence),
    note: old.note ? `${replaced} ${old.note}` : replaced,
    poses: [old.pose],
  };
}

/**
 * Pictures in the Art checkout the manifest does not account for: every
 * picture outside docs/ must be a master, a shared or retired picture, or
 * a file of Shigeyuki's pack.
 */
export function unlisted(art: string, data: Manifest): string[] {
  const listed = new Set([
    ...data.masters.map((entry) => entry.file),
    ...data.shared.map((entry) => entry.file),
    ...data.archive.retired.map((entry) => entry.file),
  ]);
  const pack = data.archive.pack.folder;
  return pictures(art, new Set([join(art, DOCS)]))
    .map((path) => relative(art, path))
    .filter((file) => !listed.has(file) && !file.startsWith(pack));
}
