// Builds the gallery from an AnkiQuest-Server checkout:
//   node src/build.ts <server-checkout> <out-dir>
// Writes index.html and the stylesheet, copies each pose's master byte for
// byte under art/<companion>/ and makes a small WebP preview of it there
// for the grid. Previews need cwebp (Debian/Ubuntu package webp).

import { execFileSync } from "node:child_process";
import { closeSync, copyFileSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { companions, type Companion, type Pose } from "./art.ts";

/** The files under site/ copied next to index.html. */
const ASSETS = ["style.css"];

/** Width of the grid previews, in pixels; masters are wider. */
const PREVIEW_WIDTH = 480;

/** WebP quality of the previews, 0 to 100. */
const PREVIEW_QUALITY = 80;

/** Bytes before a PNG's width and height in its IHDR chunk. */
const PNG_SIZE_OFFSET = 16;

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

/** Writes a WebP preview of `master` to `out` with cwebp. */
function preview(master: string, out: string, width: number): void {
  const args = ["-quiet", "-q", String(PREVIEW_QUALITY), "-alpha_q", "100"];
  if (width > PREVIEW_WIDTH) {
    args.push("-resize", String(PREVIEW_WIDTH), "0");
  }
  try {
    execFileSync("cwebp", [...args, master, "-o", out], { stdio: ["ignore", "ignore", "inherit"] });
  } catch (error) {
    throw new Error(`cwebp failed for ${master}; is it installed (package webp)? ${error}`);
  }
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
      preview(file, join(out, `${base}.webp`), size[0]);

      const [width, height] = previewSize(...size);
      art.set(file, { master: `${base}.png`, preview: `${base}.webp`, width, height });
    }
  }
  return art;
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

/** One companion: its name, the credit its licence asks for, and its poses. */
function section(companion: Companion, art: Map<string, Art>): string {
  const licence = companion.licence ? `<p class="credit">${credit(companion.licence)}</p>\n` : "";
  const cards = companion.poses
    .map((pose) => card(companion, pose, art))
    .filter(Boolean)
    .join("\n");
  return `<section id="${esc(companion.id)}">
<h2>${esc(companion.name)}</h2>
${licence}<ul class="grid">
${cards}
</ul>
</section>`;
}

/** The whole page. */
export function page(list: Companion[], art: Map<string, Art>): string {
  const toc = list.map((c) => `<a href="#${esc(c.id)}">${esc(c.name)}</a>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>AnkiQuest companions</title>
<meta name="description" content="Every AnkiQuest companion and pose.">
<link rel="stylesheet" href="style.css">
</head>
<body>
<main>
<h1><a href="https://ankiquest.org">AnkiQuest</a> companions</h1>
<nav>${toc}</nav>
${list.map((c) => section(c, art)).join("\n")}
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

  const site = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
  for (const asset of ASSETS) {
    copyFileSync(join(site, asset), join(out, asset));
  }
  writeFileSync(join(out, "index.html"), page(list, art));

  console.log(`${list.length} companions, ${art.size} masters and previews, into ${out}`);
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
