// The slots of the mapping page: every pose, launcher icon and picture a
// companion can have, from AnkiQuest-Server's companion_poses.json, plus
// the monochrome launcher icon the Server's exporter makes
// (crates/xtask/src/art.rs), each with a plain-words note on where the apps
// show it. The streak moods that show each pose come from
// streak_moods.json. A slot without a note fails the build, so a new pose
// in the fixture gets one here.

import type { Framing, MasterKind, Slot, SlotGroup } from "./mapping-model.ts";

/** companion_poses.json: core moods in order, then items by group, each with its fallback. */
export interface PoseList {
  core: string[];
  extensions: Record<string, string>;
  pictures: Record<string, string>;
  icons: Record<string, string>;
}

/** The rows of streak_moods.json's `moods` the page reads. */
export interface MoodList {
  moods: { expected: { mood: string; pose: string } }[];
}

/** The monochrome launcher icon: not in the pose list; the exporter makes it from a master's line art. */
export const MONO = "icon_mono";

/** The slots that show the head only (AGENTS.md in AnkiQuest-Art); every other slot shows the full body. */
const HEADSHOTS = /^(face|icon(_.*)?)$/;

/** What each streak mood means, in plain words. */
export const MOOD_WORDS: Record<string, string> = {
  unknown: "nothing is known about today yet",
  asleep: "no streak and no study today",
  sad: "a streak, and less than half of today's minimum studied",
  hopeful: "half of today's minimum studied, or some study without a streak",
  almost: "three quarters of today's minimum studied",
  frozen_1: "a freeze kept yesterday, and less than a quarter of today's minimum studied",
  frozen_2: "freezes kept the last two days",
  frozen_3: "freezes kept the last three days or more",
  thawing: "after a freeze, a quarter of today's minimum studied",
  fire: "today counts toward the streak",
};

/** Each slot's short name and note, in plain words. */
export const NOTES: Record<string, { title: string; note: string }> = {
  // Core moods.
  face: {
    title: "Face",
    note: "The companion's everyday face, head only. Today's mood when nothing is known about today yet; the launcher icons fall back to it.",
  },
  asleep: { title: "Asleep", note: "Today's mood when the player has no streak and has not studied today." },
  happy: {
    title: "Happy",
    note: "Celebrating: every deck due today is done. Welcome, review and the winning pictures fall back to it.",
  },
  streak: { title: "On a streak", note: "Today's mood once today counts toward the streak, for a streak of 1 to 6 days." },
  sad: {
    title: "Sad",
    note: "Today's mood when the player has a streak and has studied less than half of today's minimum. It waits for the player.",
  },
  hopeful: {
    title: "Hopeful",
    note: "Today's mood when half or three quarters of today's minimum is studied, or after some study without a streak.",
  },
  frozen: {
    title: "Frozen",
    note: "Today's mood when a streak freeze kept yesterday and less than a quarter of today's minimum is studied; also while thawing (a quarter studied).",
  },
  neglected: {
    title: "Neglected",
    note: "The player has been away a long time. No streak mood shows it yet; abandoned and dead fall back to it.",
  },

  // Extensions: tiers and variants of a core mood.
  streak_hot: { title: "Streak, hot", note: "Today's mood once today counts, for a streak of 7 to 29 days." },
  streak_blazing: { title: "Streak, blazing", note: "Today's mood once today counts, for a streak of 30 to 99 days." },
  streak_legend: { title: "Streak, legend", note: "Today's mood once today counts, for a streak of 100 days or more." },
  streak_milestone: { title: "Streak milestone", note: "The moment card when the streak reaches a milestone." },
  frozen_2: { title: "Frozen, two days", note: "Today's mood when freezes kept the last two days." },
  frozen_3: { title: "Frozen, three days", note: "Today's mood when freezes kept the last three days or more." },
  welcome: {
    title: "Welcome",
    note: "Onboarding, sign-in, empty screens, and the home-screen greeting when nothing more specific applies.",
  },
  review: { title: "Review", note: "A small next step: the home screen when cards are due in the next deck, loading and studying." },
  hurt: { title: "Hurt", note: "A stronger sad. No screen shows it yet." },
  abandoned: { title: "Abandoned", note: "A stronger neglected, after a very long absence. No screen shows it yet." },
  dead: { title: "Dead", note: "The strongest neglected, for a lost streak after a long absence. No screen shows it yet." },
  leech_defeated: { title: "Leech defeated", note: "The moment card when the player tames a leech (a card they kept forgetting)." },
  winner: { title: "Winner", note: "Winning: first place on a board, a won challenge, a conquered deck." },

  // Moment, share-card and notification pictures.
  achievement: { title: "Achievement", note: "The moment card when the player unlocks an achievement." },
  at_risk: { title: "Streak at risk", note: "The reminder that there is still time today to keep the streak." },
  backlog: { title: "Backlog", note: "Calmly sorting overdue cards, when many reviews are waiting." },
  challenge: { title: "Challenge", note: "An invitation to a friendly challenge with a friend." },
  challenge_lost: { title: "Challenge lost", note: "A challenge the player lost; the companion applauds the other player." },
  challenge_won: { title: "Challenge won", note: "A challenge the player won." },
  comeback: { title: "Comeback", note: "Starting again after a lost streak." },
  deck_conquered: { title: "Deck conquered", note: "The moment card when the player conquers a deck." },
  freeze: { title: "Freeze", note: "A streak freeze protecting the streak, and the freeze settings." },
  freeze_used: { title: "Freeze used", note: "A freeze just saved the streak." },
  goal: { title: "Daily goal", note: "The player reached today's goal." },
  level_up: { title: "Level up", note: "The moment card when the player reaches a new level." },
  minimum: { title: "Minimum reached", note: "Today's minimum is studied: today counts toward the streak." },
  nudge: { title: "Nudge", note: "A friendly wave to another player, and the notification a friend's nudge sends." },
  place_1: { title: "First place", note: "First place on the weekly board, with a gold medal." },
  place_2: { title: "Second place", note: "Second place on the weekly board, with a silver medal." },
  place_3: { title: "Third place", note: "Third place on the weekly board, with a bronze medal." },

  // Launcher icons.
  icon: {
    title: "Launcher icon",
    note: "The app's icon on the phone's home screen when this companion is chosen. Head only, inside a circle or rounded square.",
  },
  icon_happy: {
    title: "Launcher icon, on a streak",
    note: "The home-screen icon once today counts toward the player's streak (mood icons on).",
  },
  icon_worried: {
    title: "Launcher icon, worried",
    note: "The home-screen icon while the player has a streak and has not studied enough today.",
  },
  icon_frozen: { title: "Launcher icon, frozen", note: "The home-screen icon while a streak freeze is keeping the streak." },
  icon_sleepy: { title: "Launcher icon, sleepy", note: "The home-screen icon when the player has no streak and has not studied today." },
  [MONO]: {
    title: "Monochrome launcher icon",
    note: "The single-colour outline Android 13 and later shows instead of the launcher icon when the player turns on themed icons. The exporter keeps only the picture's dark lines; without its own picture it outlines the face.",
  },
};

