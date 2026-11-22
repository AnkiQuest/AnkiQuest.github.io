// The mapping page's data (mapping.json): the slots from AnkiQuest-Server's
// pose list, the companions of the art matrix, every picture of the Art
// checkout (masters, shared pictures, retired pictures and Shigeyuki's
// pack) with where it is on the site, its credit and its framing, and the
// masters manifest.json maps today. build.ts reads the files and writes it;
// this file is pure so the tests can call it.

import type { Framing, MappingCompanion, MappingData, MappingMaster, MappingPicture } from "./mapping-model.ts";
import { folder as folderOf, licence, originName, type Manifest } from "./manifest.ts";
import { fileHref, type Shown } from "./pages.ts";
import { slots, type MoodList, type PoseList } from "./slots.ts";

/** The framings manifest.json may record. */
const FRAMINGS = new Set<Framing>(["full_body", "bust", "headshot"]);

/** A master as manifest.json may list it: with `framing` once AnkiQuest-Art#4 lands. */
type Master = Manifest["masters"][number] & { framing?: string };

/** The framing of each Art file, from the masters that record one. */
export function framings(masters: Master[]): Map<string, Framing> {
  const found = new Map<string, Framing>();
  for (const entry of masters) {
    if (entry.framing === undefined) {
      continue;
    }
    if (!FRAMINGS.has(entry.framing as Framing)) {
      throw new Error(`manifest.json: ${entry.file} has framing ${entry.framing}; the gallery knows ${[...FRAMINGS].join(", ")}`);
    }
    found.set(entry.file, entry.framing as Framing);
  }
  return found;
}

/**
 * The companion a picture shows, from the manifest (a master, a retired
 * picture or a file of Shigeyuki's pack) or else from its folder (the
 * longest companion folder it sits in, also under archive/); null for a
 * picture of several companions or none.
 */
export function companionOf(path: string, data: Manifest, companions: MappingCompanion[]): string | null {
  const listed = [...data.masters, ...data.archive.retired].filter((entry) => entry.file === path).map((entry) => entry.companion);
  if (new Set(listed).size === 1) {
    return listed[0];
  }
  if (data.shared.some((entry) => entry.file === path)) {
    return null;
  }
  if (path.startsWith(data.archive.pack.folder)) {
    return data.archive.pack.companion;
  }
  const inside = path.startsWith("archive/") ? path.slice("archive/".length) : path;
  const matches = companions.filter((companion) => inside.startsWith(`${companion.folder}/`));
  matches.sort((a, b) => b.folder.length - a.folder.length);
  return matches[0]?.id ?? null;
}

/** Everything the mapping page needs; `bytes` gives a picture's file size. */
export function mappingData(
  data: Manifest,
  shown: Map<string, Shown>,
  bytes: (path: string) => number,
  columns: { id: string; name: string; stage: string }[],
  poses: PoseList,
  moods: MoodList,
  art: string | null,
): MappingData {
  // The matrix's companions, then any the manifest adds.
  const ids = new Set(columns.map((companion) => companion.id));
  const extra = [...new Set(data.masters.map((entry) => entry.companion))].filter((id) => !ids.has(id));
  const companions: MappingCompanion[] = [
    ...columns.map(({ id, name, stage }) => ({ id, name, stage, folder: folderOf(id) })),
    ...extra.map((id) => ({ id, name: id, stage: "planned", folder: folderOf(id) })),
  ];

  // Every picture on the site, by Art path.
  const framed = framings(data.masters as Master[]);
  const pictures = [...shown.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, view]): MappingPicture => {
      const { name, file } = licence(view.picture.licence);
      return {
        path,
        folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
        companion: companionOf(path, data, companions),
        framing: framed.get(path) ?? null,
        width: view.size[0],
        height: view.size[1],
        bytes: bytes(path),
        href: view.href,
        thumb: view.thumb,
        card: view.card,
        origin: view.picture.origin,
        originName: originName(view.picture.origin),
        author: view.picture.author,
        licence: view.picture.licence,
        licenceName: name,
        licenceHref: fileHref(file),
        ...(view.picture.pack === undefined ? {} : { pack: view.picture.pack }),
      };
    });

  // Today's masters, as the manifest lists them.
  const masters = (data.masters as Master[]).map((entry): MappingMaster => {
    const { companion, pose, kind, file, licence: spdx, origin, author, pack, framing } = entry;
    return {
      companion,
      pose,
      kind,
      file,
      licence: spdx,
      origin,
      author,
      ...(pack === undefined ? {} : { pack }),
      ...(framing === undefined ? {} : { framing: framing as Framing }),
    };
  });

  return { art, slots: slots(poses, moods), companions, pictures, masters };
}
