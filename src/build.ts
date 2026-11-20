// Builds the gallery from an AnkiQuest-Server checkout:
//   node src/build.ts <server-checkout> <out-dir>
// Writes index.html, the stylesheet and script, and copies each pose's
// master byte for byte under art/<companion>/ so Pages can serve it.

import { execFileSync } from "node:child_process";
import { closeSync, copyFileSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { companions, type Companion, type Pose } from "./art.ts";

/** The files under site/ copied next to index.html. */
const ASSETS = ["style.css", "filter.js"];

const SERVER_REPO = "https://github.com/AnkiQuest/AnkiQuest-Server";

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

/** Copies each master the page shows; returns its URL per source file. */
function copyArt(server: string, out: string, list: Companion[]): Map<string, string> {
  const urls = new Map<string, string>();
  for (const companion of list) {
    for (const pose of companion.poses) {
      if (pose.status.state !== "drawn") {
        continue;
      }
      const url = `art/${companion.id}/${pose.name}.png`;
      mkdirSync(join(out, dirname(url)), { recursive: true });
      copyFileSync(pose.status.file, join(out, url));
      urls.set(pose.status.file, url);
    }
  }
  return urls;
}

/** One pose's card. */
function card(companion: Companion, pose: Pose, urls: Map<string, string>): string {
  const status = pose.status;
  const label = words(pose.name);
  const search = [pose.name, label, pose.kind, ...pose.moods].join(" ");

  // The picture: the master, or the fallback the apps show instead.
  let picture = `<div class="none">Not drawn</div>`;
  let note = "";
  if (status.state !== "missing") {
    const url = urls.get(status.file) ?? "";
    const size = pngSize(status.file);
    const dims = size ? ` width="${size[0]}" height="${size[1]}"` : "";
    const alt =
      status.state === "drawn"
        ? `${companion.name}, ${label} pose`
        : `${companion.name}, ${words(status.pose)} pose, shown for ${label}`;
    picture = `<a href="${esc(url)}"><img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async"${dims}></a>`;
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
function section(companion: Companion, urls: Map<string, string>): string {
  const drawn = companion.poses.filter((p) => p.status.state === "drawn").length;
  const stage = companion.stage === "live" ? "Live in the apps" : "Planned, not in the apps yet";
  const licence = companion.licence ? `<p class="licence">${linked(companion.licence.trim())}</p>` : "";
  const cards = companion.poses.map((pose) => card(companion, pose, urls)).join("\n");
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
export function page(list: Companion[], urls: Map<string, string>, sha?: string): string {
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
${list.map((c) => section(c, urls)).join("\n")}
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
  const urls = copyArt(server, out, list);

  const site = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
  for (const asset of ASSETS) {
    copyFileSync(join(site, asset), join(out, asset));
  }
  writeFileSync(join(out, "index.html"), page(list, urls, commit(server)));

  const drawn = urls.size;
  console.log(`${list.length} companions, ${drawn} masters, into ${out}`);
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
