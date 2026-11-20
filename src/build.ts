// Builds the gallery from an AnkiQuest-Server checkout:
//   node src/build.ts <server-checkout> <out-dir>
// Writes index.html and the stylesheet, copies each pose's master byte for
// byte under art/<companion>/ and every other picture under files/, as
// static/ lays them out, and makes a small WebP preview next to each for
// the grid; an animation gets an animated WebP. Previews need cwebp and
// webpmux (Debian/Ubuntu package webp).

import { execFileSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  companions,
  GROUPS,
  PACKS,
  type Companion,
  type Group,
  type Pack,
  type Picture,
  type Place,
  type Pose,
  type Sequence,
} from "./art.ts";

/** The files under site/ copied next to index.html. */
const ASSETS = ["style.css"];

/** Width of the grid previews, in pixels; masters are wider. */
const PREVIEW_WIDTH = 480;

/** WebP quality of the previews, 0 to 100. */
const PREVIEW_QUALITY = 80;

/** Bytes before a PNG's width and height in its IHDR chunk. */
const PNG_SIZE_OFFSET = 16;

/** Bytes of a PNG's signature, before its first chunk. */
const PNG_SIGNATURE = 8;

/** Offset of the frame delay (numerator, denominator) in an APNG fcTL chunk. */
const FCTL_DELAY = 20;

/** An APNG delay denominator of 0 means hundredths (APNG spec). */
const DEFAULT_DENOMINATOR = 100;

/** Folder on the site for pictures that are not poses, laid out as static/. */
const FILES = "files";

/** Width of the animated previews, in pixels. */
const ANIMATION_WIDTH = 240;

/** Each group's heading. */
const GROUP_TITLES: Record<Group, string> = {
  pose: "Poses",
  moment: "Moments",
  icon: "Icons",
  pack: "Pack art",
  older: "Older versions, not in use",
};

/** Each kind of pack art's heading. */
const PACK_TITLES: Record<Pack, string> = {
  illustration: "Illustrations",
  sticker: "Stickers",
  emoji: "Emoji",
  sprite: "Animations",
  chibi: "Chibi",
};

/** Escapes text for HTML content and attribute values. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Escapes text and links its https URLs. */
function linked(text: string): string {
  return esc(text).replace(/https:\/\/[^\s)&]+/g, (url) => `<a href="${url}">${url}</a>`);
}

/** The credit a licence asks for: its first two paragraphs, on one line. */
export function credit(licence: string): string {
  const [who = "", terms = ""] = licence.trim().split(/\n\s*\n/);
  return linked(`${who} ${terms}`.replace(/\s+/g, " ").trim());
}

/** A pose name as words: streak_hot becomes "streak hot". */
function words(name: string): string {
  return name.replaceAll("_", " ");
}

/** A PNG's width and height from its header, or undefined. */
export function pngSize(path: string): [number, number] | undefined {
  const head = Buffer.alloc(PNG_SIZE_OFFSET + 8);
  const fd = openSync(path, "r");
  try {
    readSync(fd, head, 0, head.length, 0);
  } finally {
    closeSync(fd);
  }
  if (head.toString("latin1", 12, 16) !== "IHDR") {
    return undefined;
  }
  return [head.readUInt32BE(PNG_SIZE_OFFSET), head.readUInt32BE(PNG_SIZE_OFFSET + 4)];
}

/** One master on the site: its URL, and its preview's URL and size. */
export interface Art {
  master: string;
  preview: string;
  width: number;
  height: number;
}

/** The preview size for a master: at most PREVIEW_WIDTH wide, same shape. */
export function previewSize(width: number, height: number): [number, number] {
  if (width <= PREVIEW_WIDTH) {
    return [width, height];
  }
  return [PREVIEW_WIDTH, Math.round((height * PREVIEW_WIDTH) / width)];
}

/** cwebp's arguments for a preview of `master`, `width` wide, at `out`. */
function previewArgs(master: string, out: string, width: number): string[] {
  const args = ["-quiet", "-q", String(PREVIEW_QUALITY), "-alpha_q", "100"];
  if (width > PREVIEW_WIDTH) {
    args.push("-resize", String(PREVIEW_WIDTH), "0");
  }
  return [...args, master, "-o", out];
}

