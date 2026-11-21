// The gallery's pages, as HTML strings, from the art-coverage JSON with
// AnkiQuest-Art paths (manifest.ts `localize`): the matrix (index.html),
// one page per companion and the archive. Every picture card credits its
// origin, author and licence from Art's manifest. Pure functions; build.ts
// writes the files and makes the previews.

import { drawn, type Cell, type Companion, type Coverage, type Licence } from "./coverage.ts";
import { licence as licenceOf, originName, type PackEntry, type Picture, type RetiredEntry, type SharedEntry } from "./manifest.ts";

/** Folder on the site for files copied unchanged, at their checkout paths. */
export const FILES = "files";

/** Pages with fixed names; a companion id must not take one. */
const FIXED = new Set(["index", "archive", "wiring"]);

/** The issues that track the drawings still needed, by kind. */
const ISSUES: Record<string, number> = {
  core_mood: 57,
  extension: 57,
  picture: 116,
  icon: 116,
};

/** AnkiQuest-Server's issues, where every drawing still needed is tracked. */
const SERVER_ISSUES = "https://github.com/AnkiQuest/AnkiQuest-Server/issues";

/** Each kind's heading, plural. */
const KIND_TITLES: Record<string, string> = {
  core_mood: "Core moods",
  picture: "Moment and share-card pictures",
  icon: "Launcher icons",
  extension: "Extensions",
};

/** One item of each kind, in a sentence. */
const KIND_NAMES: Record<string, string> = {
  core_mood: "core mood",
  picture: "picture",
  icon: "launcher icon",
  extension: "extension",
};

/** One preview image on the site. */
export interface Image {
  src: string;
  width: number;
  height: number;
}

/** Where a picture is on the site (the master, a matrix thumbnail and a card preview) and who to credit. */
export interface Shown {
  href: string;
  thumb: Image;
  card: Image;
  picture: Picture;
}

/** Finds a picture's place on the site by its Art path. */
export type Look = (file: string) => Shown;

/** Art's archive, for the archive page: Shigeyuki's pack and the retired pictures. */
export interface ArtArchive {
  pack: PackEntry;
  /** The pack folder's README, by Art path. */
  packReadme: string | null;
  /** The files of the pack folder: the pack minus the files that became masters. */
  packFiles: string[];
  /** The pack files that became masters: pack path, Art file, and the companions and poses they show. */
  packUsed: { pack: string; file: string; uses: { companion: string; pose: string }[] }[];
  retired: RetiredEntry[];
  /** READMEs of the folders that hold retired pictures, by Art path. */
  retiredReadmes: string[];
}

/** The credit line of a card: origin, author and licence. */
function credit(picture: Picture): string {
  const { name, file } = licenceOf(picture.licence);
  const pack = picture.pack === undefined ? "" : `, pack <code>${esc(picture.pack)}</code>`;
  return `<small class="credit ${picture.origin}">${esc(originName(picture.origin))}${pack}. ${esc(picture.author)}, <a href="${esc(fileHref(file))}">${esc(name)}</a></small>`;
}

/** Escapes text for HTML content and attribute values. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Escapes text and links its https URLs. */
function linked(text: string): string {
  return esc(text).replace(/https:\/\/[^\s)&]+/g, (url) => `<a href="${url}">${url}</a>`);
}

/** An item name as words: streak_hot becomes "streak hot". */
function words(name: string): string {
  return name.replaceAll("_", " ");
}

/** The site URL of a file copied unchanged. */
export function fileHref(path: string): string {
  return `${FILES}/${path}`;
}

/** The page of one companion. */
export function pageName(companion: Companion): string {
  if (FIXED.has(companion.id)) {
    throw new Error(`companion id ${companion.id} clashes with the page ${companion.id}.html`);
  }
  return `${companion.id}.html`;
}

/** The issue tracking the drawings of `kind`, if one does. */
export function issueFor(kind: string): string | undefined {
  const number = ISSUES[kind];
  return number === undefined ? undefined : `${SERVER_ISSUES}/${number}`;
}

