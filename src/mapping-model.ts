// The data of the mapping page (mapping.json): every slot a companion can
// fill, every companion, every picture in AnkiQuest-Art with its credit and
// framing, and the masters manifest.json maps today. src/mapping.ts writes
// it at build time; site/mapping.ts reads it in the browser. Types only, so
// the page's script can import them and lose them when its types are
// stripped.

/** How much of the companion a picture shows, as manifest.json records it. */
export type Framing = "full_body" | "bust" | "headshot";

/**
 * The row groups of the mapping grid: the core moods and their extensions
 * from poses.json, the launcher icons (`icons` plus the
 * monochrome layer the exporter makes) and the moment and notification
 * pictures (its `pictures`).
 */
export type SlotGroup = "core" | "extension" | "icon" | "picture";

/** A master's kind in manifest.json. */
export type MasterKind = "core" | "extension" | "picture";

/** One row of the grid: a pose, icon or picture every companion can have. */
export interface Slot {
  /** The pose name, as manifest.json and poses.json name it. */
  name: string;
  group: SlotGroup;
  kind: MasterKind;
  /** The slot a companion without this one shows instead (for a core mood, its core_fallbacks entry); null when nothing is shown. */
  fallback: string | null;
  /** The framing the rule asks for: headshot for the face and launcher icons, full body for the rest. */
  framing: Framing;
  /** A short name in plain words. */
  title: string;
  /** Where and when the apps show it, in plain words. */
  note: string;
  /** The streak moods (streak_moods.json) that show this pose. */
  moods: string[];
}

/** A column of the grid. */
export interface MappingCompanion {
  id: string;
  name: string;
  /** live or planned. */
  stage: string;
  /** The companion's folder in Art, such as `anki-tan/chibi`. */
  folder: string;
}

/** One preview image on the site. */
export interface MappingImage {
  src: string;
  width: number;
  height: number;
}

/** One picture of the Art checkout. */
export interface MappingPicture {
  /** Its path in Art, such as `archive/anki-tan-pack/emoji/Ankitan_02_cry.png`. */
  path: string;
  /** Its folder in Art. */
  folder: string;
  /** The companion it shows, guessed from where it is; null for pictures of several. */
  companion: string | null;
  /** From manifest.json when a master records it; null when unknown. */
  framing: Framing | null;
  width: number;
  height: number;
  bytes: number;
  /** The full picture on the site. */
  href: string;
  thumb: MappingImage;
  card: MappingImage;
  origin: string;
  /** Who made it, as the gallery's cards say it, such as "Shigeyuki's original". */
  originName: string;
  author: string;
  /** SPDX id. */
  licence: string;
  /** How the page names the licence, and its text on the site. */
  licenceName: string;
  licenceHref: string;
  /** For a file of Shigeyuki's pack, its path in the pack. */
  pack?: string;
}

/** A master as manifest.json lists it, with the fields the mapping page reads. */
export interface MappingMaster {
  companion: string;
  pose: string;
  kind: string;
  file: string;
  licence: string;
  origin: string;
  author: string;
  pack?: string;
  framing?: Framing;
  /** In an exported mapping: the archive path the master is copied from. */
  from?: string;
}

/** mapping.json. */
export interface MappingData {
  /** The Art commit the data comes from, when known. */
  art: string | null;
  slots: Slot[];
  companions: MappingCompanion[];
  pictures: MappingPicture[];
  /** manifest.json's masters. */
  masters: MappingMaster[];
}
