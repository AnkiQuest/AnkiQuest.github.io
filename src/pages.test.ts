// Checks how the art-coverage JSON becomes pages, on a small made-up
// matrix: present, fallback and missing cells, the missing list and its
// issues, licences, who drew each picture, and the archive (Shigeyuki's
// pack and our retired art) kept apart from current art.
import assert from "node:assert/strict";
import { test } from "node:test";

import { documents, files, parse, type Coverage } from "./coverage.ts";
import type { Origin } from "./manifest.ts";
import { archivePage, companionPage, esc, issueFor, matrixPage, pageName, type ArtArchive, type Look } from "./pages.ts";

/** A small matrix in the shape `art-coverage --json` prints. */
const COVERAGE: Coverage = {
  schema: 1,
  fixture: "tests/fixtures/companion_poses.json",
  kinds: [
    { kind: "core_mood", core: true },
    { kind: "picture", core: true },
    { kind: "icon", core: true },
    { kind: "extension", core: false },
  ],
  items: [
    { name: "face", kind: "core_mood", fallback: null },
    { name: "happy", kind: "core_mood", fallback: null },
    { name: "level_up", kind: "picture", fallback: "happy" },
    { name: "icon", kind: "icon", fallback: "face" },
    { name: "frozen_2", kind: "extension", fallback: "frozen" },
  ],
  licences: {
    repository: { spdx: "AGPL-3.0-or-later", file: "LICENSE", credit: null },
    "anki-tan": {
      spdx: "CC-BY-SA-4.0",
      file: "static/anki-tan/LICENSE",
      credit: "Anki-tan by Shigeyuki (https://www.patreon.com/Shigeyuki)",
    },
  },
  companions: [
    {
      id: "aki",
      name: "Aki",
      folder: "static/aki",
      stage: "live",
      licence: "repository",
      items: [
        { name: "face", kind: "core_mood", status: "present", file: "static/aki/face.png" },
        { name: "happy", kind: "core_mood", status: "present", file: "static/aki/celebrate.png" },
        { name: "level_up", kind: "picture", status: "present", file: "static/aki/level_up.png" },
        { name: "icon", kind: "icon", status: "fallback", shows: "face", file: "static/aki/face.png" },
        { name: "frozen_2", kind: "extension", status: "missing" },
      ],
      missing: { core: ["icon"], extensions: ["frozen_2"] },
      unlisted: ["static/aki/study.png"],
    },
    {
      id: "anki_tan",
      name: "Anki-tan",
      folder: "static/anki-tan",
      stage: "live",
      licence: "anki-tan",
      items: [
        { name: "face", kind: "core_mood", status: "present", file: "static/anki-tan/face.png" },
        { name: "happy", kind: "core_mood", status: "missing" },
        { name: "level_up", kind: "picture", status: "missing" },
        { name: "icon", kind: "icon", status: "present", file: "static/anki-tan/icon.png" },
        { name: "frozen_2", kind: "extension", status: "missing" },
      ],
      missing: { core: ["happy", "level_up"], extensions: ["frozen_2"] },
      unlisted: [],
    },
    {
      id: "leech_kun",
      name: "Leech-kun",
      folder: "static/leech-kun",
      stage: "planned",
      licence: "repository",
      items: [
        { name: "face", kind: "core_mood", status: "missing" },
        { name: "happy", kind: "core_mood", status: "missing" },
        { name: "level_up", kind: "picture", status: "missing" },
        { name: "icon", kind: "icon", status: "missing" },
        { name: "frozen_2", kind: "extension", status: "missing" },
      ],
      missing: { core: ["face", "happy", "level_up", "icon"], extensions: ["frozen_2"] },
      unlisted: [],
    },
  ],
  archive: [
    {
      folder: "static/anki-tan/archive",
      licence: "anki-tan",
      readme: "static/anki-tan/archive/README.md",
      files: ["static/anki-tan/archive/sad-full.png"],
    },
    {
      folder: "static/cow/archive",
      licence: "repository",
      readme: null,
      files: ["static/cow/archive/face.png"],
    },
  ],
};

/** Who made each made-up picture: Anki-tan's face and pack files are Shigeyuki's, the archive's sad-full ours after him. */
function origin(file: string): Origin {
  if (file === "static/anki-tan/face.png" || file.startsWith("archive/anki-tan-pack/")) {
    return "shigeyuki";
  }
  return file.includes("anki-tan") ? "derivative" : "ankiquest";
}

/** Site paths that show where each picture went, and its credit, without touching disk. */
const look: Look = (file) => {
  const made = origin(file);
  return {
    href: `files/${file}`,
    thumb: { src: `thumbs/${file}.webp`, width: 160, height: 160 },
    card: { src: `cards/${file}.webp`, width: 320, height: 320 },
    picture: {
      file,
      origin: made,
      author: made === "shigeyuki" ? "Shigeyuki" : made === "derivative" ? "AnkiQuest, after Shigeyuki" : "AnkiQuest",
      licence: file.includes("anki-tan") ? "CC-BY-SA-4.0" : "AGPL-3.0-or-later",
      pack: made === "shigeyuki" ? "sticker/face.png" : undefined,
    },
  };
};

