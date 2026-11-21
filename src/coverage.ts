// The art matrix as AnkiQuest-Server's `xtask art-coverage --json` prints
// it (schema 1, docs/branding/art-coverage.md there): every companion by
// every item of the pose list, the licences and the archive. Every path is
// relative to the Server checkout's root; manifest.ts `localize` turns them
// into AnkiQuest-Art paths before the pages are made.

/** The schema this gallery reads; a newer one fails the build. */
export const SCHEMA = 1;

// String unions, not enums: Node runs this file by stripping types, and
// enums are not erasable.

/** Whether players can have a companion yet. */
export type Stage = "live" | "planned";

/** One kind of item, such as `core_mood`; `core` kinds are needed to go live. */
export interface Kind {
  kind: string;
  core: boolean;
}

/** One row of the matrix: an item of the pose list. */
export interface Item {
  name: string;
  kind: string;
  /** The item a companion without this one shows; null for a core mood. */
  fallback: string | null;
}

/** A licence: its SPDX id, its text's path and the credit it requires. */
export interface Licence {
  spdx: string;
  file: string;
  credit: string | null;
}

/** What one companion shows for one item. */
export type Cell =
  | { name: string; kind: string; status: "present"; file: string }
  | { name: string; kind: string; status: "fallback"; shows: string; file: string }
  | { name: string; kind: string; status: "missing" };

/** One column of the matrix. */
export interface Companion {
  id: string;
  name: string;
  folder: string;
  stage: Stage;
  /** A key of `licences`. */
  licence: string;
  /** One cell per item, in item order. */
  items: Cell[];
  /** The items still to draw: core ones and extensions. */
  missing: { core: string[]; extensions: string[] };
  /** Pictures in the folder that no item names. */
  unlisted: string[];
}

/** One archive folder: replaced masters and earlier copies. */
export interface Archive {
  folder: string;
  /** A key of `licences`. */
  licence: string;
  readme: string | null;
  files: string[];
}

export interface Coverage {
  schema: number;
  /** The pose list's path. */
  fixture: string;
  kinds: Kind[];
  items: Item[];
  licences: Record<string, Licence>;
  companions: Companion[];
  archive: Archive[];
}

/** Parses `art-coverage --json` output, failing on a schema it does not know. */
export function parse(text: string): Coverage {
  const value = JSON.parse(text);
  if (value?.schema !== SCHEMA) {
    throw new Error(`art-coverage schema ${value?.schema}, the gallery reads ${SCHEMA}; update src/coverage.ts`);
  }

  // Every licence key a companion or archive folder names must exist.
  const coverage = value as Coverage;
  const keys = [...coverage.companions, ...coverage.archive].map((entry) => entry.licence);
  const unknown = keys.filter((key) => coverage.licences[key] === undefined);
  if (unknown.length > 0) {
    throw new Error(`art-coverage names unknown licences: ${[...new Set(unknown)].join(", ")}`);
  }
  return coverage;
}

/** Every picture file the pages show: cells, unlisted pictures and the archive. */
export function files(coverage: Coverage): string[] {
  const found = new Set<string>();
  for (const companion of coverage.companions) {
    for (const cell of companion.items) {
      if (cell.status !== "missing") {
        found.add(cell.file);
      }
    }
    companion.unlisted.forEach((file) => found.add(file));
  }
  coverage.archive.forEach((folder) => folder.files.forEach((file) => found.add(file)));
  return [...found].sort();
}

/** Every other file the pages link to: licence texts and archive READMEs. */
export function documents(coverage: Coverage): string[] {
  const found = new Set(Object.values(coverage.licences).map((licence) => licence.file));
  for (const folder of coverage.archive) {
    if (folder.readme !== null) {
      found.add(folder.readme);
    }
  }
  return [...found].sort();
}

/** Whether a companion has at least one picture, its own or a fallback. */
export function drawn(companion: Companion): boolean {
  return companion.items.some((cell) => cell.status !== "missing");
}