/** A kind's heading. */
function kindTitle(kind: string): string {
  const title = KIND_TITLES[kind];
  if (title !== undefined) {
    return title;
  }
  const name = words(kind);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The licence line for pictures that share `licence`. */
function licenceLine(licence: Licence, scope: string): string {
  const credit = licence.credit ? ` ${linked(licence.credit)}.` : "";
  return `<p class="licence">${scope}: licence <a href="${esc(fileHref(licence.file))}">${esc(licence.spdx)}</a>.${credit}</p>`;
}

/** An `<img>` of `image`. */
function img(image: Image, alt: string): string {
  return `<img src="${esc(image.src)}" alt="${esc(alt)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async">`;
}

/** The page frame: head, the navigation and `body`. */
function layout(coverage: Coverage, title: string, description: string, body: string): string {
  const companions = coverage.companions.map((c) => `<a href="${esc(pageName(c))}">${esc(c.name)}</a>`);
  const links = [`<a href="index.html">Matrix</a>`, ...companions, `<a href="archive.html">Archive</a>`, `<a href="wiring.html">Wiring</a>`];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
<p class="site"><a href="https://ankiquest.org">AnkiQuest</a> companions</p>
<nav>${links.join("\n")}</nav>
</header>
<main>
${body}
</main>
</body>
</html>
`;
}

/** The items of `kind`, in item order. */
function itemsOf(coverage: Coverage, kind: string): string[] {
  return coverage.items.filter((item) => item.kind === kind).map((item) => item.name);
}

/** `companion`'s cell for `item`. */
function cellOf(companion: Companion, item: string): Cell {
  const found = companion.items.find((cell) => cell.name === item);
  if (found === undefined) {
    throw new Error(`${companion.id} has no cell for ${item}`);
  }
  return found;
}

/** One matrix cell: the picture, the fallback it shows, or "missing"; Shigeyuki's originals are marked. */
function matrixCell(companion: Companion, cell: Cell, look: Look): string {
  const shown = cell.status === "missing" ? undefined : look(cell.file);
  const origin = shown === undefined ? "" : ` data-origin="${shown.picture.origin}"`;
  const open = `<td data-companion="${esc(companion.id)}" data-item="${esc(cell.name)}" class="${cell.status}"${origin}>`;
  const alt = `${companion.name}, ${words(cell.name)}`;
  const title = shown === undefined ? "" : ` title="${esc(`${originName(shown.picture.origin)}, ${shown.picture.author}`)}"`;
  switch (cell.status) {
    case "present": {
      return `${open}<a href="${esc(shown!.href)}"${title}>${img(shown!.thumb, alt)}</a></td>`;
    }
    case "fallback": {
      const label = `shows ${words(cell.shows)}`;
      return `${open}<a href="${esc(shown!.href)}"${title}>${img(shown!.thumb, `${alt}: ${label}`)}</a><span>${esc(label)}</span></td>`;
    }
    case "missing":
      return `${open}<span>missing</span></td>`;
  }
}

/** The matrix: every item by every companion with a picture, then the pictures several companions share; index.html. */
export function matrixPage(coverage: Coverage, look: Look, shared: SharedEntry[] = []): string {
  const columns = coverage.companions.filter(drawn);
  const empty = coverage.companions.filter((companion) => !drawn(companion));

  // Column heads: name, stage and licence.
  const heads = columns.map((companion) => {
    const licence = coverage.licences[companion.licence];
    return `<th scope="col"><a href="${esc(pageName(companion))}">${esc(companion.name)}</a><small>${companion.stage}<br>${esc(licence.spdx)}</small></th>`;
  });

  // One row group per kind; each row names its fallback.
  const groups = coverage.kinds.map(({ kind, core }) => {
    const rows = itemsOf(coverage, kind).map((name) => {
      const item = coverage.items.find((entry) => entry.name === name);
      const fallback = item?.fallback ? `<small>fallback: ${esc(words(item.fallback))}</small>` : "";
      const cells = columns.map((companion) => matrixCell(companion, cellOf(companion, name), look));
      return `<tr><th scope="row" id="${esc(name)}">${esc(words(name))}${fallback}</th>${cells.join("")}</tr>`;
    });
    const label = core ? "core" : "optional";
    return `<tbody>
<tr class="kind"><th colspan="${columns.length + 1}" scope="rowgroup">${esc(kindTitle(kind))}<small>${label}</small></th></tr>
${rows.join("\n")}
</tbody>`;
  });

  const planned = empty.length > 0
    ? `<p>Nothing drawn yet: ${empty.map((c) => `<a href="${esc(pageName(c))}">${esc(c.name)}</a>`).join(", ")}.</p>`
    : "";

  // Pictures of several companions together, such as the friends panel.
  const together = shared.length > 0
    ? `<h2 id="shared">Pictures of several companions</h2>
<ul class="grid">
${shared.map((entry) => fileCard(entry.file, "", entry.shows.map((id) => coverage.companions.find((c) => c.id === id)?.name ?? id).join(" and "), look)).join("\n")}
</ul>`
    : "";

  const body = `<h1>Art matrix</h1>
<p>Every companion by every item of the pose list (<code>${esc(coverage.fixture)}</code>). The goal is every item drawn for every companion. Core items are needed to go live; a missing item shows its fallback until it is drawn.</p>
<p class="legend"><span class="present">drawn</span> <span class="fallback">fallback: shows another item</span> <span class="missing">missing: shows nothing</span> <span class="shigeyuki">Shigeyuki's original</span></p>
<div class="matrix-wrap">
<table class="matrix">
<thead><tr><th scope="col">Item</th>${heads.join("")}</tr></thead>
${groups.join("\n")}
</table>
</div>
${planned}
<p>Each companion's page lists what it is missing and why, and who drew each picture: Shigeyuki's original Anki-tan art, or art AnkiQuest made. Shigeyuki's pack as he made it and our retired pictures are in the <a href="archive.html">archive</a>, apart from current art.</p>
${together}`;
  return layout(coverage, "AnkiQuest art matrix", "Every AnkiQuest companion by every pose: drawn, fallback or missing.", body);
}

/** One card on a companion page: the picture, the fallback it shows, or "missing". */
function itemCard(companion: Companion, cell: Cell, look: Look): string {
  const alt = `${companion.name}, ${words(cell.name)}`;
  const name = `<b>${esc(words(cell.name))}</b>`;
  const open = `<li id="${esc(cell.name)}" class="${cell.status}">`;
  switch (cell.status) {
    case "present": {
      const shown = look(cell.file);
      const file = cell.file.slice(cell.file.lastIndexOf("/") + 1);
      return `${open}<a href="${esc(shown.href)}">${img(shown.card, alt)}</a><div class="caption">${name}<small>${esc(file)}</small>${credit(shown.picture)}</div></li>`;
    }
    case "fallback": {
      const shown = look(cell.file);
      const label = `fallback: shows ${words(cell.shows)}`;
      return `${open}<a href="${esc(shown.href)}">${img(shown.card, `${alt}: ${label}`)}</a><div class="caption">${name}<small>${esc(label)}</small>${credit(shown.picture)}</div></li>`;
    }
    case "missing":
      return `${open}<div class="blank">missing</div><div class="caption">${name}<small>shows nothing</small></div></li>`;
  }
}

/** A card for a picture that is no item: its file name, an optional note and its credit. */
function fileCard(file: string, base: string, alt: string, look: Look, note = ""): string {
  const shown = look(file);
  const name = base !== "" && file.startsWith(`${base}/`) ? file.slice(base.length + 1) : file;
  const extra = note === "" ? "" : `<small>${note}</small>`;
  return `<li><a href="${esc(shown.href)}">${img(shown.card, alt)}</a><div class="caption"><b>${esc(name)}</b>${extra}${credit(shown.picture)}</div></li>`;
}

/** "1 extension", "2 core items". */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The missing items, grouped by core or extension and by the issue tracking them. */
function missingList(coverage: Coverage, companion: Companion): string {
  const groups = new Map<string, { title: string; rows: string[] }>();
  for (const [names, scope] of [[companion.missing.core, "Core items"], [companion.missing.extensions, "Extensions"]] as const) {
    for (const name of names) {
      const cell = cellOf(companion, name);
      const issue = issueFor(cell.kind);
      const tracked = issue ? `, tracked in <a href="${issue}">AnkiQuest-Server#${issue.slice(issue.lastIndexOf("/") + 1)}</a>` : "";
      const key = `${scope} ${issue ?? ""}`;
      const group = groups.get(key) ?? { title: `${scope}${tracked}`, rows: [] };
      groups.set(key, group);

      // The item, its kind and what players see instead.
      const kind = KIND_NAMES[cell.kind] ?? words(cell.kind);
      const shows = cell.status === "fallback" ? `shows ${esc(words(cell.shows))}` : "shows nothing";
      group.rows.push(`<li><a href="#${esc(name)}">${esc(words(name))}</a> (${esc(kind)}): ${shows}</li>`);
    }
  }
  if (groups.size === 0) {
    return "<p>Nothing missing.</p>";
  }
  return [...groups.values()]
    .map((group) => `<h3>${group.title}</h3>
<ul class="missing-list">
${group.rows.join("\n")}
</ul>`)
    .join("\n");
}

