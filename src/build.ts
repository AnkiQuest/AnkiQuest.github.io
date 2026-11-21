// Builds the gallery from an AnkiQuest-Server checkout (fixtures) and an
// AnkiQuest-Art checkout (pictures):
//   node src/build.ts <server-checkout> <art-checkout> <out-dir>
// Writes index.html and the stylesheet, copies each pose's master byte for
// byte under art/<companion>/ and every other picture under files/, as Art
// lays them out, and makes a small WebP preview next to each for the grid;
// an animation gets an animated WebP. Previews need cwebp and webpmux
// (Debian/Ubuntu package webp).

import { execFileSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { companions, words, type Companion, type Origin, type Picture, type Pose, type Sequence } from "./art.ts";

/** The files under site/ copied next to index.html. */
const ASSETS = ["style.css", "wiring.html", "wiring.css"];

/** The wiring page's script, in TypeScript under site/, stripped to JavaScript on the site. */
const WIRING_SCRIPT = "wiring.ts";

/** The wiring map's data, at the repository root, written by src/wiring.ts. */
const WIRING_DATA = "wiring.json";

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

/** Folder on the site for pictures that are not poses, laid out as Art. */
const FILES = "files";

/** Width of the animated previews, in pixels. */
const ANIMATION_WIDTH = 240;

/** Shigeyuki's pack folders, in page order, and their headings; "" is the pack's top level. */
const PACK_FOLDERS: [string, string][] = [
  ["illust/", "Illustrations"],
  ["sticker/", "Stickers"],
  ["emoji/", "Emoji"],
  ["sprite/", "Animations"],
  ["", "App icon"],
];

/** What each stage says under the companion's name. */
const STAGE_TITLES: Record<Companion["stage"], string> = {
  live: "Live: players can earn this companion.",
  planned: "Future companion: not in the apps yet.",
  shared: "Pictures of more than one companion.",
};

/** What "art we made" means for each origin, under its heading. */
const MADE_BY: Record<Exclude<Origin, "shigeyuki">, string> = {
  derivative: "Derivatives of Shigeyuki's Anki-tan made for AnkiQuest, CC BY-SA 4.0.",
  ankiquest: "AnkiQuest's own art, AGPL-3.0-or-later.",
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

/** One picture on the site: its URL, and its preview's URL and size. */
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

/** An animation on the site: its animated preview, frames and frame delay. */
export interface Clip {
  art: Art;
  frames: string[];
  delay: number;
}

/** What the page shows: previews by picture path, animations by name. */
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

/** The site path of an Art file. */
function site(file: string): string {
  return `${FILES}/${file}`;
}

/** Copies `path` to `target` under `out` and makes its preview next to it. */
function publish(out: string, path: string, target: string): Art {
  const size = pngSize(path);
  if (size === undefined) {
    throw new Error(`${path} is not a PNG`);
  }
  mkdirSync(join(out, dirname(target)), { recursive: true });
  copyFileSync(path, join(out, target));
  const preview = target.replace(/\.png$/, ".webp");
  webp("cwebp", previewArgs(path, join(out, preview), size[0]));
  const [width, height] = previewSize(...size);
  return { master: target, preview, width, height };
}

/** Copies every picture the page shows, with previews; each file once. */
function copyAll(out: string, list: Companion[]): Shown {
  const art = new Map<string, Art>();

  // Pose masters at art/<companion>/<pose>.png, the URLs the gallery always had.
  for (const companion of list) {
    for (const pose of companion.poses) {
      if (pose.status.state === "drawn" && !art.has(pose.status.file)) {
        const path = companion.used.concat(companion.original).find((p) => p.file === pose.status.file)?.path;
        if (path === undefined) {
          continue;
        }
        art.set(pose.status.file, publish(out, path, `art/${companion.id}/${pose.name}.png`));
      }
    }
  }

  // Every other picture under files/, as Art lays it out.
  const clips = new Map<string, Clip>();
  for (const companion of list) {
    for (const sequence of companion.sequences) {
      clips.set(sequence.name, clip(out, sequence));
    }
    for (const picture of [...companion.original, ...companion.used, ...companion.retired]) {
      if (!art.has(picture.file) && sequenceOf(companion, picture) === undefined) {
        art.set(picture.file, publish(out, picture.path, site(picture.file)));
      }
    }
  }
  return { art, clips };
}

/** Copies an animation's frames and animated PNG, and makes one animated preview. */
function clip(out: string, sequence: Sequence): Clip {
  const delay = apngDelay(sequence.animation.path);
  for (const picture of [...sequence.frames, sequence.animation]) {
    const target = join(out, site(picture.file));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(picture.path, target);
  }

  const size = pngSize(sequence.frames[0].path);
  if (size === undefined) {
    throw new Error(`${sequence.frames[0].path} is not a PNG`);
  }
  const preview = `${FILES}/${sequence.name}.webp`;
  animate(sequence.frames.map((frame) => frame.path), join(out, preview), delay);
  const height = Math.round((size[1] * ANIMATION_WIDTH) / size[0]);
  return {
    art: { master: site(sequence.animation.file), preview, width: ANIMATION_WIDTH, height },
    frames: sequence.frames.map((frame) => site(frame.file)),
    delay,
  };
}

/** The animation `picture` is a frame or the animated PNG of, if any. */
function sequenceOf(companion: Companion, picture: Picture): Sequence | undefined {
  return companion.sequences.find(
    (sequence) => picture.file === sequence.animation.file || sequence.frames.some((frame) => frame.file === picture.file),
  );
}

/** A caption: the name, what it is, and its author and licence. */
function captionHtml(name: string, note: string, picture: Picture, extra = ""): string {
  const text = note ? `<small>${note}</small>` : "";
  const who = `<small class="licence">${esc(picture.author)} · ${esc(picture.licence)}</small>`;
  return `<div class="caption"><code>${esc(name)}</code>${text}${extra}${who}</div>`;
}

/** One picture: its preview, linking to the file, and its caption. */
export function cardHtml(companion: Companion, picture: Picture, shown: Shown): string {
  const art = shown.art.get(picture.file);
  if (art === undefined) {
    throw new Error(`no copy of ${picture.file}`);
  }
  const alt = picture.poses.length > 0 ? picture.poses.map(words).join(", ") : picture.name;
  const img = `<img src="${esc(art.preview)}" alt="${esc(`${companion.name}, ${alt}`)}" width="${art.width}" height="${art.height}" loading="lazy" decoding="async">`;
  return `<li><a href="${esc(art.master)}">${img}</a>${captionHtml(picture.name, esc(picture.note), picture)}</li>`;
}

/** One animation: its animated preview, linking to the animated PNG, and its frames. */
function clipCard(companion: Companion, sequence: Sequence, shown: Shown): string {
  const clip = shown.clips.get(sequence.name);
  if (clip === undefined) {
    throw new Error(`no animation of ${sequence.name}`);
  }
  const { art, frames, delay } = clip;
  const used = sequence.frames.filter((frame) => frame.note).map((frame) => `${basename(frame.name)}: ${frame.note}`);
  const img = `<img src="${esc(art.preview)}" alt="${esc(`${companion.name}, ${sequence.name} animation`)}" width="${art.width}" height="${art.height}" loading="lazy" decoding="async">`;
  const note = [`${frames.length} frames, ${delay} ms each; <a href="${esc(art.master)}">animated PNG</a>`, ...used.map(esc)].join(". ");
  const list = sequence.frames.map((frame, i) => `<li><a href="${esc(frames[i])}">${esc(basename(frame.name))}</a></li>`).join("");
  const details = `<details><summary>Frames</summary><ol class="frames">${list}</ol></details>`;
  const folder = sequence.frames[0].name.slice(0, sequence.frames[0].name.lastIndexOf("/") + 1);
  return `<li><a href="${esc(art.master)}">${img}</a>${captionHtml(folder, note, sequence.animation, details)}</li>`;
}

/** A grid of cards, or nothing. */
function grid(cards: string[]): string {
  return cards.length > 0 ? `<ul class="grid">\n${cards.join("\n")}\n</ul>` : "";
}

/** What a pose shows, for the pose table. */
export function shows(pose: Pose): string {
  switch (pose.status.state) {
    case "drawn": {
      const by = pose.origin === "shigeyuki" ? "Shigeyuki's" : "ours";
      return `<code>${esc(pose.status.file)}</code> (${by})`;
    }
    case "fallback":
      return `Falls back to ${esc(words(pose.status.pose))}`;
    case "missing": {
      const issue = pose.status.issue ? ` (<a href="${esc(pose.status.issue)}">to draw</a>)` : "";
      return `Missing${issue}`;
    }
  }
}

/** The pose table: every pose in the fixture and what the companion shows for it. */
function poseTable(companion: Companion): string {
  if (companion.poses.length === 0) {
    return "";
  }
  const rows = companion.poses.map((pose) => {
    const moods = pose.moods.map(words).join(", ");
    return `<tr><td>${esc(words(pose.name))}</td><td>${pose.kind}</td><td>${shows(pose)}</td><td>${esc(moods)}</td></tr>`;
  });
  return `<h3>Poses</h3>
<table class="poses">
<thead><tr><th>Pose</th><th>Kind</th><th>Shows</th><th>Moods</th></tr></thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>`;
}

/** Shigeyuki's originals, by pack folder, with his animations as one card each. */
function originals(companion: Companion, shown: Shown): string {
  if (companion.original.length === 0) {
    return "";
  }
  const parts = PACK_FOLDERS.map(([prefix, title]) => {
    const inFolder = companion.original.filter((picture) =>
      prefix ? picture.name.startsWith(prefix) : !picture.name.includes("/"),
    );
    const done = new Set<string>();
    const cards: string[] = [];
    for (const picture of inFolder) {
      const sequence = sequenceOf(companion, picture);
      if (sequence === undefined) {
        cards.push(cardHtml(companion, picture, shown));
      } else if (!done.has(sequence.name)) {
        done.add(sequence.name);
        cards.push(clipCard(companion, sequence, shown));
      }
    }
    return cards.length > 0 ? `<h4>${title}</h4>\n${grid(cards)}` : "";
  });

  const whole = companion.sequences.length > 0;
  const intro = whole
    ? "Shigeyuki's Anki-tan asset pack v1.0 as he made it (https://shigeyukey.github.io/shige-addons-wiki/Anki-tan.html). Pictures the apps use say what for."
    : "Pictures from Shigeyuki's Anki-tan asset pack v1.0 that this companion uses.";
  return `<h3>Shigeyuki's original art</h3>
<p class="credit">${linked(intro)}</p>
${parts.filter(Boolean).join("\n")}`;
}

/** Art we made: what the apps use, and what is retired. */
function ours(companion: Companion, shown: Shown): string {
  const all = [...companion.used, ...companion.retired];
  if (all.length === 0) {
    return "";
  }
  const origins = [...new Set(all.map((picture) => picture.origin))].filter((o) => o !== "shigeyuki") as (keyof typeof MADE_BY)[];
  const intro = origins.map((origin) => MADE_BY[origin]).join(" ");
  const used = grid(companion.used.map((picture) => cardHtml(companion, picture, shown)));
  const retired = grid(companion.retired.map((picture) => cardHtml(companion, picture, shown)));
  return `<h3>Art we made</h3>
<p class="credit">${esc(intro)}</p>
${used ? `<h4>In use</h4>\n${used}` : ""}
${retired ? `<h4>Retired</h4>\n${retired}` : ""}`.replace(/\n+$/, "");
}

/** One companion: name, stage, credit, poses, Shigeyuki's originals and our art. */
function section(companion: Companion, shown: Shown): string {
  const licence = companion.licence ? `<p class="credit">${credit(companion.licence)}</p>\n` : "";
  const parts = [poseTable(companion), originals(companion, shown), ours(companion, shown)].filter(Boolean).join("\n");
  return `<section id="${esc(companion.id)}">
<h2>${esc(companion.name)}</h2>
<p class="stage">${STAGE_TITLES[companion.stage]}</p>
${licence}${parts}
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
<meta name="description" content="Every AnkiQuest companion: Shigeyuki's original Anki-tan art, and the art AnkiQuest made, in use and retired.">
<link rel="stylesheet" href="style.css">
</head>
<body>
<main>
<h1><a href="https://ankiquest.org">AnkiQuest</a> companions</h1>
<p>Pictures from <a href="https://github.com/AnkiQuest/AnkiQuest-Art">AnkiQuest-Art</a>. <a href="wiring.html">How the AnkiQuest repositories are wired together</a></p>
<nav>${toc}</nav>
${list.map((c) => section(c, shown)).join("\n")}
</main>
</body>
</html>
`;
}

/** Builds the site into `out`, replacing what was there. */
export function build(server: string, art: string, out: string): void {
  const list = companions(server, art);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const shown = copyAll(out, list);

  const site = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
  for (const asset of ASSETS) {
    copyFileSync(join(site, asset), join(out, asset));
  }
  writeFileSync(join(out, "index.html"), page(list, shown));

  // The wiring page: its script without types, and the committed map.
  const script = readFileSync(join(site, WIRING_SCRIPT), "utf8");
  writeFileSync(join(out, WIRING_SCRIPT.replace(/\.ts$/, ".js")), stripTypeScriptTypes(script));
  copyFileSync(join(site, "..", WIRING_DATA), join(out, WIRING_DATA));

  // Pictures per companion and part, so a run shows what it filed where.
  for (const companion of list) {
    console.log(
      `${companion.id}: original ${companion.original.length}, used ${companion.used.length}, retired ${companion.retired.length}`,
    );
  }
  console.log(`${list.length} sections, ${shown.art.size} previews, ${shown.clips.size} animations, into ${out}`);
}

// Run when called as a script, not when imported by the tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [server, art, out] = process.argv.slice(2);
  if (!server || !art || !out) {
    console.error("usage: node src/build.ts <server-checkout> <art-checkout> <out-dir>");
    process.exit(2);
  }
  build(server, art, out);
}
