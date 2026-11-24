// Stages the AnkiQuest-Art release that ankiquest-art.json pins, so the
// gallery builds from the pinned release instead of an Art submodule:
//   node src/art-release.ts <stage-dir>
// Downloads the assets the gallery reads (masters.zip, archive.zip,
// manifest.json, poses.json) from AnkiQuest-Art's release <tag>, checks each
// against the SHA-256 the pin records, unpacks the two zips (which hold the
// Art tree the build walks, less docs/), and writes the pinned commit for
// build.ts to report on the mapping page. AnkiQuest-Sync updates the pin;
// never edit ankiquest-art.json by hand.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The assets the gallery reads, in the release and the pin. */
const ASSETS = ["masters.zip", "archive.zip", "manifest.json", "poses.json"] as const;

/** The staging file that records the pinned Art commit. */
export const COMMIT = "ankiquest-art-commit";

type Pin = { _about: string; tag: string; commit: string; assets: Record<string, string> };

/** Reads the pin at `pinFile`. */
export function readPin(pinFile: string): Pin {
  return JSON.parse(readFileSync(pinFile, "utf8")) as Pin;
}

/** Downloads an asset of the pinned release and checks its SHA-256. */
export async function asset(pin: Pin, name: string): Promise<Buffer> {
  const url = `https://github.com/AnkiQuest/AnkiQuest-Art/releases/download/${pin.tag}/${name}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${name}: HTTP ${response.status} from ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== pin.assets[name]) {
    throw new Error(`${name}: SHA-256 ${digest}, the pin expects ${pin.assets[name]}`);
  }
  return bytes;
}

/** Stages the pinned release, replacing what was in `stage`. */
export async function stage(pinFile: string, stageDir: string): Promise<void> {
  const pin = readPin(pinFile);
  mkdirSync(stageDir, { recursive: true });
  for (const name of ASSETS) {
    const bytes = await asset(pin, name);
    if (name.endsWith(".zip")) {
      const archive = join(stageDir, `.${name}`);
      writeFileSync(archive, bytes);
      execFileSync("unzip", ["-q", archive, "-d", stageDir]);
    } else {
      writeFileSync(join(stageDir, name), bytes);
    }
  }
  writeFileSync(join(stageDir, COMMIT), `${pin.commit}\n`);
}

// Run when called as a script, not when imported by the tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [pinFile, stageDir] = process.argv.slice(2);
  if (!pinFile || !stageDir) {
    console.error("usage: node src/art-release.ts <ankiquest-art.json> <stage-dir>");
    process.exit(2);
  }
  await stage(pinFile, stageDir);
}