/**
 * Who drew the companion's pictures: Shigeyuki's originals apart from the
 * art we made, and ours in use apart from ours retired (in the archive).
 */
function originList(companion: Companion, look: Look, retired: RetiredEntry[]): string {
  const drawnItems = companion.items.flatMap((cell) => (cell.status === "present" ? [{ anchor: cell.name, label: words(cell.name), file: cell.file }] : []));
  const loose = companion.unlisted.map((file) => ({ anchor: "unlisted", label: file.slice(file.lastIndexOf("/") + 1), file }));
  const all = [...drawnItems, ...loose];
  if (all.length === 0 && retired.length === 0) {
    return "";
  }
  const links = (list: typeof all) => list.map((entry) => `<a href="#${esc(entry.anchor)}">${esc(entry.label)}</a>`).join(", ");
  const theirs = all.filter((entry) => look(entry.file).picture.origin === "shigeyuki");
  const ours = all.filter((entry) => look(entry.file).picture.origin !== "shigeyuki");
  const rows: string[] = [];
  if (theirs.length > 0) {
    rows.push(`<li>Shigeyuki's original art, from his Anki-tan pack: ${links(theirs)}.</li>`);
  }
  rows.push(`<li>Art we made, in use: ${ours.length > 0 ? `${links(ours)}.` : "none."}</li>`);
  const old = retired.map((entry) => `<a href="archive.html#${esc(entry.file)}">${esc(words(entry.pose))}</a>`);
  rows.push(`<li>Art we made, retired: ${old.length > 0 ? `${old.join(", ")} (in the archive).` : "none."}</li>`);
  return `<h2 id="origin">Who drew it</h2>
<ul class="origin-list">
${rows.join("\n")}
</ul>`;
}

