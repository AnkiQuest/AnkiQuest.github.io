// Builds the gallery from an AnkiQuest-Server checkout:
//   node src/build.ts <server-checkout> <out-dir> [coverage.json]
// Reads the art matrix from `xtask art-coverage --json` (run in the
// checkout, or read from coverage.json when given), copies every picture,
// licence and README it names byte for byte under files/<path>, makes two
// WebP previews of each picture (matrix and card size) and writes the
// matrix, a page per companion and the archive. Previews need cwebp
// (Debian/Ubuntu package webp).

import { execFileSync } from "node:child_process";
import { closeSync, copyFileSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { documents, files, parse, type Coverage } from "./coverage.ts";
import {
  archivePage,
  companionPage,
  fileHref,
  firstParagraph,
  matrixPage,
  pageName,
  type Image,
  type Look,
  type Shown,
} from "./pages.ts";

/** The files under site/ copied next to the pages. */
const ASSETS = ["style.css", "wiring.html", "wiring.css"];

/** The wiring page's script, in TypeScript under site/, stripped to JavaScript on the site. */
const WIRING_SCRIPT = "wiring.ts";

/** The wiring map's data, at the repository root, written by src/wiring.ts. */
const WIRING_DATA = "wiring.json";

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

/** Copies `path` from the checkout to files/ on the site unchanged. */
function copy(server: string, out: string, path: string): void {
  const target = join(out, fileHref(path));
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(server, path), target);
}

/** Copies every picture and makes its previews; returns where each one is. */
function pictures(server: string, out: string, coverage: Coverage): Map<string, Shown> {
  const shown = new Map<string, Shown>();
  for (const file of files(coverage)) {
    const master = join(server, file);
    const size = pngSize(master);
    if (size === undefined) {
      throw new Error(`${file} is not a PNG; the gallery previews PNGs only`);
    }
    copy(server, out, file);
    const base = `${PREVIEWS}/${file.replace(/\.png$/i, "")}`;
    shown.set(file, {
      href: fileHref(file),
      thumb: preview(master, out, `${base}-${THUMB_WIDTH}.webp`, size, THUMB_WIDTH),
      card: preview(master, out, `${base}-${CARD_WIDTH}.webp`, size, CARD_WIDTH),
    });
  }
  return shown;
}

/** Builds the site into `out`, replacing what was there. */
export function build(server: string, out: string, coverageFile?: string): void {
  const coverage = readCoverage(server, coverageFile);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  // Pictures, licence texts and READMEs, as the checkout lays them out.
  const shown = pictures(server, out, coverage);
  documents(coverage).forEach((path) => copy(server, out, path));
  const look: Look = (file) => {
    const found = shown.get(file);
    if (found === undefined) {
      throw new Error(`no copy of ${file}`);
    }
    return found;
  };

  // The matrix, a page per companion and the archive.
  writeFileSync(join(out, "index.html"), matrixPage(coverage, look));
  for (const companion of coverage.companions) {
    writeFileSync(join(out, pageName(companion)), companionPage(coverage, companion, look));
  }
  const note = (file: string) => firstParagraph(readFileSync(join(server, file), "utf8"));
  writeFileSync(join(out, "archive.html"), archivePage(coverage, look, note));

  // The stylesheet, and the wiring page: its script without types, and the committed map.
  const site = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
  for (const asset of ASSETS) {
    copyFileSync(join(site, asset), join(out, asset));
  }
  const script = readFileSync(join(site, WIRING_SCRIPT), "utf8");
  writeFileSync(join(out, WIRING_SCRIPT.replace(/\.ts$/, ".js")), stripTypeScriptTypes(script));
  copyFileSync(join(site, "..", WIRING_DATA), join(out, WIRING_DATA));

  // What each companion is missing, so a run shows the backlog.
  for (const companion of coverage.companions) {
    const { core, extensions } = companion.missing;
    console.log(`${companion.id}: ${core.length} core and ${extensions.length} extensions missing`);
  }
  console.log(`${coverage.companions.length} companions, ${shown.size} pictures, ${coverage.archive.length} archive folders, into ${out}`);
}

// Run when called as a script, not when imported by the tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [server, out, coverage] = process.argv.slice(2);
  if (!server || !out) {
    console.error("usage: node src/build.ts <server-checkout> <out-dir> [coverage.json]");
    process.exit(2);
  }
  build(server, out, coverage);
}
