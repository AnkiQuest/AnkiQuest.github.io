// Reads the companions, their poses and the moods from an AnkiQuest-Server
// checkout. The rules follow `xtask art-coverage` there: a pose's master is
// the file the folder's poses.json lists, else <pose>.png, else the older
// name in RENAMES; a missing extension shows the first pose its fallback
// chain reaches that exists.
//
// Every other picture in a companion's folder is filed into one group by
// RULES below; a picture no rule files fails the build.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

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

/**
 * Whether players can have a companion yet; `shared` is a folder of
 * pictures that show several companions together.
 */
export type Stage = "live" | "planned" | "shared";

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
  /** Every picture in the folder, filed into its group, in file order. */
  pictures: Picture[];
  /** The animations among the pictures. */
  sequences: Sequence[];
  /** The folder's LICENSE text, when it has one. */
  licence?: string;
}

interface PoseList {
  core: string[];
  extensions: Record<string, string>;
}

/** The page's groups of pictures, in page order. */
export const GROUPS = ["pose", "moment", "icon", "pack", "older"] as const;

/**
 * Where a picture belongs: a pose master; a moment, share-card or
 * notification picture; a small or launcher icon; third-party pack art;
 * or an older version no app uses.
 */
export type Group = (typeof GROUPS)[number];

/** The kinds of pack art, in page order. */
export const PACKS = ["illustration", "sticker", "emoji", "sprite", "chibi"] as const;

/** One kind of pack art. */
export type Pack = (typeof PACKS)[number];

/** Whether an older file has the same bytes as the file that replaced it. */
export type Copy = "same" | "changed";

/** How RULES file a picture that is not a pose master. */
export type Rule =
  | { group: "moment" | "icon"; note: string }
  | { group: "older"; replacedBy: string; note?: string }
  | { group: "pack"; pack: Pack; note?: string };

/** Where a picture is filed. Poses come from the pose list, not RULES. */
export type Place =
  | { group: "pose"; poses: string[] }
  | { group: "moment" | "icon"; note: string }
  | { group: "older"; replacedBy: string; copy: Copy; note?: string }
  | { group: "pack"; pack: Pack; note?: string };

/** The credit and licence a folder's LICENSE or README gives. */
export interface Credit {
  /** The LICENSE or README, relative to static/; empty for the default. */
  source: string;
  /** The credit as plain text. */
  text: string;
  /** The licence's short name. */
  licence: string;
}

/** One picture file under static/. */
export interface Picture {
  /** Relative to static/, such as `aki/freeze.png`. */
  file: string;
  /** Relative to the companion's folder, such as `freeze.png`. */
  name: string;
  path: string;
  place: Place;
  credit: Credit;
}

/** An animation: its frame folder and the pack's animated PNG of it. */
export interface Sequence {
  name: string;
  /** The frames' folder, relative to static/. */
  frames: string;
  /** The animated PNG, relative to static/. */
  animation: string;
}

/** Files that count as pictures; other files (README, LICENSE, JSON) are notes. */
const IMAGE = /\.(png|webp|jpe?g|gif|svg)$/i;

/** The licence of masters whose folder names none (AnkiQuest-Server's README). */
const SERVER_LICENCE = "AGPL-3.0-or-later";

/** AnkiQuest-Server's licence text. */
const SERVER_LICENCE_URL = "https://github.com/AnkiQuest/AnkiQuest-Server/blob/master/LICENSE";

/** Licences a LICENSE or README may give, and their short names. */
const LICENCES: [RegExp, string][] = [
  [/CC BY-SA 4\.0/, "CC BY-SA 4.0"],
  [/repository licen[cs]e/i, SERVER_LICENCE],
];

/** README sentences that give credit or licence, or say how art was made. */
const CREDIT_LINE = /licen[cs]e|CC BY|credit|by Shigeyuki|image_gen/i;

/** Folders under static/ that show several companions, and their names. */
const SHARED: Record<string, string> = {
  duo: "Aki and Ankilope",
};

// Shorthands for RULES.
const moment = (note: string): Rule => ({ group: "moment", note });
const icon = (note: string): Rule => ({ group: "icon", note });
const older = (replacedBy: string, note?: string): Rule => ({ group: "older", replacedBy, note });
const pack = (kind: Pack, note?: string): Rule => ({ group: "pack", pack: kind, note });

/** Rules for each folder under static/: file or `folder/` to rule. */
export type Rules = Record<string, Record<string, Rule>>;

