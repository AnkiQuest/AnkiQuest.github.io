// The mapping page: every slot (pose, launcher icon, moment picture) by
// every companion, showing the picture mapped to it, the fallback it shows
// or "missing". A click on a cell opens a picker of every picture in
// AnkiQuest-Art. Changes stay in the page, are kept as a draft in this
// browser, are listed against manifest.json, and export as JSON in the
// shape of manifest.json's masters for an agent to apply to AnkiQuest-Art.
// build.ts strips the types into mapping.js. The helpers above main() are
// pure, so the tests import this file in Node.

import type { Framing, MappingCompanion, MappingData, MappingMaster, MappingPicture, Slot, SlotGroup } from "../src/mapping-model.ts";

/** What a slot is set to: a picture of Art, or nothing (the slot shows its fallback). */
export type Choice = { state: "picture"; file: string } | { state: "missing" };

/** Every slot of every companion, by `key`. */
export type Mapping = Map<string, Choice>;

/** What a cell shows: its own picture, the picture of the slot it falls back to, or nothing. */
export type Resolved =
  | { status: "present"; file: string }
  | { status: "fallback"; shows: string; file: string }
  | { status: "missing" };

/** One slot whose choice differs from manifest.json. */
export interface Change {
  companion: string;
  pose: string;
  before: Choice;
  after: Choice;
}

/** The exported file: manifest.json's masters and missing core poses, as the mapping sets them. */
export interface Export {
  _about: string;
  art: string | null;
  masters: MappingMaster[];
  missing: { companion: string; pose: string; issue: string }[];
}

/** Where an exported mapping says what to do with it. */
const ABOUT =
  "A companion mapping from the AnkiQuest gallery's mapping page. masters replaces manifest.json's masters in AnkiQuest-Art and missing its missing list. An entry with from copies that archive picture to file (a new master); every other file is already in Art. framing is given where Art records it. art is the Art commit the mapping was made on.";

/** The issue that tracks missing core poses. */
const MISSING_ISSUE = "https://github.com/AnkiQuest/AnkiQuest-Server/issues/57";

/** Art's folder of pictures that are no longer masters. */
const ARCHIVE = "archive/";

/** Where the draft is kept in this browser. */
const DRAFT_KEY = "ankiquest-mapping-draft";

/** The draft's format; another one is ignored. */
const DRAFT_VERSION = 1;

/** Each row group's heading and note. */
export const GROUPS: Record<SlotGroup, { title: string; note: string }> = {
  core: {
    title: "Core moods",
    note: "The poses every companion needs. The home screen, the streak widget and the Today panel show one of them for today's streak mood. Until every live companion has them drawn, some fall back to another core mood; each row says which.",
  },
  extension: {
    title: "Extension moods",
    note: "Stronger or more specific versions of a core mood. Without its own picture, each shows the pose it falls back to.",
  },
  icon: {
    title: "Launcher icons",
    note: "The app's icon on the phone's home screen. The mood icons change with the streak when the player turns mood icons on.",
  },
  picture: {
    title: "Moment and notification pictures",
    note: "Pictures on moment cards, share cards, boards, challenges and notifications.",
  },
};

/** Framing in words. */
export const FRAMING_WORDS: Record<Framing, string> = {
  full_body: "full body",
  bust: "head and shoulders",
  headshot: "head only",
};

/** The key of one companion's slot. */
export function key(companion: string, pose: string): string {
  return `${companion}/${pose}`;
}

/** Two choices are the same. */
export function same(a: Choice, b: Choice): boolean {
  return a.state === b.state && (a.state === "missing" || a.file === (b as { file: string }).file);
}

/** The mapping manifest.json gives: each slot's master, or missing. */
export function baseline(data: MappingData): Mapping {
  const mapping: Mapping = new Map();
  for (const companion of data.companions) {
    for (const slot of data.slots) {
      const master = data.masters.find((entry) => entry.companion === companion.id && entry.pose === slot.name);
      mapping.set(key(companion.id, slot.name), master === undefined ? { state: "missing" } : { state: "picture", file: master.file });
    }
  }
  return mapping;
}