/** Copies each drawn master and makes its preview. */
function copyArt(out: string, list: Companion[]): Map<string, Art> {
  const art = new Map<string, Art>();
  for (const companion of list) {
    for (const pose of companion.poses) {
      if (pose.status.state !== "drawn") {
        continue;
      }
      const file = pose.status.file;
      const size = pngSize(file);
      if (size === undefined) {
        throw new Error(`${file} is not a PNG`);
      }

      // The master unchanged, and the preview next to it.
      const base = `art/${companion.id}/${pose.name}`;
      mkdirSync(join(out, dirname(base)), { recursive: true });
      copyFileSync(file, join(out, `${base}.png`));
      webp("cwebp", previewArgs(file, join(out, `${base}.webp`), size[0]));

      const [width, height] = previewSize(...size);
      art.set(file, { master: `${base}.png`, preview: `${base}.webp`, width, height });
    }
  }
  return art;
}

/** An animation on the site: its animated preview, frames and frame delay. */
export interface Clip {
  art: Art;
  frames: string[];
  delay: number;
}

/** What the page shows: previews by master path, animations by frame folder. */
export interface Shown {
  art: Map<string, Art>;
  clips: Map<string, Clip>;
}

/** The first frame delay of an animated PNG, in milliseconds. */
export function apngDelay(path: string): number {
  const bytes = readFileSync(path);
  for (let at = PNG_SIGNATURE; at + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    if (bytes.toString("latin1", at + 4, at + 8) === "fcTL") {
      const data = at + 8;
      const numerator = bytes.readUInt16BE(data + FCTL_DELAY);
      const denominator = bytes.readUInt16BE(data + FCTL_DELAY + 2) || DEFAULT_DENOMINATOR;
      return Math.round((numerator * 1000) / denominator);
    }
    at += 12 + length;
  }
  throw new Error(`${path} is not an animated PNG`);
}

/** Runs a webp tool, naming the package when it is missing. */
function webp(tool: string, args: string[]): void {
  try {
    execFileSync(tool, args, { stdio: ["ignore", "ignore", "inherit"] });
  } catch (error) {
    throw new Error(`${tool} failed; is it installed (package webp)? ${error}`);
  }
}