/**
 * How each folder's pictures that are not pose masters are filed. Keys are
 * relative to the folder; a key ending in `/` files every picture under it
 * that no file key or pose names. Uses are from the exporters (Server
 * `build.rs` and `xtask art`, the add-on's `art-exports.json`) and the
 * Android app. `replacedBy` is relative to the folder.
 */
export const RULES: Rules = {
  aki: {
    "achievement.png": moment("Achievement and other celebrations"),
    "at_risk.png": moment("Streak at risk"),
    "backlog.png": moment("Backlog goal"),
    "challenge.png": moment("Challenge sent or accepted"),
    "challenge_lost.png": moment("Challenge lost"),
    "challenge_won.png": moment("Challenge won"),
    "comeback.png": moment("Back after a break"),
    "deck_conquered.png": moment("Deck conquered"),
    "freeze.png": moment("Streak freeze used: share cards, web and add-on; Android shows it on frozen day 2"),
    "freeze_used.png": moment("Streak freeze used: Android"),
    "goal.png": moment("Daily goal reached"),
    "level_up.png": moment("Level up"),
    "minimum.png": moment("Daily minimum done"),
    "nudge.png": moment("Nudge from a friend"),
    "place_1.png": moment("First place on the weekly board"),
    "place_2.png": moment("Second place on the weekly board"),
    "place_3.png": moment("Third place on the weekly board"),
    "face-192.png": icon("Web page icon, 192 px"),
    "face-32.png": icon("Browser tab icon, 32 px"),
    "icon_frozen.png": icon("Android launcher icon, frozen"),
    "icon_happy.png": icon("Android launcher icon, happy"),
    "icon_sleepy.png": icon("Android launcher icon, sleepy"),
    "icon_worried.png": icon("Android launcher icon, worried"),
  },
  ankilope: {
    "backlog.png": moment("Backlog goal"),
    "challenge.png": moment("Challenge sent or accepted"),
    "challenge_lost.png": moment("Challenge lost"),
    "challenge_won.png": moment("Challenge won"),
    "nudge.png": moment("Nudge from a friend"),
    "place_1.png": moment("First place on the weekly board"),
    "place_2.png": moment("Second place on the weekly board"),
    "place_3.png": moment("Third place on the weekly board"),
    "study.png": moment("Studying: the apps show it for streak and review"),
    "face-192.png": icon("Web page icon, 192 px"),
  },
  cow: {
    "archive/celebrate.png": older("happy.png"),
    "archive/face.png": older("face.png"),
    "archive/frozen.png": older("frozen.png"),
    "archive/hopeful.png": older("hopeful.png"),
    "archive/neglected.png": older("neglected.png"),
    "archive/sad.png": older("sad.png"),
    "archive/sleeping.png": older("asleep.png"),
    "archive/streak.png": older("streak.png"),
    "archive/addon/bluma_celebrate.png": older("happy.png", "Add-on export under its earlier name; now bluma_happy.png"),
    "archive/addon/bluma_sleeping.png": older("asleep.png", "Add-on export under its earlier name; now bluma_asleep.png"),
  },
  "anki-tan": {
    "icon.png": icon("Android launcher icon"),
    "archive/asleep-full.png": older("asleep.png"),
    "archive/sad-full.png": older("sad.png"),
    "archive/neglected-full.png": older("neglected.png", "All three headband stars lit"),
    "archive/addon/anki_tan_sleeping.png": older("asleep.png", "Add-on export under its earlier name; now anki_tan_asleep.png"),
    "archive/addon/anki_tan_neglected-three-blue-stars.png": older(
      "neglected.png",
      "Add-on export with all three headband stars lit; now anki_tan_neglected.png, one star unlit",
    ),
    "generated/frozen-full.png": older("frozen.png"),
    "generated/frozen-chibi.png": older("chibi/frozen.png"),
    "chibi/frozen.png": pack("chibi", "Generated from the pack's chibi faces"),
    "illust/": pack("illustration"),
    "sticker/": pack("sticker"),
    "emoji/Ankitan_00_smile.png": pack("emoji", "Android themed launcher icon"),
    "emoji/Ankitan_02_cry.png": pack("emoji", "Android launcher icon, worried"),
    "emoji/Ankitan_35_sleeping.png": pack("emoji", "Android launcher icon, sleepy"),
    "emoji/": pack("emoji"),
    "sprite/": pack("sprite"),
  },
  duo: {
    "friends.png": moment("Friends panel on the Android home screen"),
  },
};