/** Art's archive, made up: two pack files, one used as a master, and one retired picture. */
const ARCHIVE: ArtArchive = {
  pack: {
    companion: "anki_tan",
    folder: "archive/anki-tan-pack/",
    origin: "shigeyuki",
    author: "Shigeyuki",
    licence: "CC-BY-SA-4.0",
    source: "https://shigeyukey.github.io/shige-addons-wiki/Anki-tan.html",
  },
  packReadme: "archive/anki-tan-pack/README.md",
  packFiles: ["archive/anki-tan-pack/emoji/smile.png", "archive/anki-tan-pack/sprite/idle/0001.png"],
  packUsed: [{ pack: "sticker/face.png", file: "static/anki-tan/face.png", uses: [{ companion: "anki_tan", pose: "face" }] }],
  retired: [
    {
      companion: "anki_tan",
      pose: "neglected",
      file: "archive/anki-tan/sad-full.png",
      replaced_by: "anki-tan/neglected.png",
      note: "All stars lit.",
      licence: "CC-BY-SA-4.0",
      origin: "derivative",
      author: "AnkiQuest, after Shigeyuki",
    },
  ],
  retiredReadmes: ["archive/anki-tan/README.md"],
};

const aki = COVERAGE.companions[0];
const ankiTan = COVERAGE.companions[1];
const leech = COVERAGE.companions[2];

/** The HTML of the matrix cell for `item` in `companion`'s column. */
function cell(html: string, companion: string, item: string): string {
  const found = html.match(new RegExp(`<td data-companion="${companion}" data-item="${item}"[^>]*>([\\s\\S]*?)</td>`));
  assert.ok(found, `no cell ${companion} ${item}`);
  return found[0];
}

/** The HTML of the card for `item` on a companion page. */
function card(html: string, item: string): string {
  const found = html.match(new RegExp(`<li[^>]* id="${item}"[^>]*>([\\s\\S]*?)</li>`));
  assert.ok(found, `no card ${item}`);
  return found[0];
}

test("parse reads schema 1 and fails on any other", () => {
  assert.equal(parse(JSON.stringify(COVERAGE)).companions.length, 3);
  assert.throws(() => parse(JSON.stringify({ ...COVERAGE, schema: 2 })), /schema 2/);
  assert.throws(() => parse("{}"), /schema undefined/);
});

test("parse fails on a licence key the licences do not list", () => {
  const broken = { ...COVERAGE, archive: [{ ...COVERAGE.archive[0], licence: "nobody" }] };
  assert.throws(() => parse(JSON.stringify(broken)), /unknown licences: nobody/);
});

test("files: every picture once; documents: licences and READMEs", () => {
  assert.deepEqual(files(COVERAGE), [
    "static/aki/celebrate.png",
    "static/aki/face.png",
    "static/aki/level_up.png",
    "static/aki/study.png",
    "static/anki-tan/archive/sad-full.png",
    "static/anki-tan/face.png",
    "static/anki-tan/icon.png",
    "static/cow/archive/face.png",
  ]);
  assert.deepEqual(documents(COVERAGE), ["LICENSE", "static/anki-tan/LICENSE", "static/anki-tan/archive/README.md"]);
});

test("issues: poses and extensions #57, icons and pictures #116", () => {
  assert.match(issueFor("core_mood") ?? "", /AnkiQuest-Server\/issues\/57$/);
  assert.match(issueFor("extension") ?? "", /issues\/57$/);
  assert.match(issueFor("picture") ?? "", /issues\/116$/);
  assert.match(issueFor("icon") ?? "", /issues\/116$/);
  assert.equal(issueFor("something_new"), undefined);
});

test("matrix: a present cell shows its picture", () => {
  const html = matrixPage(COVERAGE, look);
  const present = cell(html, "aki", "happy");
  assert.match(present, /class="present"/);
  assert.match(present, /src="thumbs\/static\/aki\/celebrate\.png\.webp"/);
  assert.match(present, /href="files\/static\/aki\/celebrate\.png"/);
});

test("matrix: a fallback cell names the item it shows", () => {
  const html = matrixPage(COVERAGE, look);
  const fallback = cell(html, "aki", "icon");
  assert.match(fallback, /class="fallback"/);
  assert.match(fallback, /shows face/);
  assert.match(fallback, /src="thumbs\/static\/aki\/face\.png\.webp"/);
});