/** The framing a slot asks for. */
export function framingFor(name: string): Framing {
  return HEADSHOTS.test(name) ? "headshot" : "full_body";
}

/** The kind manifest.json gives a master of a slot in `group`. */
function kindOf(group: SlotGroup): MasterKind {
  switch (group) {
    case "core":
      return "core";
    case "extension":
      return "extension";
    case "icon":
    case "picture":
      return "picture";
  }
}

/** Every slot, grouped and in the fixture's order; fails on a slot without a note. */
export function slots(poses: PoseList, moods: MoodList): Slot[] {
  const rows: [string, SlotGroup, string | null][] = [
    ...poses.core.map((name): [string, SlotGroup, null] => [name, "core", null]),
    ...Object.entries(poses.extensions).map(([name, fallback]): [string, SlotGroup, string] => [name, "extension", fallback]),
    ...Object.entries(poses.icons).map(([name, fallback]): [string, SlotGroup, string] => [name, "icon", fallback]),
    [MONO, "icon", "face"],
    ...Object.entries(poses.pictures).map(([name, fallback]): [string, SlotGroup, string] => [name, "picture", fallback]),
  ];
  const unnoted = rows.map(([name]) => name).filter((name) => NOTES[name] === undefined);
  if (unnoted.length > 0) {
    throw new Error(`no note for ${unnoted.join(", ")}; add one to NOTES in src/slots.ts`);
  }

  // The moods that show each pose, in the fixture's order.
  const shownBy = new Map<string, string[]>();
  for (const { expected } of moods.moods) {
    const list = shownBy.get(expected.pose) ?? [];
    if (!list.includes(expected.mood)) {
      list.push(expected.mood);
    }
    shownBy.set(expected.pose, list);
  }

  return rows.map(([name, group, fallback]) => ({
    name,
    group,
    kind: kindOf(group),
    fallback,
    framing: framingFor(name),
    ...NOTES[name],
    moods: shownBy.get(name) ?? [],
  }));
}