/** Animations per folder: frame folder and animated PNG, relative to it. */
const SEQUENCES: Record<string, Sequence[]> = {
  "anki-tan": [
    { name: "hello", frames: "sprite/hello", animation: "sprite/Anki-tan_hello_240px.png" },
    { name: "idle", frames: "sprite/idle", animation: "sprite/Anki-tan_idle_240px.png" },
  ],
};

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

/** Every picture under `dir`, skipping the folders in `skip`, sorted. */
export function pictures(dir: string, skip: Set<string> = new Set()): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!skip.has(path)) {
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

/** README text as plain text: links as their words, no code marks. */
function plain(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\((https:[^)]*)\)/g, "$1 ($2)")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll("`", "");
}

/** The short name of the licence `text` gives, or undefined. */
function licenceIn(text: string): string | undefined {
  return LICENCES.find(([pattern]) => pattern.test(text))?.[1];
}

/** The credit a LICENSE gives: its first two paragraphs. */
function licenceCredit(server: string, path: string): Credit {
  const [who = "", terms = ""] = readFileSync(path, "utf8").trim().split(/\n\s*\n/);
  const text = `${who} ${terms}`.replace(/\s+/g, " ").trim();
  return credited(server, path, text);
}

/** The credit a README gives: its sentences about credit and licence. */
function readmeCredit(server: string, path: string): Credit | undefined {
  // Prose only: no headings or table rows.
  const prose = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("#") && !line.startsWith("|"))
    .join(" ");
  const sentences = plain(prose)
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=\.)\s+/)
    .filter((sentence) => CREDIT_LINE.test(sentence));
  if (sentences.length === 0) {
    return undefined;
  }
  return credited(server, path, sentences.join(" "));
}

/** A credit from `path`, which must name a licence. */
function credited(server: string, path: string, text: string): Credit {
  const licence = licenceIn(text);
  if (licence === undefined) {
    throw new Error(`${path} names no licence the gallery knows`);
  }
  return { source: relative(join(server, "static"), path), text, licence };
}

/**
 * The credit for a picture: the nearest LICENSE, else README, from its
 * folder up to the companion's; else AnkiQuest-Server's licence.
 */
export function creditFor(server: string, top: string, path: string): Credit {
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    const licence = join(dir, "LICENSE");
    if (existsSync(licence)) {
      return licenceCredit(server, licence);
    }
    const readme = join(dir, "README.md");
    const found = existsSync(readme) ? readmeCredit(server, readme) : undefined;
    if (found !== undefined) {
      return found;
    }
    if (dir === top || dir === dirname(dir)) {
      break;
    }
  }
  const text = `AnkiQuest-Server's licence, ${SERVER_LICENCE}: ${SERVER_LICENCE_URL}`;
  return { source: "", text, licence: SERVER_LICENCE };
}

/** The rule for `file` (relative to its folder): its own key, else the longest folder key. */
function ruleFor(rules: Record<string, Rule>, file: string): Rule | undefined {
  const own = rules[file];
  if (own !== undefined) {
    return own;
  }
  const folders = Object.keys(rules)
    .filter((key) => key.endsWith("/") && file.startsWith(key))
    .sort((a, b) => b.length - a.length);
  return folders.length > 0 ? rules[folders[0]] : undefined;
}

/** Where `rule` files a picture; an older file is compared with its replacement. */
function placeOf(dir: string, rule: Rule, path: string): Place {
  if (rule.group !== "older") {
    return rule;
  }
  const replacement = join(dir, rule.replacedBy);
  const copy: Copy = readFileSync(path).equals(readFileSync(replacement)) ? "same" : "changed";
  return { ...rule, copy };
}

/** Rule keys and replacements that name no file: stale rules fail too. */
function staleRules(dir: string, rules: Record<string, Rule>): string[] {
  const stale: string[] = [];
  for (const [key, rule] of Object.entries(rules)) {
    if (!existsSync(join(dir, key))) {
      stale.push(`${key} (no such file)`);
    }
    if (rule.group === "older" && !existsSync(join(dir, rule.replacedBy))) {
      stale.push(`${key} (replaced by ${rule.replacedBy}, no such file)`);
    }
  }
  return stale;
}

/**
 * Files every picture in `dir` into exactly one group: a pose master by the
 * pose list, any other by `rules`. Throws on a picture no rule files, on a
 * pose master a file rule also names, and on rules that name no file.
 */
