// Builds the gallery from an AnkiQuest-Server and an AnkiQuest-Art checkout:
//   node src/build.ts <server-checkout> <art-checkout> <out-dir> [coverage.json]
// Reads the art matrix from `xtask art-coverage --json` (run in the Server
// checkout, or read from coverage.json when given) and who made each
// picture from Art's manifest.json. Finds every picture the matrix shows in
// Art, copies it and the licences and READMEs byte for byte under
// files/<Art path>, makes two WebP previews of each picture (matrix and card
// size) and writes the matrix, a page per companion and the archive
// (a link to Shigeyuki's Anki-tan page and our retired art), and the mapping tool's data
// from Server's pose list and every picture of Art. Previews need cwebp
// (Debian/Ubuntu package webp).

import { execFileSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { documents, files, parse, type Coverage } from "./coverage.ts";
import { hash, localize, packUsed, pictures as artPictures, readManifest, type Manifest, type Picture } from "./manifest.ts";
import { mappingData } from "./mapping.ts";
import type { PoseList } from "./slots.ts";
import {
  archivePage,
  companionPage,
  esc,
  fileHref,
  firstParagraph,
  mappingPage,
  matrixPage,
  pageName,
  type ArtArchive,
  type Image,
  type Look,
  type Shown,
} from "./pages.ts";

/** The files under site/ copied next to the pages. */
const ASSETS = ["style.css", "wiring.css", "mapping.css"];

/** The wiring page, with the Mermaid source written into it. */
const WIRING_PAGE = "wiring.html";

/** Where the Mermaid source goes in the wiring page. */
const MERMAID_SLOT = "<!-- wiring.mmd -->";

/** The pages' scripts, in TypeScript under site/, stripped to JavaScript on the site. */
const SCRIPTS = ["wiring.ts", "mapping.ts"];

/** Art's pose list and Server's streak moods, which the mapping tool's slots come from. */
const POSES = "poses.json";
const MOODS = "tests/fixtures/streak_moods.json";

/**
 * The wiring map at the repository root, served as plain files at the site
 * root so agents can fetch them: the data (written by src/wiring.ts), its
 * Mermaid source and the source rendered light and dark (src/wiring-mermaid.ts).
 */
const WIRING_FILES = ["wiring.json", "wiring.mmd", "wiring.svg", "wiring-dark.svg"];

/** The command, run in the checkout, that prints the art matrix. */
const COVERAGE_COMMAND = ["run", "-q", "-p", "ankiquest-xtask", "--", "art-coverage", "--json"];

/** Folder on the site for the previews, laid out as the checkout. */
const PREVIEWS = "previews";

/** Width of the matrix thumbnails, in pixels: twice their width on the page. */
const THUMB_WIDTH = 160;

/** Width of the card previews, in pixels. */
const CARD_WIDTH = 360;

/** WebP quality of the previews, 0 to 100. */
const PREVIEW_QUALITY = 80;

/** Bytes before a PNG's width and height in its IHDR chunk. */
const PNG_SIZE_OFFSET = 16;

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

/** A preview's size: at most `max` wide, same shape; never enlarged. */
export function previewSize(width: number, height: number, max: number): [number, number] {
  if (width <= max) {
    return [width, height];
  }
  return [max, Math.round((height * max) / width)];
}

/** The art matrix: from `coverage` when given, else from the checkout. */
function readCoverage(server: string, coverage?: string): Coverage {
  if (coverage !== undefined) {
    return parse(readFileSync(coverage, "utf8"));
  }
  try {
    const text = execFileSync("cargo", COVERAGE_COMMAND, { cwd: server, encoding: "utf8", maxBuffer: 64 << 20 });
    return parse(text);
  } catch (error) {
    throw new Error(
      `cargo ${COVERAGE_COMMAND.join(" ")} failed in ${server}. The gallery needs AnkiQuest-Server with ` +
        `art-coverage --json (AnkiQuest-Server#118). ${error}`,
    );
  }
}

/** Writes a WebP preview of `master`, at most `max` wide, and returns it. */
function preview(master: string, out: string, src: string, size: [number, number], max: number): Image {
  const args = ["-quiet", "-q", String(PREVIEW_QUALITY), "-alpha_q", "100"];
  if (size[0] > max) {
    args.push("-resize", String(max), "0");
  }
  mkdirSync(dirname(join(out, src)), { recursive: true });
  try {
    execFileSync("cwebp", [...args, master, "-o", join(out, src)], { stdio: ["ignore", "ignore", "inherit"] });
  } catch (error) {
    throw new Error(`cwebp failed on ${master}; is it installed (package webp)? ${error}`);
  }
  const [width, height] = previewSize(...size, max);
  return { src, width, height };
}

/** Copies `path` from the Art checkout to files/ on the site unchanged. */
function copy(art: string, out: string, path: string): void {
  const target = join(out, fileHref(path));
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(art, path), target);
}

/** Copies every picture and makes its previews; returns where each one is. */
function pictures(art: string, out: string, list: string[], known: Map<string, Picture>): Map<string, Shown> {
  const shown = new Map<string, Shown>();
  for (const file of list) {
    const master = join(art, file);
    const size = pngSize(master);
    if (size === undefined) {
      throw new Error(`${file} is not a PNG; the gallery previews PNGs only`);
    }
    const picture = known.get(file);
    if (picture === undefined) {
      throw new Error(`${file} is not in manifest.json`);
    }
    copy(art, out, file);
    const base = `${PREVIEWS}/${file.replace(/\.png$/i, "")}`;
    shown.set(file, {
      href: fileHref(file),
      size,
      thumb: preview(master, out, `${base}-${THUMB_WIDTH}.webp`, size, THUMB_WIDTH),
      card: preview(master, out, `${base}-${CARD_WIDTH}.webp`, size, CARD_WIDTH),
      picture,
    });
  }
  return shown;
}