/** What a companion's slot shows: its picture, else the first slot down its fallback chain with one. */
export function resolve(data: MappingData, mapping: Mapping, companion: string, pose: string): Resolved {
  const own = mapping.get(key(companion, pose));
  if (own?.state === "picture") {
    return { status: "present", file: own.file };
  }
  const seen = new Set([pose]);
  let next = data.slots.find((slot) => slot.name === pose)?.fallback ?? null;
  while (next !== null && !seen.has(next)) {
    seen.add(next);
    const choice = mapping.get(key(companion, next));
    if (choice?.state === "picture") {
      return { status: "fallback", shows: next, file: choice.file };
    }
    next = data.slots.find((slot) => slot.name === next)?.fallback ?? null;
  }
  return { status: "missing" };
}

/** The warning when a picture's framing is not the one the slot asks for; null when it fits or is unknown. */
export function framingWarning(slot: Slot, picture: MappingPicture | undefined): string | null {
  if (picture?.framing == null || picture.framing === slot.framing) {
    return null;
  }
  return `${slot.title} should show the ${FRAMING_WORDS[slot.framing]}; this picture shows the ${FRAMING_WORDS[picture.framing]}.`;
}

/** The warning when a picture belongs to another companion: AGENTS.md allows no borrowed pictures. */
export function borrowWarning(data: MappingData, companion: string, picture: MappingPicture | undefined): string | null {
  if (picture === undefined || picture.companion === null) {
    return null;
  }
  // The same character in another version, such as Anki-tan and her chibi, may share pictures.
  if (related(data.companions, companion, picture.companion)) {
    return null;
  }
  const name = data.companions.find((entry) => entry.id === picture.companion)?.name ?? picture.companion;
  return `This is a picture of ${name}; no companion may borrow another's picture.`;
}

/** Every slot whose choice differs from `base`, in grid order. */
export function diff(data: MappingData, base: Mapping, current: Mapping): Change[] {
  const changes: Change[] = [];
  for (const companion of data.companions) {
    for (const slot of data.slots) {
      const id = key(companion.id, slot.name);
      const before = base.get(id) ?? { state: "missing" };
      const after = current.get(id) ?? before;
      if (!same(before, after)) {
        changes.push({ companion: companion.id, pose: slot.name, before, after });
      }
    }
  }
  return changes;
}

