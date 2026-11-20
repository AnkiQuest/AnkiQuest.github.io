// Builds the gallery from an AnkiQuest-Server checkout:
//   node src/build.ts <server-checkout> <out-dir>
// Writes index.html, the stylesheet and script, copies each pose's master
// byte for byte under art/<companion>/ and makes a small WebP preview of
// it there for the grid. Previews need cwebp (Debian/Ubuntu package webp).

import { execFileSync } from "node:child_process";
import { closeSync, copyFileSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { companions, type Companion, type Pose } from "./art.ts";

/** The files under site/ copied next to index.html. */
const ASSETS = ["style.css", "filter.js"];

const SERVER_REPO = "https://github.com/AnkiQuest/AnkiQuest-Server";

/** Width of the grid previews, in pixels; masters are wider. */
const PREVIEW_WIDTH = 480;

/** WebP quality of the previews, 0 to 100. */
const PREVIEW_QUALITY = 80;

/** Bytes before a PNG's width and height in its IHDR chunk. */
const PNG_SIZE_OFFSET = 16;

const LINKS: [string, string][] = [
  ["ankiquest.org", "https://ankiquest.org"],
  ["Server", SERVER_REPO],
  ["Android", "https://github.com/AnkiQuest/AnkiQuest-Android"],
  ["Desktop", "https://github.com/AnkiQuest/AnkiQuest-Desktop"],
];

/** Escapes text for HTML content and attribute values. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Escapes text and links its https URLs. */
function linked(text: string): string {
  return esc(text).replace(/https:\/\/[^\s)&]+/g, (url) => `<a href="${url}">${url}</a>`);
}

/** Plain text as paragraphs: blank lines split them, line breaks do not. */
function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((para) => `<p>${linked(para.replace(/\s*\n\s*/g, " "))}</p>`)
    .join("");
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

/** Copies each master the page shows and makes its preview. */
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

/** One pose's card. */
function card(companion: Companion, pose: Pose, art: Map<string, Art>): string {
  const status = pose.status;
  const label = words(pose.name);
  const search = [pose.name, label, pose.kind, ...pose.moods].join(" ");

  // The picture: the master, or the fallback the apps show instead.
  let picture = `<div class="none">Not drawn</div>`;
  let note = "";
  if (status.state !== "missing") {
    const shown = art.get(status.file);
    if (shown === undefined) {
      throw new Error(`no copy of ${status.file}`);
    }
    const alt =
      status.state === "drawn"
        ? `${companion.name}, ${label} pose`
        : `${companion.name}, ${words(status.pose)} pose, shown for ${label}`;
    // The preview in the grid; the link opens the full master.
    const img = `<img src="${esc(shown.preview)}" alt="${esc(alt)}" width="${shown.width}" height="${shown.height}" loading="lazy" decoding="async">`;
    picture = `<a href="${esc(shown.master)}">${img}</a>`;
  }
  if (status.state === "fallback") {
    note = `<p class="note">Not drawn yet. The apps show ${esc(words(status.pose))}.</p>`;
  }
  if (status.state === "missing") {
    note = `<p class="note">Not drawn yet.</p>`;
  }

  const moods = pose.moods.length
    ? `<p class="moods">Moods: ${pose.moods.map((m) => `<span>${esc(words(m))}</span>`).join(" ")}</p>`
    : "";
  const fallback = pose.fallback ? ` <span class="kind">falls back to ${esc(words(pose.fallback))}</span>` : "";
  return `<li class="pose ${status.state}" data-search="${esc(search.toLowerCase())}">
<figure>${picture}<figcaption><strong>${esc(label)}</strong>
<span class="tag ${pose.kind}">${pose.kind}</span>${fallback}${moods}${note}</figcaption></figure></li>`;
}

/** One companion's section. */
function section(companion: Companion, art: Map<string, Art>): string {
  const drawn = companion.poses.filter((p) => p.status.state === "drawn").length;
  const stage = companion.stage === "live" ? "Live in the apps" : "Planned, not in the apps yet";
  const licence = companion.licence ? `<div class="licence">${paragraphs(companion.licence)}</div>` : "";
  const cards = companion.poses.map((pose) => card(companion, pose, art)).join("\n");
  return `<section id="${esc(companion.id)}">
<h2>${esc(companion.name)} <span class="stage ${companion.stage}">${stage}</span></h2>
<p class="count">${drawn} of ${companion.poses.length} poses drawn</p>
${licence}<ul class="grid">
${cards}
</ul>
</section>`;
}

/** The Server commit the page was built from, if the checkout is a git one. */
function commit(server: string): string | undefined {
  try {
    return execFileSync("git", ["-C", server, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/** The whole page. */
export function page(list: Companion[], art: Map<string, Art>, sha?: string): string {
  const nav = LINKS.map(([text, href]) => `<a href="${href}">${text}</a>`).join("\n");
  const toc = list.map((c) => `<a href="#${esc(c.id)}">${esc(c.name)}</a>`).join("\n");
  const source = sha
    ? `<a href="${SERVER_REPO}/tree/${sha}/static">AnkiQuest-Server ${sha.slice(0, 7)}</a>`
    : `<a href="${SERVER_REPO}/tree/master/static">AnkiQuest-Server</a>`;
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
<header>
<p class="brand">AnkiQuest</p>
<nav>${nav}</nav>
</header>
<main>
<h1>Companions</h1>
<p class="intro">Every pose of every companion, from the masters in ${source}. Core poses are needed for every companion; a missing extension shows its fallback in the apps. Moods are the streak states that show a pose.</p>
<nav class="toc">${toc}</nav>
<label class="filter">Find a pose or mood <input type="search" id="filter" placeholder="frozen, streak, sad…" autocomplete="off"></label>
${list.map((c) => section(c, art)).join("\n")}
</main>
<script src="filter.js" defer></script>
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
  writeFileSync(join(out, "index.html"), page(list, art, commit(server)));

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