export function classify(
  server: string,
  dir: string,
  poses: Pose[],
  rules: Record<string, Rule>,
  skip: Set<string> = new Set(),
): Picture[] {
  // Pose masters and the poses each shows.
  const masters = new Map<string, string[]>();
  for (const pose of poses) {
    if (pose.status.state === "drawn") {
      masters.set(pose.status.file, [...(masters.get(pose.status.file) ?? []), pose.name]);
    }
  }

  const problems = staleRules(dir, rules);
  const out: Picture[] = [];
  for (const path of pictures(dir, skip)) {
    const file = relative(dir, path);
    const shown = masters.get(path);
    const credit = creditFor(server, dir, path);
    const stored = relative(join(server, "static"), path);

    // A pose master is a pose; a file rule naming it too is a conflict.
    if (shown !== undefined) {
      if (rules[file] !== undefined) {
        problems.push(`${file} (a pose master and a file rule)`);
      }
      out.push({ file: stored, name: file, path, place: { group: "pose", poses: shown }, credit });
      continue;
    }

    const rule = ruleFor(rules, file);
    if (rule === undefined) {
      problems.push(`${file} (no group)`);
      continue;
    }
    out.push({ file: stored, name: file, path, place: placeOf(dir, rule, path), credit });
  }

  if (problems.length > 0) {
    const where = `static/${relative(join(server, "static"), dir)}`;
    throw new Error(`${where}: ${problems.join(", ")}; file each picture in RULES in src/art.ts`);
  }
  return out;
}

/** The animations in `folder`, with paths relative to static/. */
function sequences(dir: string, folder: string): Sequence[] {
  return (SEQUENCES[folder] ?? []).map((sequence) => {
    for (const part of [sequence.frames, sequence.animation]) {
      if (!existsSync(join(dir, part))) {
        throw new Error(`static/${folder}/${part} is missing; update SEQUENCES in src/art.ts`);
      }
    }
    return {
      name: sequence.name,
      frames: `${folder}/${sequence.frames}`,
      animation: `${folder}/${sequence.animation}`,
    };
  });
}

/**
 * Every companion players can see, in picker order: the starter, then the
 * unlock list, then the shared folders. Secret companions stay hidden, as
 * in the apps; a planned one is listed only once its folder exists. Every
 * folder under static/ must belong to a companion or be shared.
 */
export function companions(server: string, rules: Rules = RULES): Companion[] {
  const list: PoseList = json(join(server, POSES));
  const shown = moods(server);
  const unlocks = [{ companion: STARTER, status: LIVE, secret: false }, ...json(join(server, UNLOCKS)).companions];
  const static_ = join(server, "static");

  // A folder under static/ that is neither a companion's nor shared fails.
  const known = new Set([...unlocks.map((entry) => folder(entry.companion).split("/")[0]), ...Object.keys(SHARED)]);
  const unknown = readdirSync(static_)
    .filter((name) => statSync(join(static_, name)).isDirectory() && !known.has(name))
    .map((name) => `static/${name}`);
  if (unknown.length > 0) {
    throw new Error(`${unknown.join(", ")}: not a companion's folder; add it to SHARED in src/art.ts`);
  }

  // The folders of listed companions: a nested one is not its parent's.
  const visible = unlocks.filter((entry) => !entry.secret && existsSync(join(static_, folder(entry.companion))));
  const owned = new Set(visible.map((entry) => join(static_, folder(entry.companion))));

  const out: Companion[] = [];
  for (const entry of visible) {
    const top = folder(entry.companion);
    const dir = join(static_, top);
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

    const skip = new Set([...owned].filter((other) => other !== dir));
    const licence = join(dir, "LICENSE");
    out.push({
      id: entry.companion,
      name: NAMES[entry.companion] ?? entry.companion,
      stage,
      poses,
      pictures: classify(server, dir, poses, rules[top] ?? {}, skip),
      sequences: sequences(dir, top),
      licence: existsSync(licence) ? readFileSync(licence, "utf8") : undefined,
    });
  }

  // Shared folders: no poses, every picture by its rules.
  for (const [name, title] of Object.entries(SHARED)) {
    const dir = join(static_, name);
    if (!existsSync(dir)) {
      continue;
    }
    out.push({
      id: name,
      name: title,
      stage: "shared",
      poses: [],
      pictures: classify(server, dir, [], rules[name] ?? {}),
      sequences: sequences(dir, name),
    });
  }
  return out;
}