/** Writes an animated WebP of `frames`, ANIMATION_WIDTH wide, to `out`. */
function animate(frames: string[], out: string, delay: number): void {
  const temp = mkdtempSync(join(tmpdir(), "gallery-frames-"));
  try {
    // Each frame encoded once, then put together without re-encoding;
    // each frame replaces the last (dispose to background, no blending).
    const args: string[] = [];
    frames.forEach((frame, index) => {
      const still = join(temp, `${index}.webp`);
      webp("cwebp", ["-quiet", "-q", String(PREVIEW_QUALITY), "-alpha_q", "100", "-resize", String(ANIMATION_WIDTH), "0", frame, "-o", still]);
      args.push("-frame", still, `+${delay}+0+0+1-b`);
    });
    webp("webpmux", [...args, "-loop", "0", "-bgcolor", "0,0,0,0", "-o", out]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** The site path of a picture under static/. */
function site(file: string): string {
  return `${FILES}/${file}`;
}

/** Copies `file` (relative to static/) to the site unchanged. */
function copyMaster(server: string, out: string, file: string): void {
  const target = join(out, site(file));
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(server, "static", file), target);
}

/** Copies each picture that is not a pose and makes its preview; animations get one preview each. */
function copyFiles(server: string, out: string, list: Companion[], art: Map<string, Art>): Map<string, Clip> {
  const clips = new Map<string, Clip>();
  for (const companion of list) {
    // Animations: frames and animated PNG copied, one animated preview.
    for (const sequence of companion.sequences) {
      const folder = join(server, "static", sequence.frames);
      const frames = readdirSync(folder).filter((name) => name.endsWith(".png")).sort();
      const delay = apngDelay(join(server, "static", sequence.animation));
      for (const frame of frames) {
        copyMaster(server, out, `${sequence.frames}/${frame}`);
      }
      copyMaster(server, out, sequence.animation);

      const size = pngSize(join(folder, frames[0]));
      if (size === undefined) {
        throw new Error(`${folder} has no PNG frames`);
      }
      const preview = `${site(sequence.frames)}.webp`;
      animate(frames.map((frame) => join(folder, frame)), join(out, preview), delay);
      const height = Math.round((size[1] * ANIMATION_WIDTH) / size[0]);
      clips.set(sequence.frames, {
        art: { master: site(sequence.animation), preview, width: ANIMATION_WIDTH, height },
        frames: frames.map((frame) => site(`${sequence.frames}/${frame}`)),
        delay,
      });
    }

    // Every other picture that is not a pose master and not in an animation.
    for (const picture of companion.pictures) {
      if (picture.place.group === "pose" || sequenceOf(companion, picture) !== undefined) {
        continue;
      }
      const size = pngSize(picture.path);
      if (size === undefined) {
        throw new Error(`${picture.path} is not a PNG`);
      }
      copyMaster(server, out, picture.file);
      const preview = site(picture.file.replace(/\.png$/, ".webp"));
      webp("cwebp", previewArgs(picture.path, join(out, preview), size[0]));
      const [width, height] = previewSize(...size);
      art.set(picture.path, { master: site(picture.file), preview, width, height });
    }
  }
  return clips;
}

/** The animation `picture` is a frame or the animated PNG of, if any. */
function sequenceOf(companion: Companion, picture: Picture): Sequence | undefined {
  return companion.sequences.find(
    (sequence) => picture.file === sequence.animation || picture.file.startsWith(`${sequence.frames}/`),
  );
}

/** One drawn pose: its preview, linking to the master, and its name. */
function card(companion: Companion, pose: Pose, art: Map<string, Art>): string {
  if (pose.status.state !== "drawn") {
    return "";
  }
  const shown = art.get(pose.status.file);
  if (shown === undefined) {
    throw new Error(`no copy of ${pose.status.file}`);
  }
  const label = words(pose.name);
  const img = `<img src="${esc(shown.preview)}" alt="${esc(`${companion.name}, ${label}`)}" width="${shown.width}" height="${shown.height}" loading="lazy" decoding="async">`;
  return `<li><a href="${esc(shown.master)}">${img}</a><span>${esc(label)}</span></li>`;
}

/** What a picture's caption says besides its file name. */
export function caption(place: Place): string {
  switch (place.group) {
    case "pose":
      return place.poses.map(words).join(", ");
    case "moment":
    case "icon":
      return place.note;
    case "older": {
      const replaced =
        place.copy === "same" ? `Earlier name of ${place.replacedBy}, same picture.` : `Replaced by ${place.replacedBy}.`;
      return place.note ? `${replaced} ${place.note}.` : replaced;
    }
    case "pack":
      return place.note ?? "";
  }
}

/** A caption: the file name, what it is, and its licence. */
function captionHtml(name: string, text: string, licence: string, extra = ""): string {
  const note = text ? `<small>${text}</small>` : "";
  return `<div class="caption"><code>${esc(name)}</code>${note}${extra}<small class="licence">${esc(licence)}</small></div>`;
}

/** One picture that is not a pose: its preview, linking to the master, and its caption. */
function fileCard(companion: Companion, picture: Picture, shown: Shown): string {
  const art = shown.art.get(picture.path);
  if (art === undefined) {
    throw new Error(`no copy of ${picture.path}`);
  }
  const img = `<img src="${esc(art.preview)}" alt="${esc(`${companion.name}, ${picture.name}`)}" width="${art.width}" height="${art.height}" loading="lazy" decoding="async">`;
  const text = esc(caption(picture.place));
  return `<li><a href="${esc(art.master)}">${img}</a>${captionHtml(picture.name, text, picture.credit.licence)}</li>`;
}

/** One animation: its animated preview, linking to the animated PNG, and its frames. */
function clipCard(companion: Companion, sequence: Sequence, licence: string, shown: Shown): string {
  const clip = shown.clips.get(sequence.frames);
  if (clip === undefined) {
    throw new Error(`no animation of ${sequence.frames}`);
  }
  const { art, frames, delay } = clip;
  const name = sequence.frames.slice(sequence.frames.indexOf("/") + 1);
  const img = `<img src="${esc(art.preview)}" alt="${esc(`${companion.name}, ${sequence.name} animation`)}" width="${art.width}" height="${art.height}" loading="lazy" decoding="async">`;
  const text = `${frames.length} frames, ${delay} ms each; <a href="${esc(art.master)}">animated PNG</a>`;
  const list = frames.map((frame) => `<li><a href="${esc(frame)}">${esc(basename(frame))}</a></li>`).join("");
  const details = `<details><summary>Frames</summary><ol class="frames">${list}</ol></details>`;
  return `<li><a href="${esc(art.master)}">${img}</a>${captionHtml(`${name}/`, text, licence, details)}</li>`;
}

/** Pictures as grids, one per credit, each under the credit it shows. */
function credited(companion: Companion, pictures: Picture[], shown: Shown): string {
  // Cards in file order, each animation once, grouped by credit source.
  const blocks = new Map<string, { text: string; cards: string[] }>();
  const done = new Set<string>();
  for (const picture of pictures) {
    const block = blocks.get(picture.credit.source) ?? { text: picture.credit.text, cards: [] };
    blocks.set(picture.credit.source, block);

    const sequence = sequenceOf(companion, picture);
    if (sequence === undefined) {
      block.cards.push(fileCard(companion, picture, shown));
    } else if (!done.has(sequence.frames)) {
      done.add(sequence.frames);
      block.cards.push(clipCard(companion, sequence, picture.credit.licence, shown));
    }
  }

  return [...blocks]
    .map(([source, block]) => {
      const from = source ? `From <code>static/${esc(source)}</code>: ` : "";
      return `<p class="credit">${from}${linked(block.text)}</p>
<ul class="grid">
${block.cards.join("\n")}
</ul>`;
    })
    .join("\n");
}

/** One group of a companion's pictures under its heading, or nothing. */
function group(companion: Companion, kind: Group, shown: Shown): string {
  // Poses: the pose list's grid, as the gallery always showed it.
  if (kind === "pose") {
    const cards = companion.poses
      .map((pose) => card(companion, pose, shown.art))
      .filter(Boolean)
      .join("\n");
    return cards ? `<h3>${GROUP_TITLES.pose}</h3>\n<ul class="grid">\n${cards}\n</ul>` : "";
  }

  const pictures = companion.pictures.filter((picture) => picture.place.group === kind);
  if (pictures.length === 0) {
    return "";
  }
  if (kind !== "pack") {
    return `<h3>${GROUP_TITLES[kind]}</h3>\n${credited(companion, pictures, shown)}`;
  }

  // Pack art, one heading per kind.
  const parts = PACKS.map((pack) => {
    const ofPack = pictures.filter((picture) => picture.place.group === "pack" && picture.place.pack === pack);
    return ofPack.length > 0 ? `<h4>${PACK_TITLES[pack]}</h4>\n${credited(companion, ofPack, shown)}` : "";
  });
  return `<h3>${GROUP_TITLES.pack}</h3>\n${parts.filter(Boolean).join("\n")}`;
}

/** One companion: its name, the credit its licence asks for, and each group of pictures. */
function section(companion: Companion, shown: Shown): string {
  const licence = companion.licence ? `<p class="credit">${credit(companion.licence)}</p>\n` : "";
  const groups = GROUPS.map((kind) => group(companion, kind, shown))
    .filter(Boolean)
    .join("\n");
  return `<section id="${esc(companion.id)}">
<h2>${esc(companion.name)}</h2>
${licence}${groups}
</section>`;
}

/** The whole page. */
export function page(list: Companion[], shown: Shown): string {
  const toc = list.map((c) => `<a href="#${esc(c.id)}">${esc(c.name)}</a>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>AnkiQuest companions</title>
<meta name="description" content="Every AnkiQuest companion: poses, moments, icons, pack art and older versions.">
<link rel="stylesheet" href="style.css">
</head>
<body>
<main>
<h1><a href="https://ankiquest.org">AnkiQuest</a> companions</h1>
<nav>${toc}</nav>
${list.map((c) => section(c, shown)).join("\n")}
</main>
</body>
</html>
`;
}

/** Builds the site into `out`, replacing what was there. */
export function build(server: string, out: string): void {
  const list = companions(server);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const art = copyArt(out, list);
  const clips = copyFiles(server, out, list, art);

  const site = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
  for (const asset of ASSETS) {
    copyFileSync(join(site, asset), join(out, asset));
  }
  writeFileSync(join(out, "index.html"), page(list, { art, clips }));

  // Pictures per companion and group, so a run shows what it filed where.
  for (const companion of list) {
    const counts = GROUPS.map((kind) => {
      const count = companion.pictures.filter((picture) => picture.place.group === kind).length;
      return `${kind} ${count}`;
    });
    console.log(`${companion.id}: ${counts.join(", ")}`);
  }
  console.log(`${list.length} sections, ${art.size} previews, ${clips.size} animations, into ${out}`);
}

// Run when called as a script, not when imported by the tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [server, out] = process.argv.slice(2);
  if (!server || !out) {
    console.error("usage: node src/build.ts <server-checkout> <out-dir>");
    process.exit(2);
  }
  build(server, out);
}