/** Sorts masters as manifest.json does: by companion, then pose. */
function byCompanionPose(a: MappingMaster, b: MappingMaster): number {
  const left = `${a.companion}\u0000${a.pose}`;
  const right = `${b.companion}\u0000${b.pose}`;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The mapping as manifest.json's masters: every slot with a picture, with
 * the picture's credit, and the manifest's other masters (poses that are no
 * slot, such as Ankilope's study) unchanged. A picture from the archive
 * becomes `<companion folder>/<pose>.png`, copied `from` its archive path.
 */
export function exportMapping(data: MappingData, current: Mapping): Export {
  const slotNames = new Set(data.slots.map((slot) => slot.name));
  const companionIds = new Set(data.companions.map((companion) => companion.id));
  const kept = data.masters.filter((entry) => !(companionIds.has(entry.companion) && slotNames.has(entry.pose)));
  const masters: MappingMaster[] = [...kept];
  const missing: Export["missing"] = [];

  for (const companion of data.companions) {
    for (const slot of data.slots) {
      const choice = current.get(key(companion.id, slot.name));
      if (choice === undefined || choice.state === "missing") {
        if (slot.group === "core") {
          missing.push({ companion: companion.id, pose: slot.name, issue: MISSING_ISSUE });
        }
        continue;
      }
      const picture = data.pictures.find((entry) => entry.path === choice.file);
      if (picture === undefined) {
        throw new Error(`${choice.file} is not in AnkiQuest-Art`);
      }
      const archived = picture.path.startsWith(ARCHIVE);
      masters.push({
        companion: companion.id,
        pose: slot.name,
        kind: slot.kind,
        file: archived ? `${companion.folder}/${slot.name}.png` : picture.path,
        licence: picture.licence,
        origin: picture.origin,
        author: picture.author,
        ...(picture.pack === undefined ? {} : { pack: picture.pack }),
        ...(picture.framing === null ? {} : { framing: picture.framing }),
        ...(archived ? { from: picture.path } : {}),
      });
    }
  }
  masters.sort(byCompanionPose);
  return { _about: ABOUT, art: data.art, masters, missing };
}

/**
 * Reads an exported mapping (or a bare list of masters) back: each slot
 * takes the picture its entry names (`from`, else `file`), or missing when
 * the file has no entry for it. Entries naming a picture Art does not have
 * keep the slot as manifest.json maps it, and are listed in `problems`.
 */
export function importMapping(data: MappingData, text: string): { mapping: Mapping; problems: string[] } {
  const value = JSON.parse(text);
  const list: unknown = Array.isArray(value) ? value : value?.masters;
  if (!Array.isArray(list)) {
    throw new Error("not a mapping: no masters list");
  }
  const masters = list as MappingMaster[];
  const base = baseline(data);
  const mapping: Mapping = new Map();
  const problems: string[] = [];
  const known = new Set(data.companions.map((companion) => companion.id));
  for (const entry of masters) {
    if (!known.has(entry.companion)) {
      problems.push(`${entry.companion}: no such companion; ${entry.pose} ignored`);
    }
  }

  for (const companion of data.companions) {
    for (const slot of data.slots) {
      const id = key(companion.id, slot.name);
      const entry = masters.find((master) => master.companion === companion.id && master.pose === slot.name);
      if (entry === undefined) {
        mapping.set(id, { state: "missing" });
        continue;
      }
      const file = entry.from ?? entry.file;
      if (!data.pictures.some((picture) => picture.path === file)) {
        problems.push(`${id}: ${file} is not in AnkiQuest-Art; kept as manifest.json maps it`);
        mapping.set(id, base.get(id) ?? { state: "missing" });
        continue;
      }
      mapping.set(id, { state: "picture", file });
    }
  }
  return { mapping, problems };
}

/** The draft kept in this browser: the changed slots only, and the Art commit they were made on. */
export function draftText(data: MappingData, base: Mapping, current: Mapping): string {
  const changes = diff(data, base, current).map((change) => [key(change.companion, change.pose), change.after]);
  return JSON.stringify({ version: DRAFT_VERSION, art: data.art, changes });
}

/** The mapping a draft gives on top of `base`; slots no longer in the grid are dropped. */
export function readDraft(base: Mapping, text: string | null): { mapping: Mapping; art: string | null } | null {
  if (text === null) {
    return null;
  }
  const value = JSON.parse(text);
  if (value?.version !== DRAFT_VERSION || !Array.isArray(value.changes)) {
    return null;
  }
  const mapping: Mapping = new Map(base);
  for (const [id, choice] of value.changes as [string, Choice][]) {
    if (base.has(id) && (choice?.state === "missing" || (choice?.state === "picture" && typeof choice.file === "string"))) {
      mapping.set(id, choice);
    }
  }
  return { mapping, art: value.art ?? null };
}

/**
 * Whether a picture of `other` belongs with `companion` in the picker: the same
 * companion, or one whose Art folder holds the other's (Anki-tan and her chibi).
 */
export function related(companions: MappingCompanion[], companion: string, other: string | null): boolean {
  if (other === null) {
    return false;
  }
  if (other === companion) {
    return true;
  }
  const folder = (id: string) => companions.find((entry) => entry.id === id)?.folder;
  const [a, b] = [folder(companion), folder(other)];
  return a !== undefined && b !== undefined && (a.startsWith(`${b}/`) || b.startsWith(`${a}/`));
}

/**
 * Pictures matching the picker's filters; this companion's first, then by path.
 * Unless `others` is set or a companion is chosen, only pictures related to
 * `companion` are kept.
 */
export function filterPictures(
  pictures: MappingPicture[],
  filter: { text: string; folder: string; companion: string; framing: string; others?: boolean },
  companion: string,
  companions: MappingCompanion[] = [],
): MappingPicture[] {
  const words = filter.text.toLowerCase().split(/\s+/).filter((word) => word !== "");
  const own = filter.others === false && filter.companion === "";
  const found = pictures.filter((picture) => {
    if (own && !related(companions, companion, picture.companion)) {
      return false;
    }
    if (filter.folder !== "" && picture.folder !== filter.folder) {
      return false;
    }
    if (filter.companion !== "" && (picture.companion ?? "none") !== filter.companion) {
      return false;
    }
    if (filter.framing !== "" && (picture.framing ?? "unknown") !== filter.framing) {
      return false;
    }
    const haystack = `${picture.path} ${picture.pack ?? ""} ${picture.author}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  const mine = (picture: MappingPicture) => (picture.companion === companion ? 0 : 1);
  return found.sort((a, b) => mine(a) - mine(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Escapes text for HTML content and attribute values. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A choice in words. */
function choiceText(choice: Choice): string {
  return choice.state === "missing" ? "missing" : choice.file;
}

/** A file size in KB or MB. */
function sizeText(bytes: number): string {
  return bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Reads localStorage; null when the browser blocks it. */
function load(): string | null {
  try {
    return localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

/** Writes or clears localStorage; does nothing when the browser blocks it. */
function store(text: string | null): void {
  try {
    if (text === null) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    localStorage.setItem(DRAFT_KEY, text);
  } catch {
    // A private window or blocked storage: the draft lives only in the page.
  }
}

/** Builds the page from mapping.json. */
async function main(): Promise<void> {
  const data = (await (await fetch("mapping.json")).json()) as MappingData;
  const $ = <T extends HTMLElement>(selector: string): T => document.querySelector(selector) as T;
  const pictures = new Map(data.pictures.map((picture) => [picture.path, picture]));
  const slots = new Map(data.slots.map((slot) => [slot.name, slot]));
  const companions = new Map(data.companions.map((companion) => [companion.id, companion]));
  const base = baseline(data);

  // Start from the draft in this browser, if any.
  let current: Mapping = new Map(base);
  const status = $("#status");
  try {
    const draft = readDraft(base, load());
    if (draft !== null) {
      current = draft.mapping;
      const older = draft.art !== null && draft.art !== data.art ? " It was made on another AnkiQuest-Art commit; check it against the grid." : "";
      status.textContent = `Your draft from this browser is loaded.${older}`;
    }
  } catch {
    store(null);
  }

  const slotTitle = (pose: string) => slots.get(pose)?.title ?? pose;
  const companionName = (id: string) => companions.get(id)?.name ?? id;

  // One cell: the picture, the fallback it shows, or "missing", with changes and warnings marked.
  const cell = (companion: string, slot: Slot): string => {
    const shown = resolve(data, current, companion, slot.name);
    const changed = !same(base.get(key(companion, slot.name))!, current.get(key(companion, slot.name))!);
    const picture = shown.status === "missing" ? undefined : pictures.get(shown.file);
    const tags: string[] = [];
    let label = `${companionName(companion)}, ${slot.title}: `;
    let inner = "";
    switch (shown.status) {
      case "present": {
        label += shown.file;
        inner = `<img src="${esc(picture?.thumb.src ?? "")}" alt="" width="72" height="72" loading="lazy" decoding="async">`;
        const framing = framingWarning(slot, picture);
        const borrowed = borrowWarning(data, companion, picture);
        if (framing !== null) {
          tags.push(`<span class="tag warn" title="${esc(framing)}">! framing</span>`);
          label += `. Warning: ${framing}`;
        }
        if (borrowed !== null) {
          tags.push(`<span class="tag warn" title="${esc(borrowed)}">! other companion</span>`);
          label += `. Warning: ${borrowed}`;
        }
        break;
      }
      case "fallback":
        label += `falls back to ${slotTitle(shown.shows)} (${shown.file})`;
        inner = `<img src="${esc(picture?.thumb.src ?? "")}" alt="" width="72" height="72" loading="lazy" decoding="async"><span class="note">falls back to ${esc(slotTitle(shown.shows))}</span>`;
        break;
      case "missing":
        label += "missing, shows nothing";
        inner = `<span class="blank">missing</span>`;
        break;
    }
    if (changed) {
      tags.unshift(`<span class="tag changed">changed</span>`);
      label += ". Changed";
    }
    return `<td class="${shown.status}${changed ? " is-changed" : ""}"><button type="button" class="cell" data-companion="${esc(companion)}" data-pose="${esc(slot.name)}" aria-haspopup="dialog" aria-label="${esc(`${label}. Change`)}">${inner}${tags.join("")}</button></td>`;
  };

  // The grid: a row group per slot group; each row header explains its slot.
  const grid = (): string => {
    const heads = data.companions.map((companion) => `<th scope="col">${esc(companion.name)}<small>${esc(companion.stage)}</small></th>`);
    const groups = (Object.keys(GROUPS) as SlotGroup[]).map((group) => {
      const rows = data.slots.filter((slot) => slot.group === group).map((slot) => {
        const rule = slot.framing === "headshot" ? "Rule: head only (headshot)." : "Rule: full body.";
        const fallback = slot.fallback === null ? "No fallback: a companion without it shows nothing." : `Without it: falls back to ${esc(slotTitle(slot.fallback))}.`;
        const moods = slot.moods.length === 0 ? "" : `<small>Streak moods: ${slot.moods.map(esc).join(", ")}.</small>`;
        return `<tr id="slot-${esc(slot.name)}"><th scope="row"><b>${esc(slot.title)}</b> <code>${esc(slot.name)}</code><span class="explain">${esc(slot.note)}</span><small>${rule} ${fallback}</small>${moods}</th>${data.companions.map((companion) => cell(companion.id, slot)).join("")}</tr>`;
      });
      return `<tbody><tr class="group"><th colspan="${data.companions.length + 1}" scope="rowgroup">${esc(GROUPS[group].title)}<small>${esc(GROUPS[group].note)}</small></th></tr>${rows.join("")}</tbody>`;
    });
    return `<table class="mapping"><caption class="visually-hidden">Slots by companion; each cell opens the picture picker</caption><thead><tr><th scope="col">Slot</th>${heads.join("")}</tr></thead>${groups.join("")}</table>`;
  };

  // The changes against manifest.json, each with an undo button.
  const changesList = (): void => {
    const changes = diff(data, base, current);
    $("#change-count").textContent = changes.length === 0 ? "" : `(${changes.length})`;
    $<HTMLButtonElement>("#reset-all").disabled = changes.length === 0;
    if (changes.length === 0) {
      $("#changes").innerHTML = `<li class="muted">No changes: the grid shows manifest.json.</li>`;
      return;
    }
    $("#changes").innerHTML = changes
      .map((change) => {
        const id = key(change.companion, change.pose);
        return `<li><b>${esc(companionName(change.companion))}, ${esc(slotTitle(change.pose))}</b> <code>${esc(change.pose)}</code>: <code>${esc(choiceText(change.before))}</code> → <code>${esc(choiceText(change.after))}</code> <button type="button" class="undo" data-key="${esc(id)}">Undo</button></li>`;
      })
      .join("");
  };

  // Redraw everything that depends on the mapping and keep the draft.
  const render = (): void => {
    const scrollLeft = $("#grid").scrollLeft;
    $("#grid").innerHTML = grid();
    $("#grid").scrollLeft = scrollLeft;
    changesList();
    store(diff(data, base, current).length === 0 ? null : draftText(data, base, current));
  };
  const set = (id: string, choice: Choice): void => {
    current.set(id, choice);
    render();
  };

  // The picker: filters, a large preview and every picture of Art.
  const dialog = $<HTMLDialogElement>("#picker");
  let open: { companion: string; slot: Slot; button: string } | undefined;
  let previewed: string | undefined;
  // Other companions' pictures stay hidden until asked for, each time the picker opens.
  let others = false;
  const folders = [...new Set(data.pictures.map((picture) => picture.folder))].sort();
  $("#filter-folder").innerHTML = `<option value="">Every folder</option>${folders.map((folder) => `<option>${esc(folder)}</option>`).join("")}`;
  $("#filter-companion").innerHTML = `<option value="">Every companion</option>${data.companions.map((companion) => `<option value="${esc(companion.id)}">${esc(companion.name)}</option>`).join("")}<option value="none">Several or none</option>`;

  const preview = (): void => {
    const target = $("#preview");
    const picture = previewed === undefined ? undefined : pictures.get(previewed);
    if (open === undefined || picture === undefined) {
      target.innerHTML = `<p class="muted">Choose a picture below to see it large, with its credit.</p>`;
      return;
    }
    const warnings = [framingWarning(open.slot, picture), borrowWarning(data, open.companion, picture)].filter((text) => text !== null);
    const framing = picture.framing === null ? "unknown (manifest.json does not record it)" : FRAMING_WORDS[picture.framing];
    const pack = picture.pack === undefined ? "" : `, pack <code>${esc(picture.pack)}</code>`;
    const isCurrent = same(current.get(key(open.companion, open.slot.name))!, { state: "picture", file: picture.path });
    target.innerHTML = `<img src="${esc(picture.card.src)}" alt="${esc(picture.path)}" width="${picture.card.width}" height="${picture.card.height}">
<div><p><code>${esc(picture.path)}</code></p>
<p class="credit">${esc(picture.originName)}${pack}. ${esc(picture.author)}, <a href="${esc(picture.licenceHref)}">${esc(picture.licenceName)}</a></p>
<p class="muted">${picture.width} × ${picture.height} px, ${sizeText(picture.bytes)}. Framing: ${esc(framing)}. <a href="${esc(picture.href)}" target="_blank" rel="noopener">Open full size</a></p>
${warnings.map((text) => `<p class="warn">! ${esc(text)} You can still use it.</p>`).join("")}
<button type="button" id="use" class="primary"${isCurrent ? " disabled" : ""}>${isCurrent ? "Already chosen" : "Use this picture"}</button></div>`;
    $("#use").addEventListener("click", () => choose({ state: "picture", file: picture.path }));
  };

  const results = (): void => {
    if (open === undefined) {
      return;
    }
    const filter = {
      text: $<HTMLInputElement>("#filter-text").value,
      folder: $<HTMLSelectElement>("#filter-folder").value,
      companion: $<HTMLSelectElement>("#filter-companion").value,
      framing: $<HTMLSelectElement>("#filter-framing").value,
    };
    const found = filterPictures(data.pictures, { ...filter, others }, open.companion, data.companions);
    const hidden = others ? 0 : filterPictures(data.pictures, { ...filter, others: true }, open.companion).length - found.length;
    const chosen = current.get(key(open.companion, open.slot.name));
    $("#result-count").textContent = `${found.length} of ${data.pictures.length} pictures`;
    const more = $<HTMLButtonElement>("#show-others");
    more.hidden = hidden === 0;
    more.textContent = `Show ${hidden} more from other companions`;
    $("#results").innerHTML = found
      .map((picture) => {
        const name = picture.path.slice(picture.path.lastIndexOf("/") + 1);
        const mark = chosen?.state === "picture" && chosen.file === picture.path ? `<span class="tag changed">chosen</span>` : "";
        return `<li><button type="button" class="pick" data-path="${esc(picture.path)}" aria-pressed="${picture.path === previewed}"><img src="${esc(picture.thumb.src)}" alt="" width="80" height="80" loading="lazy" decoding="async"><span>${esc(name)}</span><small>${esc(picture.folder)}</small>${mark}</button></li>`;
      })
      .join("");
  };

  const close = (): void => {
    dialog.close();
  };
  const choose = (choice: Choice): void => {
    if (open === undefined) {
      return;
    }
    const target = open;
    set(key(target.companion, target.slot.name), choice);
    status.textContent = `${companionName(target.companion)}, ${target.slot.title}: ${choiceText(choice)}.`;
    close();
  };

  const openPicker = (companion: string, pose: string): void => {
    const slot = slots.get(pose)!;
    const id = key(companion, pose);
    open = { companion, slot, button: id };
    const chosen = current.get(id)!;
    const before = base.get(id)!;
    previewed = chosen.state === "picture" ? chosen.file : undefined;
    others = false;
    const shown = resolve(data, current, companion, pose);
    const now = shown.status === "present" ? `<code>${esc(shown.file)}</code>` : shown.status === "fallback" ? `missing; falls back to ${esc(slotTitle(shown.shows))} (<code>${esc(shown.file)}</code>)` : "missing; shows nothing";
    $("#picker-title").textContent = `${companionName(companion)}: ${slot.title}`;
    $("#picker-about").innerHTML = `<p>${esc(slot.note)} ${slot.framing === "headshot" ? "Rule: head only (headshot)." : "Rule: full body."}</p>
<p>Now: ${now}. In manifest.json: <code>${esc(choiceText(before))}</code>.</p>`;
    $<HTMLButtonElement>("#set-missing").disabled = chosen.state === "missing";
    $<HTMLButtonElement>("#reset-one").disabled = same(chosen, before);
    $<HTMLButtonElement>("#set-missing").textContent = slot.fallback === null ? "Set to missing (shows nothing)" : `Set to missing (falls back to ${slotTitle(slot.fallback)})`;
    preview();
    results();
    dialog.showModal();
    $<HTMLInputElement>("#filter-text").focus();
  };

  // Clicks: a cell opens the picker; in the picker, a picture shows its preview, a double click uses it.
  $("#grid").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button.cell");
    if (button !== null) {
      openPicker(button.dataset.companion!, button.dataset.pose!);
    }
  });
  $("#results").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button.pick");
    if (button === null) {
      return;
    }
    previewed = button.dataset.path!;
    for (const other of document.querySelectorAll<HTMLButtonElement>("#results button.pick")) {
      other.setAttribute("aria-pressed", String(other === button));
    }
    preview();
    // On narrow screens the preview, with its "Use this picture" button, is above the list.
    if (window.matchMedia("(max-width: 799px)").matches) {
      $("#preview").scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
  $("#results").addEventListener("dblclick", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button.pick");
    if (button !== null) {
      choose({ state: "picture", file: button.dataset.path! });
    }
  });
  for (const id of ["#filter-text", "#filter-folder", "#filter-companion", "#filter-framing"]) {
    $(id).addEventListener("input", results);
  }
  $("#show-others").addEventListener("click", () => {
    others = true;
    results();
  });
  $("#filter-clear").addEventListener("click", () => {
    $<HTMLInputElement>("#filter-text").value = "";
    for (const id of ["#filter-folder", "#filter-companion", "#filter-framing"]) {
      $<HTMLSelectElement>(id).value = "";
    }
    results();
  });
  $("#set-missing").addEventListener("click", () => choose({ state: "missing" }));
  $("#reset-one").addEventListener("click", () => {
    if (open !== undefined) {
      choose(base.get(key(open.companion, open.slot.name))!);
    }
  });
  $("#picker-close").addEventListener("click", close);
  dialog.addEventListener("close", () => {
    // Back to the cell that opened the picker.
    const target = open;
    open = undefined;
    if (target !== undefined) {
      const [companion, pose] = [target.companion, target.slot.name];
      document.querySelector<HTMLButtonElement>(`button.cell[data-companion="${CSS.escape(companion)}"][data-pose="${CSS.escape(pose)}"]`)?.focus();
    }
  });

  // Undo one change, or all.
  $("#changes").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button.undo");
    if (button !== null) {
      set(button.dataset.key!, base.get(button.dataset.key!)!);
      status.textContent = "Change undone.";
    }
  });
  $("#reset-all").addEventListener("click", () => {
    current = new Map(base);
    render();
    status.textContent = "Every change undone: the grid shows manifest.json.";
  });

  // Export as a file or to the clipboard; import a file exported before.
  const exported = (): string => `${JSON.stringify(exportMapping(data, current), null, 2)}\n`;
  $("#download").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([exported()], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ankiquest-mapping.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    status.textContent = "Downloaded ankiquest-mapping.json.";
  });
  $("#copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(exported());
      status.textContent = "Copied the mapping JSON.";
    } catch {
      status.textContent = "The browser did not allow copying; use Download instead.";
    }
  });
  $<HTMLInputElement>("#import").addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file === undefined) {
      return;
    }
    try {
      const { mapping, problems } = importMapping(data, await file.text());
      current = mapping;
      render();
      status.textContent = `Imported ${file.name}.${problems.length > 0 ? ` ${problems.length} problems: ${problems.join("; ")}` : ""}`;
    } catch (error) {
      status.textContent = `Could not import ${file.name}: ${String(error)}`;
    }
    input.value = "";
  });

  $("#summary").textContent = `${data.slots.length} slots, ${data.companions.length} companions, ${data.pictures.length} pictures in AnkiQuest-Art${data.art === null ? "" : ` at ${data.art.slice(0, 7)}`}.`;
  render();
}

if (typeof document !== "undefined") {
  main().catch((error: unknown) => {
    document.querySelector("#summary")!.textContent = `Could not load mapping.json: ${String(error)}`;
  });
}