/** One companion's page: licence, who drew it, what is missing and why, then every item. */
export function companionPage(coverage: Coverage, companion: Companion, look: Look, retired: RetiredEntry[] = []): string {
  const licence = coverage.licences[companion.licence];
  const stage = companion.stage === "live" ? "Live in the apps." : "Planned: not in the apps yet.";
  const present = companion.items.filter((cell) => cell.status === "present").length;
  const { core, extensions } = companion.missing;
  const summary = `${present} of ${companion.items.length} items drawn; ${count(core.length, "core item", "core items")} and ${count(extensions.length, "extension", "extensions")} missing.`;

  // Every item by kind, as on the matrix; nothing when nothing is drawn.
  const sections = drawn(companion)
    ? coverage.kinds.map(({ kind }) => {
        const cards = itemsOf(coverage, kind).map((name) => itemCard(companion, cellOf(companion, name), look));
        return `<h2 id="kind-${esc(kind)}">${esc(kindTitle(kind))}</h2>
<ul class="grid">
${cards.join("\n")}
</ul>`;
      })
    : ["<p>Nothing drawn yet.</p>"];

  // Pictures in the folder that the pose list does not name.
  const unlisted = companion.unlisted.length > 0
    ? `<h2 id="unlisted">Not in the pose list</h2>
<p>Pictures in <code>${esc(companion.folder)}</code> that no item names.</p>
<ul class="grid">
${companion.unlisted.map((file) => fileCard(file, companion.folder, `${companion.name}, ${file}`, look)).join("\n")}
</ul>`
    : "";

  const body = `<h1>${esc(companion.name)}</h1>
<p>${stage} ${summary}</p>
${licenceLine(licence, "Every picture on this page")}
${originList(companion, look, retired)}
<h2 id="missing">Missing</h2>
<p>Until it is drawn, a missing item shows its fallback.</p>
${missingList(coverage, companion)}
${sections.join("\n")}
${unlisted}`;
  return layout(coverage, `${companion.name}: AnkiQuest companion`, `What ${companion.name} has, what is missing and why.`, body);
}

/** The licence the matrix names for `spdx`, with its credit; else the bare licence. */
function licenceFor(coverage: Coverage, spdx: string): Licence {
  return Object.values(coverage.licences).find((entry) => entry.spdx === spdx) ?? { spdx, file: licenceOf(spdx).file, credit: null };
}

/** A README's first paragraph and a link to it. */
function readmeLine(readme: string, note: (file: string) => string | undefined): string {
  const text = note(readme);
  return `<p>${text ? `${linked(text)} ` : ""}<a href="${esc(fileHref(readme))}">README</a></p>`;
}

/** A link to the card of `pose` on `id`'s page. */
function poseLink(coverage: Coverage, id: string, pose: string): string {
  const companion = coverage.companions.find((entry) => entry.id === id);
  const label = `${companion?.name ?? id}: ${words(pose)}`;
  return companion === undefined ? esc(label) : `<a href="${esc(pageName(companion))}#${esc(pose)}">${esc(label)}</a>`;
}