/** Finds a Server file in Art by its bytes: Art moved the pictures without editing them. */
function sameBytes(server: string, art: string, known: Map<string, Picture>): (file: string) => string | undefined {
  let byHash: Map<string, string> | undefined;
  return (file) => {
    if (!existsSync(join(server, file))) {
      return undefined;
    }
    byHash ??= new Map([...known.keys()].map((path) => [hash(join(art, path)), path]));
    return byHash.get(hash(join(server, file)));
  };
}

// Companions whose archive the gallery does not show: Anki-tan's art is
// Shigeyuki's, and his own page shows it (hill, 2026-11-21).
const HIDDEN_ARCHIVE = new Set(["anki_tan", "anki_tan_chibi"]);

/** Art's archive for the archive page, without the hidden companions' retired pictures. */
function artArchive(art: string, data: Manifest): ArtArchive {
  const readme = (dir: string) => (existsSync(join(art, dir, "README.md")) ? `${dir}/README.md` : null);
  const retired = data.archive.retired.filter((entry) => !HIDDEN_ARCHIVE.has(entry.companion));
  const retiredFolders = [...new Set(retired.map((entry) => entry.file.slice(0, entry.file.lastIndexOf("/"))))].sort();
  return {
    pack: data.archive.pack,
    packUsed: packUsed(data),
    retired,
    retiredReadmes: retiredFolders.flatMap((dir) => readme(dir) ?? []),
  };
}

/** The commit the Art checkout is on, or null when git cannot tell. */
function artCommit(art: string): string | null {
  try {
    return execFileSync("git", ["-C", art, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** The wiring page with the Mermaid source in its code block. */
export function wiringPage(html: string, source: string): string {
  if (!html.includes(MERMAID_SLOT)) {
    throw new Error(`${WIRING_PAGE} has no ${MERMAID_SLOT}`);
  }
  return html.replace(MERMAID_SLOT, () => esc(source.trimEnd()));
}

/**
 * The pictures the site copies: those the matrix shows, and every other picture
 * of Art, since the mapping tool offers each. That includes Shigeyuki's pack and
 * the retired pictures the archive page hides.
 */
export function copied(coverage: Coverage, known: Map<string, Picture>): string[] {
  return [...new Set([...files(coverage), ...known.keys()])].sort();
}

/** Builds the site into `out`, replacing what was there. */
export function build(server: string, art: string, out: string, coverageFile?: string): void {
  const data = readManifest(art);
  const known = artPictures(art, data);
  const coverage = localize(readCoverage(server, coverageFile), data, known, sameBytes(server, art, known));
  const archive = artArchive(art, data);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  // Pictures, licence texts and READMEs, as Art lays them out.
  const shown = pictures(art, out, copied(coverage, known), known);
  const docs = [...documents(coverage), ...archive.retiredReadmes];
  [...new Set(docs)].forEach((path) => copy(art, out, path));
  const look: Look = (file) => {
    const found = shown.get(file);
    if (found === undefined) {
      throw new Error(`no copy of ${file}`);
    }
    return found;
  };

  // The matrix, a page per companion and the archive.
  writeFileSync(join(out, "index.html"), matrixPage(coverage, look, data.shared));
  for (const companion of coverage.companions) {
    const retired = archive.retired.filter((entry) => entry.companion === companion.id);
    writeFileSync(join(out, pageName(companion)), companionPage(coverage, companion, look, retired));
  }
  const note = (file: string) => firstParagraph(readFileSync(join(art, file), "utf8"));
  writeFileSync(join(out, "archive.html"), archivePage(coverage, look, archive, note));

  // The stylesheet, and the wiring page: its script without types, and the committed map.
  const site = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
  for (const asset of ASSETS) {
    copyFileSync(join(site, asset), join(out, asset));
  }
  for (const script of SCRIPTS) {
    writeFileSync(join(out, script.replace(/\.ts$/, ".js")), stripTypeScriptTypes(readFileSync(join(site, script), "utf8")));
  }
  for (const file of WIRING_FILES) {
    copyFileSync(join(site, "..", file), join(out, file));
  }
  writeFileSync(join(out, WIRING_PAGE), wiringPage(readFileSync(join(site, WIRING_PAGE), "utf8"), readFileSync(join(site, "..", "wiring.mmd"), "utf8")));

  // The mapping tool: every slot by every companion, and every picture of Art.
  const poses = poseList(art);
  const moods = JSON.parse(readFileSync(join(server, MOODS), "utf8"));
  const mapping = mappingData(data, shown, (file) => statSync(join(art, file)).size, coverage.companions, poses, moods, artCommit(art));
  writeFileSync(join(out, "mapping.json"), JSON.stringify(mapping));
  writeFileSync(join(out, "mapping.html"), mappingPage(coverage));

  // What each companion is missing, so a run shows the backlog.
  for (const companion of coverage.companions) {
    const { core, extensions } = companion.missing;
    console.log(`${companion.id}: ${core.length} core and ${extensions.length} extensions missing`);
  }
  console.log(`${coverage.companions.length} companions, ${shown.size} pictures (${archive.retired.length} retired), into ${out}`);
}

/** The mapping tool's pose list: Art's poses.json. */
export function poseList(art: string): PoseList {
  return JSON.parse(readFileSync(join(art, POSES), "utf8")) as PoseList;
}

// Run when called as a script, not when imported by the tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [server, art, out, coverage] = process.argv.slice(2);
  if (!server || !art || !out) {
    console.error("usage: node src/build.ts <server-checkout> <art-checkout> <out-dir> [coverage.json]");
    process.exit(2);
  }
  build(server, art, out, coverage);
}