test("matrix: a missing cell shows no picture", () => {
  const html = matrixPage(COVERAGE, look);
  const missing = cell(html, "aki", "frozen_2");
  assert.match(missing, /class="missing"/);
  assert.match(missing, />missing</);
  assert.doesNotMatch(missing, /<img/);
});

test("matrix: rows by kind, each row names its fallback", () => {
  const html = matrixPage(COVERAGE, look);
  const kinds = [...html.matchAll(/<th colspan="\d+" scope="rowgroup">([^<]*)/g)].map((m) => m[1]);
  assert.deepEqual(kinds, ["Core moods", "Moment and share-card pictures", "Launcher icons", "Extensions"]);
  assert.match(html, /<th scope="row"[^>]*>level up<small>fallback: happy<\/small><\/th>/);
});

test("matrix: each column names its licence; undrawn companions are listed apart", () => {
  const html = matrixPage(COVERAGE, look);
  const head = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
  assert.match(head, /Aki[\s\S]*AGPL-3\.0-or-later/);
  assert.match(head, /Anki-tan[\s\S]*CC-BY-SA-4\.0/);
  assert.doesNotMatch(head, /Leech-kun/);
  assert.match(html, /Nothing drawn yet: <a href="leech_kun\.html">Leech-kun<\/a>/);
});

