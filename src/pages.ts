// The gallery's pages, as HTML strings, from the art-coverage JSON: the
// matrix (index.html), one page per companion and the archive. Pure
// functions; build.ts writes the files and makes the previews.

import { drawn, type Archive, type Cell, type Companion, type Coverage, type Licence } from "./coverage.ts";

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

/** Where a picture is on the site: the master, a matrix thumbnail and a card preview. */
export interface Shown {
  href: string;
  thumb: Image;
  card: Image;
}

/** Finds a picture's place on the site by its checkout path. */
export type Look = (file: string) => Shown;

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

/** One matrix cell: the picture, the fallback it shows, or "missing". */
function matrixCell(companion: Companion, cell: Cell, look: Look): string {
  const open = `<td data-companion="${esc(companion.id)}" data-item="${esc(cell.name)}" class="${cell.status}">`;
  const alt = `${companion.name}, ${words(cell.name)}`;
  switch (cell.status) {
    case "present": {
      const shown = look(cell.file);
      return `${open}<a href="${esc(shown.href)}">${img(shown.thumb, alt)}</a></td>`;
    }
    case "fallback": {
      const shown = look(cell.file);
      const label = `shows ${words(cell.shows)}`;
      return `${open}<a href="${esc(shown.href)}">${img(shown.thumb, `${alt}: ${label}`)}</a><span>${esc(label)}</span></td>`;
    }
    case "missing":
      return `${open}<span>missing</span></td>`;
  }
}

/** The matrix: every item by every companion with a picture; index.html. */
export function matrixPage(coverage: Coverage, look: Look): string {
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

  const body = `<h1>Art matrix</h1>
<p>Every companion by every item of the pose list (<code>${esc(coverage.fixture)}</code>). The goal is every item drawn for every companion. Core items are needed to go live; a missing item shows its fallback until it is drawn.</p>
<p class="legend"><span class="present">drawn</span> <span class="fallback">fallback: shows another item</span> <span class="missing">missing: shows nothing</span></p>
<div class="matrix-wrap">
<table class="matrix">
<thead><tr><th scope="col">Item</th>${heads.join("")}</tr></thead>
${groups.join("\n")}
</table>
</div>
${planned}
<p>Each companion's page lists what it is missing and why. Replaced and retired pictures are in the <a href="archive.html">archive</a>, apart from current art.</p>`;
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
      return `${open}<a href="${esc(shown.href)}">${img(shown.card, alt)}</a><div class="caption">${name}<small>${esc(file)}</small></div></li>`;
    }
    case "fallback": {
      const shown = look(cell.file);
      const label = `fallback: shows ${words(cell.shows)}`;
      return `${open}<a href="${esc(shown.href)}">${img(shown.card, `${alt}: ${label}`)}</a><div class="caption">${name}<small>${esc(label)}</small></div></li>`;
    }
    case "missing":
      return `${open}<div class="blank">missing</div><div class="caption">${name}<small>shows nothing</small></div></li>`;
  }
}

/** A card for a picture that is no item: its file name. */
function fileCard(file: string, base: string, alt: string, look: Look): string {
  const shown = look(file);
  const name = file.startsWith(`${base}/`) ? file.slice(base.length + 1) : file;
  return `<li><a href="${esc(shown.href)}">${img(shown.card, alt)}</a><div class="caption"><b>${esc(name)}</b></div></li>`;
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

/** One companion's page: licence, what is missing and why, then every item. */
export function companionPage(coverage: Coverage, companion: Companion, look: Look): string {
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
<h2 id="missing">Missing</h2>
<p>Until it is drawn, a missing item shows its fallback.</p>
${missingList(coverage, companion)}
${sections.join("\n")}
${unlisted}`;
  return layout(coverage, `${companion.name}: AnkiQuest companion`, `What ${companion.name} has, what is missing and why.`, body);
}

/** One archive folder: its licence, README and pictures. */
function archiveSection(coverage: Coverage, folder: Archive, look: Look, note: (file: string) => string | undefined): string {
  const licence = coverage.licences[folder.licence];
  const text = folder.readme === null ? undefined : note(folder.readme);
  const readme = folder.readme === null
    ? ""
    : `<p>${text ? `${linked(text)} ` : ""}<a href="${esc(fileHref(folder.readme))}">README</a></p>`;
  const cards = folder.files.map((file) => fileCard(file, folder.folder, file, look));
  return `<section id="${esc(folder.folder)}">
<h2><code>${esc(folder.folder)}</code></h2>
${licenceLine(licence, "Every picture in this folder")}
${readme}
<ul class="grid">
${cards.join("\n")}
</ul>
</section>`;
}

/** The archive page: replaced masters and earlier copies, folder by folder. */
export function archivePage(coverage: Coverage, look: Look, note: (file: string) => string | undefined = () => undefined): string {
  const sections = coverage.archive.map((folder) => archiveSection(coverage, folder, look, note));
  const body = `<h1>Archive</h1>
<p>Masters that were replaced, redrawn or retired, and earlier copies, kept byte for byte. None of them is current art, and no app shows them.</p>
${sections.length > 0 ? sections.join("\n") : "<p>The archive is empty.</p>"}`;
  return layout(coverage, "AnkiQuest art archive", "Replaced and retired AnkiQuest companion pictures.", body);
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
