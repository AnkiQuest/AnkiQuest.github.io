// Where each picture comes from: AnkiQuest-Art's manifest.json, which lists
// every master with its origin (a file of Shigeyuki's Anki-tan pack, a
// derivative AnkiQuest made from his Anki-tan, or AnkiQuest's own art),
// author and licence, the pictures several companions share, and the
// archive: retired pictures and the rest of Shigeyuki's pack.
//
// The art matrix from AnkiQuest-Server decides what each companion shows;
// this file finds each shown picture in the Art checkout so every card can
// credit it. A picture in Art the manifest does not list, or a licence the
// gallery does not know, fails the build.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { Companion, Coverage } from "./coverage.ts";

/** Art's record of every master, the shared pictures and the archive. */
const MANIFEST = "manifest.json";

/** Art's folder of generation records; its pictures are not companion art. */
const DOCS = "docs";

/** Files that count as pictures; other files (README, LICENSE, JSON) are notes. */
const IMAGE = /\.(png|webp|jpe?g|gif|svg)$/i;

/** The licences the manifest may name (SPDX): how the page names each, and its text in Art. */
export const LICENCES: Record<string, { name: string; file: string }> = {
  "CC-BY-SA-4.0": { name: "CC BY-SA 4.0", file: "anki-tan/LICENSE" },
  "AGPL-3.0-or-later": { name: "AGPL-3.0-or-later", file: "LICENSE" },
};

// String unions, not enums: Node runs this file by stripping types, and
// enums are not erasable.

/**
 * Who made a picture: Shigeyuki (a file of his pack, unchanged), AnkiQuest
 * from his Anki-tan, or AnkiQuest for its own companions.
 */
export type Origin = "shigeyuki" | "derivative" | "ankiquest";

/** A master as manifest.json lists it. */
export interface Entry {
  companion: string;
  pose: string;
  kind: string;
  file: string;
  licence: string;
  origin: Origin;
  author: string;
  /** The file's path in Shigeyuki's pack. */
  pack?: string;
}

/** A picture of several companions as manifest.json lists it. */
export interface SharedEntry {
  name: string;
  shows: string[];
  file: string;
  licence: string;
  origin: Origin;
  author: string;
}