test("matrix and companion pages never show the archive", () => {
  const pages = [matrixPage(COVERAGE, look), ...COVERAGE.companions.map((c) => companionPage(COVERAGE, c, look))];
  for (const html of pages) {
    assert.doesNotMatch(html, /\/archive\/[^"]*\.png/);
  }
});

test("archive: Shigeyuki's pack apart from our retired art, each with licence and README", () => {
  const html = archivePage(COVERAGE, look, ARCHIVE, (file) => `About ${file}.`);
  const pack = html.slice(html.indexOf('id="shigeyuki"'), html.indexOf('id="retired"'));
  assert.match(pack, /<h2>Shigeyuki's original art<\/h2>/);
  assert.match(pack, /CC-BY-SA-4\.0/);
  assert.match(pack, /Anki-tan by Shigeyuki/);
  assert.match(pack, /About archive\/anki-tan-pack\/README\.md\./);
  assert.match(pack, /emoji\/smile\.png/);
  assert.match(pack, /<details>\s*<summary><code>sprite\/idle<\/code>: 1 frames<\/summary>/);
  assert.doesNotMatch(pack, /sad-full/);
  const retired = html.slice(html.indexOf('id="retired"'));
  assert.match(retired, /<h2>Art we made, retired<\/h2>/);
  assert.match(retired, /About archive\/anki-tan\/README\.md\./);
  assert.match(retired, /<li id="archive\/anki-tan\/sad-full\.png">/);
  assert.match(retired, /Replaced by <a href="anki_tan\.html#neglected">Anki-tan: neglected<\/a>/);
  assert.match(retired, /All stars lit\./);
  assert.doesNotMatch(retired, /smile\.png/);
});

test("archive: pack files the apps use are named and linked, not shown", () => {
  const html = archivePage(COVERAGE, look, ARCHIVE);
  assert.match(html, /<code>sticker\/face\.png<\/code>: <a href="anki_tan\.html#face">Anki-tan: face<\/a>/);
  assert.doesNotMatch(html, /static\/aki\//);
  assert.doesNotMatch(html, /src="[^"]*static\/anki-tan\/face\.png/);
});

test("cards credit origin, author and licence", () => {
  const tan = companionPage(COVERAGE, ankiTan, look);
  assert.match(card(tan, "face"), /class="credit shigeyuki">Shigeyuki&#39;s original, pack <code>sticker\/face\.png<\/code>\. Shigeyuki, <a href="files\/anki-tan\/LICENSE">CC BY-SA 4\.0<\/a>/);
  const akiPage = companionPage(COVERAGE, aki, look);
  assert.match(card(akiPage, "happy"), /class="credit ankiquest">Made by AnkiQuest\. AnkiQuest, <a href="files\/LICENSE">AGPL-3\.0-or-later<\/a>/);
  assert.match(card(akiPage, "icon"), /class="credit ankiquest">/);
  assert.doesNotMatch(card(akiPage, "frozen_2"), /credit/);
  const archive = archivePage(COVERAGE, look, ARCHIVE);
  assert.match(archive, /class="credit derivative">Made by AnkiQuest from Shigeyuki&#39;s Anki-tan\. AnkiQuest, after Shigeyuki/);
});

test("companion page: Shigeyuki's originals apart from ours, ours in use apart from retired", () => {
  const tan = companionPage(COVERAGE, ankiTan, look, ARCHIVE.retired);
  const list = tan.slice(tan.indexOf('<h2 id="origin">'), tan.indexOf('<h2 id="missing">'));
  assert.match(list, /Shigeyuki's original art, from his Anki-tan pack: <a href="#face">face<\/a>\./);
  assert.match(list, /Art we made, in use: <a href="#icon">icon<\/a>\./);
  assert.match(list, /Art we made, retired: <a href="archive\.html#archive\/anki-tan\/sad-full\.png">neglected<\/a>/);
  const akiPage = companionPage(COVERAGE, aki, look);
  assert.doesNotMatch(akiPage, /Shigeyuki's original art/);
  assert.match(akiPage, /Art we made, in use: <a href="#face">face<\/a>, <a href="#happy">happy<\/a>, <a href="#level_up">level up<\/a>, <a href="#unlisted">study\.png<\/a>\./);
  assert.match(akiPage, /Art we made, retired: none\./);
});

test("matrix: Shigeyuki's originals are marked; shared pictures have their own section", () => {
  const shared = [{ name: "friends", shows: ["aki", "anki_tan"], file: "duo/friends.png", licence: "AGPL-3.0-or-later", origin: "ankiquest" as const, author: "AnkiQuest" }];
  const html = matrixPage(COVERAGE, look, shared);
  assert.match(cell(html, "anki_tan", "face"), /data-origin="shigeyuki"/);
  assert.match(cell(html, "aki", "face"), /data-origin="ankiquest"/);
  assert.doesNotMatch(cell(html, "aki", "frozen_2"), /data-origin/);
  assert.match(html, /<h2 id="shared">Pictures of several companions<\/h2>[\s\S]*duo\/friends\.png[\s\S]*Made by AnkiQuest/);
  assert.doesNotMatch(matrixPage(COVERAGE, look), /id="shared"/);
});

test("companion page: one licence line with the credit it requires", () => {
  const html = companionPage(COVERAGE, ankiTan, look);
  const licences = [...html.matchAll(/class="licence"/g)];
  assert.equal(licences.length, 1);
  assert.match(html, /<a href="files\/static\/anki-tan\/LICENSE">CC-BY-SA-4\.0<\/a>/);
  assert.match(html, /Anki-tan by Shigeyuki \(<a href="https:\/\/www\.patreon\.com\/Shigeyuki">/);
  assert.match(companionPage(COVERAGE, aki, look), /<a href="files\/LICENSE">AGPL-3\.0-or-later<\/a>/);
});

test("companion page: the missing list gives fallback and issue for each item", () => {
  const html = companionPage(COVERAGE, aki, look);
  const groups = [...html.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<ul class="missing-list">([\s\S]*?)<\/ul>/g)];
  assert.equal(groups.length, 2);
  assert.match(groups[0][1], /^Core items, tracked in .*issues\/116/);
  assert.match(groups[0][2], /icon<\/a> \(launcher icon\): shows face/);
  assert.match(groups[1][1], /^Extensions, tracked in .*issues\/57/);
  assert.match(groups[1][2], /frozen 2<\/a> \(extension\): shows nothing/);
});

test("companion page: core items of one issue share a group", () => {
  const html = companionPage(COVERAGE, leech, look);
  const titles = [...html.matchAll(/<h3>([^<]*)/g)].map((m) => m[1]);
  assert.deepEqual(titles, ["Core items, tracked in ", "Core items, tracked in ", "Extensions, tracked in "]);
  assert.match(html, /<h3>Core items, tracked in <a href="[^"]*\/57">[\s\S]*face[\s\S]*happy[\s\S]*<h3>Core items, tracked in <a href="[^"]*\/116">[\s\S]*level up[\s\S]*icon/);
});

test("companion page: core and extension counts, and a card per item", () => {
  const html = companionPage(COVERAGE, ankiTan, look);
  assert.match(html, /2 core items and 1 extension missing/);
  assert.match(card(html, "face"), /class="present"/);
  assert.match(card(html, "happy"), /class="missing"/);
  assert.doesNotMatch(card(html, "happy"), /<img/);
});

test("companion page: unlisted pictures get a section of their own", () => {
  const html = companionPage(COVERAGE, aki, look);
  assert.match(html, /<h2[^>]*>Not in the pose list<\/h2>[\s\S]*study\.png/);
  assert.doesNotMatch(companionPage(COVERAGE, ankiTan, look), /Not in the pose list/);
});

test("companion page: nothing drawn says so and shows no cards", () => {
  const html = companionPage(COVERAGE, leech, look);
  assert.match(html, /Nothing drawn yet/);
  assert.match(html, /Planned/);
  assert.doesNotMatch(html, /<img/);
});

test("page names: one file per companion; a clash with a fixed page fails", () => {
  assert.equal(pageName(aki), "aki.html");
  assert.throws(() => pageName({ ...aki, id: "archive" }), /clashes/);
});

test("escapes markup", () => {
  assert.equal(esc(`<a href="x">&'`), "&#60;a href=&#34;x&#34;&#62;&#38;&#39;");
});