/**
 * Shigeyuki's original art: his pack as he made it. The files that became
 * masters are named with what they show (their cards are on the companion
 * pages); the rest are cards, folder by folder, the animation frames folded.
 */
function packSection(coverage: Coverage, archive: ArtArchive, look: Look, note: (file: string) => string | undefined): string {
  const { pack } = archive;
  const base = pack.folder.replace(/\/$/, "");
  const used = archive.packUsed.map(
    (entry) => `<li><code>${esc(entry.pack)}</code>: ${entry.uses.map((use) => poseLink(coverage, use.companion, use.pose)).join(", ")}</li>`,
  );

  // The rest of the pack, by folder.
  const folders = new Map<string, string[]>();
  for (const file of archive.packFiles) {
    const path = file.slice(base.length + 1);
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    folders.set(dir, [...(folders.get(dir) ?? []), file]);
  }
  const groups = [...folders].map(([dir, files]) => {
    const cards = `<ul class="grid">
${files.map((file) => fileCard(file, `${base}/${dir}`.replace(/\/$/, ""), file, look)).join("\n")}
</ul>`;
    const title = dir === "" ? "Top folder" : dir;
    // Animation frames: many near-identical pictures, folded away.
    if (dir.split("/").length > 1) {
      return `<details>
<summary><code>${esc(title)}</code>: ${files.length} frames</summary>
${cards}
</details>`;
    }
    return `<h3><code>${esc(title)}</code></h3>
${cards}`;
  });

  return `<section id="shigeyuki">
<h2>Shigeyuki's original art</h2>
${licenceLine(licenceFor(coverage, pack.licence), "Every picture in his pack")}
${archive.packReadme === null ? `<p>${esc(pack.author)}'s Anki-tan asset pack (<a href="${esc(pack.source)}">${esc(pack.source)}</a>).</p>` : readmeLine(archive.packReadme, note)}
<h3>Pack files the apps use</h3>
<p>Kept as masters, unchanged; their cards are on the companion pages.</p>
<ul class="missing-list">
${used.join("\n")}
</ul>
${groups.join("\n")}
</section>`;
}

/** Art we made that the apps no longer use, each with the master that replaced it. */
function retiredSection(coverage: Coverage, archive: ArtArchive, look: Look, note: (file: string) => string | undefined): string {
  const cards = archive.retired.map((entry) => {
    const shown = look(entry.file);
    const why = `Replaced by ${poseLink(coverage, entry.companion, entry.pose)} (<code>${esc(entry.replaced_by)}</code>).${entry.note ? ` ${esc(entry.note)}` : ""}`;
    const name = entry.file.slice(entry.file.lastIndexOf("/") + 1);
    return `<li id="${esc(entry.file)}"><a href="${esc(shown.href)}">${img(shown.card, entry.file)}</a><div class="caption"><b>${esc(name)}</b><small>${why}</small>${credit(shown.picture)}</div></li>`;
  });
  return `<section id="retired">
<h2>Art we made, retired</h2>
${archive.retiredReadmes.map((readme) => readmeLine(readme, note)).join("\n")}
${cards.length > 0 ? `<ul class="grid">
${cards.join("\n")}
</ul>` : "<p>Nothing retired.</p>"}
</section>`;
}

/** The archive page: Shigeyuki's pack as he made it, and the art we made that is retired. */
export function archivePage(coverage: Coverage, look: Look, archive: ArtArchive, note: (file: string) => string | undefined = () => undefined): string {
  const body = `<h1>Archive</h1>
<p>What AnkiQuest-Art keeps apart from current art: Shigeyuki's Anki-tan pack as he made it, and pictures we made that were replaced. No app shows the pictures on this page; the pack files the apps use are named, with links to their cards.</p>
${packSection(coverage, archive, look, note)}
${retiredSection(coverage, archive, look, note)}`;
  return layout(coverage, "AnkiQuest art archive", "Shigeyuki's Anki-tan pack and retired AnkiQuest companion pictures.", body);
}

/** A README's first paragraph as plain text: links as their words. */
export function firstParagraph(markdown: string): string {
  const paragraph = markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block.length > 0 && !block.startsWith("#") && !block.startsWith("|"));
  return (paragraph ?? "")
    .replace(/\[([^\]]*)\]\((https:[^)]*)\)/g, "$1 ($2)")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll("`", "")
    .replace(/\s+/g, " ");
}