/** A retired picture as manifest.json lists it. */
export interface RetiredEntry {
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
export interface PackEntry {
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

/** One picture file in the Art checkout and who to credit for it. */
export interface Picture {
  /** Relative to the Art checkout, such as `aki/freeze.png`. */
  file: string;
  origin: Origin;
  author: string;
  /** SPDX id; a key of LICENCES. */
  licence: string;
  /** For a file of Shigeyuki's pack, its path in the pack. */
  pack?: string;
}

/** Art's manifest. */
export function readManifest(art: string): Manifest {
  return JSON.parse(readFileSync(join(art, MANIFEST), "utf8"));
}

/** The licence `spdx` as the page names it, and its text in Art; an unknown one fails. */
export function licence(spdx: string): { name: string; file: string } {
  const found = LICENCES[spdx];
  if (found === undefined) {
    throw new Error(`manifest.json: licence ${spdx} is unknown; add it to LICENCES in src/manifest.ts`);
  }
  return found;
}

/** Who made a picture, as a card says it. */
export function originName(origin: Origin): string {
  switch (origin) {
    case "shigeyuki":
      return "Shigeyuki's original";
    case "derivative":
      return "Made by AnkiQuest from Shigeyuki's Anki-tan";
    case "ankiquest":
      return "Made by AnkiQuest";
  }
}

/** The Art folder of a companion id: `anki_tan_chibi` is `anki-tan/chibi`. */
export function folder(id: string): string {
  const chibi = id.endsWith("_chibi");
  const base = (chibi ? id.slice(0, -"_chibi".length) : id).replaceAll("_", "-");
  return chibi ? `${base}/chibi` : base;
}

/** Every picture under `dir`, relative to `root` with `/`, sorted, skipping the folders in `skip`. */
export function walk(root: string, dir = "", skip: Set<string> = new Set()): string[] {
  const found: string[] = [];
  for (const name of readdirSync(join(root, dir)).sort()) {
    const path = dir === "" ? name : `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) {
      if (!skip.has(path) && name !== ".git") {
        found.push(...walk(root, path, skip));
      }
      continue;
    }
    if (IMAGE.test(name)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Every picture of the Art checkout with its credit, by Art path: the
 * masters, the shared and retired pictures and the files of Shigeyuki's
 * pack folder. Fails on a picture the manifest does not list, on an
 * unknown licence, and on a pack file kept twice.
 */
export function pictures(art: string, data: Manifest): Map<string, Picture> {
  const found = new Map<string, Picture>();
  const add = (picture: Picture) => {
    licence(picture.licence);
    found.set(picture.file, picture);
  };
  for (const entry of [...data.masters, ...data.shared, ...data.archive.retired]) {
    add({ file: entry.file, origin: entry.origin, author: entry.author, licence: entry.licence, pack: (entry as Entry).pack });
  }

  // The pack folder keeps the files of the pack that are no master.
  const pack = data.archive.pack;
  const taken = new Set(data.masters.flatMap((entry) => (entry.pack === undefined ? [] : [entry.pack])));
  const folder = pack.folder.replace(/\/$/, "");
  for (const file of walk(art, folder)) {
    const path = file.slice(folder.length + 1);
    if (taken.has(path)) {
      throw new Error(`${file} is also a master; the pack keeps each file once`);
    }
    add({ file, origin: pack.origin, author: pack.author, licence: pack.licence, pack: path });
  }

  // Two masters naming one pack file must be the same picture.
  const byPack = new Map<string, string>();
  for (const entry of data.masters) {
    if (entry.pack === undefined) {
      continue;
    }
    const known = byPack.get(entry.pack);
    if (known !== undefined && !readFileSync(join(art, known)).equals(readFileSync(join(art, entry.file)))) {
      throw new Error(`${known} and ${entry.file} both name pack ${entry.pack} but differ`);
    }
    byPack.set(entry.pack, entry.file);
  }

  // Every picture in the checkout, outside docs/, must be listed.
  const loose = walk(art, "", new Set([DOCS])).filter((file) => !found.has(file));
  if (loose.length > 0) {
    throw new Error(`${loose.join(", ")}: not in manifest.json`);
  }
  return found;
}

/** Content hashes of pictures, to find a Server file in Art by its bytes. */
export function hash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * The matrix with Art paths: each picture a cell shows becomes its master
 * in Art, or else the Art picture with the same bytes as the Server file
 * (`same`); the unlisted pictures are the companion's Art masters for no
 * item of the pose list, and licence texts are Art's. The Server's archive
 * is dropped: the archive page shows Art's. Fails on a picture Art does
 * not have, on a picture whose licence in Art is not the companion's in
 * the matrix (each page has one licence line), and on a manifest
 * companion the matrix does not list.
 */
export function localize(
  coverage: Coverage,
  data: Manifest,
  known: Map<string, Picture>,
  same: (file: string) => string | undefined,
): Coverage {
  const ids = new Set(coverage.companions.map((companion) => companion.id));
  const strangers = [...new Set(data.masters.map((entry) => entry.companion))].filter((id) => !ids.has(id));
  if (strangers.length > 0) {
    throw new Error(`manifest.json: ${strangers.join(", ")} not in the art matrix`);
  }

  const items = new Set(coverage.items.map((item) => item.name));
  const companions = coverage.companions.map((companion): Companion => {
    const masters = data.masters.filter((entry) => entry.companion === companion.id);
    const find = (pose: string, file: string) => {
      const found = masters.find((entry) => entry.pose === pose)?.file ?? same(file);
      if (found === undefined) {
        throw new Error(`${companion.id} ${pose} shows ${file}, which is not in AnkiQuest-Art; bump the art or server submodule`);
      }
      const spdx = coverage.licences[companion.licence]?.spdx;
      const picture = known.get(found);
      if (picture === undefined || picture.licence !== spdx) {
        throw new Error(`${found}: AnkiQuest-Art gives licence ${picture?.licence}, the art matrix gives ${companion.id} ${spdx}`);
      }
      return found;
    };
    return {
      ...companion,
      folder: folder(companion.id),
      items: companion.items.map((cell) => {
        switch (cell.status) {
          case "present":
            return { ...cell, file: find(cell.name, cell.file) };
          case "fallback":
            return { ...cell, file: find(cell.shows, cell.file) };
          case "missing":
            return cell;
        }
      }),
      unlisted: masters.filter((entry) => !items.has(entry.pose)).map((entry) => entry.file).sort(),
    };
  });

  const licences = Object.fromEntries(
    Object.entries(coverage.licences).map(([key, value]) => [key, { ...value, file: licence(value.spdx).file }]),
  );
  return { ...coverage, licences, companions, archive: [] };
}

/** The pack files that became masters, by pack path, with the companions and poses they show. */
export function packUsed(data: Manifest): { pack: string; file: string; uses: { companion: string; pose: string }[] }[] {
  const used = new Map<string, { pack: string; file: string; uses: { companion: string; pose: string }[] }>();
  for (const entry of data.masters) {
    if (entry.pack === undefined) {
      continue;
    }
    const found = used.get(entry.pack) ?? { pack: entry.pack, file: entry.file, uses: [] };
    found.uses.push({ companion: entry.companion, pose: entry.pose });
    used.set(entry.pack, found);
  }
  return [...used.values()].sort((a, b) => (a.pack < b.pack ? -1 : a.pack > b.pack ? 1 : 0));
}
